CREATE OR REPLACE FUNCTION public.smart_purchase_demand_transfer_preview_v2(p_session_token text, p_branch text, p_financial_mode text DEFAULT 'medium'::text, p_rows jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp', 'extensions'
AS $function$
declare
  a record;
  v_days int;
  v_plan jsonb:='[]'::jsonb;
  v_summary jsonb:='{}'::jsonb;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing','accountant') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
  if coalesce(trim(p_branch),'')='' or p_branch='all' then return jsonb_build_object('ok',false,'error','branch_required'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,p_branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;

  v_days:=case lower(coalesce(p_financial_mode,'medium')) when 'critical' then 7 when 'comfortable' then 30 else 14 end;

  with latest as (
    select distinct on (
      pai.branch,
      coalesce(nullif(trim(pai.product_code),''),public.purchase_normalize_product_name(pai.product_name))
    )
      pai.*,
      coalesce(nullif(trim(pai.product_code),''),public.purchase_normalize_product_name(pai.product_name)) product_key
    from public.purchase_analysis_items pai
    where coalesce(trim(pai.product_name),'')<>''
    order by pai.branch,
      coalesce(nullif(trim(pai.product_code),''),public.purchase_normalize_product_name(pai.product_name)),
      pai.created_at desc
  ),
  db_normalized as (
    select
      l.branch,l.product_key,l.product_code,l.product_name,
      greatest(0,coalesce(l.current_stock,0))::numeric current_stock,
      greatest(0,coalesce(l.pending_incoming,0))::numeric pending_incoming,
      greatest(0,coalesce(l.safety_stock,0))::numeric safety_stock,
      greatest(0,coalesce(l.sales_30,0))::numeric sales_30,
      greatest(0,coalesce(l.sales_60,0))::numeric sales_60,
      greatest(0,coalesce(l.sales_90,0))::numeric sales_90,
      l.last_sale_date,
      greatest(0,coalesce(l.last_purchase_price,l.expected_unit_cost,0))::numeric unit_cost,
      greatest(0,coalesce(l.customer_requests_count,0))::int customer_requests_count,
      greatest(0,coalesce(l.priority_score,0))::numeric priority_score,
      case
        when coalesce(l.avg_daily_usage,0)>0 then l.avg_daily_usage
        when coalesce(l.sales_30,0)>0 and coalesce(l.sales_60,0)>0 and coalesce(l.sales_90,0)>0
          then (l.sales_30/30.0)*0.50+(l.sales_60/60.0)*0.30+(l.sales_90/90.0)*0.20
        when coalesce(l.sales_30,0)>0 and coalesce(l.sales_90,0)>0
          then (l.sales_30/30.0)*0.60+(l.sales_90/90.0)*0.40
        when coalesce(l.sales_30,0)>0 and coalesce(l.sales_60,0)>0
          then (l.sales_30/30.0)*0.65+(l.sales_60/60.0)*0.35
        else greatest(coalesce(l.sales_30,0)/30.0,coalesce(l.sales_60,0)/60.0,coalesce(l.sales_90,0)/90.0,0)
      end::numeric usage_per_day
    from latest l
  ),
  input_rows as (
    select
      p_branch branch,
      coalesce(nullif(trim(x->>'product_code'),''),public.purchase_normalize_product_name(x->>'product_name')) product_key,
      nullif(trim(x->>'product_code'),'') product_code,
      trim(x->>'product_name') product_name,
      greatest(0,coalesce(nullif(x->>'current_stock','')::numeric,0)) current_stock,
      greatest(0,coalesce(nullif(x->>'pending_incoming','')::numeric,0)) pending_incoming,
      greatest(0,coalesce(nullif(x->>'safety_stock','')::numeric,0)) safety_stock,
      greatest(0,coalesce(nullif(x->>'sales_30','')::numeric,0)) sales_30,
      greatest(0,coalesce(nullif(x->>'sales_60','')::numeric,0)) sales_60,
      greatest(0,coalesce(nullif(x->>'sales_90','')::numeric,0)) sales_90,
      case when coalesce(x->>'last_sale_date','') ~ '^\d{4}-\d{2}-\d{2}$' then (x->>'last_sale_date')::date else null end last_sale_date,
      greatest(0,coalesce(nullif(x->>'last_purchase_price','')::numeric,nullif(x->>'expected_unit_cost','')::numeric,0)) unit_cost,
      greatest(0,coalesce(nullif(x->>'customer_requests_count','')::int,0)) customer_requests_count,
      greatest(0,coalesce(nullif(x->>'priority_score','')::numeric,0)) priority_score,
      case
        when coalesce(nullif(x->>'avg_daily_usage','')::numeric,0)>0 then (x->>'avg_daily_usage')::numeric
        when coalesce(nullif(x->>'sales_30','')::numeric,0)>0 and coalesce(nullif(x->>'sales_60','')::numeric,0)>0 and coalesce(nullif(x->>'sales_90','')::numeric,0)>0
          then ((x->>'sales_30')::numeric/30.0)*0.50+((x->>'sales_60')::numeric/60.0)*0.30+((x->>'sales_90')::numeric/90.0)*0.20
        when coalesce(nullif(x->>'sales_30','')::numeric,0)>0 and coalesce(nullif(x->>'sales_90','')::numeric,0)>0
          then ((x->>'sales_30')::numeric/30.0)*0.60+((x->>'sales_90')::numeric/90.0)*0.40
        when coalesce(nullif(x->>'sales_30','')::numeric,0)>0 and coalesce(nullif(x->>'sales_60','')::numeric,0)>0
          then ((x->>'sales_30')::numeric/30.0)*0.65+((x->>'sales_60')::numeric/60.0)*0.35
        else greatest(coalesce(nullif(x->>'sales_30','')::numeric,0)/30.0,coalesce(nullif(x->>'sales_60','')::numeric,0)/60.0,coalesce(nullif(x->>'sales_90','')::numeric,0)/90.0,0)
      end::numeric usage_per_day
    from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) x
    where nullif(trim(x->>'product_name'),'') is not null
  ),
  target_source as (
    select * from input_rows
    union all
    select d.* from db_normalized d where d.branch=p_branch and not exists(select 1 from input_rows)
  ),
  target_items as (
    select n.*,
      greatest(0,ceil(round((n.usage_per_day*v_days+n.safety_stock)::numeric,6)))::numeric target_stock,
      greatest(0,ceil(round((n.usage_per_day*v_days+n.safety_stock-n.current_stock-n.pending_incoming)::numeric,6)))::numeric gross_need,
      case when n.usage_per_day>0 then round(((n.current_stock+n.pending_incoming)/n.usage_per_day)::numeric,1) else null end coverage_days,
      case when n.last_sale_date is not null then current_date-n.last_sale_date else null end days_since_last_sale,
      case
        when n.current_stock>0 and n.last_sale_date is not null and current_date-n.last_sale_date>=90 then 'dead_90_plus'
        when n.current_stock>0 and n.last_sale_date is not null and current_date-n.last_sale_date>=60 then 'dead_60_plus'
        when n.current_stock>0 and n.sales_30=0 and n.sales_90<=1 then 'deadstock'
        when n.current_stock>0 and n.usage_per_day>0 and (n.current_stock+n.pending_incoming)/n.usage_per_day>=60 then 'slow_mover'
        when n.usage_per_day>=1 then 'fast_mover'
        when n.usage_per_day>0 then 'normal'
        else 'no_movement'
      end movement_class
    from target_source n
  ),
  cross_branch as (
    select
      t.*,
      o.branch transfer_from_branch,
      coalesce(o.current_stock,0) other_stock,
      coalesce(o.pending_incoming,0) other_pending,
      coalesce(o.usage_per_day,0) other_usage_per_day,
      greatest(0,ceil(round((coalesce(o.usage_per_day,0)*v_days+coalesce(o.safety_stock,0))::numeric,6)))::numeric other_target_stock,
      greatest(0,floor(
        coalesce(o.current_stock,0)+coalesce(o.pending_incoming,0)
        - greatest(0,ceil(round((coalesce(o.usage_per_day,0)*v_days+coalesce(o.safety_stock,0))::numeric,6)))
      ))::numeric other_safe_surplus
    from target_items t
    left join lateral (
      select n.*
      from db_normalized n
      where n.product_key=t.product_key and n.branch<>p_branch
      order by greatest(0,floor(
        n.current_stock+n.pending_incoming
        - greatest(0,ceil(round((n.usage_per_day*v_days+n.safety_stock)::numeric,6)))
      )) desc,n.current_stock desc
      limit 1
    ) o on true
  ),
  decisions as (
    select c.*,
      least(c.gross_need,c.other_safe_surplus)::numeric suggested_transfer_qty,
      greatest(0,c.gross_need-least(c.gross_need,c.other_safe_surplus))::numeric raw_buy_quantity,
      case
        when c.movement_class in ('dead_90_plus','dead_60_plus','deadstock','no_movement') and c.customer_requests_count=0 then 'do_not_buy'
        when c.gross_need<=0 then 'enough_stock'
        when c.other_safe_surplus>=c.gross_need and c.gross_need>0 then 'transfer_only'
        when c.other_safe_surplus>0 and c.gross_need>c.other_safe_surplus then 'transfer_then_buy'
        when c.gross_need>0 then 'buy'
        else 'review'
      end decision
    from cross_branch c
  ),
  final_decisions as (
    select d.*,
      case when d.decision='do_not_buy' then 0 else d.raw_buy_quantity end::numeric buy_quantity,
      round((case when d.decision='do_not_buy' then 0 else d.raw_buy_quantity end*d.unit_cost)::numeric,2) buy_estimated_cost
    from decisions d
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'branch',p_branch,'product_code',product_code,'product_name',product_name,
      'financial_mode',lower(coalesce(p_financial_mode,'medium')),'target_coverage_days',v_days,
      'current_stock',current_stock,'pending_incoming',pending_incoming,'safety_stock',safety_stock,
      'sales_30',sales_30,'sales_60',sales_60,'sales_90',sales_90,
      'usage_per_day',round(usage_per_day,3),'estimated_30_day_usage',round((usage_per_day*30)::numeric,2),
      'target_stock',target_stock,'coverage_days',coverage_days,'last_sale_date',last_sale_date,
      'days_since_last_sale',days_since_last_sale,'movement_class',movement_class,'gross_need',gross_need,
      'transfer_from_branch',transfer_from_branch,'transfer_source_stock',other_stock,
      'transfer_source_target_stock',other_target_stock,'transfer_source_safe_surplus',other_safe_surplus,
      'suggested_transfer_qty',suggested_transfer_qty,'buy_quantity',buy_quantity,
      'unit_cost',unit_cost,'buy_estimated_cost',buy_estimated_cost,
      'customer_requests_count',customer_requests_count,'priority_score',priority_score,'decision',decision
    ) order by
      case decision when 'transfer_only' then 1 when 'transfer_then_buy' then 2 when 'buy' then 3 when 'do_not_buy' then 4 else 5 end,
      priority_score desc,gross_need desc),'[]'::jsonb),
    jsonb_build_object(
      'items',count(*),'need_items',count(*) filter(where gross_need>0),
      'transfer_only_items',count(*) filter(where decision='transfer_only'),
      'transfer_then_buy_items',count(*) filter(where decision='transfer_then_buy'),
      'buy_items',count(*) filter(where decision='buy'),
      'blocked_deadstock_items',count(*) filter(where decision='do_not_buy'),
      'suggested_transfer_units',coalesce(sum(suggested_transfer_qty),0),
      'suggested_buy_units',coalesce(sum(buy_quantity),0),
      'suggested_buy_value',round(coalesce(sum(buy_estimated_cost),0)::numeric,2)
    )
  into v_plan,v_summary
  from final_decisions;

  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'branch',p_branch,'financial_mode',lower(coalesce(p_financial_mode,'medium')),
    'target_coverage_days',v_days,'summary',v_summary,'plan',v_plan,
    'method',jsonb_build_object(
      'usage','avg_daily_usage لو متاح، وإلا وزن 50%/30%/20% للأحدث',
      'financial_modes','critical=7, medium=14, comfortable=30',
      'transfer_rule','فائض الفرع الآخر فوق تغطيته المستهدفة ومخزون الأمان يخصم قبل الشراء',
      'deadstock_rule','الراكد بدون طلب عميل لا يدخل شراء تلقائي',
      'precision','يتم تقريب الاستهلاك قبل ceil لمنع إضافة وحدة بسبب الكسور العشرية الدورية',
      'source',case when jsonb_array_length(coalesce(p_rows,'[]'::jsonb))>0 then 'current_rows_plus_other_branch_db' else 'database_latest' end
    )
  ));
end $function$


revoke all on function public.smart_purchase_demand_transfer_preview_v2(text,text,text,jsonb) from public;
grant execute on function public.smart_purchase_demand_transfer_preview_v2(text,text,text,jsonb) to anon,authenticated;
