-- Historical supplier/cost fallback across branches.
-- Product economics are shared across branches; stock/movement/policy remain branch-scoped.
-- No inventory/order data is mutated by this migration.

create or replace view public.purchase_historical_supplier_choice_v1 as
with ranked as (
  select
    s.branch as history_branch,
    s.product_key,
    s.product_code,
    s.product_name,
    s.supplier_name,
    s.purchase_events,
    s.purchased_qty,
    s.bonus_qty,
    s.net_cost_total,
    s.avg_effective_unit_cost,
    s.min_effective_unit_cost,
    s.last_purchase_date,
    s.last_unit_cost,
    s.source_file,
    s.updated_at,
    coalesce(nullif(s.avg_effective_unit_cost,0),nullif(s.last_unit_cost,0),0) selected_unit_cost,
    case when nullif(s.avg_effective_unit_cost,0) is not null then 'historical_average'
         when nullif(s.last_unit_cost,0) is not null then 'historical_last' else 'missing' end historical_cost_source,
    case when coalesce(s.purchase_events,0)>=2 and s.last_purchase_date>=current_date-90 then 'high'
         when (coalesce(s.purchase_events,0)=1 and s.last_purchase_date>=current_date-90) or coalesce(s.purchase_events,0)>=2 then 'medium'
         when coalesce(s.purchase_events,0)=1 then 'low' else 'missing' end historical_confidence,
    row_number() over(partition by s.product_key order by
      case when coalesce(s.purchase_events,0)>=2 and s.last_purchase_date>=current_date-90 then 0
           when coalesce(s.purchase_events,0)=1 and s.last_purchase_date>=current_date-90 then 1
           when coalesce(s.purchase_events,0)>=2 then 2 else 3 end,
      s.avg_effective_unit_cost,
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
  history_branch as branch,
  product_key,product_code,product_name,supplier_name,purchase_events,purchased_qty,bonus_qty,
  net_cost_total,avg_effective_unit_cost,min_effective_unit_cost,last_purchase_date,last_unit_cost,
  source_file,updated_at,selected_unit_cost,historical_cost_source,historical_confidence
from ranked where rn=1;


-- Consumers must join by product_key only: the selected history row may come from either branch.
-- Keep branch authorization, inventory, movement and policy branch-scoped.

do $migration$
declare
  r record;
  v_def text;
begin
  for r in
    select p.oid,p.proname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'smart_purchase_apply_historical_allocation_v1',
        'smart_purchase_historical_allocation_preview_v1',
        'smart_purchase_history_enrich_rows_v1'
      )
      and pg_get_functiondef(p.oid) ilike '%purchase_historical_supplier_choice_v1%'
  loop
    v_def := pg_get_functiondef(r.oid);
    v_def := replace(v_def,'h.branch=v_order.branch' || chr(10) || '       and h.product_key=', 'h.product_key=');
    v_def := replace(v_def,'h.branch=o.branch' || chr(10) || '     and h.product_key=', 'h.product_key=');
    v_def := replace(v_def,'sh.branch=p_branch and sh.product_key=', 'sh.product_key=');
    execute v_def;
  end loop;
end
$migration$;


-- NOTE: planner integrity handling for missing costs is intentionally NOT changed here.
-- Missing-cost adaptive items must remain visible and must not receive invented prices.
-- A separate reviewed planner change will resolve effective cost from trusted history
-- and quarantine only unresolved-cost items from auto-buy, without hiding demand.
