-- Guarded and duplicate-safe receipt import for purchase orders.
create or replace function public.smart_purchase_import_receipt_v2(
  p_session_token text,p_payload jsonb
) returns jsonb
language plpgsql security definer
set search_path='pg_catalog','public','extensions'
as $$
declare
  v_account record; v_order public.smart_purchase_orders%rowtype; v_order_id uuid;
  v_file text; v_supplier text; v_actual numeric:=0; v_expected numeric:=0;
  v_tolerance numeric:=0; v_policy_max numeric:=0; v_effective_limit numeric:=0; v_result jsonb;
begin
  select sa.* into v_account
  from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_account.role not in ('general_manager','branch_manager','purchasing','accountant','invoice_reviewer') then return jsonb_build_object('ok',false,'error','forbidden'); end if;

  v_order_id:=nullif(p_payload->>'order_id','')::uuid;
  v_file:=nullif(trim(p_payload->>'file_name'),'');
  v_supplier:=nullif(trim(p_payload->>'supplier_name'),'');

  select * into v_order from public.smart_purchase_orders where id=v_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;

  if v_account.role='branch_manager' and not (
    coalesce(v_account.branch_ids,'[]'::jsonb)?coalesce(v_order.branch,'')
    or coalesce(v_account.branch_ids,'[]'::jsonb)?replace(coalesce(v_order.branch,''),'دواء ','')
    or coalesce(v_account.branch_ids,'[]'::jsonb)?replace(coalesce(v_order.branch,''),'فرع ','')
  ) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;

  perform pg_advisory_xact_lock(hashtext(v_order_id::text||':'||coalesce(v_file,'manual')||':'||coalesce(v_supplier,'')));

  if v_file is not null and exists(
    select 1 from public.purchase_order_receipts r
    where r.order_id=v_order_id and coalesce(r.source_file_name,'')=v_file
      and coalesce(r.supplier_name,'')=coalesce(v_supplier,'')
  ) then return jsonb_build_object('ok',false,'error','duplicate_receipt_file'); end if;

  if jsonb_typeof(coalesce(p_payload->'rows','[]'::jsonb))<>'array' then return jsonb_build_object('ok',false,'error','invalid_rows'); end if;

  select coalesce(sum(greatest(0,coalesce(
    nullif(x->>'actual_total','')::numeric,
    coalesce(nullif(x->>'invoiced_quantity','')::numeric,nullif(x->>'received_quantity','')::numeric,0)
      * coalesce(nullif(x->>'actual_unit_cost','')::numeric,0)
  ))),0)
  into v_actual from jsonb_array_elements(coalesce(p_payload->'rows','[]'::jsonb)) x;

  v_expected:=greatest(0,coalesce(v_order.approved_total,v_order.expected_total,0));
  v_tolerance:=greatest(100,v_expected*0.02);
  v_policy_max:=greatest(0,coalesce(v_order.maximum_order_value,0),coalesce(v_order.budget,0));
  v_effective_limit:=case when v_policy_max>0 then least(v_policy_max,v_expected+v_tolerance) else v_expected+v_tolerance end;

  if v_expected>0 and v_actual>v_effective_limit+0.01 then
    return jsonb_build_object('ok',false,'error','receipt_value_above_limit',
      'actual_total',v_actual,'expected_total',v_expected,'effective_limit',v_effective_limit,'policy_max',v_policy_max);
  end if;

  v_result:=public.smart_purchase_receiving_center(p_session_token,'import_receipt',p_payload);
  return v_result;
end $$;

revoke all on function public.smart_purchase_import_receipt_v2(text,jsonb) from public;
grant execute on function public.smart_purchase_import_receipt_v2(text,jsonb) to anon,authenticated;
