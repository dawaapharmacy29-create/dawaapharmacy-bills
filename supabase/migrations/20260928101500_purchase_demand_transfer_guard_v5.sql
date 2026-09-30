CREATE OR REPLACE FUNCTION public.smart_purchase_demand_transfer_preview_v5(
  p_session_token text,
  p_branch text,
  p_financial_mode text DEFAULT 'medium'::text,
  p_rows jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp','extensions'
AS $function$
declare
  v_base jsonb;
  v_days int;
  v_plan jsonb := '[]'::jsonb;
  v_summary jsonb := '{}'::jsonb;
begin
  v_base := public.smart_purchase_demand_transfer_preview_v4(
    p_session_token,
    p_branch,
    p_financial_mode,
    p_rows
  );

  if coalesce((v_base->>'ok')::boolean,false)=false then
    return v_base;
  end if;

  v_days := coalesce((v_base->'data'->>'target_coverage_days')::int,
    case lower(coalesce(p_financial_mode,'medium'))
      when 'essential' then 7
      when 'critical' then 7
      when 'comfortable' then 30
      else 14
    end
  );

  with base_rows as (
    select
      value item,
      nullif(trim(value->>'product_code'),'') product_code,
      public.purchase_normalize_product_name(value->>'product_name') product_name_key,
      regexp_replace(nullif(trim(value->>'product_code'),''),'\.0+$','','g') product_code_key,
      coalesce((value->>'sales_30')::numeric,0) sales_30,
      coalesce((value->>'sales_60')::numeric,0) sales_60,
      coalesce((value->>'sales_90')::numeric,0) sales_90,
      coalesce((value->>'customer_requests_count')::int,0) customer_requests_count,
      coalesce((value->>'priority_score')::numeric,0) priority_score,
      coalesce((value->>'gross_need')::numeric,0) gross_need,
      coalesce((value->>'unit_cost')::numeric,0) unit_cost,
      coalesce((value->>'usage_per_day')::numeric,0) usage_per_day,
      coalesce(value->>'decision','') base_decision
    from jsonb_array_elements(coalesce(v_base->'data'->'plan','[]'::jsonb))
  ),
  latest_other as (
    select distinct on (
      regexp_replace(lower(trim(pai.branch)),'^(دواء|فرع)[[:space:]]*','','g'),
      coalesce(
        regexp_replace(nullif(trim(pai.product_code),''),'\.0+$','','g'),
        public.purchase_normalize_product_name(pai.product_name)
      )
    )
      pai.*,
      regexp_replace(lower(trim(pai.branch)),'^(دواء|فرع)[[:space:]]*','','g') branch_key,
      regexp_replace(nullif(trim(pai.product_code),''),'\.0+$','','g') code_key,
      public.purchase_normalize_product_name(pai.product_name) name_key,
      case
        when coalesce(pai.avg_daily_usage,0)>0 then pai.avg_daily_usage
        when coalesce(pai.sales_30,0)>0 and coalesce(pai.sales_60,0)>0 and coalesce(pai.sales_90,0)>0
          then (pai.sales_30/30.0)*0.50+(pai.sales_60/60.0)*0.30+(pai.sales_90/90.0)*0.20
        when coalesce(pai.sales_30,0)>0 and coalesce(pai.sales_90,0)>0
          then (pai.sales_30/30.0)*0.60+(pai.sales_90/90.0)*0.40
        when coalesce(pai.sales_30,0)>0 and coalesce(pai.sales_60,0)>0
          then (pai.sales_30/30.0)*0.65+(pai.sales_60/60.0)*0.35
        else greatest(
          coalesce(pai.sales_30,0)/30.0,
          coalesce(pai.sales_60,0)/60.0,
          coalesce(pai.sales_90,0)/90.0,
          0
        )
      end::numeric usage_per_day
    from public.purchase_analysis_items pai
    where coalesce(trim(pai.product_name),'')<>''
    order by
      regexp_replace(lower(trim(pai.branch)),'^(دواء|فرع)[[:space:]]*','','g'),
      coalesce(
        regexp_replace(nullif(trim(pai.product_code),''),'\.0+$','','g'),
        public.purchase_normalize_product_name(pai.product_name)
      ),
      pai.created_at desc
  ),
  matched as (
    select
      b.*,
      o.branch transfer_from_branch,
      coalesce(o.current_stock,0)::numeric other_stock,
      coalesce(o.pending_incoming,0)::numeric other_pending,
      coalesce(o.safety_stock,0)::numeric other_safety_stock,
      coalesce(o.usage_per_day,0)::numeric other_usage_per_day,
      case when o.id is null then false else true end other_branch_matched
    from base_rows b
    left join lateral (
      select lo.*
      from latest_other lo
      where lo.branch_key <> regexp_replace(lower(trim(p_branch)),'^(دواء|فرع)[[:space:]]*','','g')
        and (
          (
            b.product_code_key is not null
            and lo.code_key is not null
            and b.product_code_key = lo.code_key
          )
          or (
            b.product_name_key <> ''
            and lo.name_key = b.product_name_key
          )
        )
      order by
        case
          when b.product_code_key is not null and lo.code_key=b.product_code_key then 0
          else 1
        end,
        lo.created_at desc
      limit 1
    ) o on true
  ),
  recalculated as (
    select
      m.*,
      (m.sales_30>0 or m.sales_60>0 or m.sales_90>0) recent_has_movement,
      greatest(
        0,
        floor(
          m.other_stock + m.other_pending
          - greatest(
              0,
              ceil(round((m.other_usage_per_day*v_days + m.other_safety_stock)::numeric,6))
            )
        )
      )::numeric other_safe_surplus
    from matched m
  ),
  decisions as (
    select
      r.*,
      case
        when not r.recent_has_movement
          and r.customer_requests_count=0
          and r.priority_score<50
          and r.usage_per_day>0
        then true else false
      end history_only_block,
      case
        when not r.recent_has_movement
          and r.customer_requests_count=0
          and r.priority_score<50
          and r.usage_per_day>0
        then 0
        when r.base_decision='do_not_buy' then 0
        else least(r.gross_need,r.other_safe_surplus)
      end::numeric suggested_transfer_qty
    from recalculated r
  ),
  final_rows as (
    select
      d.*,
      case
        when d.history_only_block then 'do_not_buy'
        when d.base_decision='do_not_buy' then 'do_not_buy'
        when d.gross_need<=0 then 'enough_stock'
        when d.suggested_transfer_qty>=d.gross_need and d.gross_need>0 then 'transfer_only'
        when d.suggested_transfer_qty>0 and d.gross_need>d.suggested_transfer_qty then 'transfer_then_buy'
        when d.gross_need>0 then 'buy'
        else d.base_decision
      end decision,
      case
        when d.history_only_block or d.base_decision='do_not_buy' then 0
        else greatest(0,d.gross_need-d.suggested_transfer_qty)
      end::numeric buy_quantity
    from decisions d
  ),
  rendered as (
    select
      (
        item
        || jsonb_build_object(
          'transfer_from_branch',case when suggested_transfer_qty>0 then transfer_from_branch else null end,
          'transfer_source_stock',other_stock,
          'transfer_source_safe_surplus',other_safe_surplus,
          'suggested_transfer_qty',suggested_transfer_qty,
          'buy_quantity',buy_quantity,
          'buy_estimated_cost',round((buy_quantity*unit_cost)::numeric,2),
          'decision',decision,
          'movement_class',case when history_only_block then 'history_only_no_recent' else item->>'movement_class' end,
          'history_only_blocked',history_only_block,
          'other_branch_matched',other_branch_matched
        )
      ) row_json,
      *
    from final_rows
  )
  select
    coalesce(jsonb_agg(row_json order by
      case decision
        when 'transfer_only' then 1
        when 'transfer_then_buy' then 2
        when 'buy' then 3
        when 'defer_low_priority' then 4
        when 'do_not_buy' then 5
        else 6
      end,
      priority_score desc,
      gross_need desc
    ),'[]'::jsonb),
    jsonb_build_object(
      'items',count(*),
      'need_items',count(*) filter(where gross_need>0),
      'transfer_only_items',count(*) filter(where decision='transfer_only'),
      'transfer_then_buy_items',count(*) filter(where decision='transfer_then_buy'),
      'buy_items',count(*) filter(where decision='buy'),
      'deferred_low_priority_items',count(*) filter(where decision='defer_low_priority'),
      'blocked_deadstock_items',count(*) filter(where decision='do_not_buy'),
      'history_only_blocked_items',count(*) filter(where history_only_block),
      'other_branch_matched_items',count(*) filter(where other_branch_matched),
      'suggested_transfer_units',coalesce(sum(suggested_transfer_qty),0),
      'suggested_buy_units',coalesce(sum(buy_quantity),0),
      'suggested_buy_value',round(coalesce(sum(buy_quantity*unit_cost),0)::numeric,2)
    )
  into v_plan,v_summary
  from rendered;

  return jsonb_build_object(
    'ok',true,
    'data',
      (v_base->'data')
      || jsonb_build_object(
        'plan',v_plan,
        'summary',v_summary,
        'method',
          coalesce(v_base->'data'->'method','{}'::jsonb)
          || jsonb_build_object(
            'engine','smart_purchase_demand_transfer_preview_v5',
            'history_only_rule','تاريخ 6 شهور يثبت الطلب الحالي ولا ينشئ شراء جديدًا إذا كانت مبيعات 30/60/90 كلها صفر بدون طلب عميل أو أولوية مرتفعة',
            'cross_branch_match','مطابقة بالكود بعد تنظيف .0 أو بالاسم المطبع كبديل، مع استبعاد نفس الفرع بعد توحيد بادئة دواء/فرع'
          )
      )
  );
end;
$function$;

revoke all on function public.smart_purchase_demand_transfer_preview_v5(text,text,text,jsonb) from public;
grant execute on function public.smart_purchase_demand_transfer_preview_v5(text,text,text,jsonb) to anon,authenticated;
