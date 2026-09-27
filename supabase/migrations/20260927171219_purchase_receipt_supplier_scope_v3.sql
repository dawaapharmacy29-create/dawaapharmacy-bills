create or replace function public.smart_purchase_import_receipt_v3(
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
  v_effective_limit numeric:=0;
  v_result jsonb;
  v_has_dispatch_history boolean:=false;
  v_cross_supplier_rows integer:=0;
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
  if not public.smart_purchase_branch_allowed_v2(v_account.id,v_order.branch) then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;

  select exists(select 1 from public.purchase_order_supplier_dispatches d where d.order_id=v_order_id)
  into v_has_dispatch_history;

  if v_has_dispatch_history and not exists(
    select 1 from public.purchase_order_supplier_dispatches d
    where d.order_id=v_order_id and d.sent_at is not null
      and lower(trim(d.supplier_name))=lower(trim(v_supplier))
  ) then return jsonb_build_object('ok',false,'error','supplier_not_dispatched'); end if;

  if not v_has_dispatch_history and v_order.status in ('معتمدة','approved') and v_order.sent_at is null then
    return jsonb_build_object('ok',false,'error','supplier_not_dispatched');
  end if;

  perform pg_advisory_xact_lock(hashtext(v_order_id::text||':'||coalesce(v_invoice_number,v_file,'manual')||':'||lower(v_supplier)));

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

  select count(*) into v_cross_supplier_rows
  from jsonb_array_elements(coalesce(p_payload->'rows','[]'::jsonb)) x
  where exists(
    select 1 from public.smart_purchase_order_items i
    where i.order_id=v_order_id
      and coalesce(i.approved_quantity,0)>0
      and lower(trim(coalesce(i.supplier_name,'')))<>lower(trim(v_supplier))
      and (
        (nullif(trim(x->>'product_code'),'') is not null and lower(trim(coalesce(i.product_code,'')))=lower(trim(x->>'product_code')))
        or lower(trim(coalesce(i.product_name,'')))=lower(trim(coalesce(x->>'product_name','')))
      )
  );
  if v_cross_supplier_rows>0 then
    return jsonb_build_object('ok',false,'error','cross_supplier_receipt_rows','invalid_rows',v_cross_supplier_rows);
  end if;

  select coalesce(sum(
    greatest(0,coalesce(nullif(x->>'actual_total','')::numeric,
      coalesce(nullif(x->>'invoiced_quantity','')::numeric,nullif(x->>'received_quantity','')::numeric,0)
      * coalesce(nullif(x->>'actual_unit_cost','')::numeric,0)
    ))
  ),0)
  into v_actual
  from jsonb_array_elements(coalesce(p_payload->'rows','[]'::jsonb)) x;

  select coalesce(sum(
    greatest(0,coalesce(i.approved_quantity,0)-coalesce(i.received_quantity,0))
      * greatest(0,coalesce(i.expected_unit_cost,0))
  ),0)
  into v_expected
  from public.smart_purchase_order_items i
  where i.order_id=v_order_id
    and coalesce(i.approved_quantity,0)>0
    and lower(trim(coalesce(i.supplier_name,'')))=lower(trim(v_supplier));

  if v_expected<=0 and v_actual>0 then
    return jsonb_build_object('ok',false,'error','supplier_has_no_remaining_items');
  end if;

  v_tolerance:=greatest(100,v_expected*0.02);
  v_effective_limit:=v_expected+v_tolerance;

  if v_expected>0 and v_actual>v_effective_limit+0.01 then
    return jsonb_build_object('ok',false,'error','receipt_value_above_supplier_limit',
      'actual_total',v_actual,'supplier_remaining_expected_total',v_expected,'effective_limit',v_effective_limit);
  end if;

  v_result:=public.smart_purchase_import_receipt_v2(p_session_token,p_payload);
  return v_result;
end $$;

revoke all on function public.smart_purchase_import_receipt_v3(text,jsonb) from public;
grant execute on function public.smart_purchase_import_receipt_v3(text,jsonb) to anon,authenticated;
