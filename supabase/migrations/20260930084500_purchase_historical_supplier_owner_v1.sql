-- One canonical owner for historical supplier selection.
-- Both analysis and draft persistence must read the exact same selected supplier/cost/confidence.
create or replace view public.purchase_historical_supplier_choice_v1
with (security_invoker = true)
as
with ranked as (
  select
    s.branch,
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
    coalesce(nullif(s.avg_effective_unit_cost,0),nullif(s.last_unit_cost,0),0) as selected_unit_cost,
    case
      when coalesce(s.purchase_events,0)>=2
        and s.last_purchase_date >= (current_date - interval '90 days')::date then 'high'
      when (
        coalesce(s.purchase_events,0)=1
        and s.last_purchase_date >= (current_date - interval '90 days')::date
      ) or coalesce(s.purchase_events,0)>=2 then 'medium'
      when coalesce(s.purchase_events,0)=1 then 'low'
      else 'missing'
    end as historical_confidence,
    row_number() over (
      partition by s.branch,s.product_key
      order by
        case
          when coalesce(s.purchase_events,0)>=2
            and s.last_purchase_date >= (current_date - interval '90 days')::date then 0
          when coalesce(s.purchase_events,0)=1
            and s.last_purchase_date >= (current_date - interval '90 days')::date then 1
          when coalesce(s.purchase_events,0)>=2 then 2
          else 3
        end,
        s.avg_effective_unit_cost asc nulls last,
        s.purchase_events desc,
        s.last_purchase_date desc nulls last,
        lower(trim(s.supplier_name)) asc
    ) as rn
  from public.purchase_supplier_history_profiles s
  where nullif(trim(s.supplier_name),'') is not null
    and lower(trim(s.supplier_name)) not like 'دواء %'
    and lower(trim(s.supplier_name)) not like '%جرد%'
    and lower(trim(s.supplier_name)) <> 'شحن خارجي'
    and lower(trim(s.supplier_name)) <> 'صيدليات'
    and lower(trim(s.supplier_name)) <> 'مورد متنوع'
    and coalesce(nullif(s.avg_effective_unit_cost,0),nullif(s.last_unit_cost,0),0) > 0
)
select
  branch,product_key,product_code,product_name,supplier_name,purchase_events,
  purchased_qty,bonus_qty,net_cost_total,avg_effective_unit_cost,min_effective_unit_cost,
  last_purchase_date,last_unit_cost,source_file,updated_at,selected_unit_cost,historical_confidence
from ranked
where rn=1;

revoke all on public.purchase_historical_supplier_choice_v1 from anon,authenticated;

CREATE OR REPLACE FUNCTION public.smart_purchase_history_enrich_rows_v1(p_session_token text, p_branch text, p_rows jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp', 'extensions'
AS $function$
declare
  a record;
  v_rows jsonb;
begin
  select sa.* into a
  from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,p_branch) then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;

  with latest as (
    select distinct on (
      coalesce(nullif(trim(i.product_code),''),public.purchase_normalize_product_name(i.product_name))
    )
      jsonb_build_object(
        'product_code',i.product_code,'product_name',i.product_name,'current_stock',i.current_stock,
        'pending_incoming',i.pending_incoming,'safety_stock',i.safety_stock,
        'sales_30',i.sales_30,'sales_60',i.sales_60,'sales_90',i.sales_90,
        'avg_daily_usage',i.avg_daily_usage,'last_sale_date',i.last_sale_date,
        'last_purchase_price',i.last_purchase_price,'expected_unit_cost',i.expected_unit_cost,
        'customer_requests_count',i.customer_requests_count,'priority_score',i.priority_score
      ) row_json
    from public.purchase_analysis_items i
    where i.branch=p_branch and coalesce(trim(i.product_name),'')<>''
    order by coalesce(nullif(trim(i.product_code),''),public.purchase_normalize_product_name(i.product_name)),i.created_at desc
  ),
  input_rows as (
    select value row_json from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb))
  ),
  src as (
    select row_json from input_rows
    union all
    select row_json from latest where not exists(select 1 from input_rows)
  ),
  normalized as (
    select
      s.row_json,
      coalesce(nullif(trim(s.row_json->>'product_code'),''),
               public.purchase_normalize_product_name(s.row_json->>'product_name')) product_key,
      greatest(0,coalesce(nullif(s.row_json->>'avg_daily_usage','')::numeric,0)) explicit_daily,
      greatest(0,coalesce(nullif(s.row_json->>'sales_30','')::numeric,0)) sales30,
      greatest(0,coalesce(nullif(s.row_json->>'sales_60','')::numeric,0)) sales60,
      greatest(0,coalesce(nullif(s.row_json->>'sales_90','')::numeric,0)) sales90
    from src s
    where nullif(trim(s.row_json->>'product_name'),'') is not null
  ),
  calc as (
    select n.*,
      case
        when explicit_daily>0 then explicit_daily
        when sales30>0 and sales60>0 and sales90>0 then (sales30/30.0)*0.50+(sales60/60.0)*0.30+(sales90/90.0)*0.20
        when sales30>0 and sales90>0 then (sales30/30.0)*0.60+(sales90/90.0)*0.40
        when sales30>0 and sales60>0 then (sales30/30.0)*0.65+(sales60/60.0)*0.35
        else greatest(sales30/30.0,sales60/60.0,sales90/90.0,0)
      end recent_daily
    from normalized n
  ),
  enriched as (
    select c.*,
      h.avg_monthly_6m,
      h.sales_6m,
      h.distinct_customers,
      sh.supplier_name hist_supplier,
      sh.selected_unit_cost hist_cost,
      sh.last_unit_cost hist_last_cost,
      sh.last_purchase_date hist_last_date,
      sh.purchase_events hist_purchase_events,
      sh.historical_confidence hist_confidence,
      case
        when coalesce(h.distinct_customers,0)>=20 then 20
        when coalesce(h.distinct_customers,0)>=10 then 15
        when coalesce(h.distinct_customers,0)>=5 then 10
        when coalesce(h.distinct_customers,0)>=2 then 5
        else 0
      end customer_priority_boost
    from calc c
    left join public.purchase_product_history_profiles h
      on h.branch=p_branch and h.product_key=c.product_key
    left join public.purchase_historical_supplier_choice_v1 sh
      on sh.branch=p_branch and sh.product_key=c.product_key
  )
  select coalesce(jsonb_agg(
    row_json || jsonb_build_object(
      'avg_daily_usage',
        case
          when recent_daily>0 and coalesce(avg_monthly_6m,0)>0 then round((recent_daily*0.70+(avg_monthly_6m/30.0)*0.30)::numeric,6)
          when recent_daily>0 then round(recent_daily::numeric,6)
          when coalesce(avg_monthly_6m,0)>0 then round((avg_monthly_6m/30.0)::numeric,6)
          else 0
        end,
      'priority_score',greatest(0,coalesce(nullif(row_json->>'priority_score','')::numeric,0))+customer_priority_boost,
      'last_purchase_price',
        case when coalesce(nullif(row_json->>'last_purchase_price','')::numeric,0)>0
             then (row_json->>'last_purchase_price')::numeric
             else coalesce(nullif(hist_last_cost,0),nullif(hist_cost,0),0) end,
      'preferred_supplier',coalesce(nullif(row_json->>'preferred_supplier',''),hist_supplier,''),
      'historical_sales_6m',coalesce(sales_6m,0),
      'historical_avg_monthly_6m',coalesce(avg_monthly_6m,0),
      'historical_distinct_customers',coalesce(distinct_customers,0),
      'historical_supplier',coalesce(hist_supplier,''),
      'historical_effective_unit_cost',coalesce(hist_cost,0),
      'historical_last_purchase_date',hist_last_date,
      'historical_purchase_events',coalesce(hist_purchase_events,0),
      'historical_confidence',coalesce(hist_confidence,'missing'),
      'history_priority_boost',customer_priority_boost
    )
  ),'[]'::jsonb) into v_rows
  from enriched;

  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'branch',p_branch,'rows',v_rows,
    'method',jsonb_build_object(
      'usage_blend','70% recent + 30% six-month monthly average when both exist',
      'customer_history','historical distinct customers increase priority only; they do not become open customer requests',
      'supplier_history','historical supplier selection prioritizes confidence (repeat purchases + recency within 90 days), then effective cost'
    )
  ));
end $function$



create or replace function public.smart_purchase_apply_historical_allocation_v1(
  p_session_token text,
  p_order_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  a record;
  v_order_id uuid;
  v_order public.smart_purchase_orders%rowtype;
  v_item_count int;
  v_mappable_count int;
  v_total numeric;
  v_results jsonb := '[]'::jsonb;
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

  if a.role not in ('general_manager','branch_manager','purchasing') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  if coalesce(cardinality(p_order_ids),0) < 1 then
    return jsonb_build_object('ok',false,'error','order_not_found');
  end if;

  foreach v_order_id in array p_order_ids loop
    select * into v_order
    from public.smart_purchase_orders
    where id=v_order_id
    for update;

    if not found then
      raise exception 'order_not_found:%', v_order_id;
    end if;

    if not public.smart_purchase_branch_allowed_v2(a.id,v_order.branch) then
      raise exception 'forbidden_branch:%', v_order.branch;
    end if;

    if coalesce(v_order.status,'مسودة') not in ('draft','مسودة') then
      raise exception 'historical_allocation_requires_draft:%', v_order.order_number;
    end if;

    if v_order.sent_at is not null
       or exists (
         select 1 from public.purchase_order_supplier_dispatches d
         where d.order_id=v_order.id and d.sent_at is not null
       )
       or exists (
         select 1 from public.purchase_order_receipts r
         where r.order_id=v_order.id
       )
    then
      raise exception 'order_execution_started:%', v_order.order_number;
    end if;

    select count(*) into v_item_count
    from public.smart_purchase_order_items i
    where i.order_id=v_order.id
      and coalesce(i.approved_quantity,0)>0;

    with picked as (
      select i.id as item_id,
             h.supplier_name,
             h.selected_unit_cost as hist_cost,
             h.purchase_events,
             h.last_purchase_date
      from public.smart_purchase_order_items i
      left join public.purchase_historical_supplier_choice_v1 h
        on h.branch=v_order.branch
       and h.product_key=coalesce(
         nullif(trim(i.product_code),''),
         public.purchase_normalize_product_name(i.product_name)
       )
      where i.order_id=v_order.id
        and coalesce(i.approved_quantity,0)>0
    )
    select count(*) into v_mappable_count
    from picked
    where nullif(trim(supplier_name),'') is not null
      and hist_cost>0;

    if v_item_count=0 or v_mappable_count<>v_item_count then
      raise exception 'historical_allocation_incomplete:%/%:%',
        v_mappable_count,v_item_count,v_order.order_number;
    end if;

    with picked as (
      select i.id as item_id,
             h.supplier_name,
             h.selected_unit_cost as hist_cost,
             h.purchase_events,
             h.last_purchase_date,
             h.historical_confidence as confidence
      from public.smart_purchase_order_items i
      join public.purchase_historical_supplier_choice_v1 h
        on h.branch=v_order.branch
       and h.product_key=coalesce(
         nullif(trim(i.product_code),''),
         public.purchase_normalize_product_name(i.product_name)
       )
      where i.order_id=v_order.id
        and coalesce(i.approved_quantity,0)>0
    )
    update public.smart_purchase_order_items i
    set supplier_name=p.supplier_name,
        expected_unit_cost=round(p.hist_cost::numeric,4),
        expected_total=round((coalesce(i.approved_quantity,0)*p.hist_cost)::numeric,2),
        supplier_offer_id=null,
        supplier_reason='historical_purchase_v1:'||p.confidence,
        cost_source='reference',
        cost_verified_at=null,
        cost_verified_by_account_id=null,
        cost_verified_by_name=null,
        updated_at=now()
    from picked p
    where i.id=p.item_id;

    select round(coalesce(sum(expected_total),0)::numeric,2)
    into v_total
    from public.smart_purchase_order_items
    where order_id=v_order.id
      and coalesce(approved_quantity,0)>0;

    update public.smart_purchase_orders
    set expected_total=v_total,
        approved_total=v_total,
        updated_at=now()
    where id=v_order.id;

    insert into public.purchase_status_history(
      source_type,record_id,old_status,new_status,reason,
      changed_by_account_id,changed_by_name,changed_at
    )
    values(
      'smart_purchase_order',
      v_order.id::text,
      v_order.status,
      v_order.status,
      'Applied reviewed historical supplier/cost allocation without approval or dispatch',
      a.id,
      a.display_name,
      now()
    );

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'order_id',v_order.id,
        'order_number',v_order.order_number,
        'branch',v_order.branch,
        'items',v_item_count,
        'total',v_total
      )
    );
  end loop;

  return jsonb_build_object(
    'ok',true,
    'data',jsonb_build_object(
      'orders',v_results,
      'orders_count',jsonb_array_length(v_results),
      'items_count',(
        select count(*)
        from public.smart_purchase_order_items
        where order_id=any(p_order_ids)
          and coalesce(approved_quantity,0)>0
      ),
      'grand_total',(
        select round(coalesce(sum(approved_total),0)::numeric,2)
        from public.smart_purchase_orders
        where id=any(p_order_ids)
      )
    )
  );
end
$function$;

revoke all on function public.smart_purchase_apply_historical_allocation_v1(text,uuid[]) from public;
grant execute on function public.smart_purchase_apply_historical_allocation_v1(text,uuid[]) to anon,authenticated;
