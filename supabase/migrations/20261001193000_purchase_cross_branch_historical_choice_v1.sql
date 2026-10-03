-- Trusted network historical cost source for planning only.
-- Existing branch-scoped purchase_historical_supplier_choice_v1 is intentionally preserved.
-- No inventory, movement, order or supplier-allocation data is mutated.

create or replace view public.purchase_historical_cost_network_v1 as
with ranked as (
  select
    s.branch as history_branch,
    s.product_key,
    s.product_code,
    s.product_name,
    s.supplier_name,
    s.purchase_events,
    s.last_purchase_date,
    coalesce(nullif(s.avg_effective_unit_cost,0),nullif(s.last_unit_cost,0),0)::numeric selected_unit_cost,
    case
      when nullif(s.avg_effective_unit_cost,0) is not null then 'historical_average'
      when nullif(s.last_unit_cost,0) is not null then 'historical_last'
      else 'missing'
    end historical_cost_source,
    case
      when coalesce(s.purchase_events,0)>=2 and s.last_purchase_date>=current_date-90 then 'high'
      when (coalesce(s.purchase_events,0)=1 and s.last_purchase_date>=current_date-90)
        or coalesce(s.purchase_events,0)>=2 then 'medium'
      when coalesce(s.purchase_events,0)=1 then 'low'
      else 'missing'
    end historical_confidence,
    row_number() over (
      partition by s.product_key
      order by
        case
          when coalesce(s.purchase_events,0)>=2 and s.last_purchase_date>=current_date-90 then 0
          when coalesce(s.purchase_events,0)=1 and s.last_purchase_date>=current_date-90 then 1
          when coalesce(s.purchase_events,0)>=2 then 2
          else 3
        end,
        coalesce(nullif(s.avg_effective_unit_cost,0),nullif(s.last_unit_cost,0),0),
        s.purchase_events desc,
        s.last_purchase_date desc nulls last,
        lower(trim(s.supplier_name)),
        s.branch
    ) rn
  from public.purchase_supplier_history_profiles s
  where nullif(trim(s.supplier_name),'') is not null
    and lower(trim(s.supplier_name)) not like 'دواء %'
    and lower(trim(s.supplier_name)) not like '%جرد%'
    and lower(trim(s.supplier_name)) not in ('شحن خارجي','صيدليات','مورد متنوع')
    and coalesce(nullif(s.avg_effective_unit_cost,0),nullif(s.last_unit_cost,0),0)>0
)
select
  history_branch,product_key,product_code,product_name,supplier_name,purchase_events,last_purchase_date,
  selected_unit_cost,historical_cost_source,historical_confidence
from ranked
where rn=1;

comment on view public.purchase_historical_cost_network_v1 is
'Planning-only trusted cost fallback across branches. Stock, movement, policy and supplier allocation remain branch-scoped.';

-- Rollout contract:
-- Planner functions must prefer positive snapshot unit_cost, then this view.
-- If both are missing, keep demand visible as cost_review_required with buy_quantity=0.
-- Never invent a default price and never auto-buy an unresolved-cost item.


-- One deterministic planning-cost contract. Consumers must not reimplement this precedence.
create or replace view public.purchase_planning_effective_cost_v1 as
select
  s.branch,
  s.product_key,
  s.product_code,
  s.stock_sync_id,
  case
    when coalesce(s.unit_cost,0)>0 then s.unit_cost
    when coalesce(os.unit_cost,0)>0 then os.unit_cost
    when coalesce(h.selected_unit_cost,0)>0 then h.selected_unit_cost
    else 0
  end::numeric effective_unit_cost,
  case
    when coalesce(s.unit_cost,0)>0 then 'snapshot'
    when coalesce(os.unit_cost,0)>0 then 'cross_branch_same_sync'
    when coalesce(h.selected_unit_cost,0)>0 then 'historical'
    else 'missing'
  end::text cost_source,
  case when coalesce(os.unit_cost,0)>0 and coalesce(s.unit_cost,0)<=0 then os.branch end source_branch,
  case when coalesce(s.unit_cost,0)<=0 and coalesce(os.unit_cost,0)<=0 and coalesce(h.selected_unit_cost,0)>0 then h.history_branch end history_branch,
  case when coalesce(s.unit_cost,0)<=0 and coalesce(os.unit_cost,0)<=0 and coalesce(h.selected_unit_cost,0)>0 then h.historical_cost_source end historical_cost_source,
  case when coalesce(s.unit_cost,0)<=0 and coalesce(os.unit_cost,0)<=0 and coalesce(h.selected_unit_cost,0)>0 then h.historical_confidence end historical_confidence
from public.purchase_branch_current_snapshots s
left join public.purchase_branch_current_snapshots os
  on os.product_key=s.product_key
 and os.branch<>s.branch
 and os.stock_sync_id=s.stock_sync_id
left join public.purchase_historical_cost_network_v1 h
  on h.product_key=s.product_key;

comment on view public.purchase_planning_effective_cost_v1 is
'Planner cost precedence: own positive snapshot, same-stock-sync other branch, trusted network history, otherwise missing. Missing must never auto-buy.';


-- Planner consumers of the effective-cost contract.
CREATE OR REPLACE FUNCTION public.smart_purchase_demand_transfer_preview_v10(p_session_token text, p_branch text, p_financial_mode text DEFAULT 'medium'::text, p_budget numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp', 'extensions'
AS $function$
declare
  a record;
  v_mode text:=lower(coalesce(nullif(trim(p_financial_mode),''),'medium'));
  v_safe_order numeric:=0;
  v_financial_captured_at timestamptz;
  v_stock_captured_at timestamptz;
  v_movement_captured_at timestamptz;
  v_profile_calculated_at timestamptz;
  v_financial_fresh boolean:=false;
  v_stock_fresh boolean:=false;
  v_movement_fresh boolean:=false;
  v_profile_fresh boolean:=false;
  v_hist_median numeric:=0;
  v_effective_budget numeric:=0;
  v_policy_count int:=0;
  v_integrity_issues int:=0;
  v_integrity_detail jsonb:='{}'::jsonb;
  v_plan jsonb:='[]'::jsonb;
  v_summary jsonb:='{}'::jsonb;
begin
  select sa.* into a
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

  if not public.smart_purchase_branch_allowed_v2(a.id,p_branch) then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;

  select
    count(*),
    count(*) filter(where
      s.product_key is null
      or coalesce(s.inventory_eligible,false)=false
      or coalesce(p.smart_min_stock,0)<0
      or coalesce(p.smart_reorder_point,0)<coalesce(p.smart_min_stock,0)
      or coalesce(p.smart_max_stock,0)<coalesce(p.smart_reorder_point,0)
    ),
    jsonb_build_object(
      'missing_snapshot',count(*) filter(where s.product_key is null),
      'ineligible',count(*) filter(where s.product_key is not null and coalesce(s.inventory_eligible,false)=false),
      'missing_cost',count(*) filter(where s.product_key is not null and coalesce(ec.effective_unit_cost,0)<=0),
      'min_gt_reorder',count(*) filter(where coalesce(p.smart_min_stock,0)>coalesce(p.smart_reorder_point,0)),
      'reorder_gt_max',count(*) filter(where coalesce(p.smart_reorder_point,0)>coalesce(p.smart_max_stock,0)),
      'negative_policy',count(*) filter(where coalesce(p.smart_min_stock,0)<0 or coalesce(p.smart_reorder_point,0)<0 or coalesce(p.smart_max_stock,0)<0)
    )
  into v_policy_count,v_integrity_issues,v_integrity_detail
  from public.purchase_inventory_intelligence_profiles p
  left join public.purchase_branch_current_snapshots s
    on s.branch=p.branch and s.product_key=p.product_key
  left join public.purchase_planning_effective_cost_v1 ec on ec.branch=s.branch and ec.product_key=s.product_key
  where p.branch=p_branch
    and p.inventory_policy_model_version='adaptive_pack_minmax_v1';

  if v_policy_count=0 then
    return jsonb_build_object('ok',false,'error','no_active_purchase_policy','data',jsonb_build_object('branch',p_branch));
  end if;

  if v_integrity_issues>0 then
    return jsonb_build_object('ok',false,'error','analysis_integrity_guard_failed','data',jsonb_build_object('branch',p_branch,'issues',v_integrity_issues,'detail',v_integrity_detail));
  end if;

  select min(source_calculated_at)
  into v_profile_calculated_at
  from public.purchase_inventory_intelligence_profiles
  where branch=p_branch
    and inventory_policy_model_version='adaptive_pack_minmax_v1';

  v_profile_fresh := v_profile_calculated_at is not null and now()-v_profile_calculated_at <= interval '48 hours';

  select coalesce(safe_order_today,0),captured_at
  into v_safe_order,v_financial_captured_at
  from public.purchase_decision_daily_snapshots
  where branch=p_branch
  order by captured_at desc
  limit 1;

  v_financial_fresh := v_financial_captured_at is not null and now()-v_financial_captured_at <= interval '12 hours';

  select max(stock_captured_at),max(movement_captured_at)
  into v_stock_captured_at,v_movement_captured_at
  from public.purchase_branch_current_snapshots
  where branch=p_branch and coalesce(inventory_eligible,true);

  v_stock_fresh := v_stock_captured_at is not null and now()-v_stock_captured_at <= interval '24 hours';
  v_movement_fresh := v_movement_captured_at is not null and now()-v_movement_captured_at <= interval '48 hours';

  with daily as (
    select invoice_date,sum(total_value)::numeric spend
    from public.purchase_invoices
    where branch=p_branch
      and transaction_type='external_purchase'
      and invoice_date>=current_date-30
      and invoice_date<current_date
      and coalesce(is_sample,false)=false
      and excluded_at is null
      and coalesce(duplicate_review_status,'') not in ('duplicate','confirmed_duplicate')
      and coalesce(status,'') not in ('cancelled','canceled','ملغي','ملغاة')
    group by invoice_date
  )
  select coalesce(percentile_cont(.5) within group(order by spend),0)
  into v_hist_median
  from daily;

  if coalesce(p_budget,0)>0 then
    v_effective_budget := case
      when v_safe_order>0 and v_financial_fresh then least(p_budget,v_safe_order)
      else p_budget
    end;
  elsif v_safe_order>0 and v_financial_fresh then
    v_effective_budget := v_safe_order;
  elsif v_hist_median>0 then
    v_effective_budget := v_hist_median;
  else
    v_effective_budget := 30000;
  end if;

  with base as (
    select
      s.branch,s.product_key,s.product_code,s.product_name,s.stock_unit,s.company_name,
      greatest(0,coalesce(s.current_stock,0))::numeric current_stock,
      greatest(0,coalesce(s.pending_incoming,0))::numeric snapshot_pending_incoming,
      greatest(0,coalesce(ep.pending_quantity,0))::numeric executive_pending_incoming,
      greatest(greatest(0,coalesce(s.pending_incoming,0)),greatest(0,coalesce(ep.pending_quantity,0)))::numeric pending_incoming,
      greatest(0,coalesce(s.current_stock,0))
        + greatest(greatest(0,coalesce(s.pending_incoming,0)),greatest(0,coalesce(ep.pending_quantity,0)))::numeric available_stock,
      greatest(0,coalesce(ec.effective_unit_cost,0))::numeric unit_cost,
      coalesce(ec.cost_source,'missing')::text cost_source,
      ec.source_branch,ec.history_branch,ec.historical_cost_source,ec.historical_confidence,
      greatest(0,coalesce(s.customer_requests_count,0))::int customer_requests_count,
      p.smart_daily_consumption::numeric forecast_daily,
      p.smart_weekly_consumption::numeric smart_weekly_consumption,
      p.smart_monthly_consumption::numeric smart_monthly_consumption,
      p.smart_min_stock::numeric min_stock,
      p.smart_reorder_point::numeric reorder_stock,
      p.smart_max_stock::numeric max_stock,
      p.smart_target_days::numeric smart_target_days,
      p.confidence_score::numeric confidence_score,
      p.demand_stability_score::numeric demand_stability_score,
      p.outlier_share::numeric outlier_share,
      p.dominant_customer_share::numeric dominant_customer_share,
      p.auto_decision_class,
      p.trend_class,
      p.customers_30d,
      p.invoices_30d,
      p.supply_cycle_days,
      p.supply_history_source
    from public.purchase_branch_current_snapshots s
    join public.purchase_inventory_intelligence_profiles p
      on p.branch=s.branch
     and p.product_key=s.product_key
     and p.inventory_policy_model_version='adaptive_pack_minmax_v1'
    left join public.smart_purchase_executive_pending_incoming_v1 ep
      on ep.branch=s.branch and ep.product_key=s.product_key
    left join public.purchase_planning_effective_cost_v1 ec on ec.branch=s.branch and ec.product_key=s.product_key
    where coalesce(s.inventory_eligible,true)
  ),
  target as (
    select
      b.*,
      case
        when v_mode in ('essential','critical') then b.min_stock
        when v_mode='comfortable' then b.max_stock
        else b.reorder_stock
      end::numeric execution_target_stock,
      case
        when b.forecast_daily>0 then b.available_stock/b.forecast_daily
        else null
      end::numeric coverage_days,
      case
        when b.forecast_daily>0 then b.reorder_stock/b.forecast_daily
        else null
      end::numeric reorder_point_days
    from base b
  ),
  other as (
    select * from target where branch<>p_branch
  ),
  matched as (
    select
      t.*,
      src.branch transfer_from_branch,
      coalesce(src.available_stock,0)::numeric source_available,
      coalesce(src.max_stock,0)::numeric source_max,
      greatest(0,coalesce(src.available_stock,0)-coalesce(src.max_stock,0))::numeric source_surplus
    from target t
    left join other src
      on src.product_key=t.product_key
    where t.branch=p_branch
  ),
  desired as (
    select
      m.*,
      case
        when v_mode='essential'
          then case
            when m.customer_requests_count>0 or m.available_stock<=0 then greatest(0,m.execution_target_stock-m.available_stock)
            else 0
          end
        else greatest(0,m.execution_target_stock-m.available_stock)
      end::numeric gross_need,
      case
        when m.available_stock<=0 then 'stockout'
        when m.available_stock<m.min_stock then 'below_min'
        when m.available_stock<m.reorder_stock then 'below_reorder'
        when m.available_stock<m.max_stock then 'below_max'
        else 'healthy'
      end stock_state
    from matched m
  ),
  moved as (
    select
      d.*,
      least(d.gross_need,d.source_surplus)::numeric transfer_qty
    from desired d
  ),
  need as (
    select
      m.*,
      ceil(greatest(0,m.gross_need-m.transfer_qty))::numeric period_buy_quantity,
      least(100,greatest(0,
        case m.stock_state
          when 'stockout' then 50
          when 'below_min' then 40
          when 'below_reorder' then 25
          when 'below_max' then 8
          else 0
        end
        + case when m.customer_requests_count>0 then least(20,10+m.customer_requests_count*2) else 0 end
        + case when m.auto_decision_class='high' then 10 else 5 end
        + case when m.demand_stability_score>=70 then 10 when m.demand_stability_score>=50 then 6 else 2 end
        + case when m.trend_class='up' then 7 when m.trend_class='down' then -4 else 0 end
        + case when coalesce(m.customers_30d,0)>=10 then 5 when coalesce(m.customers_30d,0)>=5 then 3 else 0 end
      ))::numeric priority_score
    from moved m
  ),
  ranked as (
    select
      n.*,
      (n.period_buy_quantity*n.unit_cost)::numeric period_line_value,
      sum(n.period_buy_quantity*n.unit_cost) over(
        order by
          case when n.customer_requests_count>0 then 0 else 1 end,
          n.priority_score desc,
          case n.stock_state when 'stockout' then 0 when 'below_min' then 1 when 'below_reorder' then 2 else 3 end,
          n.period_buy_quantity*n.unit_cost asc,
          n.product_name
      )::numeric cumulative_before_partial
    from need n
    where n.period_buy_quantity>0 and n.unit_cost>0
  ),
  budgeted as (
    select
      r.*,
      greatest(0,v_effective_budget-(r.cumulative_before_partial-r.period_line_value))::numeric remaining_before,
      case
        when r.unit_cost<=0 then 0
        when r.cumulative_before_partial<=v_effective_budget then r.period_buy_quantity
        else least(r.period_buy_quantity,floor(greatest(0,v_effective_budget-(r.cumulative_before_partial-r.period_line_value))/r.unit_cost))
      end::numeric buy_today_qty
    from ranked r
  ),
  rows as (
    select
      n.*,
      coalesce(b.buy_today_qty,0)::numeric buy_quantity,
      (coalesce(b.buy_today_qty,0)*n.unit_cost)::numeric buy_estimated_cost,
      case
        when n.gross_need>0 and n.unit_cost<=0 then 'cost_review_required'
        when n.gross_need<=0 then 'monitor'
        when n.period_buy_quantity<=0 and n.transfer_qty>0 then 'transfer_only'
        when coalesce(b.buy_today_qty,0)>=n.period_buy_quantity and n.transfer_qty>0 then 'transfer_then_buy'
        when coalesce(b.buy_today_qty,0)>=n.period_buy_quantity then 'buy_now'
        when coalesce(b.buy_today_qty,0)>0 then 'buy_partial_budget'
        else 'defer_budget'
      end decision,
      case
        when n.gross_need>0 and n.unit_cost<=0 then 'الاحتياج حقيقي لكن لا توجد تكلفة شراء موثوقة؛ مراجعة التكلفة مطلوبة قبل أي شراء'
        when n.gross_need<=0 then 'الرصيد داخل السياسة المناسبة للوضع المالي الحالي'
        when n.period_buy_quantity<=0 and n.transfer_qty>0 then 'الاحتياج يتغطى بالكامل من فائض الفرع الآخر فوق الحد الأقصى'
        when coalesce(b.buy_today_qty,0)>=n.period_buy_quantity and n.transfer_qty>0 then 'تحويل الفائض أولًا ثم شراء المتبقي ضمن السقف المالي الآمن'
        when coalesce(b.buy_today_qty,0)>=n.period_buy_quantity then
          case
            when v_mode in ('essential','critical') then 'شراء للوصول إلى الحد الأدنى الآمن'
            when v_mode='comfortable' then 'تعزيز المخزون حتى الحد الأقصى الذكي ضمن السيولة الآمنة'
            else 'شراء للوصول إلى نقطة إعادة الطلب'
          end
        when coalesce(b.buy_today_qty,0)>0 then 'شراء جزئي اليوم، والباقي يؤجل حسب أولوية السيولة'
        else 'احتياج حقيقي لكنه مؤجل لأن أصناف أعلى أولوية استهلكت سقف اليوم'
      end reason
    from need n
    left join budgeted b on b.branch=n.branch and b.product_key=n.product_key
  ),
  summary as (
    select jsonb_build_object(
      'policy_items',count(*),
      'stockout_items',count(*) filter(where stock_state='stockout'),
      'below_min_items',count(*) filter(where stock_state='below_min'),
      'below_reorder_items',count(*) filter(where stock_state='below_reorder'),
      'below_max_items',count(*) filter(where stock_state='below_max'),
      'transfer_only_items',count(*) filter(where decision='transfer_only'),
      'transfer_then_buy_items',count(*) filter(where decision='transfer_then_buy'),
      'transfer_units',coalesce(sum(transfer_qty),0),
      'buy_now_items',count(*) filter(where decision in ('buy_now','buy_partial_budget','transfer_then_buy')),
      'deferred_budget_items',count(*) filter(where decision='defer_budget'),
      'cost_review_items',count(*) filter(where decision='cost_review_required'),
      'historical_cost_fallback_items',count(*) filter(where cost_source='historical'),
      'cross_branch_cost_fallback_items',count(*) filter(where cost_source='cross_branch_same_sync'),
      'quick_review_items',count(*) filter(where buy_quantity>0 and (
        buy_estimated_cost>5000
        or (smart_monthly_consumption>0 and buy_quantity>smart_monthly_consumption)
        or coalesce(dominant_customer_share,0)>=0.7
        or coalesce(outlier_share,0)>=0.5
      )),
      'period_need_units',coalesce(sum(period_buy_quantity),0),
      'period_need_value',round(coalesce(sum(period_buy_quantity*unit_cost),0)::numeric,2),
      'suggested_buy_units',coalesce(sum(buy_quantity),0),
      'suggested_buy_value',round(coalesce(sum(buy_estimated_cost),0)::numeric,2),
      'recommended_daily_budget',round(v_effective_budget,2),
      'safe_order_today',round(v_safe_order,2),
      'financial_snapshot_fresh',v_financial_fresh,
      'stock_snapshot_fresh',v_stock_fresh,
      'movement_snapshot_fresh',v_movement_fresh,
      'profile_snapshot_fresh',v_profile_fresh,
      'analysis_ready_for_order',(v_stock_fresh and v_movement_fresh and v_profile_fresh and (coalesce(p_budget,0)>0 or v_financial_fresh)),
      'historical_median_purchase_day',round(v_hist_median,2),
      'financial_target',
        case
          when v_mode in ('essential','critical') then 'min'
          when v_mode='comfortable' then 'max'
          else 'reorder'
        end
    ) j
    from rows
  ),
  plan_rows as (
    select jsonb_build_object(
      'product_key',product_key,
      'product_code',product_code,
      'product_name',product_name,
      'stock_unit',stock_unit,
      'company_name',company_name,
      'current_stock',current_stock,
      'pending_incoming',pending_incoming,
      'snapshot_pending_incoming',snapshot_pending_incoming,
      'executive_pending_incoming',executive_pending_incoming,
      'forecast_daily',forecast_daily,
      'usage_per_day',forecast_daily,
      'coverage_days',coverage_days,
      'reorder_point_days',reorder_point_days,
      'dynamic_target_days',smart_target_days,
      'target_stock',max_stock,
      'min_stock',min_stock,
      'reorder_stock',reorder_stock,
      'max_stock',max_stock,
      'execution_target_stock',execution_target_stock,
      'period_buy_quantity',period_buy_quantity,
      'gross_need',gross_need,
      'suggested_transfer_qty',transfer_qty,
      'transfer_from_branch',case when transfer_qty>0 then transfer_from_branch else null end,
      'buy_quantity',buy_quantity,
      'buy_estimated_cost',buy_estimated_cost,
      'unit_cost',unit_cost,
      'cost_source',cost_source,
      'cost_source_branch',source_branch,
      'history_branch',history_branch,
      'historical_cost_source',historical_cost_source,
      'historical_confidence',historical_confidence,
      'priority_score',priority_score,
      'stock_state',stock_state,
      'confidence_score',confidence_score,
      'demand_stability_score',demand_stability_score,
      'smart_monthly_consumption',smart_monthly_consumption,
      'outlier_share',outlier_share,
      'dominant_customer_share',dominant_customer_share,
      'requires_quick_review',(buy_quantity>0 and (
        buy_estimated_cost>5000
        or (smart_monthly_consumption>0 and buy_quantity>smart_monthly_consumption)
        or coalesce(dominant_customer_share,0)>=0.7
        or coalesce(outlier_share,0)>=0.5
      )),
      'quick_review_reasons',to_jsonb(array_remove(array[
        case when buy_estimated_cost>5000 then 'high_line_value' end,
        case when smart_monthly_consumption>0 and buy_quantity>smart_monthly_consumption then 'qty_above_smart_monthly' end,
        case when coalesce(dominant_customer_share,0)>=0.7 then 'dominant_customer' end,
        case when coalesce(outlier_share,0)>=0.5 then 'high_outlier_share' end
      ]::text[],null)),
      'auto_decision_class',auto_decision_class,
      'trend_class',trend_class,
      'customers_30d',customers_30d,
      'invoices_30d',invoices_30d,
      'supply_cycle_days',supply_cycle_days,
      'supply_history_source',supply_history_source,
      'decision',decision,
      'reason',reason
    ) j,
    decision,priority_score,product_name
    from rows
    where gross_need>0 or transfer_qty>0
  )
  select
    coalesce((select jsonb_agg(j order by
      case decision when 'transfer_only' then 1 when 'transfer_then_buy' then 2 when 'buy_now' then 3 when 'buy_partial_budget' then 4 else 5 end,
      priority_score desc,
      product_name
    ) from plan_rows),'[]'::jsonb),
    (select j from summary)
  into v_plan,v_summary;

  return jsonb_build_object(
    'ok',true,
    'data',jsonb_build_object(
      'branch',p_branch,
      'financial_mode',v_mode,
      'summary',v_summary,
      'plan',v_plan,
      'method',jsonb_build_object(
        'engine','smart_purchase_demand_transfer_preview_v10',
        'policy_model','adaptive_pack_minmax_v1',
        'consumption_model','pack_equivalent_3m_v1',
        'financial_target',v_summary->>'financial_target',
        'transfer_policy','only surplus above source smart max',
        'review_policy','review-only profiles are excluded from automatic purchasing',
        'budget_source',case
          when coalesce(p_budget,0)>0 and v_safe_order>0 and v_financial_fresh then 'user_cap_guarded_by_safe_order'
          when coalesce(p_budget,0)>0 then 'user_cap'
          when v_safe_order>0 and v_financial_fresh then 'safe_order_today'
          else 'historical_median_purchase_day'
        end,
        'data_quality',jsonb_build_object(
          'financial_snapshot_at',v_financial_captured_at,
          'financial_snapshot_fresh',v_financial_fresh,
          'stock_snapshot_at',v_stock_captured_at,
          'stock_snapshot_fresh',v_stock_fresh,
          'movement_snapshot_at',v_movement_captured_at,
          'movement_snapshot_fresh',v_movement_fresh,
          'profile_calculated_at',v_profile_calculated_at,
          'profile_snapshot_fresh',v_profile_fresh,
          'analysis_ready_for_order',(v_stock_fresh and v_movement_fresh and v_profile_fresh and (coalesce(p_budget,0)>0 or v_financial_fresh))
        )
      )
    )
  );
end
$function$
;

CREATE OR REPLACE FUNCTION public.smart_purchase_dual_branch_instant_plan_v1(p_session_token text, p_shokry_budget numeric DEFAULT NULL::numeric, p_shamy_budget numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp', 'extensions'
 SET statement_timeout TO '20s'
AS $function$
declare
  a record;
  v_branch text;
  v_safe numeric:=0;
  v_financial_at timestamptz;
  v_capacity numeric:=0;
  v_min_value numeric:=0;
  v_reorder_value numeric:=0;
  v_max_value numeric:=0;
  v_mode text;
  v_budget numeric;
  v_result jsonb;
  v_shokry jsonb;
  v_shamy jsonb;
  v_modes jsonb:='{}'::jsonb;
  v_shokry_sync text;
  v_shamy_sync text;
  v_sync_id text;
  v_plan_hash text;
  v_review_watchlist jsonb;
  v_movement_watchlist jsonb;
  v_creation_guard jsonb;
  v_pending_summary jsonb;
  v_negative_shokry int:=0;
  v_negative_shamy int:=0;
begin
  select sa.* into a
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

  perform public.smart_purchase_refresh_movement_review_v1();

  select s.stock_sync_id
  into v_shokry_sync
  from public.purchase_branch_current_snapshots s
  where s.branch='دواء شكري'
    and coalesce(s.inventory_eligible,true)
    and s.stock_sync_id is not null
  order by s.stock_captured_at desc nulls last
  limit 1;

  select s.stock_sync_id
  into v_shamy_sync
  from public.purchase_branch_current_snapshots s
  where s.branch='دواء الشامي'
    and coalesce(s.inventory_eligible,true)
    and s.stock_sync_id is not null
  order by s.stock_captured_at desc nulls last
  limit 1;

  if coalesce(v_shokry_sync,'')=''
     or coalesce(v_shamy_sync,'')=''
     or v_shokry_sync<>v_shamy_sync then
    return jsonb_build_object(
      'ok',false,
      'error','stock_sync_mismatch',
      'data',jsonb_build_object(
        'shokry_sync',v_shokry_sync,
        'shamy_sync',v_shamy_sync
      )
    );
  end if;

  v_sync_id:=v_shokry_sync;

  select
    count(*) filter(where s.branch='دواء شكري' and coalesce((s.source_row->>'shokry_stock_negative')::boolean,false)),
    count(*) filter(where s.branch='دواء الشامي' and coalesce((s.source_row->>'shamy_stock_negative')::boolean,false))
  into v_negative_shokry,v_negative_shamy
  from public.purchase_branch_current_snapshots s
  where s.stock_sync_id=v_sync_id
    and s.branch in ('دواء شكري','دواء الشامي');

  foreach v_branch in array array['دواء شكري','دواء الشامي'] loop
    if not public.smart_purchase_branch_allowed_v2(a.id,v_branch) then
      return jsonb_build_object('ok',false,'error','forbidden_branch','data',jsonb_build_object('branch',v_branch));
    end if;

    select coalesce(d.safe_order_today,0),d.captured_at
    into v_safe,v_financial_at
    from public.purchase_decision_daily_snapshots d
    where d.branch=v_branch
    order by d.captured_at desc
    limit 1;

    v_budget:=case when v_branch='دواء شكري' then p_shokry_budget else p_shamy_budget end;

    v_capacity:=case
      when coalesce(v_budget,0)>0
           and v_financial_at is not null
           and now()-v_financial_at<=interval '12 hours'
           and v_safe>0
        then least(v_budget,v_safe)
      when coalesce(v_budget,0)>0 then v_budget
      when v_financial_at is not null
           and now()-v_financial_at<=interval '12 hours'
        then greatest(0,v_safe)
      else 0
    end;

    with active as (
      select
        p.branch,
        p.product_key,
        p.smart_min_stock,
        p.smart_reorder_point,
        p.smart_max_stock,
        greatest(0,coalesce(s.current_stock,0))
          + greatest(
              greatest(0,coalesce(s.pending_incoming,0)),
              greatest(0,coalesce(ep.pending_quantity,0))
            ) available,
        greatest(0,coalesce(ec.effective_unit_cost,0)) unit_cost
      from public.purchase_inventory_intelligence_profiles p
      join public.purchase_branch_current_snapshots s
        on s.branch=p.branch and s.product_key=p.product_key
      left join public.smart_purchase_executive_pending_incoming_v1 ep
        on ep.branch=s.branch and ep.product_key=s.product_key
      left join public.purchase_planning_effective_cost_v1 ec on ec.branch=s.branch and ec.product_key=s.product_key
      where p.inventory_policy_model_version='adaptive_pack_minmax_v1'
        and coalesce(s.inventory_eligible,true)
    ),
    target as (
      select *
      from active
      where branch=v_branch
    ),
    source as (
      select
        product_key,
        greatest(0,available-smart_max_stock) source_surplus
      from active
      where branch<>v_branch
    ),
    net as (
      select
        t.*,
        coalesce(src.source_surplus,0) source_surplus,
        greatest(0,greatest(0,t.smart_min_stock-t.available)-coalesce(src.source_surplus,0)) need_min_external,
        greatest(0,greatest(0,t.smart_reorder_point-t.available)-coalesce(src.source_surplus,0)) need_reorder_external,
        greatest(0,greatest(0,t.smart_max_stock-t.available)-coalesce(src.source_surplus,0)) need_max_external
      from target t
      left join source src on src.product_key=t.product_key
    )
    select
      coalesce(sum(need_min_external*unit_cost),0),
      coalesce(sum(need_reorder_external*unit_cost),0),
      coalesce(sum(need_max_external*unit_cost),0)
    into v_min_value,v_reorder_value,v_max_value
    from net;

    v_mode:=case
      when v_capacity<=0 then 'critical'
      when v_capacity<v_reorder_value then 'critical'
      when v_capacity<v_max_value then 'medium'
      else 'comfortable'
    end;

    select public.smart_purchase_demand_transfer_preview_v10(
      p_session_token,
      v_branch,
      v_mode,
      v_budget
    )
    into v_result;

    if coalesce((v_result->>'ok')::boolean,false)=false then
      return v_result;
    end if;

    v_modes:=v_modes || jsonb_build_object(
      v_branch,
      jsonb_build_object(
        'mode',v_mode,
        'decision_capacity',round(v_capacity,2),
        'safe_order_today',round(v_safe,2),
        'financial_snapshot_at',v_financial_at,
        'financial_snapshot_fresh',(v_financial_at is not null and now()-v_financial_at<=interval '12 hours'),
        'need_to_min',round(v_min_value,2),
        'need_to_reorder',round(v_reorder_value,2),
        'need_to_max',round(v_max_value,2)
      )
    );

    if v_branch='دواء شكري' then
      v_shokry:=v_result->'data';
    else
      v_shamy:=v_result->'data';
    end if;
  end loop;

  v_review_watchlist:=jsonb_build_object(
    'shokry',public.smart_purchase_review_watchlist_clean_v1('دواء شكري',25),
    'shamy',public.smart_purchase_review_watchlist_clean_v1('دواء الشامي',25)
  );

  v_movement_watchlist:=jsonb_build_object(
    'shokry',public.smart_purchase_movement_watchlist_clean_v1('دواء شكري',15),
    'shamy',public.smart_purchase_movement_watchlist_clean_v1('دواء الشامي',15)
  );

  select jsonb_build_object(
    'shokry',jsonb_build_object(
      'items',count(*) filter(where ep.branch='دواء شكري'),
      'units',round(coalesce(sum(ep.pending_quantity) filter(where ep.branch='دواء شكري'),0),2),
      'last_sent_at',max(ep.last_sent_at) filter(where ep.branch='دواء شكري')
    ),
    'shamy',jsonb_build_object(
      'items',count(*) filter(where ep.branch='دواء الشامي'),
      'units',round(coalesce(sum(ep.pending_quantity) filter(where ep.branch='دواء الشامي'),0),2),
      'last_sent_at',max(ep.last_sent_at) filter(where ep.branch='دواء الشامي')
    )
  )
  into v_pending_summary
  from public.smart_purchase_executive_pending_incoming_v1 ep;

  v_creation_guard:=jsonb_build_object(
    'shokry_open_order',public.smart_purchase_branch_has_blocking_order_clean_v1('دواء شكري'),
    'shamy_open_order',public.smart_purchase_branch_has_blocking_order_clean_v1('دواء الشامي'),
    'shokry_data_ready',coalesce((v_shokry->'method'->'data_quality'->>'analysis_ready_for_order')::boolean,false),
    'shamy_data_ready',coalesce((v_shamy->'method'->'data_quality'->>'analysis_ready_for_order')::boolean,false),
    'stock_quality',jsonb_build_object(
      'negative_shokry',v_negative_shokry,
      'negative_shamy',v_negative_shamy,
      'ok',(v_negative_shokry=0 and v_negative_shamy=0)
    ),
    'can_create_dual',
      not public.smart_purchase_branch_has_blocking_order_clean_v1('دواء شكري')
      and not public.smart_purchase_branch_has_blocking_order_clean_v1('دواء الشامي')
      and coalesce((v_shokry->'method'->'data_quality'->>'analysis_ready_for_order')::boolean,false)
      and coalesce((v_shamy->'method'->'data_quality'->>'analysis_ready_for_order')::boolean,false),
    'shokry_open_orders',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',o.id,
        'order_number',o.order_number,
        'status',o.status,
        'created_at',o.created_at,
        'title',o.title
      ) order by o.created_at desc)
      from public.smart_purchase_orders o
      where o.branch='دواء شكري'
        and coalesce(o.status,'') not in (
          'ملغاة','cancelled','canceled','مغلقة','closed',
          'وصلت بالكامل','received','تمت مطابقة الفاتورة','matched'
        )
        and (
          (
            o.created_at>=now()-interval '30 days'
            and o.status in (
              'draft','مسودة','تم التحليل','معتمدة','approved',
              'تم الإرسال للمورد','sent','وصلت جزئيًا','partially_received'
            )
          )
          or (
            exists(
              select 1 from public.purchase_order_supplier_dispatches d
              where d.order_id=o.id and d.sent_at is not null
            )
            and exists(
              select 1 from public.smart_purchase_order_items i
              where i.order_id=o.id
                and greatest(0,coalesce(i.approved_quantity,0)-coalesce(i.received_quantity,0))>0
            )
          )
          or exists(
            select 1 from public.purchase_order_receipts r
            where r.order_id=o.id and coalesce(r.cumulative_remaining_quantity,0)>0
          )
        )
    ),'[]'::jsonb),
    'shamy_open_orders',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',o.id,
        'order_number',o.order_number,
        'status',o.status,
        'created_at',o.created_at,
        'title',o.title
      ) order by o.created_at desc)
      from public.smart_purchase_orders o
      where o.branch='دواء الشامي'
        and coalesce(o.status,'') not in (
          'ملغاة','cancelled','canceled','مغلقة','closed',
          'وصلت بالكامل','received','تمت مطابقة الفاتورة','matched'
        )
        and (
          (
            o.created_at>=now()-interval '30 days'
            and o.status in (
              'draft','مسودة','تم التحليل','معتمدة','approved',
              'تم الإرسال للمورد','sent','وصلت جزئيًا','partially_received'
            )
          )
          or (
            exists(
              select 1 from public.purchase_order_supplier_dispatches d
              where d.order_id=o.id and d.sent_at is not null
            )
            and exists(
              select 1 from public.smart_purchase_order_items i
              where i.order_id=o.id
                and greatest(0,coalesce(i.approved_quantity,0)-coalesce(i.received_quantity,0))>0
            )
          )
          or exists(
            select 1 from public.purchase_order_receipts r
            where r.order_id=o.id and coalesce(r.cumulative_remaining_quantity,0)>0
          )
        )
    ),'[]'::jsonb),
    'legacy_stale_orders',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',o.id,
        'order_number',o.order_number,
        'branch',o.branch,
        'status',o.status,
        'created_at',o.created_at,
        'title',o.title
      ) order by o.created_at desc)
      from public.smart_purchase_orders o
      where coalesce(o.status,'') not in (
        'ملغاة','cancelled','canceled','مغلقة','closed',
        'وصلت بالكامل','received','تمت مطابقة الفاتورة','matched'
      )
        and o.created_at<now()-interval '30 days'
        and not exists(
          select 1 from public.purchase_order_supplier_dispatches d
          where d.order_id=o.id and d.sent_at is not null
        )
        and not exists(select 1 from public.purchase_order_receipts r where r.order_id=o.id)
        and not exists(select 1 from public.smart_purchase_receipt_facts rf where rf.order_id=o.id)
    ),'[]'::jsonb)
  );

  v_plan_hash:=encode(
    extensions.digest(
      convert_to(
        coalesce(v_sync_id,'')||'|'||
        coalesce(v_modes::text,'{}')||'|'||
        coalesce(v_shokry::text,'{}')||'|'||
        coalesce(v_shamy::text,'{}'),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  return jsonb_build_object(
    'ok',true,
    'data',jsonb_build_object(
      'planner','dual_branch_instant_plan_v1',
      'stock_sync_id',v_sync_id,
      'plan_hash',v_plan_hash,
      'generated_at',now(),
      'modes',v_modes,
      'shokry',v_shokry,
      'shamy',v_shamy,
      'execution_pending',v_pending_summary,
      'review_watchlist',v_review_watchlist,
      'movement_only_watchlist',v_movement_watchlist,
      'creation_guard',v_creation_guard,
      'totals',jsonb_build_object(
        'buy_value',
          round(
            coalesce((v_shokry->'summary'->>'suggested_buy_value')::numeric,0)
            + coalesce((v_shamy->'summary'->>'suggested_buy_value')::numeric,0)
          ,2),
        'buy_items',
          coalesce((v_shokry->'summary'->>'buy_now_items')::int,0)
          + coalesce((v_shamy->'summary'->>'buy_now_items')::int,0),
        'transfer_items',
          coalesce((v_shokry->'summary'->>'transfer_only_items')::int,0)
          + coalesce((v_shokry->'summary'->>'transfer_then_buy_items')::int,0)
          + coalesce((v_shamy->'summary'->>'transfer_only_items')::int,0)
          + coalesce((v_shamy->'summary'->>'transfer_then_buy_items')::int,0),
        'quick_review_items',
          coalesce((v_shokry->'summary'->>'quick_review_items')::int,0)
          + coalesce((v_shamy->'summary'->>'quick_review_items')::int,0)
      )
    )
  );
end
$function$
;
