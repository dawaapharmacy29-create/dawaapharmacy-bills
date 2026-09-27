-- Read-only purchase insights and customer follow-up workflows using current hashed sessions.
create or replace function public.smart_purchase_order_evaluation_v2(
  p_session_token text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','extensions'
as $$
declare
  a record;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  return jsonb_build_object('ok',true,'data',(
    select jsonb_build_object(
      'order',to_jsonb(o),
      'items_count',count(i.id),
      'ordered_quantity',coalesce(sum(i.approved_quantity),0),
      'received_quantity',coalesce(sum(i.received_quantity),0),
      'invoiced_quantity',coalesce(sum(i.invoiced_quantity),0),
      'expected_total',coalesce(sum(i.expected_total),0),
      'actual_total',coalesce(sum(i.actual_total),0),
      'fill_rate',case when coalesce(sum(i.approved_quantity),0)>0 then round(100*coalesce(sum(i.received_quantity),0)/sum(i.approved_quantity),1) else 0 end,
      'value_variance',coalesce(sum(i.actual_total),0)-coalesce(sum(i.expected_total),0),
      'complete_items',sum(case when i.status='سليم' then 1 else 0 end),
      'shortage_items',sum(case when i.status in ('ناقص','لم يصل') then 1 else 0 end),
      'issue_items',sum(case when i.status in ('فرق سعر','فرق فاتورة','يحتاج مراجعة','غير مطلوب','زائد') then 1 else 0 end),
      'customers_waiting',(select count(*) from public.smart_purchase_customer_followups f where f.order_id=o.id and f.status='بانتظار التواصل'),
      'customers_completed',(select count(*) from public.smart_purchase_customer_followups f where f.order_id=o.id and f.status in ('تم البيع','تم الحجز','تم التواصل')),
      'score',greatest(0,least(100,
        (case when coalesce(sum(i.approved_quantity),0)>0 then 70*coalesce(sum(i.received_quantity),0)/sum(i.approved_quantity) else 0 end)
        + greatest(0,20-abs(case when coalesce(sum(i.expected_total),0)>0 then 100*(coalesce(sum(i.actual_total),0)-sum(i.expected_total))/sum(i.expected_total) else 0 end))
        + greatest(0,10-(sum(case when i.status in ('فرق سعر','فرق فاتورة','يحتاج مراجعة','غير مطلوب','زائد') then 1 else 0 end)*1.5))
      ))
    )
    from public.smart_purchase_orders o
    left join public.smart_purchase_order_items i on i.order_id=o.id
    where o.id=p_order_id
    group by o.id
  ));
end $$;

create or replace function public.smart_purchase_followups_v2(
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
  a record; v_order uuid; v_created int:=0; v_updated int:=0; r jsonb;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  v_order:=nullif(p_payload->>'order_id','')::uuid;

  if p_action='create' then
    if a.role not in ('general_manager','branch_manager','purchasing','accountant','invoice_reviewer') then return jsonb_build_object('ok',false,'error','forbidden'); end if;

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
      where v_order is null or f.order_id=v_order
    ),'[]'::jsonb));

  elsif p_action='update' then
    if a.role not in ('general_manager','branch_manager','purchasing','accountant','invoice_reviewer') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
    for r in select value from jsonb_array_elements(coalesce(p_payload->'rows','[]'::jsonb)) loop
      update public.smart_purchase_customer_followups f
      set status=coalesce(nullif(r->>'status',''),f.status),
          contact_result=coalesce(nullif(r->>'contact_result',''),f.contact_result),
          notes=coalesce(r->>'notes',f.notes),
          contacted_at=case when nullif(r->>'status','') is not null and (r->>'status')<>'بانتظار التواصل' then now() else f.contacted_at end,
          contacted_by_account_id=case when nullif(r->>'status','') is not null then a.id else f.contacted_by_account_id end,
          contacted_by_name=case when nullif(r->>'status','') is not null then a.display_name else f.contacted_by_name end,
          updated_at=now()
      where f.id=(r->>'id')::uuid;
      v_updated:=v_updated+1;
    end loop;
    return jsonb_build_object('ok',true,'data',jsonb_build_object('updated',v_updated));
  end if;

  return jsonb_build_object('ok',false,'error','unsupported_action');
end $$;

revoke all on function public.smart_purchase_order_evaluation_v2(text,uuid) from public;
revoke all on function public.smart_purchase_followups_v2(text,text,jsonb) from public;
grant execute on function public.smart_purchase_order_evaluation_v2(text,uuid) to anon,authenticated;
grant execute on function public.smart_purchase_followups_v2(text,text,jsonb) to anon,authenticated;
