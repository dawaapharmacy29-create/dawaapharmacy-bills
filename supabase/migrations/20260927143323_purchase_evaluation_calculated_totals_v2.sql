-- Calculate post-execution purchase evaluation from live quantities and unit costs instead of stale stored totals.

CREATE OR REPLACE FUNCTION public.smart_purchase_order_evaluation_v2(p_session_token text, p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
      'expected_total',coalesce(sum(greatest(0,coalesce(i.approved_quantity,0))*greatest(0,coalesce(i.expected_unit_cost,0))),0),
      'actual_total',coalesce(sum(i.actual_total),0),
      'fill_rate',case when coalesce(sum(i.approved_quantity),0)>0 then round(100*coalesce(sum(i.received_quantity),0)/sum(i.approved_quantity),1) else 0 end,
      'value_variance',coalesce(sum(i.actual_total),0)-coalesce(sum(greatest(0,coalesce(i.approved_quantity,0))*greatest(0,coalesce(i.expected_unit_cost,0))),0),
      'complete_items',sum(case when i.status='سليم' then 1 else 0 end),
      'shortage_items',sum(case when i.status in ('ناقص','لم يصل') then 1 else 0 end),
      'issue_items',sum(case when i.status in ('فرق سعر','فرق فاتورة','يحتاج مراجعة','غير مطلوب','زائد') then 1 else 0 end),
      'customers_waiting',(select count(*) from public.smart_purchase_customer_followups f where f.order_id=o.id and f.status='بانتظار التواصل'),
      'customers_completed',(select count(*) from public.smart_purchase_customer_followups f where f.order_id=o.id and f.status in ('تم البيع','تم الحجز','تم التواصل')),
      'score',greatest(0,least(100,
        (case when coalesce(sum(i.approved_quantity),0)>0 then 70*coalesce(sum(i.received_quantity),0)/sum(i.approved_quantity) else 0 end)
        + greatest(0,20-abs(case
            when coalesce(sum(greatest(0,coalesce(i.approved_quantity,0))*greatest(0,coalesce(i.expected_unit_cost,0))),0)>0
            then 100*(
              coalesce(sum(i.actual_total),0)
              - coalesce(sum(greatest(0,coalesce(i.approved_quantity,0))*greatest(0,coalesce(i.expected_unit_cost,0))),0)
            ) / coalesce(sum(greatest(0,coalesce(i.approved_quantity,0))*greatest(0,coalesce(i.expected_unit_cost,0))),1)
            else 0 end))
        + greatest(0,10-(sum(case when i.status in ('فرق سعر','فرق فاتورة','يحتاج مراجعة','غير مطلوب','زائد') then 1 else 0 end)*1.5))
      ))
    )
    from public.smart_purchase_orders o
    left join public.smart_purchase_order_items i on i.order_id=o.id
    where o.id=p_order_id
    group by o.id
  ));
end $function$


revoke all on function public.smart_purchase_order_evaluation_v2(text,uuid) from public;
grant execute on function public.smart_purchase_order_evaluation_v2(text,uuid) to anon,authenticated;
