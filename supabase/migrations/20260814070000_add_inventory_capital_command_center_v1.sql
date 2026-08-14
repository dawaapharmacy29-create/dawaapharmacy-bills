create or replace function public.smart_purchase_inventory_command_center_v1(
  p_session_token text,
  p_branch text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp','extensions'
as $function$
declare
  v_account record;
  v_result jsonb;
begin
  perform set_config('statement_timeout','25000',true);

  select sa.* into v_account
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null
    and ss.expires_at>now()
    and sa.status='active'
  order by ss.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'error','invalid_session');
  end if;
  if v_account.role not in ('general_manager','branch_manager','purchasing','accountant') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  with latest as (
    select distinct on (
      pai.branch,
      coalesce(nullif(trim(pai.product_code),''), lower(trim(pai.product_name)))
    ) pai.*
    from public.purchase_analysis_items pai
    where (coalesce(p_branch,'all')='all' or pai.branch=p_branch)
      and (
        v_account.role <> 'branch_manager'
        or coalesce(v_account.branch_ids,'[]'::jsonb) ? coalesce(pai.branch,'')
        or coalesce(v_account.branch_ids,'[]'::jsonb) ? replace(coalesce(pai.branch,''),'دواء ','')
        or coalesce(v_account.branch_ids,'[]'::jsonb) ? replace(coalesce(pai.branch,''),'فرع ','')
      )
    order by pai.branch,
      coalesce(nullif(trim(pai.product_code),''), lower(trim(pai.product_name))),
      pai.created_at desc
  ), base as (
    select
      branch, product_code, product_name,
      greatest(0,coalesce(current_stock,0))::numeric current_stock,
      greatest(0,coalesce(pending_incoming,0))::numeric pending_incoming,
      greatest(0,coalesce(safety_stock,0))::numeric safety_stock,
      greatest(0,coalesce(sales_30,0))::numeric sales_30,
      greatest(0,coalesce(sales_60,0))::numeric sales_60,
      greatest(0,coalesce(sales_90,0))::numeric sales_90,
      greatest(0,coalesce(avg_daily_usage,0),coalesce(sales_30,0)/30.0,coalesce(sales_60,0)/60.0,coalesce(sales_90,0)/90.0)::numeric usage_per_day,
      greatest(0,coalesce(last_purchase_price,expected_unit_cost,0))::numeric unit_cost,
      greatest(0,coalesce(customer_requests_count,0))::int customer_requests_count,
      greatest(0,coalesce(priority_score,0))::numeric priority_score,
      priority_label, preferred_supplier
    from latest
    where coalesce(trim(product_name),'')<>''
  ), m as (
    select b.*,
      round((current_stock*unit_cost)::numeric,2) stock_value,
      case when usage_per_day>0 then round((current_stock/usage_per_day)::numeric,1) else null end calculated_coverage_days,
      greatest(0,ceil(usage_per_day*30 + safety_stock - current_stock - pending_incoming))::numeric month_need_qty,
      round((greatest(0,ceil(usage_per_day*30 + safety_stock - current_stock - pending_incoming))*unit_cost)::numeric,2) month_need_cost,
      greatest(0,current_stock-greatest(safety_stock,usage_per_day*45))::numeric excess_units_45,
      round((greatest(0,current_stock-greatest(safety_stock,usage_per_day*45))*unit_cost)::numeric,2) excess_value_45,
      case when sales_30=0 and sales_90<=1 and current_stock>0 then true else false end is_deadstock,
      case when usage_per_day>0 then round((unit_cost*usage_per_day)::numeric,2) else 0 end daily_cost_velocity
    from base b
  ), branch_summary as (
    select branch,
      count(*)::int items,
      count(*) filter(where current_stock>0)::int stocked_items,
      round(sum(stock_value)::numeric,2) total_stock_value,
      round(sum(excess_value_45)::numeric,2) locked_over_45_value,
      round(sum(stock_value) filter(where is_deadstock)::numeric,2) deadstock_value,
      count(*) filter(where is_deadstock)::int deadstock_items,
      round(sum(month_need_cost)::numeric,2) month_need_cost,
      round(sum(month_need_qty)::numeric,2) month_need_units,
      round(sum(daily_cost_velocity)::numeric,2) daily_cost_velocity,
      case when sum(daily_cost_velocity)>0 then round((sum(stock_value)/sum(daily_cost_velocity))::numeric,1) else null end capital_cycle_days
    from m group by branch
  ), summaries as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'branch',branch,'items',items,'stocked_items',stocked_items,'total_stock_value',total_stock_value,
      'locked_over_45_value',coalesce(locked_over_45_value,0),'deadstock_value',coalesce(deadstock_value,0),
      'deadstock_items',deadstock_items,'month_need_cost',coalesce(month_need_cost,0),'month_need_units',coalesce(month_need_units,0),
      'daily_cost_velocity',coalesce(daily_cost_velocity,0),'capital_cycle_days',capital_cycle_days
    ) order by branch),'[]'::jsonb) j from branch_summary
  ), locked as (
    select coalesce(jsonb_agg(x.obj order by x.excess desc, x.stock_value desc),'[]'::jsonb) j
    from (
      select jsonb_build_object('branch',branch,'product_code',product_code,'product_name',product_name,'current_stock',current_stock,
        'sales_30',sales_30,'sales_90',sales_90,'usage_per_day',round(usage_per_day,3),'coverage_days',calculated_coverage_days,
        'unit_cost',unit_cost,'stock_value',stock_value,'excess_value_45',excess_value_45) obj,
        excess_value_45 excess, stock_value
      from m where excess_value_45>0 or is_deadstock
      order by excess_value_45 desc, stock_value desc limit 30
    ) x
  ), dead as (
    select coalesce(jsonb_agg(x.obj order by x.stock_value desc, x.coverage desc nulls last),'[]'::jsonb) j
    from (
      select jsonb_build_object('branch',branch,'product_code',product_code,'product_name',product_name,'current_stock',current_stock,
        'sales_30',sales_30,'sales_90',sales_90,'coverage_days',calculated_coverage_days,'unit_cost',unit_cost,'stock_value',stock_value) obj,
        stock_value, calculated_coverage_days coverage
      from m where is_deadstock order by stock_value desc limit 30
    ) x
  ), slow as (
    select coalesce(jsonb_agg(x.obj order by x.coverage desc, x.stock_value desc),'[]'::jsonb) j
    from (
      select jsonb_build_object('branch',branch,'product_code',product_code,'product_name',product_name,'current_stock',current_stock,
        'sales_30',sales_30,'usage_per_day',round(usage_per_day,3),'coverage_days',calculated_coverage_days,'stock_value',stock_value,'unit_cost',unit_cost) obj,
        calculated_coverage_days coverage, stock_value
      from m where calculated_coverage_days>=60 and current_stock>0
      order by calculated_coverage_days desc,stock_value desc limit 30
    ) x
  ), turnover as (
    select coalesce(jsonb_agg(x.obj order by x.velocity desc, x.sales30 desc),'[]'::jsonb) j
    from (
      select jsonb_build_object('branch',branch,'product_code',product_code,'product_name',product_name,'current_stock',current_stock,
        'sales_30',sales_30,'sales_60',sales_60,'sales_90',sales_90,'usage_per_day',round(usage_per_day,3),'coverage_days',calculated_coverage_days,
        'unit_cost',unit_cost,'month_need_qty',month_need_qty,'month_need_cost',month_need_cost,'customer_requests_count',customer_requests_count) obj,
        usage_per_day velocity, sales_30 sales30
      from m where usage_per_day>0 order by usage_per_day desc,sales_30 desc limit 40
    ) x
  ), need as (
    select coalesce(jsonb_agg(x.obj order by x.score desc, x.need_cost desc),'[]'::jsonb) j
    from (
      select jsonb_build_object('branch',branch,'product_code',product_code,'product_name',product_name,'current_stock',current_stock,
        'pending_incoming',pending_incoming,'safety_stock',safety_stock,'sales_30',sales_30,'usage_per_day',round(usage_per_day,3),
        'coverage_days',calculated_coverage_days,'month_need_qty',month_need_qty,'month_need_cost',month_need_cost,'unit_cost',unit_cost,
        'priority_score',priority_score,'priority_label',priority_label,'customer_requests_count',customer_requests_count,'preferred_supplier',preferred_supplier) obj,
        (priority_score + customer_requests_count*35 + least(60,usage_per_day*12) + case when current_stock<=0 and usage_per_day>0 then 35 else 0 end)::numeric score,
        month_need_cost need_cost
      from m where month_need_qty>0 and unit_cost>0 order by score desc,month_need_cost desc limit 50
    ) x
  ), investment_candidates as (
    select *,
      sum(month_need_cost) over(order by
        (priority_score + customer_requests_count*35 + least(60,usage_per_day*12) + case when current_stock<=0 and usage_per_day>0 then 35 else 0 end) desc,
        case when unit_cost>0 then usage_per_day/unit_cost else 0 end desc, month_need_cost asc
      ) cumulative_cost,
      case when usage_per_day>0 then least(60,month_need_qty/usage_per_day) else 60 end days_to_sell
    from m where month_need_qty>0 and unit_cost>0 and usage_per_day>0
  ), scenarios as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'investment',budget,
      'allocatable_value',coalesce((select round(sum(month_need_cost)::numeric,2) from investment_candidates i where i.cumulative_cost<=budget),0),
      'selected_items',coalesce((select count(*) from investment_candidates i where i.cumulative_cost<=budget),0),
      'estimated_days_to_cycle',(select case when sum(month_need_cost)>0 then round((sum(month_need_cost*days_to_sell)/sum(month_need_cost))::numeric,1) else null end from investment_candidates i where i.cumulative_cost<=budget)
    ) order by budget),'[]'::jsonb) j
    from (values (50000::numeric),(100000::numeric),(150000::numeric)) s(budget)
  )
  select jsonb_build_object(
    'ok',true,'generated_at',now(),'summary',summaries.j,'cash_locked',locked.j,'deadstock',dead.j,'slow_movers',slow.j,
    'high_turnover',turnover.j,'stock_needed',need.j,'investment_scenarios',scenarios.j,
    'readiness',jsonb_build_object(
      'profitability_ready',false,'profitability_reason','لا يوجد سعر بيع موثوق وكمية بيع على مستوى الصنف داخل مصدر تحليل المشتريات الحالي.',
      'expiry_ready',false,'expiry_reason','لا توجد Batch/Expiry Date في ملف تحليل المخزون الحالي.',
      'doctor_profit_list_ready',false,'doctor_profit_list_reason','يتم تفعيلها فور ربط سعر البيع وهامش الربح الحقيقي لكل صنف.'
    ),
    'method',jsonb_build_object('month_target_days',30,'locked_threshold_days',45,'slow_threshold_days',60,
      'deadstock_rule','مبيعات 30 يوم = صفر ومبيعات 90 يوم <= 1 مع وجود رصيد','note','القيم تقديرات تشغيلية على تكلفة الشراء وليست صافي ربح محاسبي.')
  ) into v_result
  from summaries,locked,dead,slow,turnover,need,scenarios;

  return v_result;
end;
$function$;

grant execute on function public.smart_purchase_inventory_command_center_v1(text,text) to anon, authenticated;
