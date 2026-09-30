-- Recalculate receipt financials from ordered quantity × expected unit cost before scoring suppliers.

CREATE OR REPLACE FUNCTION public.smart_purchase_import_receipt_v2(p_session_token text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
  v_receipt_id uuid;
  v_receipt_expected numeric:=0;
  v_receipt_received numeric:=0;
  v_receipt_invoiced numeric:=0;
  v_receipt_qty_var numeric:=0;
  v_receipt_value_var numeric:=0;
  v_receipt_price_var numeric:=0;
  v_total_ordered numeric:=0;
  v_total_received numeric:=0;
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

  v_expected:=greatest(0,coalesce((
    select sum(greatest(0,coalesce(i.approved_quantity,0))*greatest(0,coalesce(i.expected_unit_cost,0)))
    from public.smart_purchase_order_items i
    where i.order_id=v_order_id
  ),0));
  v_tolerance:=greatest(100,v_expected*0.02);
  v_policy_max:=greatest(0,coalesce(v_order.maximum_order_value,0),coalesce(v_order.budget,0));
  v_effective_limit:=case
    when v_policy_max>0 then least(v_policy_max,v_expected+v_tolerance)
    else v_expected+v_tolerance
  end;

  if v_expected>0 and v_actual>v_effective_limit+0.01 then
    return jsonb_build_object('ok',false,'error','receipt_value_above_limit',
      'actual_total',v_actual,'expected_total',v_expected,'effective_limit',v_effective_limit,'policy_max',v_policy_max);
  end if;

  v_result:=public.smart_purchase_receiving_center(p_session_token,'import_receipt',p_payload);

  if coalesce((v_result->>'ok')::boolean,false) is true then
    v_receipt_id:=nullif(v_result->'data'->>'receipt_id','')::uuid;

    if v_receipt_id is not null then
      update public.purchase_order_receipt_items ri
      set expected_total=greatest(0,coalesce(ri.ordered_quantity,0))*greatest(0,coalesce(ri.expected_unit_cost,0)),
          value_variance=coalesce(ri.actual_total,0)
            -(greatest(0,coalesce(ri.ordered_quantity,0))*greatest(0,coalesce(ri.expected_unit_cost,0)))
      where ri.receipt_id=v_receipt_id;

      select
        coalesce(sum(ri.expected_total),0),
        coalesce(sum(ri.received_quantity*ri.actual_unit_cost),0),
        coalesce(sum(ri.actual_total),0),
        coalesce(sum(ri.quantity_variance),0),
        coalesce(sum(ri.value_variance),0),
        coalesce(sum(ri.price_variance),0),
        coalesce(sum(ri.ordered_quantity) filter(where ri.order_item_id is not null),0),
        coalesce(sum(ri.received_quantity) filter(where ri.order_item_id is not null),0)
      into
        v_receipt_expected,v_receipt_received,v_receipt_invoiced,
        v_receipt_qty_var,v_receipt_value_var,v_receipt_price_var,
        v_total_ordered,v_total_received
      from public.purchase_order_receipt_items ri
      where ri.receipt_id=v_receipt_id;

      update public.purchase_order_receipts r
      set expected_total=v_receipt_expected,
          received_total=v_receipt_received,
          invoiced_total=v_receipt_invoiced,
          quantity_variance=v_receipt_qty_var,
          value_variance=v_receipt_value_var,
          price_variance=v_receipt_price_var,
          completion_rate=case when v_total_ordered>0 then round(100*v_total_received/v_total_ordered,2) else 0 end,
          price_score=greatest(0,least(100,100-case when v_receipt_expected>0 then abs(v_receipt_value_var)/v_receipt_expected*100 else 0 end)),
          supplier_score=greatest(0,least(100,
            (case when v_total_ordered>0 then 70*v_total_received/v_total_ordered else 0 end)
            +(case when v_receipt_expected>0 then greatest(0,30-abs(v_receipt_value_var)/v_receipt_expected*30) else 30 end)
          )),
          updated_at=now()
      where r.id=v_receipt_id;
    end if;

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
    set received_total=(
          select coalesce(sum(i.actual_total),0)
          from public.smart_purchase_order_items i
          where i.order_id=o.id
        ),
        status=case
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
end $function$


revoke all on function public.smart_purchase_import_receipt_v2(text,jsonb) from public;
grant execute on function public.smart_purchase_import_receipt_v2(text,jsonb) to anon,authenticated;
