alter table public.purchase_order_receipts
  add column if not exists cumulative_ordered_quantity numeric not null default 0,
  add column if not exists cumulative_received_quantity numeric not null default 0,
  add column if not exists cumulative_remaining_quantity numeric not null default 0,
  add column if not exists cumulative_completion_rate numeric not null default 0,
  add column if not exists supplier_order_status text not null default 'open';

create or replace function public.smart_purchase_import_receipt_v4(
  p_session_token text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','extensions'
as $$
declare
  v_result jsonb;
  v_receipt_id uuid;
  v_order_id uuid;
  v_supplier text;
  v_ordered numeric:=0;
  v_received numeric:=0;
  v_remaining numeric:=0;
  v_completion numeric:=0;
  v_status text:='open';
begin
  v_result:=public.smart_purchase_import_receipt_v3(p_session_token,p_payload);
  if coalesce((v_result->>'ok')::boolean,false)=false then return v_result; end if;

  v_receipt_id:=nullif(v_result->'data'->>'receipt_id','')::uuid;
  v_order_id:=nullif(p_payload->>'order_id','')::uuid;
  v_supplier:=nullif(trim(p_payload->>'supplier_name'),'');

  if v_receipt_id is null or v_order_id is null or v_supplier is null then return v_result; end if;

  select
    coalesce(sum(greatest(0,coalesce(i.approved_quantity,0))),0),
    coalesce(sum(least(greatest(0,coalesce(i.received_quantity,0)),greatest(0,coalesce(i.approved_quantity,0)))),0)
  into v_ordered,v_received
  from public.smart_purchase_order_items i
  where i.order_id=v_order_id
    and coalesce(i.approved_quantity,0)>0
    and lower(trim(coalesce(i.supplier_name,'')))=lower(trim(v_supplier));

  v_remaining:=greatest(0,v_ordered-v_received);
  v_completion:=case when v_ordered>0 then round(least(100,100*v_received/v_ordered),2) else 0 end;
  v_status:=case
    when v_ordered<=0 then 'needs_review'
    when v_remaining<=0 then 'completed'
    when v_received>0 then 'partial'
    else 'not_received'
  end;

  update public.purchase_order_receipts r
  set cumulative_ordered_quantity=v_ordered,
      cumulative_received_quantity=v_received,
      cumulative_remaining_quantity=v_remaining,
      cumulative_completion_rate=v_completion,
      supplier_order_status=v_status,
      updated_at=now()
  where r.id=v_receipt_id;

  return jsonb_set(
    v_result,
    '{data,cumulative}',
    jsonb_build_object(
      'supplier_name',v_supplier,
      'ordered_quantity',v_ordered,
      'received_quantity',v_received,
      'remaining_quantity',v_remaining,
      'completion_rate',v_completion,
      'status',v_status
    ),
    true
  );
end $$;

create or replace function public.smart_purchase_supplier_performance_v2(
  p_session_token text,
  p_branch text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','pg_temp','extensions'
as $$
declare
  a record;
  v_rows jsonb:='[]'::jsonb;
  v_summary jsonb:='{}'::jsonb;
begin
  perform set_config('statement_timeout','25000',true);

  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing','accountant') then return jsonb_build_object('ok',false,'error','forbidden'); end if;

  with item_scope as (
    select
      o.id order_id,
      o.branch,
      trim(i.supplier_name) supplier_name,
      sum(greatest(0,coalesce(i.approved_quantity,0)))::numeric ordered_qty,
      sum(least(greatest(0,coalesce(i.received_quantity,0)),greatest(0,coalesce(i.approved_quantity,0))))::numeric received_qty,
      sum(
        least(greatest(0,coalesce(i.received_quantity,0)),greatest(0,coalesce(i.approved_quantity,0)))
        * greatest(0,coalesce(i.expected_unit_cost,0))
      )::numeric expected_received_value,
      sum(greatest(0,coalesce(i.actual_total,0)))::numeric actual_received_value
    from public.smart_purchase_orders o
    join public.smart_purchase_order_items i on i.order_id=o.id
    where coalesce(i.approved_quantity,0)>0
      and nullif(trim(coalesce(i.supplier_name,'')),'') is not null
      and (coalesce(p_branch,'all')='all' or o.branch=p_branch)
      and (
        a.role<>'branch_manager'
        or coalesce(a.branch_ids,'[]'::jsonb)?o.branch
        or coalesce(a.branch_ids,'[]'::jsonb)?replace(o.branch,'دواء ','')
        or coalesce(a.branch_ids,'[]'::jsonb)?replace(o.branch,'فرع ','')
      )
    group by o.id,o.branch,trim(i.supplier_name)
  ),
  receipt_scope as (
    select
      r.order_id,
      trim(r.supplier_name) supplier_name,
      count(*)::int receipt_count,
      max(r.receipt_date) last_receipt_date,
      count(*) filter(where r.delay_days is not null)::int delivery_observations,
      avg(r.delay_days) filter(where r.delay_days is not null)::numeric avg_delay_days,
      max(r.delay_days) filter(where r.delay_days is not null)::int max_delay_days
    from public.purchase_order_receipts r
    where nullif(trim(coalesce(r.supplier_name,'')),'') is not null
      and r.receipt_date>=current_date-365
    group by r.order_id,trim(r.supplier_name)
  ),
  order_scores as (
    select
      i.supplier_name,
      i.order_id,
      r.last_receipt_date,
      coalesce(r.receipt_count,0)::int receipt_count,
      coalesce(r.delivery_observations,0)::int delivery_observations,
      r.avg_delay_days,
      r.max_delay_days,
      i.ordered_qty,
      i.received_qty,
      greatest(0,i.ordered_qty-i.received_qty) remaining_qty,
      case when i.ordered_qty>0 then least(100,100*i.received_qty/i.ordered_qty) else 0 end completion_rate,
      case
        when i.expected_received_value>0
          then greatest(0,least(100,100-(abs(i.actual_received_value-i.expected_received_value)/i.expected_received_value*100)))
        else 100
      end price_score,
      greatest(0,i.actual_received_value-i.expected_received_value) price_overpay_value,
      case when i.ordered_qty>0 and i.received_qty>=i.ordered_qty then true else false end completed,
      case when coalesce(r.delivery_observations,0)>0 and coalesce(r.max_delay_days,0)=0 then true else false end on_time
    from item_scope i
    join receipt_scope r
      on r.order_id=i.order_id
     and lower(trim(r.supplier_name))=lower(trim(i.supplier_name))
  ),
  agg as (
    select
      supplier_name,
      count(*)::int supplier_order_count,
      sum(receipt_count)::int receipt_count,
      max(last_receipt_date) last_receipt_date,
      round(avg(completion_rate)::numeric,1) avg_completion_rate,
      round(avg(price_score)::numeric,1) avg_price_score,
      sum(delivery_observations)::int delivery_observations,
      round(avg(avg_delay_days) filter(where delivery_observations>0)::numeric,1) avg_delay_days,
      round(100.0*count(*) filter(where delivery_observations>0 and on_time)
        /nullif(count(*) filter(where delivery_observations>0),0),1) on_time_rate,
      round(100.0*count(*) filter(where completed and price_score>=98)
        /nullif(count(*),0),1) clean_order_rate,
      round(sum(price_overpay_value)::numeric,2) price_overpay_value,
      count(*) filter(where completed)::int completed_orders,
      count(*) filter(where not completed)::int open_orders
    from order_scores
    group by supplier_name
  ),
  scored as (
    select x.*,
      round(greatest(0,least(100,
        case when delivery_observations>0 then
          coalesce(avg_completion_rate,0)*0.45
          +coalesce(avg_price_score,0)*0.25
          +coalesce(on_time_rate,0)*0.20
          +coalesce(clean_order_rate,0)*0.10
        else
          coalesce(avg_completion_rate,0)*0.60
          +coalesce(avg_price_score,0)*0.30
          +coalesce(clean_order_rate,0)*0.10
        end
      )),1) performance_score,
      least(100,round(supplier_order_count*12.5,0))::int confidence,
      case when supplier_order_count<3 then 'تعلم أولي' when supplier_order_count<8 then 'ثقة متوسطة' else 'ثقة عالية' end confidence_label
    from agg x
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'supplier_name',supplier_name,'receipt_count',receipt_count,'order_count',supplier_order_count,
      'completed_orders',completed_orders,'open_orders',open_orders,'last_receipt_date',last_receipt_date,
      'completion_rate',avg_completion_rate,'price_adherence',avg_price_score,
      'delivery_observations',delivery_observations,'on_time_rate',on_time_rate,
      'avg_delay_days',avg_delay_days,'clean_receipt_rate',clean_order_rate,
      'shortage_value',0,'price_overpay_value',coalesce(price_overpay_value,0),
      'performance_score',performance_score,'confidence',confidence,'confidence_label',confidence_label,
      'rating',case when performance_score>=90 then 'ممتاز' when performance_score>=80 then 'جيد جدًا'
                    when performance_score>=70 then 'جيد' when performance_score>=60 then 'يحتاج متابعة'
                    else 'ضعيف' end
    ) order by performance_score desc,confidence desc,supplier_name),'[]'::jsonb),
    jsonb_build_object(
      'suppliers_with_history',count(*),'receipts_analyzed',coalesce(sum(receipt_count),0),
      'supplier_orders_analyzed',coalesce(sum(supplier_order_count),0),
      'completed_supplier_orders',coalesce(sum(completed_orders),0),
      'open_supplier_orders',coalesce(sum(open_orders),0),
      'price_overpay_value',round(coalesce(sum(price_overpay_value),0)::numeric,2),
      'high_confidence_suppliers',count(*) filter(where confidence>=100)
    )
  into v_rows,v_summary
  from scored;

  return jsonb_build_object(
    'ok',true,'generated_at',now(),'branch',coalesce(p_branch,'all'),'summary',v_summary,'suppliers',v_rows,
    'readiness',jsonb_build_object(
      'ready',jsonb_array_length(v_rows)>0,
      'reason',case when jsonb_array_length(v_rows)>0
        then 'التقييم مبني على الأداء التراكمي لكل طلبية مع المورد، وليس على كل إيصال منفصل.'
        else 'لا توجد استلامات فعلية محفوظة بعد. سيبدأ التقييم من أول استلام جديد.' end
    ),
    'method',jsonb_build_object(
      'unit','طلبية + مورد',
      'partial_receipts','الاستلام الجزئي لا يعاقب المورد كحالة نهائية؛ يتم تجميعه حتى اكتمال حصة المورد.',
      'with_delivery_history','45% اكتمال تراكمي + 25% التزام السعر + 20% الالتزام بالموعد + 10% طلبيات نظيفة',
      'without_delivery_history','60% اكتمال تراكمي + 30% التزام السعر + 10% طلبيات نظيفة',
      'confidence','الثقة تزيد بعدد الطلبيات مع المورد، وليس بعدد الإيصالات الجزئية.'
    )
  );
end $$;

revoke all on function public.smart_purchase_import_receipt_v4(text,jsonb) from public;
revoke all on function public.smart_purchase_supplier_performance_v2(text,text) from public;
grant execute on function public.smart_purchase_import_receipt_v4(text,jsonb) to anon,authenticated;
grant execute on function public.smart_purchase_supplier_performance_v2(text,text) to anon,authenticated;
