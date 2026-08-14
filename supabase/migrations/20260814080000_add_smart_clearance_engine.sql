create or replace function public.smart_purchase_clearance_engine_v1(
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
  v_plan jsonb := '[]'::jsonb;
  v_summary jsonb := '{}'::jsonb;
begin
  perform set_config('statement_timeout','25000',true);

  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing','accountant') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  with latest as (
    select distinct on (
      pai.branch,
      coalesce(nullif(trim(pai.product_code),''),lower(regexp_replace(trim(pai.product_name),'[\s_\-]+',' ','g')))
    )
      pai.branch,
      pai.product_code,
      pai.product_name,
      greatest(0,coalesce(pai.current_stock,0))::numeric current_stock,
      greatest(0,coalesce(pai.pending_incoming,0))::numeric pending_incoming,
      greatest(0,coalesce(pai.safety_stock,0))::numeric safety_stock,
      greatest(0,coalesce(pai.avg_daily_usage,0),coalesce(pai.sales_30,0)/30.0,coalesce(pai.sales_60,0)/60.0,coalesce(pai.sales_90,0)/90.0)::numeric usage_per_day,
      greatest(0,coalesce(pai.sales_30,0))::numeric sales_30,
      coalesce(nullif(trim(pai.product_code),''),lower(regexp_replace(trim(pai.product_name),'[\s_\-]+',' ','g'))) product_key
    from public.purchase_analysis_items pai
    where coalesce(trim(pai.product_name),'')<>''
    order by pai.branch,
      coalesce(nullif(trim(pai.product_code),''),lower(regexp_replace(trim(pai.product_name),'[\s_\-]+',' ','g'))),
      pai.created_at desc
  ), raw as (
    select
      b.id batch_id,b.branch,b.product_key,b.product_code,b.product_name,b.batch_number,b.expiry_date,
      greatest(0,b.quantity)::numeric batch_quantity,
      greatest(0,b.unit_cost)::numeric unit_cost,
      greatest(0,b.selling_price)::numeric selling_price,
      (b.expiry_date-current_date)::int days_to_expiry,
      coalesce(src.usage_per_day,0)::numeric usage_per_day,
      coalesce(src.sales_30,0)::numeric sales_30,
      coalesce(src.current_stock,0)::numeric current_stock,
      coalesce(src.safety_stock,0)::numeric safety_stock,
      greatest((b.expiry_date-current_date)-30,0)::int safe_sell_days,
      other.branch transfer_branch,
      coalesce(other.transfer_need,0)::numeric transfer_need,
      coalesce(other.coverage_days,999)::numeric transfer_branch_coverage
    from public.purchase_inventory_batches b
    left join latest src on src.branch=b.branch and src.product_key=b.product_key
    left join lateral (
      select l.branch,
        greatest(0,ceil(l.usage_per_day*21 + l.safety_stock - l.current_stock - l.pending_incoming))::numeric transfer_need,
        case when l.usage_per_day>0 then round((l.current_stock/l.usage_per_day)::numeric,1) else 999 end coverage_days
      from latest l
      where l.product_key=b.product_key and l.branch<>b.branch and l.usage_per_day>0
        and greatest(0,ceil(l.usage_per_day*21 + l.safety_stock - l.current_stock - l.pending_incoming))>0
      order by coverage_days asc,transfer_need desc
      limit 1
    ) other on true
    where b.quantity>0
      and b.expiry_date<=current_date+180
      and (coalesce(p_branch,'all')='all' or b.branch=p_branch)
      and (
        a.role<>'branch_manager'
        or coalesce(a.branch_ids,'[]'::jsonb) ? b.branch
        or coalesce(a.branch_ids,'[]'::jsonb) ? replace(b.branch,'دواء ','')
        or coalesce(a.branch_ids,'[]'::jsonb) ? replace(b.branch,'فرع ','')
      )
  ), calc as (
    select r.*,
      least(batch_quantity,greatest(0,ceil(usage_per_day*safe_sell_days)))::numeric natural_sell_before_danger,
      greatest(0,batch_quantity-least(batch_quantity,greatest(0,ceil(usage_per_day*safe_sell_days))))::numeric action_units,
      round((batch_quantity*unit_cost)::numeric,2) batch_cost_value,
      round((greatest(0,batch_quantity-least(batch_quantity,greatest(0,ceil(usage_per_day*safe_sell_days))))*unit_cost)::numeric,2) capital_at_risk,
      case when selling_price>0 and selling_price>unit_cost then round(((selling_price-unit_cost)/selling_price*100)::numeric,1) else 0 end margin_percent
    from raw r
  ), actions as (
    select c.*,
      case
        when days_to_expiry<0 then batch_quantity
        when days_to_expiry<=30 then batch_quantity
        else action_units
      end::numeric units_to_act,
      case
        when days_to_expiry>30 and action_units>0 and transfer_need>0 then least(action_units,transfer_need)
        else 0
      end::numeric suggested_transfer_units,
      case
        when days_to_expiry<0 then greatest(1,batch_quantity)
        when days_to_expiry<=30 then greatest(1,ceil(batch_quantity/greatest(days_to_expiry,1)::numeric))
        when action_units>0 then greatest(1,ceil(action_units/greatest(safe_sell_days,1)::numeric))
        else 0
      end::numeric daily_clearance_target,
      case
        when days_to_expiry<0 then 'expired_quarantine'
        when days_to_expiry<=30 then 'urgent_clearance'
        when action_units>0 and transfer_need>0 then 'transfer_first'
        when days_to_expiry<=60 and action_units>0 then 'doctor_push_offer'
        when days_to_expiry<=90 and action_units>0 then 'controlled_push'
        when action_units>0 then 'watch_push'
        else 'natural_sell_ok'
      end action_code,
      case
        when days_to_expiry<0 then 'عزل الصنف فورًا ومراجعة المرتجع/المورد — لا يدخل في البيع'
        when days_to_expiry<=30 then 'تصريف عاجل يومي مع مراجعة سياسة الصلاحية وعدم النزول تحت تكلفة الشراء بدون اعتماد'
        when action_units>0 and transfer_need>0 then 'تحويل للفرع المحتاج أولًا ثم دفع المتبقي محليًا'
        when days_to_expiry<=60 and action_units>0 then 'إضافة لقائمة الدكاترة + دفع بيعي/عرض محسوب'
        when days_to_expiry<=90 and action_units>0 then 'دفع بيعي منظم قبل دخول منطقة الخطر'
        when action_units>0 then 'مراقبة أسبوعية ودفع تدريجي'
        else 'الحركة الطبيعية متوقعة تكفي قبل منطقة الخطر'
      end action_label,
      case
        when selling_price<=0 or margin_percent<=0 then 0
        when days_to_expiry<=30 then round((margin_percent*0.70)::numeric,1)
        when days_to_expiry<=60 then round((margin_percent*0.45)::numeric,1)
        when days_to_expiry<=90 then round((margin_percent*0.25)::numeric,1)
        else round((margin_percent*0.10)::numeric,1)
      end suggested_discount_ceiling_percent
    from calc c
  ), ranked as (
    select a.*,
      greatest(0,units_to_act-suggested_transfer_units)::numeric local_push_units,
      round((suggested_transfer_units*unit_cost)::numeric,2) transferable_capital,
      round((greatest(0,units_to_act-suggested_transfer_units)*unit_cost)::numeric,2) local_capital_to_recover,
      case action_code
        when 'expired_quarantine' then 100
        when 'urgent_clearance' then 95
        when 'transfer_first' then 85
        when 'doctor_push_offer' then 75
        when 'controlled_push' then 60
        when 'watch_push' then 45
        else 10
      end + least(25,round(capital_at_risk/500)::int) priority_score
    from actions a
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'batch_id',batch_id,'branch',branch,'product_code',product_code,'product_name',product_name,
      'batch_number',batch_number,'expiry_date',expiry_date,'days_to_expiry',days_to_expiry,
      'batch_quantity',batch_quantity,'unit_cost',unit_cost,'selling_price',selling_price,
      'margin_percent',margin_percent,'batch_cost_value',batch_cost_value,
      'usage_per_day',round(usage_per_day,3),'sales_30',sales_30,'safe_sell_days',safe_sell_days,
      'natural_sell_before_danger',natural_sell_before_danger,'units_to_act',units_to_act,
      'daily_clearance_target',daily_clearance_target,'capital_at_risk',capital_at_risk,
      'transfer_branch',transfer_branch,'transfer_branch_coverage',transfer_branch_coverage,
      'suggested_transfer_units',suggested_transfer_units,'transferable_capital',transferable_capital,
      'local_push_units',local_push_units,'local_capital_to_recover',local_capital_to_recover,
      'suggested_discount_ceiling_percent',suggested_discount_ceiling_percent,
      'action_code',action_code,'action_label',action_label,'priority_score',priority_score
    ) order by priority_score desc,days_to_expiry asc,capital_at_risk desc),'[]'::jsonb),
    jsonb_build_object(
      'batches_reviewed',count(*),
      'batches_needing_action',count(*) filter(where units_to_act>0 or days_to_expiry<0),
      'units_needing_action',coalesce(sum(units_to_act),0),
      'capital_at_risk',round(coalesce(sum(capital_at_risk),0)::numeric,2),
      'expired_capital',round(coalesce(sum(batch_cost_value) filter(where days_to_expiry<0),0)::numeric,2),
      'transferable_capital',round(coalesce(sum(transferable_capital),0)::numeric,2),
      'local_capital_to_recover',round(coalesce(sum(local_capital_to_recover),0)::numeric,2),
      'daily_units_target',coalesce(sum(daily_clearance_target) filter(where units_to_act>0 and days_to_expiry>=0),0)
    )
  into v_plan,v_summary
  from ranked;

  return jsonb_build_object(
    'ok',true,
    'generated_at',now(),
    'branch',coalesce(p_branch,'all'),
    'summary',v_summary,
    'plan',v_plan,
    'method',jsonb_build_object(
      'danger_window_days',30,
      'transfer_target_days',21,
      'natural_sell','الاستهلاك اليومي × الأيام المتبقية حتى الوصول إلى 30 يوم قبل الصلاحية',
      'units_to_act','الكمية المتبقية التي لا يُتوقع أن تتحرك طبيعيًا قبل منطقة الخطر',
      'discount_ceiling','نسبة استرشادية من هامش الربح فقط ولا تسمح تلقائيًا بالبيع تحت التكلفة'
    )
  );
end;
$$;

grant execute on function public.smart_purchase_clearance_engine_v1(text,text) to anon,authenticated;
