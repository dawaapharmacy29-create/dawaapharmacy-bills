create table if not exists public.smart_purchase_budget_runs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.smart_purchase_orders(id) on delete cascade,
  target_budget numeric not null,
  before_total numeric not null default 0,
  after_total numeric not null default 0,
  savings numeric not null default 0,
  reduced_items integer not null default 0,
  removed_items integer not null default 0,
  protected_items integer not null default 0,
  feasible boolean not null default true,
  applied boolean not null default false,
  plan jsonb not null default '[]'::jsonb,
  created_by_account_id uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists smart_purchase_budget_runs_order_idx on public.smart_purchase_budget_runs(order_id,created_at desc);

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
  v_account record;
  v_order public.smart_purchase_orders%rowtype;
  v_target numeric := greatest(coalesce(p_target_budget,0),0);
  v_before numeric := 0;
  v_after numeric := 0;
  v_gap numeric := 0;
  v_id uuid;
  v_qty numeric;
  v_floor numeric;
  v_cost numeric;
  v_units numeric;
  v_plan jsonb := '[]'::jsonb;
  v_reduced integer := 0;
  v_removed integer := 0;
  v_protected integer := 0;
  v_feasible boolean := true;
begin
  perform set_config('statement_timeout','20000',true);

  select sa.* into v_account
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_account.role not in ('general_manager','branch_manager','purchasing') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  select * into v_order from public.smart_purchase_orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if v_target<=0 then return jsonb_build_object('ok',false,'error','invalid_budget'); end if;

  create temp table if not exists _smart_budget_plan(
    id uuid primary key,
    product_code text,
    product_name text,
    original_qty numeric,
    proposed_qty numeric,
    unit_cost numeric,
    priority_score numeric,
    customer_requests_count integer,
    phase1_floor numeric,
    hard_floor numeric,
    original_total numeric,
    proposed_total numeric,
    action_reason text
  ) on commit drop;
  truncate _smart_budget_plan;

  insert into _smart_budget_plan(
    id,product_code,product_name,original_qty,proposed_qty,unit_cost,priority_score,customer_requests_count,
    phase1_floor,hard_floor,original_total,proposed_total,action_reason
  )
  select
    i.id,i.product_code,i.product_name,
    greatest(0,floor(coalesce(i.approved_quantity,i.requested_quantity,0))) as q,
    greatest(0,floor(coalesce(i.approved_quantity,i.requested_quantity,0))) as q,
    greatest(0,coalesce(i.expected_unit_cost,0)) as c,
    coalesce(i.priority_score,0),coalesce(i.customer_requests_count,0),
    least(greatest(0,floor(coalesce(i.approved_quantity,i.requested_quantity,0))),
      case
        when coalesce(i.customer_requests_count,0)>0 then greatest(coalesce(i.customer_requests_count,0),ceil(greatest(0,coalesce(i.approved_quantity,i.requested_quantity,0))*.60))
        when coalesce(i.priority_score,0)>=80 then ceil(greatest(0,coalesce(i.approved_quantity,i.requested_quantity,0))*.60)
        when coalesce(i.priority_score,0)>=60 then ceil(greatest(0,coalesce(i.approved_quantity,i.requested_quantity,0))*.40)
        when coalesce(i.priority_score,0)>=40 then ceil(greatest(0,coalesce(i.approved_quantity,i.requested_quantity,0))*.25)
        when greatest(0,coalesce(i.approved_quantity,i.requested_quantity,0))>0 then 1 else 0 end
    ) as phase1_floor,
    least(greatest(0,floor(coalesce(i.approved_quantity,i.requested_quantity,0))),
      case when coalesce(i.customer_requests_count,0)>0 then greatest(1,coalesce(i.customer_requests_count,0))
           when greatest(0,coalesce(i.approved_quantity,i.requested_quantity,0))>0 then 1 else 0 end
    ) as hard_floor,
    greatest(0,floor(coalesce(i.approved_quantity,i.requested_quantity,0)))*greatest(0,coalesce(i.expected_unit_cost,0)),
    greatest(0,floor(coalesce(i.approved_quantity,i.requested_quantity,0)))*greatest(0,coalesce(i.expected_unit_cost,0)),
    'بدون تغيير'
  from public.smart_purchase_order_items i
  where i.order_id=p_order_id;

  select coalesce(sum(proposed_total),0),count(*) filter(where customer_requests_count>0)
    into v_before,v_protected from _smart_budget_plan;
  v_after:=v_before;

  -- المرحلة 1: نقلل الكميات الزائدة أولًا مع الحفاظ على حد أمان أعلى للأصناف المهمة.
  while v_after>v_target+0.005 loop
    select id,proposed_qty,phase1_floor,unit_cost into v_id,v_qty,v_floor,v_cost
    from _smart_budget_plan
    where proposed_qty>phase1_floor and unit_cost>0
    order by (customer_requests_count>0) asc, priority_score asc, proposed_qty desc, unit_cost desc
    limit 1;
    exit when not found;
    v_gap:=v_after-v_target;
    v_units:=least(v_qty-v_floor,greatest(1,ceil(v_gap/v_cost)));
    update _smart_budget_plan set proposed_qty=proposed_qty-v_units,
      proposed_total=(proposed_qty-v_units)*unit_cost,
      action_reason='تقليل كمية تدريجي للحفاظ على تنوع الطلبية قبل حذف الصنف'
    where id=v_id;
    v_after:=v_after-(v_units*v_cost);
  end loop;

  -- المرحلة 2: لو الميزانية ما زالت أقل، ننزل الأصناف غير المحمية حتى الحد الأدنى بدل حذفها مباشرة.
  while v_after>v_target+0.005 loop
    select id,proposed_qty,hard_floor,unit_cost into v_id,v_qty,v_floor,v_cost
    from _smart_budget_plan
    where proposed_qty>hard_floor and unit_cost>0
    order by (customer_requests_count>0) asc, priority_score asc, proposed_qty desc, unit_cost desc
    limit 1;
    exit when not found;
    v_gap:=v_after-v_target;
    v_units:=least(v_qty-v_floor,greatest(1,ceil(v_gap/v_cost)));
    update _smart_budget_plan set proposed_qty=proposed_qty-v_units,
      proposed_total=(proposed_qty-v_units)*unit_cost,
      action_reason=case when customer_requests_count>0 then 'تقليل محسوب مع حماية كمية تغطي طلبات العملاء' else 'تقليل إضافي للحد الأدنى قبل التفكير في حذف الصنف' end
    where id=v_id;
    v_after:=v_after-(v_units*v_cost);
  end loop;

  -- المرحلة 3: الحذف الكامل آخر حل فقط، ومن الأقل أولوية وغير المرتبط بطلب عميل.
  while v_after>v_target+0.005 loop
    select id,proposed_qty,unit_cost into v_id,v_qty,v_cost
    from _smart_budget_plan
    where proposed_qty>0 and customer_requests_count=0 and unit_cost>0
    order by priority_score asc, proposed_total desc
    limit 1;
    exit when not found;
    update _smart_budget_plan set proposed_qty=0,proposed_total=0,
      action_reason='حذف كحل أخير بعد استنفاد تقليل الكميات؛ الصنف أقل أولوية وغير مرتبط بطلب عميل'
    where id=v_id;
    v_after:=v_after-(v_qty*v_cost);
  end loop;

  select coalesce(sum(proposed_total),0) into v_after from _smart_budget_plan;
  v_feasible:=v_after<=v_target+0.01;

  select count(*) filter(where proposed_qty<original_qty and proposed_qty>0),
         count(*) filter(where original_qty>0 and proposed_qty=0)
    into v_reduced,v_removed from _smart_budget_plan;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'product_code',product_code,'product_name',product_name,
    'original_quantity',original_qty,'proposed_quantity',proposed_qty,'unit_cost',unit_cost,
    'priority_score',priority_score,'customer_requests_count',customer_requests_count,
    'protected',customer_requests_count>0,'original_total',original_total,'proposed_total',proposed_total,
    'saved_amount',original_total-proposed_total,'reason',action_reason
  ) order by (customer_requests_count>0) desc,priority_score desc,product_name),'[]'::jsonb)
  into v_plan from _smart_budget_plan;

  if p_apply then
    if not v_feasible then
      return jsonb_build_object('ok',false,'error','budget_below_protected_minimum','data',jsonb_build_object(
        'target_budget',v_target,'minimum_possible_total',v_after,'gap',v_after-v_target,'plan',v_plan));
    end if;

    update public.smart_purchase_order_items i
    set approved_quantity=p.proposed_qty,
        expected_total=p.proposed_total,
        supplier_reason=case when p.proposed_qty<i.approved_quantity then coalesce(nullif(i.supplier_reason,''),'') || case when coalesce(i.supplier_reason,'')='' then '' else ' • ' end || p.action_reason else i.supplier_reason end,
        updated_at=now()
    from _smart_budget_plan p where i.id=p.id and i.order_id=p_order_id;

    update public.smart_purchase_orders
    set budget=v_target,approved_total=v_after,expected_total=v_after,updated_at=now()
    where id=p_order_id;
  end if;

  insert into public.smart_purchase_budget_runs(order_id,target_budget,before_total,after_total,savings,reduced_items,removed_items,protected_items,feasible,applied,plan,created_by_account_id,created_by_name)
  values(p_order_id,v_target,v_before,v_after,greatest(0,v_before-v_after),v_reduced,v_removed,v_protected,v_feasible,p_apply,v_plan,v_account.id,v_account.display_name);

  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'target_budget',v_target,'before_total',v_before,'after_total',v_after,
    'savings',greatest(0,v_before-v_after),'gap_to_target',greatest(0,v_after-v_target),
    'reduced_items',v_reduced,'removed_items',v_removed,'protected_items',v_protected,
    'feasible',v_feasible,'applied',p_apply,'plan',v_plan
  ));
end;
$function$;

revoke all on function public.smart_purchase_optimize_budget_v2(text,uuid,numeric,boolean) from public;
grant execute on function public.smart_purchase_optimize_budget_v2(text,uuid,numeric,boolean) to anon,authenticated;
