alter table public.purchase_order_receipts
  add column if not exists financial_resolution_status text not null default 'pending',
  add column if not exists financial_resolution_note text,
  add column if not exists financial_resolved_at timestamptz,
  add column if not exists financial_resolved_by_account_id uuid,
  add column if not exists financial_resolved_by_name text;

alter table public.purchase_order_receipts
  drop constraint if exists purchase_order_receipts_financial_resolution_status_chk;
alter table public.purchase_order_receipts
  add constraint purchase_order_receipts_financial_resolution_status_chk
  check (financial_resolution_status in ('pending','accepted_match','accepted_variance','followup_required'));

create or replace function public.smart_purchase_resolve_receipt_financial_v1(
  p_session_token text,p_receipt_id uuid,p_resolution_status text,p_note text default null
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','public','extensions'
as $$
declare a record; r public.purchase_order_receipts%rowtype; o record; v_resolution text:=trim(coalesce(p_resolution_status,''));
begin
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing','accountant','invoice_reviewer') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
  select * into r from public.purchase_order_receipts where id=p_receipt_id for update;
  if not found then return jsonb_build_object('ok',false,'error','receipt_not_found'); end if;
  select id,branch into o from public.smart_purchase_orders where id=r.order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;
  if v_resolution not in ('accepted_match','accepted_variance','followup_required') then return jsonb_build_object('ok',false,'error','invalid_financial_resolution'); end if;
  update public.purchase_order_receipts
  set financial_resolution_status=v_resolution,financial_resolution_note=nullif(trim(coalesce(p_note,'')),''),
      financial_resolved_at=now(),financial_resolved_by_account_id=a.id,financial_resolved_by_name=a.display_name,updated_at=now()
  where id=p_receipt_id;
  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'receipt_id',p_receipt_id,'financial_resolution_status',v_resolution,'resolved_by_name',a.display_name,'resolved_at',now()
  ));
end $$;

create or replace function public.smart_purchase_financial_close_readiness_v1(
  p_session_token text,p_order_id uuid
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','public','extensions'
as $$
declare a record; o record; v_receipts integer:=0; v_pending integer:=0; v_followup integer:=0;
v_expected numeric:=0; v_invoiced numeric:=0; v_received numeric:=0; v_bonus numeric:=0;
v_value_variance numeric:=0; v_price_variance numeric:=0; v_ready boolean:=false;
begin
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select id,branch into o from public.smart_purchase_orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;
  select count(*),
    count(*) filter(where coalesce(r.financial_resolution_status,'pending')='pending'),
    count(*) filter(where r.financial_resolution_status='followup_required'),
    coalesce(sum(r.expected_total),0),coalesce(sum(r.invoiced_total),0),coalesce(sum(r.received_total),0),
    coalesce(sum(r.value_variance),0),coalesce(sum(r.price_variance),0)
  into v_receipts,v_pending,v_followup,v_expected,v_invoiced,v_received,v_value_variance,v_price_variance
  from public.purchase_order_receipts r where r.order_id=p_order_id;
  select coalesce(sum(ri.bonus_quantity),0) into v_bonus
  from public.purchase_order_receipt_items ri join public.purchase_order_receipts r on r.id=ri.receipt_id
  where r.order_id=p_order_id;
  v_ready:=v_receipts>0 and v_pending=0 and v_followup=0;
  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'ready',v_ready,'receipts_count',v_receipts,'pending_receipts',v_pending,'followup_receipts',v_followup,
    'expected_total',v_expected,'invoiced_total',v_invoiced,'received_total',v_received,'bonus_quantity',v_bonus,
    'value_variance',v_value_variance,'price_variance',v_price_variance
  ));
end $$;

create or replace function public.smart_purchase_import_receipt_v4(
  p_session_token text,p_payload jsonb
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','public','extensions'
as $$
declare v_result jsonb; v_receipt_id uuid; v_order_id uuid; v_supplier text; v_ordered numeric:=0; v_received numeric:=0;
v_remaining numeric:=0; v_completion numeric:=0; v_status text:='open'; v_value_variance numeric:=0; v_price_variance numeric:=0; v_invoice_gap numeric:=0;
begin
  v_result:=public.smart_purchase_import_receipt_v3(p_session_token,p_payload);
  if coalesce((v_result->>'ok')::boolean,false)=false then return v_result; end if;
  v_receipt_id:=nullif(v_result->'data'->>'receipt_id','')::uuid;
  v_order_id:=nullif(p_payload->>'order_id','')::uuid;
  v_supplier:=nullif(trim(p_payload->>'supplier_name'),'');
  if v_receipt_id is null or v_order_id is null or v_supplier is null then return v_result; end if;

  select coalesce(sum(greatest(0,coalesce(i.approved_quantity,0))),0),
         coalesce(sum(least(greatest(0,coalesce(i.received_quantity,0)),greatest(0,coalesce(i.approved_quantity,0)))),0)
  into v_ordered,v_received
  from public.smart_purchase_order_items i
  where i.order_id=v_order_id and coalesce(i.approved_quantity,0)>0
    and lower(trim(coalesce(i.supplier_name,'')))=lower(trim(v_supplier));

  v_remaining:=greatest(0,v_ordered-v_received);
  v_completion:=case when v_ordered>0 then round(least(100,100*v_received/v_ordered),2) else 0 end;
  v_status:=case when v_ordered<=0 then 'needs_review' when v_remaining<=0 then 'completed'
                 when v_received>0 then 'partial' else 'not_received' end;

  select coalesce(value_variance,0),coalesce(price_variance,0),abs(coalesce(invoiced_total,0)-coalesce(received_total,0))
  into v_value_variance,v_price_variance,v_invoice_gap
  from public.purchase_order_receipts where id=v_receipt_id;

  update public.purchase_order_receipts
  set cumulative_ordered_quantity=v_ordered,cumulative_received_quantity=v_received,
      cumulative_remaining_quantity=v_remaining,cumulative_completion_rate=v_completion,supplier_order_status=v_status,
      financial_resolution_status=case
        when abs(v_value_variance)<=0.01 and abs(v_price_variance)<=0.01 and v_invoice_gap<=0.01 then 'accepted_match' else 'pending' end,
      financial_resolution_note=case
        when abs(v_value_variance)<=0.01 and abs(v_price_variance)<=0.01 and v_invoice_gap<=0.01 then 'مطابقة مالية تلقائية' else null end,
      financial_resolved_at=case
        when abs(v_value_variance)<=0.01 and abs(v_price_variance)<=0.01 and v_invoice_gap<=0.01 then now() else null end,
      financial_resolved_by_account_id=null,
      financial_resolved_by_name=case
        when abs(v_value_variance)<=0.01 and abs(v_price_variance)<=0.01 and v_invoice_gap<=0.01 then 'النظام' else null end,
      updated_at=now()
  where id=v_receipt_id;

  update public.smart_purchase_order_items i
  set resolution_status=case
        when coalesce(i.received_quantity,0)=coalesce(i.approved_quantity,0)
         and coalesce(i.invoiced_quantity,0)=coalesce(i.received_quantity,0)
         and coalesce(i.actual_unit_cost,0)>0 and coalesce(i.expected_unit_cost,0)>0
         and abs(i.actual_unit_cost-i.expected_unit_cost)<=greatest(0.01,i.expected_unit_cost*0.03)
        then 'accepted_ok' else 'pending' end,
      resolution_note=case
        when coalesce(i.received_quantity,0)=coalesce(i.approved_quantity,0)
         and coalesce(i.invoiced_quantity,0)=coalesce(i.received_quantity,0)
         and coalesce(i.actual_unit_cost,0)>0 and coalesce(i.expected_unit_cost,0)>0
         and abs(i.actual_unit_cost-i.expected_unit_cost)<=greatest(0.01,i.expected_unit_cost*0.03)
        then 'مطابقة تلقائية بعد الاستلام' else null end,
      resolved_at=case
        when coalesce(i.received_quantity,0)=coalesce(i.approved_quantity,0)
         and coalesce(i.invoiced_quantity,0)=coalesce(i.received_quantity,0)
         and coalesce(i.actual_unit_cost,0)>0 and coalesce(i.expected_unit_cost,0)>0
         and abs(i.actual_unit_cost-i.expected_unit_cost)<=greatest(0.01,i.expected_unit_cost*0.03)
        then now() else null end,
      resolved_by_account_id=null,
      resolved_by_name=case
        when coalesce(i.received_quantity,0)=coalesce(i.approved_quantity,0)
         and coalesce(i.invoiced_quantity,0)=coalesce(i.received_quantity,0)
         and coalesce(i.actual_unit_cost,0)>0 and coalesce(i.expected_unit_cost,0)>0
         and abs(i.actual_unit_cost-i.expected_unit_cost)<=greatest(0.01,i.expected_unit_cost*0.03)
        then 'النظام' else null end,
      updated_at=now()
  where i.order_id=v_order_id and coalesce(i.approved_quantity,0)>0
    and lower(trim(coalesce(i.supplier_name,'')))=lower(trim(v_supplier));

  return jsonb_set(v_result,'{data,cumulative}',jsonb_build_object(
    'supplier_name',v_supplier,'ordered_quantity',v_ordered,'received_quantity',v_received,
    'remaining_quantity',v_remaining,'completion_rate',v_completion,'status',v_status
  ),true);
end $$;

create or replace function public.smart_purchase_close_order_v1(
  p_session_token text,p_order_id uuid
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','public','extensions'
as $$
declare a record; o public.smart_purchase_orders%rowtype; v_item_check jsonb; v_fin_check jsonb; ic jsonb; fc jsonb;
begin
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing','accountant') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
  select * into o from public.smart_purchase_orders where id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;
  if coalesce(o.status,'') not in ('received','partially_received','وصلت جزئيًا','وصلت بالكامل') then return jsonb_build_object('ok',false,'error','order_not_closable','status',o.status); end if;
  if not exists(select 1 from public.purchase_order_receipts r where r.order_id=p_order_id) then return jsonb_build_object('ok',false,'error','receiving_not_started'); end if;

  v_item_check:=public.smart_purchase_receiving_close_readiness_v1(p_session_token,p_order_id);
  if coalesce((v_item_check->>'ok')::boolean,false)=false then return v_item_check; end if;
  ic:=v_item_check->'data';
  v_fin_check:=public.smart_purchase_financial_close_readiness_v1(p_session_token,p_order_id);
  if coalesce((v_fin_check->>'ok')::boolean,false)=false then return v_fin_check; end if;
  fc:=v_fin_check->'data';

  if coalesce((ic->>'unresolved_items')::int,0)>0 then return jsonb_build_object('ok',false,'error','receiving_items_unresolved','readiness',ic); end if;
  if coalesce((ic->>'followup_items')::int,0)>0 then return jsonb_build_object('ok',false,'error','receiving_followup_open','readiness',ic); end if;
  if coalesce((fc->>'pending_receipts')::int,0)>0 then return jsonb_build_object('ok',false,'error','financial_receipts_unresolved','financial_readiness',fc); end if;
  if coalesce((fc->>'followup_receipts')::int,0)>0 then return jsonb_build_object('ok',false,'error','financial_followup_open','financial_readiness',fc); end if;

  update public.smart_purchase_orders
  set status='مغلقة',received_total=coalesce((fc->>'invoiced_total')::numeric,received_total),updated_at=now()
  where id=p_order_id;
  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'order_id',p_order_id,'status','مغلقة','financial_summary',fc,'closed_by_name',a.display_name,'closed_at',now()
  ));
end $$;

revoke all on function public.smart_purchase_resolve_receipt_financial_v1(text,uuid,text,text) from public;
revoke all on function public.smart_purchase_financial_close_readiness_v1(text,uuid) from public;
grant execute on function public.smart_purchase_resolve_receipt_financial_v1(text,uuid,text,text) to anon,authenticated;
grant execute on function public.smart_purchase_financial_close_readiness_v1(text,uuid) to anon,authenticated;
