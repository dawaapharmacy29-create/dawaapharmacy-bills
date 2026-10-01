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
