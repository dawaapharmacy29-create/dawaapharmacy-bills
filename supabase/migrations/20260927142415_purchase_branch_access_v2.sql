-- Branch-aware purchase center read/review RPC for the V2 workflow.
create or replace function public.smart_purchase_branch_allowed_v2(
  p_account_id uuid,
  p_branch text
)
returns boolean
language sql
stable
security definer
set search_path='pg_catalog','public'
as $$
  select case
    when sa.id is null or sa.status<>'active' then false
    when sa.role in ('general_manager','purchasing','accountant','invoice_reviewer') then true
    when sa.role='branch_manager' then
      coalesce(sa.branch_ids,'[]'::jsonb) ? coalesce(p_branch,'')
      or coalesce(sa.branch_ids,'[]'::jsonb) ? replace(coalesce(p_branch,''),'دواء ','')
      or coalesce(sa.branch_ids,'[]'::jsonb) ? replace(coalesce(p_branch,''),'فرع ','')
      or coalesce(sa.branch_ids,'[]'::jsonb) ? ('دواء '||replace(coalesce(p_branch,''),'دواء ',''))
    else false
  end
  from public.staff_accounts sa
  where sa.id=p_account_id
$$;

revoke all on function public.smart_purchase_branch_allowed_v2(uuid,text) from public;

create or replace function public.smart_purchase_unified_v2(
  p_session_token text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','extensions'
as $$
declare
  a record;
  o public.smart_purchase_orders%rowtype;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null
    and ss.expires_at>now()
    and sa.status='active'
  order by ss.created_at desc
  limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  if p_action='dashboard' then
    return jsonb_build_object('ok',true,'data',jsonb_build_object(
      'orders',coalesce((
        select jsonb_agg(to_jsonb(x) order by x.created_at desc)
        from public.smart_purchase_orders x
        where public.smart_purchase_branch_allowed_v2(a.id,x.branch)
      ),'[]'::jsonb),
      'treasuries','[]'::jsonb,
      'pending_actions',jsonb_build_object(
        'draft',coalesce((
          select count(*) from public.smart_purchase_orders x
          where x.status in ('draft','مسودة')
            and public.smart_purchase_branch_allowed_v2(a.id,x.branch)
        ),0),
        'needs_supplier',coalesce((
          select count(distinct i.order_id)
          from public.smart_purchase_order_items i
          join public.smart_purchase_orders x on x.id=i.order_id
          where coalesce(i.supplier_name,'')=''
            and x.status not in ('مغلقة','ملغاة')
            and public.smart_purchase_branch_allowed_v2(a.id,x.branch)
        ),0),
        'pending_receiving',coalesce((
          select count(*) from public.smart_purchase_orders x
          where x.status in ('معتمدة','تم الإرسال للمورد','وصلت جزئيًا','partially_received')
            and public.smart_purchase_branch_allowed_v2(a.id,x.branch)
        ),0)
      )
    ));

  elsif p_action='get_order' then
    select * into o
    from public.smart_purchase_orders
    where id=(p_payload->>'id')::uuid;

    if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
    if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then
      return jsonb_build_object('ok',false,'error','forbidden_branch');
    end if;

    return jsonb_build_object('ok',true,'data',jsonb_build_object(
      'order',to_jsonb(o),
      'items',coalesce((
        select jsonb_agg(to_jsonb(i) order by i.priority_score desc,i.product_name)
        from public.smart_purchase_order_items i
        where i.order_id=o.id
      ),'[]'::jsonb),
      'supplier_groups',coalesce((
        select jsonb_agg(x)
        from (
          select jsonb_build_object(
            'supplier_name',coalesce(i.supplier_name,'بدون مورد'),
            'items_count',count(*),
            'total',sum(coalesce(i.approved_quantity,0)*coalesce(i.expected_unit_cost,0))
          ) x
          from public.smart_purchase_order_items i
          where i.order_id=o.id
          group by coalesce(i.supplier_name,'بدون مورد')
        ) q
      ),'[]'::jsonb)
    ));

  elsif p_action='return_to_review' then
    if a.role not in ('general_manager','branch_manager','purchasing') then
      return jsonb_build_object('ok',false,'error','forbidden');
    end if;

    select * into o
    from public.smart_purchase_orders
    where id=(p_payload->>'order_id')::uuid
    for update;

    if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
    if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then
      return jsonb_build_object('ok',false,'error','forbidden_branch');
    end if;
    if o.status not in ('معتمدة','approved') then
      return jsonb_build_object('ok',false,'error','order_not_returnable','status',o.status);
    end if;
    if exists(
      select 1 from public.purchase_order_supplier_dispatches d
      where d.order_id=o.id and d.sent_at is not null
    ) then
      return jsonb_build_object('ok',false,'error','order_already_dispatched');
    end if;

    update public.smart_purchase_orders
    set status='مسودة',
        approved_by_account_id=null,
        approved_by_name=null,
        approved_at=null,
        updated_at=now()
    where id=o.id;

    update public.smart_purchase_order_items
    set status='مقترح',
        approved_by_account_id=null,
        approved_by_name=null,
        approved_at=null,
        updated_at=now()
    where order_id=o.id;

    return jsonb_build_object('ok',true,'data',jsonb_build_object('order_id',o.id,'status','مسودة'));
  end if;

  return jsonb_build_object('ok',false,'error','unsupported_action');
end $$;

revoke all on function public.smart_purchase_unified_v2(text,text,jsonb) from public;
grant execute on function public.smart_purchase_unified_v2(text,text,jsonb) to anon,authenticated;
