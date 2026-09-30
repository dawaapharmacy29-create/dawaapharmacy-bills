-- Branch-aware receiving reads, workflow snapshots, and customer follow-ups.

CREATE OR REPLACE FUNCTION public.smart_purchase_followups_v2(p_session_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  a record;
  v_order uuid;
  v_branch text;
  v_created int:=0;
  v_updated int:=0;
  v_row_updated int:=0;
  r jsonb;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing','accountant','invoice_reviewer') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  v_order:=nullif(p_payload->>'order_id','')::uuid;

  if v_order is not null then
    select branch into v_branch from public.smart_purchase_orders where id=v_order;
    if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
    if not public.smart_purchase_branch_allowed_v2(a.id,v_branch) then
      return jsonb_build_object('ok',false,'error','forbidden_branch');
    end if;
  end if;

  if p_action='create' then
    if v_order is null then return jsonb_build_object('ok',false,'error','order_required'); end if;

    insert into public.smart_purchase_customer_followups(
      order_id,order_item_id,pharmacy_order_id,branch,product_code,product_name,
      customer_name,customer_code,phone,request_date
    )
    select i.order_id,i.id,po.id,o.branch,i.product_code,i.product_name,
      po.customer_name,po.customer_code,po.phone,po.request_date
    from public.smart_purchase_order_items i
    join public.smart_purchase_orders o on o.id=i.order_id
    join public.pharmacy_orders po
      on po.branch=o.branch
      and po.status not in ('تم التسليم','ملغي','مكتمل')
      and lower(trim(po.product_name))=lower(trim(i.product_name))
    where i.order_id=v_order and coalesce(i.received_quantity,0)>0
    on conflict(order_item_id,pharmacy_order_id) do nothing;

    get diagnostics v_created=row_count;
    return jsonb_build_object('ok',true,'data',jsonb_build_object('created',v_created));

  elsif p_action='list' then
    return jsonb_build_object('ok',true,'data',coalesce((
      select jsonb_agg(to_jsonb(f) order by f.status,f.request_date nulls last,f.customer_name)
      from public.smart_purchase_customer_followups f
      where (v_order is null or f.order_id=v_order)
        and public.smart_purchase_branch_allowed_v2(a.id,f.branch)
    ),'[]'::jsonb));

  elsif p_action='update' then
    for r in select value from jsonb_array_elements(coalesce(p_payload->'rows','[]'::jsonb)) loop
      update public.smart_purchase_customer_followups f
      set status=coalesce(nullif(r->>'status',''),f.status),
          contact_result=coalesce(nullif(r->>'contact_result',''),f.contact_result),
          notes=coalesce(r->>'notes',f.notes),
          contacted_at=case when nullif(r->>'status','') is not null and (r->>'status')<>'بانتظار التواصل' then now() else f.contacted_at end,
          contacted_by_account_id=case when nullif(r->>'status','') is not null then a.id else f.contacted_by_account_id end,
          contacted_by_name=case when nullif(r->>'status','') is not null then a.display_name else f.contacted_by_name end,
          updated_at=now()
      where f.id=(r->>'id')::uuid
        and public.smart_purchase_branch_allowed_v2(a.id,f.branch);
      get diagnostics v_row_updated=row_count;
      v_updated:=v_updated+v_row_updated;
    end loop;

    return jsonb_build_object('ok',true,'data',jsonb_build_object('updated',v_updated));
  end if;

  return jsonb_build_object('ok',false,'error','unsupported_action');
end $function$


CREATE OR REPLACE FUNCTION public.smart_purchase_receiving_read_v2(p_session_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  a record;
  v_order_id uuid;
  o public.smart_purchase_orders%rowtype;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing','accountant','invoice_reviewer') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  if p_action='list_orders' then
    return jsonb_build_object('ok',true,'data',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',x.id,
        'order_number',x.order_number,
        'branch',x.branch,
        'title',x.title,
        'status',x.status,
        'expected_total',x.expected_total,
        'approved_total',x.approved_total,
        'received_total',x.received_total,
        'created_at',x.created_at,
        'items_count',(select count(*) from public.smart_purchase_order_items i where i.order_id=x.id),
        'received_items',(select count(*) from public.smart_purchase_order_items i where i.order_id=x.id and coalesce(i.received_quantity,0)>0)
      ) order by x.created_at desc)
      from public.smart_purchase_orders x
      where public.smart_purchase_branch_allowed_v2(a.id,x.branch)
    ),'[]'::jsonb));

  elsif p_action='get_order' then
    v_order_id:=nullif(p_payload->>'id','')::uuid;
    select * into o from public.smart_purchase_orders where id=v_order_id;
    if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
    if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then
      return jsonb_build_object('ok',false,'error','forbidden_branch');
    end if;

    return jsonb_build_object('ok',true,'data',jsonb_build_object(
      'order',to_jsonb(o),
      'items',coalesce((
        select jsonb_agg(to_jsonb(i) order by i.supplier_name nulls last,i.product_name)
        from public.smart_purchase_order_items i where i.order_id=v_order_id
      ),'[]'::jsonb),
      'receipts',coalesce((
        select jsonb_agg(to_jsonb(r) order by r.created_at desc)
        from public.purchase_order_receipts r where r.order_id=v_order_id
      ),'[]'::jsonb)
    ));
  end if;

  return jsonb_build_object('ok',false,'error','unsupported_action');
end $function$


CREATE OR REPLACE FUNCTION public.smart_purchase_save_workflow_snapshot_guarded_v2(p_session_token text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  a record;
  v_order_id uuid;
  o record;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing','accountant','invoice_reviewer') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  v_order_id:=nullif(p_payload->>'order_id','')::uuid;
  if v_order_id is null then return jsonb_build_object('ok',false,'error','invalid_order'); end if;

  select id,branch into o from public.smart_purchase_orders where id=v_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;

  return public.smart_purchase_save_workflow_snapshot(p_session_token,p_payload);
end $function$


revoke all on function public.smart_purchase_receiving_read_v2(text,text,jsonb) from public;
revoke all on function public.smart_purchase_save_workflow_snapshot_guarded_v2(text,jsonb) from public;
revoke all on function public.smart_purchase_followups_v2(text,text,jsonb) from public;
grant execute on function public.smart_purchase_receiving_read_v2(text,text,jsonb) to anon,authenticated;
grant execute on function public.smart_purchase_save_workflow_snapshot_guarded_v2(text,jsonb) to anon,authenticated;
grant execute on function public.smart_purchase_followups_v2(text,text,jsonb) to anon,authenticated;
