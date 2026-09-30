-- Keep historical supplier references actionable:
-- exclude internal/placeholder labels, then fall through to the next valid supplier.
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
      sh.avg_effective_unit_cost hist_cost,
      sh.last_unit_cost hist_last_cost,
      sh.last_purchase_date hist_last_date,
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
    left join lateral (
      select s.*
      from public.purchase_supplier_history_profiles s
      where s.branch=p_branch and s.product_key=c.product_key
        and nullif(trim(s.supplier_name),'') is not null
        and lower(trim(s.supplier_name)) not like 'دواء %'
        and lower(trim(s.supplier_name)) not like '%جرد%'
        and lower(trim(s.supplier_name)) <> 'شحن خارجي'
        and lower(trim(s.supplier_name)) <> 'صيدليات'
        and lower(trim(s.supplier_name)) <> 'مورد متنوع'
      order by case when s.purchase_events>=2 then 0 else 1 end,
               s.avg_effective_unit_cost asc nulls last,
               s.purchase_events desc
      limit 1
    ) sh on true
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
      'history_priority_boost',customer_priority_boost
    )
  ),'[]'::jsonb) into v_rows
  from enriched;

  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'branch',p_branch,'rows',v_rows,
    'method',jsonb_build_object(
      'usage_blend','70% recent + 30% six-month monthly average when both exist',
      'customer_history','historical distinct customers increase priority only; they do not become open customer requests',
      'supplier_history','historical supplier/cost is reference only and does not verify current supplier cost'
    )
  ));
end $function$

