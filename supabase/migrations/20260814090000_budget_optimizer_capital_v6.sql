create or replace function public.smart_purchase_optimize_budget_v2(
  p_session_token text,
  p_order_id uuid,
  p_target_budget numeric,
  p_apply boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp','extensions'
as $function$
declare
  v_account record; v_order public.smart_purchase_orders%rowtype;
  v_target numeric:=greatest(coalesce(p_target_budget,0),0); v_before numeric:=0; v_after numeric:=0; v_gap numeric:=0;
  v_id uuid; v_qty numeric; v_floor numeric; v_cost numeric; v_units numeric; v_plan jsonb:='[]'::jsonb;
  v_reduced int:=0; v_removed int:=0; v_protected int:=0; v_feasible boolean:=true;
begin
  perform set_config('statement_timeout','25000',true);
  select sa.* into v_account from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex') and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_account.role not in ('general_manager','branch_manager','purchasing') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
  select * into v_order from public.smart_purchase_orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if v_target<=0 then return jsonb_build_object('ok',false,'error','invalid_budget'); end if;

  create temp table if not exists _smart_budget_plan(
    id uuid primary key, product_code text, product_name text, original_qty numeric, proposed_qty numeric, unit_cost numeric,
    priority_score numeric, customer_requests_count int, shortage_count int, sales_30 numeric, avg_daily_usage numeric,
    current_stock numeric, safety_stock numeric, coverage_days numeric, pending_incoming numeric, demand_score numeric,
    learned_multiplier numeric, learning_confidence numeric, learning_observations int,
    stock_value numeric, proposed_value numeric, excess_stock_value numeric, capital_pressure_score numeric,
    phase1_floor numeric, hard_floor numeric, original_total numeric, proposed_total numeric, action_reason text
  ) on commit drop;
  truncate _smart_budget_plan;

  insert into _smart_budget_plan
  select i.id,i.product_code,i.product_name,q.qty,q.qty,greatest(0,coalesce(i.expected_unit_cost,0)),
    coalesce(i.priority_score,0)+(live.open_count*40)+(live.shortage_count*30)+sig.demand_score
      + case when learn.learning_confidence>=0.4 then round((learn.learned_multiplier-1)*80,2) else 0 end
      + cap.capital_pressure_score,
    greatest(coalesce(i.customer_requests_count,0),live.open_count),live.shortage_count,
    sig.sales_30,sig.avg_daily_usage,sig.current_stock,sig.safety_stock,sig.coverage_days,sig.pending_incoming,sig.demand_score,
    learn.learned_multiplier,learn.learning_confidence,learn.learning_observations,
    cap.stock_value,cap.proposed_value,cap.excess_stock_value,cap.capital_pressure_score,
    least(q.qty,case
      when live.open_count>0 or coalesce(i.customer_requests_count,0)>0 then greatest(greatest(coalesce(i.customer_requests_count,0),live.open_count),ceil(q.qty*.65))
      when learn.learning_confidence>=0.4 and learn.learned_multiplier>=1.15 then ceil(q.qty*least(.85,.58*learn.learned_multiplier))
      when sig.demand_score>=55 then ceil(q.qty*.70)
      when sig.demand_score>=35 then ceil(q.qty*.55)
      when cap.capital_pressure_score<=-18 then greatest(1,ceil(q.qty*.20))
      when sig.demand_score>=20 or coalesce(i.priority_score,0)>=80 then ceil(q.qty*.45)
      when learn.learning_confidence>=0.4 and learn.learned_multiplier<=0.85 then greatest(1,ceil(q.qty*.15))
      when coalesce(i.priority_score,0)>=60 then ceil(q.qty*.35)
      when coalesce(i.priority_score,0)>=40 then ceil(q.qty*.20)
      when q.qty>0 then 1 else 0 end),
    least(q.qty,case
      when live.open_count>0 or coalesce(i.customer_requests_count,0)>0 then greatest(1,greatest(coalesce(i.customer_requests_count,0),live.open_count))
      when learn.learning_confidence>=0.55 and learn.learned_multiplier>=1.20 and q.qty>0 then least(q.qty,greatest(1,ceil(q.qty*.30)))
      when sig.demand_score>=45 and q.qty>0 then least(q.qty,greatest(1,ceil(q.qty*.25)))
      when q.qty>0 then 1 else 0 end),
    q.qty*greatest(0,coalesce(i.expected_unit_cost,0)),q.qty*greatest(0,coalesce(i.expected_unit_cost,0)),'بدون تغيير'
  from public.smart_purchase_order_items i
  cross join lateral (select greatest(0,floor(coalesce(i.approved_quantity,i.requested_quantity,0))) qty) q
  cross join lateral (
    select count(*)::int open_count,count(*) filter(where co.status='النواقص')::int shortage_count
    from public.customer_orders co
    where coalesce(co.status,'طلب جديد') not in ('تم التوصيل','تم الإلغاء','cancelled','تم توفير الصنف')
      and public.purchase_normalize_product_name(co.product_name)=public.purchase_normalize_product_name(i.product_name)
      and (v_order.branch is null or co.branch is null or co.branch=v_order.branch or replace(co.branch,'فرع ','')=replace(v_order.branch,'دواء ',''))
  ) live
  cross join lateral (
    select coalesce(a.sales_30,0) sales_30,coalesce(a.avg_daily_usage,0) avg_daily_usage,coalesce(a.current_stock,0) current_stock,
      coalesce(a.safety_stock,0) safety_stock,coalesce(a.coverage_days,0) coverage_days,coalesce(a.pending_incoming,0) pending_incoming,
      greatest(-25,least(90,
        case when coalesce(a.sales_30,0)>0 and coalesce(a.current_stock,0)<=0 then 30 when coalesce(a.current_stock,0)<=coalesce(a.safety_stock,0) and coalesce(a.sales_30,0)>0 then 22 else 0 end
        + case when coalesce(a.coverage_days,0)>0 and a.coverage_days<=7 then 30 when coalesce(a.coverage_days,0)>0 and a.coverage_days<=14 then 22 when coalesce(a.coverage_days,0)>0 and a.coverage_days<=30 then 12 when coalesce(a.coverage_days,0)>60 then -18 else 0 end
        + least(15,greatest(0,coalesce(a.avg_daily_usage,0)*3)) - case when coalesce(a.pending_incoming,0)>=greatest(1,q.qty) then 12 else 0 end
      ))::numeric demand_score,
      coalesce(a.last_purchase_price,0) last_purchase_price
    from lateral (
      select pai.* from public.purchase_analysis_items pai
      where pai.id=i.analysis_item_id or (((i.product_code is not null and pai.product_code=i.product_code) or lower(pai.product_name)=lower(i.product_name))
        and (v_order.branch is null or pai.branch=v_order.branch or replace(pai.branch,'فرع ','')=replace(v_order.branch,'دواء ','')))
      order by (pai.id=i.analysis_item_id) desc,pai.created_at desc limit 1
    ) a
  ) sig
  cross join lateral public.smart_purchase_learning_signal(v_order.branch,i.product_code,i.product_name) learn
  cross join lateral (
    select
      greatest(0,sig.current_stock*greatest(sig.last_purchase_price,coalesce(i.expected_unit_cost,0))) stock_value,
      greatest(0,q.qty*coalesce(i.expected_unit_cost,0)) proposed_value,
      greatest(0,greatest(0,sig.current_stock-greatest(sig.safety_stock,sig.avg_daily_usage*30))*greatest(sig.last_purchase_price,coalesce(i.expected_unit_cost,0))) excess_stock_value,
      greatest(-35,least(12,
        case when sig.coverage_days>75 then -22 when sig.coverage_days>60 then -16 when sig.coverage_days>45 then -10 else 0 end
        + case when greatest(0,sig.current_stock*greatest(sig.last_purchase_price,coalesce(i.expected_unit_cost,0)))>=5000 then -8
               when greatest(0,sig.current_stock*greatest(sig.last_purchase_price,coalesce(i.expected_unit_cost,0)))>=2500 then -5 else 0 end
        + case when q.qty*coalesce(i.expected_unit_cost,0)>=5000 and sig.demand_score<20 then -7
               when q.qty*coalesce(i.expected_unit_cost,0)>=2500 and sig.demand_score<20 then -4 else 0 end
        + case when sig.coverage_days<=14 and sig.sales_30>0 then 10 else 0 end
      ))::numeric capital_pressure_score
  ) cap
  where i.order_id=p_order_id;

  select coalesce(sum(proposed_total),0),count(*) filter(where customer_requests_count>0 or demand_score>=55 or (learning_confidence>=0.55 and learned_multiplier>=1.20))
  into v_before,v_protected from _smart_budget_plan; v_after:=v_before;

  while v_after>v_target+0.005 loop
    select id,proposed_qty,phase1_floor,unit_cost into v_id,v_qty,v_floor,v_cost from _smart_budget_plan
    where proposed_qty>phase1_floor and unit_cost>0
    order by (customer_requests_count>0) asc,(learning_confidence>=0.55 and learned_multiplier>=1.20) asc,
      capital_pressure_score asc,learned_multiplier asc,demand_score asc,excess_stock_value desc,proposed_value desc,coverage_days desc limit 1;
    exit when not found; v_gap:=v_after-v_target; v_units:=least(v_qty-v_floor,greatest(1,ceil(v_gap/v_cost)));
    update _smart_budget_plan set proposed_qty=proposed_qty-v_units,proposed_total=(proposed_qty-v_units)*unit_cost,
      action_reason=case when capital_pressure_score<=-18 then 'تقليل مبكر لأن الصنف يجمد سيولة مع تغطية/مخزون مرتفع مقارنة بحركته'
        when learning_confidence>=0.4 and learned_multiplier<=0.85 then 'تقليل مبكر لأن نتائج الاستلامات السابقة تشير لتغطية زائدة بعد الشراء'
        when demand_score<0 then 'تقليل لأن حركة الصنف أبطأ أو تغطية المخزون مرتفعة' else 'تقليل كمية تدريجي للحفاظ على تنوع الأصناف بدل الحذف المباشر' end where id=v_id;
    v_after:=v_after-(v_units*v_cost);
  end loop;

  while v_after>v_target+0.005 loop
    select id,proposed_qty,hard_floor,unit_cost into v_id,v_qty,v_floor,v_cost from _smart_budget_plan
    where proposed_qty>hard_floor and unit_cost>0
    order by (customer_requests_count>0) asc,(learning_confidence>=0.55 and learned_multiplier>=1.20) asc,capital_pressure_score asc,learned_multiplier asc,demand_score asc,excess_stock_value desc limit 1;
    exit when not found; v_gap:=v_after-v_target; v_units:=least(v_qty-v_floor,greatest(1,ceil(v_gap/v_cost)));
    update _smart_budget_plan set proposed_qty=proposed_qty-v_units,proposed_total=(proposed_qty-v_units)*unit_cost,
      action_reason=case when customer_requests_count>0 then 'تقليل محسوب مع إبقاء حد يغطي طلبات العملاء والنواقص'
        when learning_confidence>=0.55 and learned_multiplier>=1.20 then 'تقليل محسوب مع حماية إضافية بسبب خطر نقص متعلم'
        when demand_score>=45 then 'تقليل محسوب مع إبقاء مخزون أمان لصنف سريع الحركة' else 'تقليل إضافي للحد الأدنى قبل حذف الصنف' end where id=v_id;
    v_after:=v_after-(v_units*v_cost);
  end loop;

  while v_after>v_target+0.005 loop
    select id,proposed_qty,unit_cost into v_id,v_qty,v_cost from _smart_budget_plan
    where proposed_qty>0 and customer_requests_count=0 and demand_score<45 and unit_cost>0 and not (learning_confidence>=0.55 and learned_multiplier>=1.10)
    order by capital_pressure_score asc,excess_stock_value desc,learned_multiplier asc,demand_score asc,proposed_total desc limit 1;
    exit when not found;
    update _smart_budget_plan set proposed_qty=0,proposed_total=0,action_reason='حذف كحل أخير لصنف غير محمي مع ضغط سيولة/تغطية أعلى من أولويته' where id=v_id;
    v_after:=v_after-(v_qty*v_cost);
  end loop;

  select coalesce(sum(proposed_total),0) into v_after from _smart_budget_plan; v_feasible:=v_after<=v_target+0.01;
  select count(*) filter(where proposed_qty<original_qty and proposed_qty>0),count(*) filter(where original_qty>0 and proposed_qty=0) into v_reduced,v_removed from _smart_budget_plan;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'product_code',product_code,'product_name',product_name,'original_quantity',original_qty,'proposed_quantity',proposed_qty,'unit_cost',unit_cost,
    'priority_score',priority_score,'customer_requests_count',customer_requests_count,'shortage_count',shortage_count,'sales_30',sales_30,'avg_daily_usage',avg_daily_usage,
    'current_stock',current_stock,'safety_stock',safety_stock,'coverage_days',coverage_days,'pending_incoming',pending_incoming,'demand_score',demand_score,
    'learned_multiplier',learned_multiplier,'learning_confidence',learning_confidence,'learning_observations',learning_observations,
    'stock_value',stock_value,'proposed_value',proposed_value,'excess_stock_value',excess_stock_value,'capital_pressure_score',capital_pressure_score,
    'protected',(customer_requests_count>0 or demand_score>=45 or (learning_confidence>=0.55 and learned_multiplier>=1.10)),
    'original_total',original_total,'proposed_total',proposed_total,'saved_amount',original_total-proposed_total,'reason',action_reason
  ) order by (customer_requests_count>0) desc,(learning_confidence>=0.55 and learned_multiplier>=1.10) desc,demand_score desc,capital_pressure_score desc,product_name),'[]'::jsonb) into v_plan from _smart_budget_plan;

  if p_apply then
    if not v_feasible then return jsonb_build_object('ok',false,'error','budget_below_protected_minimum','data',jsonb_build_object('target_budget',v_target,'minimum_possible_total',v_after,'gap',v_after-v_target,'plan',v_plan)); end if;
    update public.smart_purchase_order_items i set approved_quantity=p.proposed_qty,expected_total=p.proposed_total,customer_requests_count=p.customer_requests_count,priority_score=p.priority_score,
      supplier_reason=case when p.proposed_qty<coalesce(i.approved_quantity,i.requested_quantity,0) then concat_ws(' • ',nullif(i.supplier_reason,''),p.action_reason) else i.supplier_reason end,updated_at=now()
    from _smart_budget_plan p where i.id=p.id and i.order_id=p_order_id;
    update public.smart_purchase_orders set budget=v_target,approved_total=v_after,expected_total=v_after,updated_at=now() where id=p_order_id;
  end if;
  insert into public.smart_purchase_budget_runs(order_id,target_budget,before_total,after_total,savings,reduced_items,removed_items,protected_items,feasible,applied,plan,created_by_account_id,created_by_name)
  values(p_order_id,v_target,v_before,v_after,greatest(0,v_before-v_after),v_reduced,v_removed,v_protected,v_feasible,p_apply,v_plan,v_account.id,v_account.display_name);
  return jsonb_build_object('ok',true,'data',jsonb_build_object('target_budget',v_target,'before_total',v_before,'after_total',v_after,'savings',greatest(0,v_before-v_after),'gap_to_target',greatest(0,v_after-v_target),
    'reduced_items',v_reduced,'removed_items',v_removed,'protected_items',v_protected,'feasible',v_feasible,'applied',p_apply,'intelligence_version','capital_learning_v6','plan',v_plan));
end;
$function$;
