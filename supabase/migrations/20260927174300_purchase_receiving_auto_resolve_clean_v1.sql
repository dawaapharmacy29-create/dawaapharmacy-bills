create or replace function public.smart_purchase_import_receipt_v4(
  p_session_token text,p_payload jsonb
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','public','extensions'
as $$
declare v_result jsonb; v_receipt_id uuid; v_order_id uuid; v_supplier text; v_ordered numeric:=0; v_received numeric:=0;
v_remaining numeric:=0; v_completion numeric:=0; v_status text:='open';
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
  v_status:=case when v_ordered<=0 then 'needs_review' when v_remaining<=0 then 'completed' when v_received>0 then 'partial' else 'not_received' end;
  update public.purchase_order_receipts set cumulative_ordered_quantity=v_ordered,cumulative_received_quantity=v_received,
    cumulative_remaining_quantity=v_remaining,cumulative_completion_rate=v_completion,supplier_order_status=v_status,updated_at=now()
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
