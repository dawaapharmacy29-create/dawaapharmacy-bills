alter table public.purchase_order_receipts
  add column if not exists workflow_snapshot_id uuid,
  add column if not exists expected_lead_days integer,
  add column if not exists actual_lead_days integer,
  add column if not exists delay_days integer;

create unique index if not exists purchase_order_receipts_snapshot_uidx
  on public.purchase_order_receipts(workflow_snapshot_id)
  where workflow_snapshot_id is not null;
create index if not exists purchase_order_receipts_supplier_date_idx
  on public.purchase_order_receipts(supplier_name,receipt_date desc);

create or replace function public.purchase_capture_receipt_snapshot_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp','extensions'
as $$
declare
  v_receipt_id uuid;
  v_detail jsonb;
  v_item_id uuid;
  v_supplier text;
  v_ordered numeric;
  v_received numeric;
  v_expected_cost numeric;
  v_actual_cost numeric;
  v_expected_total numeric := 0;
  v_actual_total numeric := 0;
  v_sent_date date;
  v_expected_lead integer;
  v_actual_lead integer;
  v_delay integer;
begin
  if new.workflow_type <> 'receipt' then return new; end if;

  v_supplier := nullif(trim(new.supplier_name),'');
  if v_supplier is null then
    select nullif(trim(i.supplier_name),'') into v_supplier
    from public.smart_purchase_order_items i
    where i.order_id=new.order_id and nullif(trim(i.supplier_name),'') is not null
    group by i.supplier_name order by count(*) desc limit 1;
  end if;

  select o.sent_at::date into v_sent_date
  from public.smart_purchase_orders o where o.id=new.order_id;

  select max(greatest(0,coalesce(sp.lead_time_days,0))) into v_expected_lead
  from public.smart_purchase_order_items i
  left join public.supplier_product_offers sp on sp.id=i.supplier_offer_id
  where i.order_id=new.order_id
    and (v_supplier is null or i.supplier_name=v_supplier or sp.supplier_name=v_supplier)
    and sp.lead_time_days is not null;

  v_actual_lead := case when v_sent_date is not null then greatest(0,current_date-v_sent_date) else null end;
  v_delay := case when v_actual_lead is not null and v_expected_lead is not null then greatest(0,v_actual_lead-v_expected_lead) else null end;

  insert into public.purchase_order_receipts(
    order_id,supplier_name,receipt_date,source_file_name,status,workflow_snapshot_id,
    expected_lead_days,actual_lead_days,delay_days
  ) values(
    new.order_id,v_supplier,current_date,new.file_name,'captured',new.id,
    v_expected_lead,v_actual_lead,v_delay
  )
  on conflict(workflow_snapshot_id) where workflow_snapshot_id is not null
  do update set supplier_name=excluded.supplier_name,source_file_name=excluded.source_file_name,
    expected_lead_days=excluded.expected_lead_days,actual_lead_days=excluded.actual_lead_days,
    delay_days=excluded.delay_days,updated_at=now()
  returning id into v_receipt_id;

  delete from public.purchase_order_receipt_items where receipt_id=v_receipt_id;

  for v_detail in select value from jsonb_array_elements(coalesce(new.details->'details','[]'::jsonb)) loop
    begin v_item_id:=nullif(v_detail->'item'->>'id','')::uuid; exception when others then v_item_id:=null; end;
    v_ordered:=greatest(0,coalesce(nullif(v_detail->>'ordered','')::numeric,0));
    v_received:=greatest(0,coalesce(nullif(v_detail->>'received','')::numeric,0));
    v_expected_cost:=greatest(0,coalesce(nullif(v_detail->>'expectedPrice','')::numeric,0));
    v_actual_cost:=greatest(0,coalesce(nullif(v_detail->>'actualPrice','')::numeric,0));
    v_expected_total:=v_expected_total+(v_ordered*v_expected_cost);
    v_actual_total:=v_actual_total+(v_received*v_actual_cost);

    insert into public.purchase_order_receipt_items(
      receipt_id,order_item_id,product_code,product_name,
      ordered_quantity,received_quantity,invoiced_quantity,
      expected_unit_cost,actual_unit_cost,expected_total,actual_total,
      quantity_variance,invoice_quantity_variance,price_variance,value_variance,
      effective_unit_cost,match_status,notes,source_row
    ) values(
      v_receipt_id,v_item_id,
      coalesce(nullif(trim(v_detail->'item'->>'product_code'),''),nullif(trim(v_detail->'row'->>'product_code'),'')),
      coalesce(nullif(trim(v_detail->'item'->>'product_name'),''),nullif(trim(v_detail->'row'->>'product_name'),''),'غير معروف'),
      v_ordered,v_received,v_received,
      v_expected_cost,v_actual_cost,v_ordered*v_expected_cost,v_received*v_actual_cost,
      v_received-v_ordered,0,v_actual_cost-v_expected_cost,(v_received*v_actual_cost)-(v_ordered*v_expected_cost),
      v_actual_cost,coalesce(nullif(v_detail->>'status',''),'pending'),
      concat_ws(' • ',nullif(v_detail->>'method',''),case when coalesce(nullif(v_detail->>'confidence','')::numeric,1)<0.9 then 'مطابقة تحتاج مراجعة' end),
      coalesce(v_detail->'row'->'source','{}'::jsonb)
    );

    if v_item_id is not null then
      update public.smart_purchase_order_items
      set received_quantity=v_received,
          actual_unit_cost=case when v_actual_cost>0 then v_actual_cost else actual_unit_cost end,
          actual_total=case when v_actual_cost>0 then v_received*v_actual_cost else actual_total end,
          updated_at=now()
      where id=v_item_id;
    end if;
  end loop;

  update public.purchase_order_receipts r set
    expected_total=round(v_expected_total,2),
    received_total=round(v_actual_total,2),
    invoiced_total=round(v_actual_total,2),
    quantity_variance=coalesce((select sum(x.received_quantity-x.ordered_quantity) from public.purchase_order_receipt_items x where x.receipt_id=v_receipt_id),0),
    value_variance=round(v_actual_total-v_expected_total,2),
    price_variance=round(coalesce((select sum(abs(x.actual_unit_cost-x.expected_unit_cost)*x.received_quantity) from public.purchase_order_receipt_items x where x.receipt_id=v_receipt_id),0),2),
    completion_rate=round(coalesce((select least(100,100*sum(x.received_quantity)/nullif(sum(x.ordered_quantity),0)) from public.purchase_order_receipt_items x where x.receipt_id=v_receipt_id),0),1),
    price_score=round(greatest(0,100-coalesce((select 100*sum(abs(x.actual_unit_cost-x.expected_unit_cost)*x.received_quantity)/nullif(sum(x.expected_unit_cost*x.received_quantity),0) from public.purchase_order_receipt_items x where x.receipt_id=v_receipt_id and x.expected_unit_cost>0 and x.actual_unit_cost>0),0)),1),
    updated_at=now()
  where r.id=v_receipt_id;

  update public.purchase_order_receipts r set
    supplier_score=round(greatest(0,least(100,
      r.completion_rate*0.60+r.price_score*0.30+
      case when r.delay_days is null then 10 else greatest(0,10-least(10,r.delay_days*2)) end
    )),1)
  where r.id=v_receipt_id;

  update public.smart_purchase_orders o set
    received_total=coalesce((select sum(r.received_total) from public.purchase_order_receipts r where r.order_id=o.id),0),
    updated_at=now()
  where o.id=new.order_id;

  return new;
exception when others then
  raise warning 'purchase receipt capture failed for snapshot %: %',new.id,sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_purchase_capture_receipt_snapshot_v1 on public.smart_purchase_workflow_snapshots;
create trigger trg_purchase_capture_receipt_snapshot_v1
after insert on public.smart_purchase_workflow_snapshots
for each row when (new.workflow_type='receipt')
execute function public.purchase_capture_receipt_snapshot_v1();

create or replace function public.smart_purchase_supplier_performance_v1(
  p_session_token text,
  p_branch text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp','extensions'
as $$
declare
  a record;
  v_rows jsonb := '[]'::jsonb;
  v_summary jsonb := '{}'::jsonb;
begin
  perform set_config('statement_timeout','25000',true);
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing','accountant') then return jsonb_build_object('ok',false,'error','forbidden'); end if;

  with base as (
    select r.*,o.branch
    from public.purchase_order_receipts r
    join public.smart_purchase_orders o on o.id=r.order_id
    where nullif(trim(r.supplier_name),'') is not null
      and r.receipt_date>=current_date-365
      and (coalesce(p_branch,'all')='all' or o.branch=p_branch)
      and (a.role<>'branch_manager' or coalesce(a.branch_ids,'[]'::jsonb)?o.branch or coalesce(a.branch_ids,'[]'::jsonb)?replace(o.branch,'دواء ','') or coalesce(a.branch_ids,'[]'::jsonb)?replace(o.branch,'فرع ',''))
  ), agg as (
    select b.supplier_name,
      count(*)::int receipt_count,count(distinct b.order_id)::int order_count,max(b.receipt_date) last_receipt_date,
      round(avg(b.completion_rate)::numeric,1) avg_completion_rate,
      round(avg(b.price_score)::numeric,1) avg_price_score,
      count(*) filter(where b.delay_days is not null)::int delivery_observations,
      round(avg(b.delay_days) filter(where b.delay_days is not null)::numeric,1) avg_delay_days,
      round(100.0*count(*) filter(where b.delay_days is not null and b.delay_days=0)/nullif(count(*) filter(where b.delay_days is not null),0),1) on_time_rate,
      round(sum(greatest(0,-i.quantity_variance)*i.expected_unit_cost)::numeric,2) shortage_value,
      round(sum(greatest(0,i.actual_unit_cost-i.expected_unit_cost)*i.received_quantity)::numeric,2) price_overpay_value,
      round(100.0*count(*) filter(where b.completion_rate>=95 and b.price_score>=98)/nullif(count(*),0),1) clean_receipt_rate
    from base b left join public.purchase_order_receipt_items i on i.receipt_id=b.id
    group by b.supplier_name
  ), scored as (
    select x.*,
      round(greatest(0,least(100,
        case when delivery_observations>0 then
          coalesce(avg_completion_rate,0)*0.45+coalesce(avg_price_score,0)*0.25+coalesce(on_time_rate,0)*0.20+coalesce(clean_receipt_rate,0)*0.10
        else coalesce(avg_completion_rate,0)*0.60+coalesce(avg_price_score,0)*0.30+coalesce(clean_receipt_rate,0)*0.10 end
      )),1) performance_score,
      least(100,round(receipt_count*12.5,0))::int confidence,
      case when receipt_count<3 then 'تعلم أولي' when receipt_count<8 then 'ثقة متوسطة' else 'ثقة عالية' end confidence_label
    from agg x
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'supplier_name',supplier_name,'receipt_count',receipt_count,'order_count',order_count,'last_receipt_date',last_receipt_date,
      'completion_rate',avg_completion_rate,'price_adherence',avg_price_score,'delivery_observations',delivery_observations,
      'on_time_rate',on_time_rate,'avg_delay_days',avg_delay_days,'clean_receipt_rate',clean_receipt_rate,
      'shortage_value',coalesce(shortage_value,0),'price_overpay_value',coalesce(price_overpay_value,0),
      'performance_score',performance_score,'confidence',confidence,'confidence_label',confidence_label,
      'rating',case when performance_score>=90 then 'ممتاز' when performance_score>=80 then 'جيد جدًا' when performance_score>=70 then 'جيد' when performance_score>=60 then 'يحتاج متابعة' else 'ضعيف' end
    ) order by performance_score desc,confidence desc,supplier_name),'[]'::jsonb),
    jsonb_build_object(
      'suppliers_with_history',count(*),'receipts_analyzed',coalesce(sum(receipt_count),0),
      'shortage_value',round(coalesce(sum(shortage_value),0)::numeric,2),
      'price_overpay_value',round(coalesce(sum(price_overpay_value),0)::numeric,2),
      'high_confidence_suppliers',count(*) filter(where confidence>=100)
    )
  into v_rows,v_summary from scored;

  return jsonb_build_object(
    'ok',true,'generated_at',now(),'branch',coalesce(p_branch,'all'),'summary',v_summary,'suppliers',v_rows,
    'readiness',jsonb_build_object(
      'ready',jsonb_array_length(v_rows)>0,
      'reason',case when jsonb_array_length(v_rows)>0 then 'التقييم مبني على الاستلامات الفعلية المسجلة خلال آخر 365 يوم.' else 'لا توجد استلامات فعلية محفوظة بعد. سيبدأ التقييم تلقائيًا من أول استلام جديد.' end
    ),
    'method',jsonb_build_object(
      'with_delivery_history','45% اكتمال الكمية + 25% التزام السعر + 20% الالتزام بالموعد + 10% استلامات نظيفة',
      'without_delivery_history','60% اكتمال الكمية + 30% التزام السعر + 10% استلامات نظيفة',
      'confidence','تزداد تدريجيًا مع عدد الاستلامات ولا يعتبر المورد عالي الثقة قبل تراكم تاريخ كافٍ.'
    )
  );
end;
$$;

grant execute on function public.smart_purchase_supplier_performance_v1(text,text) to anon,authenticated;
