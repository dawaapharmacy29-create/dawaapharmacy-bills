-- Keep supplier dispatch tracking usable during partial receiving, and require supplier dispatch before new receipt posting.
create or replace function public.smart_purchase_supplier_dispatch_v2(
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
  v_order_id uuid;
  v_supplier text;
  v_order public.smart_purchase_orders%rowtype;
  v_required integer:=0;
  v_sent integer:=0;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
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
          'supplier_name',x.supplier_name,
          'items_count',x.items_count,
          'total_value',x.total_value,
          'sent_at',d.sent_at,
          'sent_by_name',d.sent_by_name,
          'sent',d.sent_at is not null
        ) order by x.supplier_name)
        from (
          select trim(i.supplier_name) supplier_name,
                 count(*) items_count,
                 sum(coalesce(i.approved_quantity,0)*coalesce(i.expected_unit_cost,0)) total_value
          from public.smart_purchase_order_items i
          where i.order_id=v_order_id
            and coalesce(i.approved_quantity,0)>0
            and nullif(trim(coalesce(i.supplier_name,'')),'') is not null
          group by trim(i.supplier_name)
        ) x
        left join public.purchase_order_supplier_dispatches d
          on d.order_id=v_order_id and lower(trim(d.supplier_name))=lower(trim(x.supplier_name))
      ),'[]'::jsonb)
    ));

  elsif p_action='mark_supplier_sent' then
    if a.role not in ('general_manager','branch_manager','purchasing') then
      return jsonb_build_object('ok',false,'error','forbidden');
    end if;
    if v_order.status not in ('معتمدة','تم الإرسال للمورد','partially_received','وصلت جزئيًا') then
      return jsonb_build_object('ok',false,'error','order_not_ready_to_send','status',v_order.status);
    end if;

    v_supplier:=nullif(trim(p_payload->>'supplier_name'),'');
    if v_supplier is null then return jsonb_build_object('ok',false,'error','supplier_required'); end if;

    if not exists(
      select 1 from public.smart_purchase_order_items
      where order_id=v_order_id and coalesce(approved_quantity,0)>0
        and lower(trim(coalesce(supplier_name,'')))=lower(trim(v_supplier))
    ) then
      return jsonb_build_object('ok',false,'error','supplier_not_in_order');
    end if;

    insert into public.purchase_order_supplier_dispatches(
      order_id,supplier_name,sent_at,sent_by_account_id,sent_by_name,created_at,updated_at
    ) values (
      v_order_id,v_supplier,now(),a.id,a.display_name,now(),now()
    )
    on conflict(order_id,supplier_name) do update set
      sent_at=excluded.sent_at,
      sent_by_account_id=excluded.sent_by_account_id,
      sent_by_name=excluded.sent_by_name,
      updated_at=now();

    select count(distinct lower(trim(i.supplier_name))) into v_required
    from public.smart_purchase_order_items i
    where i.order_id=v_order_id and coalesce(i.approved_quantity,0)>0
      and nullif(trim(coalesce(i.supplier_name,'')),'') is not null;

    select count(distinct lower(trim(d.supplier_name))) into v_sent
    from public.purchase_order_supplier_dispatches d
    where d.order_id=v_order_id and d.sent_at is not null;

    if v_required>0 and v_sent>=v_required and v_order.status in ('معتمدة','تم الإرسال للمورد') then
      update public.smart_purchase_orders
      set status='تم الإرسال للمورد',
          sent_at=coalesce(sent_at,now()),
          sent_by_name=a.display_name,
          updated_at=now()
      where id=v_order_id;
    end if;

    return jsonb_build_object('ok',true,'data',jsonb_build_object(
      'supplier_name',v_supplier,
      'required_suppliers',v_required,
      'sent_suppliers',v_sent,
      'all_sent',(v_required>0 and v_sent>=v_required)
    ));
  end if;

  return jsonb_build_object('ok',false,'error','unsupported_action');
end $$;

create or replace function public.smart_purchase_import_receipt_v2(
  p_session_token text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','extensions'
as $$
declare
  v_account record;
  v_order public.smart_purchase_orders%rowtype;
  v_order_id uuid;
  v_file text;
  v_supplier text;
  v_invoice_number text;
  v_actual numeric:=0;
  v_expected numeric:=0;
  v_tolerance numeric:=0;
  v_policy_max numeric:=0;
  v_effective_limit numeric:=0;
  v_result jsonb;
  v_has_dispatch_history boolean:=false;
begin
  select sa.* into v_account
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_account.role not in ('general_manager','branch_manager','purchasing','accountant','invoice_reviewer') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  v_order_id:=nullif(p_payload->>'order_id','')::uuid;
  v_file:=nullif(trim(p_payload->>'file_name'),'');
  v_supplier:=nullif(trim(p_payload->>'supplier_name'),'');
  v_invoice_number:=nullif(trim(p_payload->>'supplier_invoice_number'),'');
  if v_supplier is null then return jsonb_build_object('ok',false,'error','supplier_required'); end if;

  select * into v_order from public.smart_purchase_orders where id=v_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if coalesce(v_order.status,'') not in ('معتمدة','تم الإرسال للمورد','approved','sent','partially_received','وصلت جزئيًا') then
    return jsonb_build_object('ok',false,'error','receipt_order_not_ready','status',v_order.status);
  end if;

  if v_account.role='branch_manager' and not (
    coalesce(v_account.branch_ids,'[]'::jsonb)?coalesce(v_order.branch,'')
    or coalesce(v_account.branch_ids,'[]'::jsonb)?replace(coalesce(v_order.branch,''),'دواء ','')
    or coalesce(v_account.branch_ids,'[]'::jsonb)?replace(coalesce(v_order.branch,''),'فرع ','')
  ) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;

  select exists(
    select 1 from public.purchase_order_supplier_dispatches d
    where d.order_id=v_order_id
  ) into v_has_dispatch_history;

  if v_has_dispatch_history and not exists(
    select 1 from public.purchase_order_supplier_dispatches d
    where d.order_id=v_order_id and d.sent_at is not null
      and lower(trim(d.supplier_name))=lower(trim(v_supplier))
  ) then
    return jsonb_build_object('ok',false,'error','supplier_not_dispatched');
  end if;

  if not v_has_dispatch_history and v_order.status in ('معتمدة','approved') and v_order.sent_at is null then
    return jsonb_build_object('ok',false,'error','supplier_not_dispatched');
  end if;

  perform pg_advisory_xact_lock(hashtext(v_order_id::text||':'||coalesce(v_invoice_number,v_file,'manual')||':'||v_supplier));

  if v_invoice_number is not null and exists(
    select 1 from public.purchase_order_receipts r
    where r.order_id=v_order_id
      and lower(trim(coalesce(r.supplier_name,'')))=lower(trim(v_supplier))
      and lower(trim(coalesce(r.supplier_invoice_number,'')))=lower(trim(v_invoice_number))
  ) then return jsonb_build_object('ok',false,'error','duplicate_supplier_invoice'); end if;

  if v_file is not null and exists(
    select 1 from public.purchase_order_receipts r
    where r.order_id=v_order_id
      and coalesce(r.source_file_name,'')=v_file
      and lower(trim(coalesce(r.supplier_name,'')))=lower(trim(v_supplier))
  ) then return jsonb_build_object('ok',false,'error','duplicate_receipt_file'); end if;

  if jsonb_typeof(coalesce(p_payload->'rows','[]'::jsonb))<>'array' then
    return jsonb_build_object('ok',false,'error','invalid_rows');
  end if;

  select coalesce(sum(
    greatest(0,coalesce(nullif(x->>'actual_total','')::numeric,
      coalesce(nullif(x->>'invoiced_quantity','')::numeric,nullif(x->>'received_quantity','')::numeric,0)
      * coalesce(nullif(x->>'actual_unit_cost','')::numeric,0)
    ))
  ),0)
  into v_actual
  from jsonb_array_elements(coalesce(p_payload->'rows','[]'::jsonb)) x;

  v_expected:=greatest(0,coalesce(v_order.approved_total,v_order.expected_total,0));
  v_tolerance:=greatest(100,v_expected*0.02);
  v_policy_max:=greatest(0,coalesce(v_order.maximum_order_value,0),coalesce(v_order.budget,0));
  v_effective_limit:=case when v_policy_max>0 then least(v_policy_max,v_expected+v_tolerance) else v_expected+v_tolerance end;

  if v_expected>0 and v_actual>v_effective_limit+0.01 then
    return jsonb_build_object('ok',false,'error','receipt_value_above_limit',
      'actual_total',v_actual,'expected_total',v_expected,'effective_limit',v_effective_limit,'policy_max',v_policy_max);
  end if;

  v_result:=public.smart_purchase_receiving_center(p_session_token,'import_receipt',p_payload);

  if coalesce((v_result->>'ok')::boolean,false) is true then
    update public.smart_purchase_order_items i
    set status=case
      when coalesce(i.received_quantity,0)<=0 then 'لم يصل'
      when coalesce(i.received_quantity,0)<coalesce(i.approved_quantity,i.requested_quantity,0) then 'ناقص'
      when coalesce(i.received_quantity,0)>coalesce(i.approved_quantity,i.requested_quantity,0) then 'زائد'
      when coalesce(i.actual_unit_cost,0)>0 and coalesce(i.expected_unit_cost,0)>0
        and abs(i.actual_unit_cost-i.expected_unit_cost)>greatest(0.01,i.expected_unit_cost*0.03) then 'فرق سعر'
      when coalesce(i.invoiced_quantity,0)<>coalesce(i.received_quantity,0) then 'فرق فاتورة'
      else 'سليم'
    end,
    updated_at=now()
    where i.order_id=v_order_id;

    update public.smart_purchase_orders o
    set status=case
      when (select coalesce(sum(i.received_quantity),0) from public.smart_purchase_order_items i where i.order_id=o.id)
           >=
           (select coalesce(sum(i.approved_quantity),0) from public.smart_purchase_order_items i where i.order_id=o.id)
      then 'received'
      when (select coalesce(sum(i.received_quantity),0) from public.smart_purchase_order_items i where i.order_id=o.id)>0
      then 'partially_received'
      else o.status
    end,
    updated_at=now()
    where o.id=v_order_id;
  end if;

  return v_result;
end $$;

revoke all on function public.smart_purchase_supplier_dispatch_v2(text,text,jsonb) from public;
revoke all on function public.smart_purchase_import_receipt_v2(text,jsonb) from public;
grant execute on function public.smart_purchase_supplier_dispatch_v2(text,text,jsonb) to anon,authenticated;
grant execute on function public.smart_purchase_import_receipt_v2(text,jsonb) to anon,authenticated;
