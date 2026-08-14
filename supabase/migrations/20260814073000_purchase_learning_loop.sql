create table if not exists public.smart_purchase_receipt_facts (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.smart_purchase_workflow_snapshots(id) on delete cascade,
  order_id uuid not null references public.smart_purchase_orders(id) on delete cascade,
  order_item_id uuid references public.smart_purchase_order_items(id) on delete set null,
  branch text,
  product_code text,
  product_name text not null,
  product_key text not null,
  approved_quantity numeric not null default 0,
  received_quantity numeric not null default 0,
  actual_unit_cost numeric not null default 0,
  receipt_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(snapshot_id, order_item_id, product_key)
);

create index if not exists smart_purchase_receipt_facts_product_idx
  on public.smart_purchase_receipt_facts(branch, product_key, receipt_at desc);

create table if not exists public.smart_purchase_learning_outcomes (
  id uuid primary key default gen_random_uuid(),
  receipt_fact_id uuid not null unique references public.smart_purchase_receipt_facts(id) on delete cascade,
  analysis_item_id uuid not null references public.purchase_analysis_items(id) on delete cascade,
  evaluation_at timestamptz not null,
  days_after_receipt integer not null,
  sales_30 numeric not null default 0,
  current_stock numeric not null default 0,
  safety_stock numeric not null default 0,
  coverage_days numeric not null default 0,
  pending_incoming numeric not null default 0,
  customer_requests_count integer not null default 0,
  outcome text not null check (outcome in ('understock','balanced','overstock')),
  pressure_score numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists smart_purchase_learning_outcomes_eval_idx
  on public.smart_purchase_learning_outcomes(evaluation_at desc, outcome);

create table if not exists public.smart_purchase_learning_profiles (
  branch text not null,
  product_key text not null,
  product_code text,
  product_name text not null,
  observations integer not null default 0,
  understock_events integer not null default 0,
  balanced_events integer not null default 0,
  overstock_events integer not null default 0,
  avg_approved_quantity numeric not null default 0,
  avg_received_quantity numeric not null default 0,
  avg_fill_rate numeric not null default 0,
  learned_multiplier numeric not null default 1,
  confidence numeric not null default 0,
  last_outcome text,
  last_evaluation_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(branch, product_key)
);

create or replace function public.smart_purchase_capture_receipt_fact()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp'
as $function$
declare
  v_order public.smart_purchase_orders%rowtype;
  v_row jsonb;
  v_item_id uuid;
  v_name text;
  v_code text;
  v_key text;
  v_approved numeric;
  v_received numeric;
  v_price numeric;
begin
  if new.workflow_type <> 'receipt' then return new; end if;
  select * into v_order from public.smart_purchase_orders where id=new.order_id;
  if not found then return new; end if;

  for v_row in select value from jsonb_array_elements(coalesce(new.details->'details','[]'::jsonb)) loop
    begin v_item_id := nullif(v_row#>>'{item,id}','')::uuid; exception when others then v_item_id := null; end;
    v_name := coalesce(nullif(v_row#>>'{item,product_name}',''), nullif(v_row#>>'{row,product_name}',''));
    if v_name is null then continue; end if;
    v_code := coalesce(nullif(v_row#>>'{item,product_code}',''), nullif(v_row#>>'{row,product_code}',''));
    v_key := public.purchase_normalize_product_name(v_name);
    v_approved := greatest(0,coalesce(nullif(v_row->>'ordered','')::numeric, nullif(v_row#>>'{item,approved_quantity}','')::numeric,0));
    v_received := greatest(0,coalesce(nullif(v_row->>'received','')::numeric,0));
    v_price := greatest(0,coalesce(nullif(v_row->>'actualPrice','')::numeric, nullif(v_row#>>'{row,price}','')::numeric,0));

    insert into public.smart_purchase_receipt_facts(
      snapshot_id,order_id,order_item_id,branch,product_code,product_name,product_key,
      approved_quantity,received_quantity,actual_unit_cost,receipt_at
    ) values(
      new.id,new.order_id,v_item_id,v_order.branch,v_code,v_name,v_key,
      v_approved,v_received,v_price,new.created_at
    ) on conflict (snapshot_id,order_item_id,product_key) do update set
      approved_quantity=excluded.approved_quantity,
      received_quantity=excluded.received_quantity,
      actual_unit_cost=excluded.actual_unit_cost;

    if v_item_id is not null then
      update public.smart_purchase_order_items
      set received_quantity=v_received,
          actual_unit_cost=case when v_price>0 then v_price else actual_unit_cost end,
          actual_total=v_received*case when v_price>0 then v_price else coalesce(actual_unit_cost,expected_unit_cost,0) end,
          updated_at=now()
      where id=v_item_id and order_id=new.order_id;
    end if;
  end loop;

  update public.smart_purchase_orders o
  set received_total=coalesce((select sum(coalesce(i.actual_total,0)) from public.smart_purchase_order_items i where i.order_id=o.id),0),
      updated_at=now()
  where o.id=new.order_id;
  return new;
end;
$function$;

drop trigger if exists trg_smart_purchase_capture_receipt_fact on public.smart_purchase_workflow_snapshots;
create trigger trg_smart_purchase_capture_receipt_fact
after insert on public.smart_purchase_workflow_snapshots
for each row execute function public.smart_purchase_capture_receipt_fact();

create or replace function public.smart_purchase_learning_signal(
  p_branch text,
  p_product_code text,
  p_product_name text
)
returns table(
  learned_multiplier numeric,
  learning_confidence numeric,
  learning_observations integer,
  last_learning_outcome text
)
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp'
as $function$
declare
  v_key text := public.purchase_normalize_product_name(p_product_name);
  v_fact record;
  v_analysis record;
  v_obs integer := 0;
  v_under integer := 0;
  v_bal integer := 0;
  v_over integer := 0;
  v_avg_approved numeric := 0;
  v_avg_received numeric := 0;
  v_fill numeric := 0;
  v_mult numeric := 1;
  v_conf numeric := 0;
  v_last text := null;
  v_last_at timestamptz := null;
begin
  for v_fact in
    select f.* from public.smart_purchase_receipt_facts f
    where f.product_key=v_key
      and (p_branch is null or f.branch=p_branch or replace(coalesce(f.branch,''),'فرع ','')=replace(coalesce(p_branch,''),'دواء ',''))
      and f.receipt_at <= now()-interval '7 days'
      and not exists(select 1 from public.smart_purchase_learning_outcomes o where o.receipt_fact_id=f.id)
    order by f.receipt_at
  loop
    select pai.* into v_analysis
    from public.purchase_analysis_items pai
    where ((nullif(v_fact.product_code,'') is not null and pai.product_code=v_fact.product_code)
        or public.purchase_normalize_product_name(pai.product_name)=v_fact.product_key)
      and (v_fact.branch is null or pai.branch=v_fact.branch or replace(coalesce(pai.branch,''),'فرع ','')=replace(coalesce(v_fact.branch,''),'دواء ',''))
      and pai.created_at >= v_fact.receipt_at + interval '7 days'
      and pai.created_at <= v_fact.receipt_at + interval '45 days'
    order by pai.created_at asc
    limit 1;

    if found then
      insert into public.smart_purchase_learning_outcomes(
        receipt_fact_id,analysis_item_id,evaluation_at,days_after_receipt,sales_30,current_stock,safety_stock,
        coverage_days,pending_incoming,customer_requests_count,outcome,pressure_score
      ) values(
        v_fact.id,v_analysis.id,v_analysis.created_at,
        greatest(0,extract(day from (v_analysis.created_at-v_fact.receipt_at))::int),
        coalesce(v_analysis.sales_30,0),coalesce(v_analysis.current_stock,0),coalesce(v_analysis.safety_stock,0),
        coalesce(v_analysis.coverage_days,0),coalesce(v_analysis.pending_incoming,0),coalesce(v_analysis.customer_requests_count,0),
        case
          when coalesce(v_analysis.customer_requests_count,0)>0
            or (coalesce(v_analysis.sales_30,0)>0 and coalesce(v_analysis.current_stock,0)<=coalesce(v_analysis.safety_stock,0))
            or (coalesce(v_analysis.coverage_days,0)>0 and v_analysis.coverage_days<=10)
            then 'understock'
          when coalesce(v_analysis.coverage_days,0)>=55
            or (coalesce(v_analysis.sales_30,0)=0 and coalesce(v_analysis.current_stock,0)>0)
            then 'overstock'
          else 'balanced' end,
        greatest(-100,least(100,
          case when coalesce(v_analysis.coverage_days,0)>0 and v_analysis.coverage_days<=10 then 35 else 0 end
          + case when coalesce(v_analysis.current_stock,0)<=coalesce(v_analysis.safety_stock,0) and coalesce(v_analysis.sales_30,0)>0 then 25 else 0 end
          + case when coalesce(v_analysis.customer_requests_count,0)>0 then 25 else 0 end
          - case when coalesce(v_analysis.coverage_days,0)>=55 then 35 else 0 end
          - case when coalesce(v_analysis.sales_30,0)=0 and coalesce(v_analysis.current_stock,0)>0 then 25 else 0 end
          - case when coalesce(v_analysis.pending_incoming,0)>=greatest(1,coalesce(v_analysis.sales_30,0)) then 10 else 0 end
        ))
      ) on conflict(receipt_fact_id) do nothing;
    end if;
  end loop;

  select count(*),
         count(*) filter(where o.outcome='understock'),
         count(*) filter(where o.outcome='balanced'),
         count(*) filter(where o.outcome='overstock'),
         coalesce(avg(f.approved_quantity),0),coalesce(avg(f.received_quantity),0),
         coalesce(avg(case when f.approved_quantity>0 then least(1.5,f.received_quantity/f.approved_quantity) else 0 end),0)
  into v_obs,v_under,v_bal,v_over,v_avg_approved,v_avg_received,v_fill
  from public.smart_purchase_learning_outcomes o
  join public.smart_purchase_receipt_facts f on f.id=o.receipt_fact_id
  where f.product_key=v_key
    and (p_branch is null or f.branch=p_branch or replace(coalesce(f.branch,''),'فرع ','')=replace(coalesce(p_branch,''),'دواء ',''));

  select o.outcome,o.evaluation_at into v_last,v_last_at
  from public.smart_purchase_learning_outcomes o
  join public.smart_purchase_receipt_facts f on f.id=o.receipt_fact_id
  where f.product_key=v_key
    and (p_branch is null or f.branch=p_branch or replace(coalesce(f.branch,''),'فرع ','')=replace(coalesce(p_branch,''),'دواء ',''))
  order by o.evaluation_at desc limit 1;

  if v_obs>0 then
    v_mult := greatest(0.65,least(1.35,1 + ((v_under-v_over)::numeric/greatest(v_obs,1))*0.22));
    v_conf := least(1,0.25 + v_obs*0.15);
  else
    v_mult := 1;
    v_conf := 0;
  end if;

  insert into public.smart_purchase_learning_profiles(
    branch,product_key,product_code,product_name,observations,understock_events,balanced_events,overstock_events,
    avg_approved_quantity,avg_received_quantity,avg_fill_rate,learned_multiplier,confidence,last_outcome,last_evaluation_at,updated_at
  ) values(
    coalesce(p_branch,''),v_key,p_product_code,p_product_name,v_obs,v_under,v_bal,v_over,
    v_avg_approved,v_avg_received,v_fill,v_mult,v_conf,v_last,v_last_at,now()
  ) on conflict(branch,product_key) do update set
    product_code=excluded.product_code,product_name=excluded.product_name,observations=excluded.observations,
    understock_events=excluded.understock_events,balanced_events=excluded.balanced_events,overstock_events=excluded.overstock_events,
    avg_approved_quantity=excluded.avg_approved_quantity,avg_received_quantity=excluded.avg_received_quantity,
    avg_fill_rate=excluded.avg_fill_rate,learned_multiplier=excluded.learned_multiplier,confidence=excluded.confidence,
    last_outcome=excluded.last_outcome,last_evaluation_at=excluded.last_evaluation_at,updated_at=now();

  learned_multiplier:=v_mult;
  learning_confidence:=v_conf;
  learning_observations:=v_obs;
  last_learning_outcome:=v_last;
  return next;
end;
$function$;

grant execute on function public.smart_purchase_learning_signal(text,text,text) to anon,authenticated;

create or replace function public.smart_purchase_learning_dashboard(p_session_token text, p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp','extensions'
as $function$
declare v_account record;
begin
  select sa.* into v_account from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'receipt_facts',(select count(*) from public.smart_purchase_receipt_facts),
    'evaluated_outcomes',(select count(*) from public.smart_purchase_learning_outcomes),
    'profiles',(select count(*) from public.smart_purchase_learning_profiles where observations>0),
    'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.confidence desc,x.observations desc) from (
      select * from public.smart_purchase_learning_profiles where observations>0 order by confidence desc,observations desc limit greatest(1,least(coalesce(p_limit,100),500))
    ) x),'[]'::jsonb)
  ));
end;
$function$;

grant execute on function public.smart_purchase_learning_dashboard(text,integer) to anon,authenticated;
