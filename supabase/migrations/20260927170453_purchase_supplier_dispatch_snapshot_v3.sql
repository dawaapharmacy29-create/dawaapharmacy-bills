alter table public.purchase_order_supplier_dispatches
  add column if not exists snapshot_items jsonb,
  add column if not exists snapshot_items_count integer,
  add column if not exists snapshot_quantity numeric,
  add column if not exists snapshot_total numeric,
  add column if not exists snapshot_hash text,
  add column if not exists snapshot_order_approved_at timestamptz;

create or replace function public.smart_purchase_supplier_dispatch_v3(
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
  a record; v_order_id uuid; v_supplier text;
  v_order public.smart_purchase_orders%rowtype;
  v_required integer:=0; v_sent integer:=0;
  v_snapshot jsonb; v_items_count integer:=0;
  v_quantity numeric:=0; v_total numeric:=0; v_hash text;
begin
  select sa.* into a
  from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  v_order_id:=nullif(p_payload->>'order_id','')::uuid;
  if v_order_id is null then return jsonb_build_object('ok',false,'error','order_required'); end if;
  select * into v_order from public.smart_purchase_orders where id=v_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;

  if p_action='list' then
    return jsonb_build_object('ok',true,'data',jsonb_build_object(
      'suppliers',coalesce((
        select jsonb_agg(jsonb_build_object(
          'supplier_name',x.supplier_name,'items_count',x.items_count,
          'total_quantity',x.total_quantity,'total_value',x.total_value,
          'sent_at',d.sent_at,'sent_by_name',d.sent_by_name,'sent',d.sent_at is not null,
          'snapshot_items_count',d.snapshot_items_count,'snapshot_quantity',d.snapshot_quantity,
          'snapshot_total',d.snapshot_total,'snapshot_hash',d.snapshot_hash,
          'snapshot_order_approved_at',d.snapshot_order_approved_at,
          'snapshot_matches_current',case when d.sent_at is null or d.snapshot_hash is null then null else d.snapshot_hash=x.current_hash end
        ) order by x.supplier_name)
        from (
          select trim(i.supplier_name) supplier_name,count(*)::int items_count,
            sum(coalesce(i.approved_quantity,0))::numeric total_quantity,
            sum(coalesce(i.approved_quantity,0)*coalesce(i.expected_unit_cost,0))::numeric total_value,
            encode(extensions.digest(
              coalesce(jsonb_agg(jsonb_build_object(
                'id',i.id,'product_code',coalesce(i.product_code,''),
                'product_name',coalesce(i.product_name,''),
                'approved_quantity',coalesce(i.approved_quantity,0),
                'expected_unit_cost',coalesce(i.expected_unit_cost,0),
                'expected_discount',coalesce(i.expected_discount,0)
              ) order by coalesce(i.product_code,''),coalesce(i.product_name,''),i.id),'[]'::jsonb)::text,
              'sha256'
            ),'hex') current_hash
          from public.smart_purchase_order_items i
          where i.order_id=v_order_id and coalesce(i.approved_quantity,0)>0
            and nullif(trim(coalesce(i.supplier_name,'')),'') is not null
          group by trim(i.supplier_name)
        ) x
        left join public.purchase_order_supplier_dispatches d
          on d.order_id=v_order_id and lower(trim(d.supplier_name))=lower(trim(x.supplier_name))
      ),'[]'::jsonb)
    ));

  elsif p_action='mark_supplier_sent' then
    if a.role not in ('general_manager','branch_manager','purchasing') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
    if v_order.status not in ('معتمدة','تم الإرسال للمورد','partially_received','وصلت جزئيًا') then
      return jsonb_build_object('ok',false,'error','order_not_ready_to_send','status',v_order.status);
    end if;

    v_supplier:=nullif(trim(p_payload->>'supplier_name'),'');
    if v_supplier is null then return jsonb_build_object('ok',false,'error','supplier_required'); end if;

    select
      coalesce(jsonb_agg(jsonb_build_object(
        'id',i.id,'product_code',coalesce(i.product_code,''),
        'product_name',coalesce(i.product_name,''),
        'approved_quantity',coalesce(i.approved_quantity,0),
        'expected_unit_cost',coalesce(i.expected_unit_cost,0),
        'expected_discount',coalesce(i.expected_discount,0)
      ) order by coalesce(i.product_code,''),coalesce(i.product_name,''),i.id),'[]'::jsonb),
      count(*)::int,coalesce(sum(i.approved_quantity),0)::numeric,
      coalesce(sum(i.approved_quantity*i.expected_unit_cost),0)::numeric
    into v_snapshot,v_items_count,v_quantity,v_total
    from public.smart_purchase_order_items i
    where i.order_id=v_order_id and coalesce(i.approved_quantity,0)>0
      and lower(trim(coalesce(i.supplier_name,'')))=lower(trim(v_supplier));

    if v_items_count=0 then return jsonb_build_object('ok',false,'error','supplier_not_in_order'); end if;

    if exists(
      select 1 from public.smart_purchase_order_items i
      where i.order_id=v_order_id and coalesce(i.approved_quantity,0)>0
        and lower(trim(coalesce(i.supplier_name,'')))=lower(trim(v_supplier))
        and (coalesce(i.expected_unit_cost,0)<=0 or i.cost_verified_at is null)
    ) then return jsonb_build_object('ok',false,'error','supplier_items_not_send_ready'); end if;

    v_hash:=encode(extensions.digest(v_snapshot::text,'sha256'),'hex');

    insert into public.purchase_order_supplier_dispatches(
      order_id,supplier_name,sent_at,sent_by_account_id,sent_by_name,
      snapshot_items,snapshot_items_count,snapshot_quantity,snapshot_total,snapshot_hash,
      snapshot_order_approved_at,created_at,updated_at
    ) values (
      v_order_id,v_supplier,now(),a.id,a.display_name,
      v_snapshot,v_items_count,v_quantity,v_total,v_hash,
      v_order.approved_at,now(),now()
    )
    on conflict(order_id,supplier_name) do update set
      sent_at=excluded.sent_at,sent_by_account_id=excluded.sent_by_account_id,
      sent_by_name=excluded.sent_by_name,snapshot_items=excluded.snapshot_items,
      snapshot_items_count=excluded.snapshot_items_count,snapshot_quantity=excluded.snapshot_quantity,
      snapshot_total=excluded.snapshot_total,snapshot_hash=excluded.snapshot_hash,
      snapshot_order_approved_at=excluded.snapshot_order_approved_at,updated_at=now();

    select count(distinct lower(trim(i.supplier_name))) into v_required
    from public.smart_purchase_order_items i
    where i.order_id=v_order_id and coalesce(i.approved_quantity,0)>0
      and nullif(trim(coalesce(i.supplier_name,'')),'') is not null;

    select count(distinct lower(trim(d.supplier_name))) into v_sent
    from public.purchase_order_supplier_dispatches d
    where d.order_id=v_order_id and d.sent_at is not null;

    if v_required>0 and v_sent>=v_required and v_order.status in ('معتمدة','تم الإرسال للمورد') then
      update public.smart_purchase_orders
      set status='تم الإرسال للمورد',sent_at=coalesce(sent_at,now()),
          sent_by_name=a.display_name,updated_at=now()
      where id=v_order_id;
    end if;

    return jsonb_build_object('ok',true,'data',jsonb_build_object(
      'supplier_name',v_supplier,'required_suppliers',v_required,'sent_suppliers',v_sent,
      'all_sent',(v_required>0 and v_sent>=v_required),'snapshot_items_count',v_items_count,
      'snapshot_quantity',v_quantity,'snapshot_total',v_total,'snapshot_hash',v_hash
    ));
  end if;

  return jsonb_build_object('ok',false,'error','unsupported_action');
end $$;

create or replace function public.smart_purchase_supplier_dispatch_guarded_v3(
  p_session_token text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','extensions'
as $$
declare a record; o record; v_order_id uuid;
begin
  select sa.* into a
  from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  v_order_id:=nullif(p_payload->>'order_id','')::uuid;
  if v_order_id is null then return jsonb_build_object('ok',false,'error','order_required'); end if;
  select id,branch into o from public.smart_purchase_orders where id=v_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;
  return public.smart_purchase_supplier_dispatch_v3(p_session_token,p_action,p_payload);
end $$;

revoke all on function public.smart_purchase_supplier_dispatch_v3(text,text,jsonb) from public;
revoke all on function public.smart_purchase_supplier_dispatch_guarded_v3(text,text,jsonb) from public;
grant execute on function public.smart_purchase_supplier_dispatch_guarded_v3(text,text,jsonb) to anon,authenticated;
