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
