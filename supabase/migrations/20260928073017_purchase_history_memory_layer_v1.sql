create table if not exists public.purchase_product_history_profiles (
  branch text not null,
  product_key text not null,
  product_code text,
  product_name text not null,
  sales_6m numeric not null default 0 check (sales_6m >= 0),
  avg_monthly_6m numeric not null default 0 check (avg_monthly_6m >= 0),
  distinct_customers integer not null default 0 check (distinct_customers >= 0),
  source_movement_file text,
  source_customer_file text,
  movement_updated_at timestamptz,
  customer_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (branch, product_key)
);

create table if not exists public.purchase_supplier_history_profiles (
  branch text not null,
  product_key text not null,
  product_code text,
  product_name text not null,
  supplier_name text not null,
  purchase_events integer not null default 0 check (purchase_events >= 0),
  purchased_qty numeric not null default 0 check (purchased_qty >= 0),
  bonus_qty numeric not null default 0 check (bonus_qty >= 0),
  net_cost_total numeric not null default 0 check (net_cost_total >= 0),
  avg_effective_unit_cost numeric not null default 0 check (avg_effective_unit_cost >= 0),
  min_effective_unit_cost numeric not null default 0 check (min_effective_unit_cost >= 0),
  last_purchase_date date,
  last_unit_cost numeric not null default 0 check (last_unit_cost >= 0),
  source_file text,
  updated_at timestamptz not null default now(),
  primary key (branch, product_key, supplier_name)
);

create index if not exists purchase_product_history_profiles_code_idx
  on public.purchase_product_history_profiles(branch, product_code);
create index if not exists purchase_supplier_history_profiles_lookup_idx
  on public.purchase_supplier_history_profiles(branch, product_key, avg_effective_unit_cost);

alter table public.purchase_product_history_profiles enable row level security;
alter table public.purchase_supplier_history_profiles enable row level security;

drop policy if exists purchase_product_history_profiles_block_direct on public.purchase_product_history_profiles;
create policy purchase_product_history_profiles_block_direct
on public.purchase_product_history_profiles for all to anon, authenticated
using (false) with check (false);

drop policy if exists purchase_supplier_history_profiles_block_direct on public.purchase_supplier_history_profiles;
create policy purchase_supplier_history_profiles_block_direct
on public.purchase_supplier_history_profiles for all to anon, authenticated
using (false) with check (false);

revoke all on public.purchase_product_history_profiles from public, anon, authenticated;
revoke all on public.purchase_supplier_history_profiles from public, anon, authenticated;


CREATE OR REPLACE FUNCTION public.smart_purchase_history_import_v1(p_session_token text, p_branch text, p_kind text, p_source_file_name text, p_rows jsonb, p_reset boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp', 'extensions'
AS $function$
declare
  a record;
  v_kind text:=lower(trim(coalesce(p_kind,'')));
  v_row jsonb;
  v_key text;
  v_code text;
  v_name text;
  v_supplier text;
  v_qty numeric;
  v_bonus numeric;
  v_cost numeric;
  v_eff numeric;
  v_date date;
  v_count int:=0;
  v_skipped int:=0;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;
  if coalesce(trim(p_branch),'')='' or p_branch='all' then
    return jsonb_build_object('ok',false,'error','branch_required');
  end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,p_branch) then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;
  if v_kind not in ('movement_6m','customer_history','purchase_history') then
    return jsonb_build_object('ok',false,'error','invalid_history_kind');
  end if;
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb))<>'array' then
    return jsonb_build_object('ok',false,'error','rows_required');
  end if;

  if p_reset then
    if v_kind='movement_6m' then
      update public.purchase_product_history_profiles
      set sales_6m=0,avg_monthly_6m=0,source_movement_file=null,movement_updated_at=null,updated_at=now()
      where branch=p_branch;
    elsif v_kind='customer_history' then
      update public.purchase_product_history_profiles
      set distinct_customers=0,source_customer_file=null,customer_updated_at=null,updated_at=now()
      where branch=p_branch;
    else
      delete from public.purchase_supplier_history_profiles where branch=p_branch;
    end if;
  end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb))
  loop
    v_code:=nullif(trim(v_row->>'product_code'),'');
    v_name:=trim(coalesce(v_row->>'product_name',''));
    if v_name='' then v_skipped:=v_skipped+1; continue; end if;
    v_key:=coalesce(v_code,public.purchase_normalize_product_name(v_name));
    if coalesce(v_key,'')='' then v_skipped:=v_skipped+1; continue; end if;

    if v_kind='movement_6m' then
      v_qty:=greatest(0,coalesce(nullif(v_row->>'sales_6m','')::numeric,0));
      insert into public.purchase_product_history_profiles(
        branch,product_key,product_code,product_name,sales_6m,avg_monthly_6m,
        source_movement_file,movement_updated_at,updated_at
      ) values (
        p_branch,v_key,v_code,v_name,v_qty,v_qty/6.0,p_source_file_name,now(),now()
      )
      on conflict(branch,product_key) do update set
        product_code=coalesce(excluded.product_code,purchase_product_history_profiles.product_code),
        product_name=excluded.product_name,
        sales_6m=purchase_product_history_profiles.sales_6m+excluded.sales_6m,
        avg_monthly_6m=(purchase_product_history_profiles.sales_6m+excluded.sales_6m)/6.0,
        source_movement_file=excluded.source_movement_file,
        movement_updated_at=now(),
        updated_at=now();
      v_count:=v_count+1;

    elsif v_kind='customer_history' then
      insert into public.purchase_product_history_profiles(
        branch,product_key,product_code,product_name,distinct_customers,
        source_customer_file,customer_updated_at,updated_at
      ) values (
        p_branch,v_key,v_code,v_name,
        greatest(0,coalesce(nullif(v_row->>'distinct_customers','')::int,0)),
        p_source_file_name,now(),now()
      )
      on conflict(branch,product_key) do update set
        product_code=coalesce(excluded.product_code,purchase_product_history_profiles.product_code),
        product_name=excluded.product_name,
        distinct_customers=purchase_product_history_profiles.distinct_customers+excluded.distinct_customers,
        source_customer_file=excluded.source_customer_file,
        customer_updated_at=now(),
        updated_at=now();
      v_count:=v_count+1;

    else
      v_supplier:=trim(coalesce(v_row->>'supplier_name',''));
      if v_supplier='' then v_skipped:=v_skipped+1; continue; end if;
      v_qty:=greatest(0,coalesce(nullif(v_row->>'purchase_qty','')::numeric,0));
      v_bonus:=greatest(0,coalesce(nullif(v_row->>'bonus_qty','')::numeric,0));
      v_cost:=greatest(0,coalesce(nullif(v_row->>'unit_cost','')::numeric,0));
      if v_qty<=0 or v_cost<=0 then v_skipped:=v_skipped+1; continue; end if;
      v_eff:=(v_qty*v_cost)/greatest(v_qty+v_bonus,1);
      v_date:=case when coalesce(v_row->>'purchase_date','') ~ '^\d{4}-\d{2}-\d{2}$'
                   then (v_row->>'purchase_date')::date else null end;

      insert into public.purchase_supplier_history_profiles(
        branch,product_key,product_code,product_name,supplier_name,purchase_events,
        purchased_qty,bonus_qty,net_cost_total,avg_effective_unit_cost,min_effective_unit_cost,
        last_purchase_date,last_unit_cost,source_file,updated_at
      ) values (
        p_branch,v_key,v_code,v_name,v_supplier,1,v_qty,v_bonus,v_qty*v_cost,v_eff,v_eff,
        v_date,v_cost,p_source_file_name,now()
      )
      on conflict(branch,product_key,supplier_name) do update set
        product_code=coalesce(excluded.product_code,purchase_supplier_history_profiles.product_code),
        product_name=excluded.product_name,
        purchase_events=purchase_supplier_history_profiles.purchase_events+1,
        purchased_qty=purchase_supplier_history_profiles.purchased_qty+excluded.purchased_qty,
        bonus_qty=purchase_supplier_history_profiles.bonus_qty+excluded.bonus_qty,
        net_cost_total=purchase_supplier_history_profiles.net_cost_total+excluded.net_cost_total,
        avg_effective_unit_cost=
          (purchase_supplier_history_profiles.net_cost_total+excluded.net_cost_total)/
          greatest(purchase_supplier_history_profiles.purchased_qty+purchase_supplier_history_profiles.bonus_qty+
                   excluded.purchased_qty+excluded.bonus_qty,1),
        min_effective_unit_cost=case
          when purchase_supplier_history_profiles.min_effective_unit_cost<=0 then excluded.min_effective_unit_cost
          else least(purchase_supplier_history_profiles.min_effective_unit_cost,excluded.min_effective_unit_cost)
        end,
        last_purchase_date=greatest(purchase_supplier_history_profiles.last_purchase_date,excluded.last_purchase_date),
        last_unit_cost=case
          when excluded.last_purchase_date is not null
           and (purchase_supplier_history_profiles.last_purchase_date is null or excluded.last_purchase_date>=purchase_supplier_history_profiles.last_purchase_date)
          then excluded.last_unit_cost else purchase_supplier_history_profiles.last_unit_cost end,
        source_file=excluded.source_file,
        updated_at=now();
      v_count:=v_count+1;
    end if;
  end loop;

  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'branch',p_branch,'kind',v_kind,'processed',v_count,'skipped',v_skipped,'source_file',p_source_file_name
  ));
end $function$
;
CREATE OR REPLACE FUNCTION public.smart_purchase_history_status_v1(p_session_token text, p_branch text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp', 'extensions'
AS $function$
declare
  a record;
  v_data jsonb;
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

  select jsonb_build_object(
    'branch',p_branch,
    'movement_products',count(*) filter(where sales_6m>0),
    'customer_products',count(*) filter(where distinct_customers>0),
    'movement_updated_at',max(movement_updated_at),
    'customer_updated_at',max(customer_updated_at),
    'supplier_product_pairs',(select count(*) from public.purchase_supplier_history_profiles s where s.branch=p_branch),
    'suppliers',(select count(distinct supplier_name) from public.purchase_supplier_history_profiles s where s.branch=p_branch),
    'supplier_updated_at',(select max(updated_at) from public.purchase_supplier_history_profiles s where s.branch=p_branch)
  ) into v_data
  from public.purchase_product_history_profiles h
  where h.branch=p_branch;

  return jsonb_build_object('ok',true,'data',coalesce(v_data,jsonb_build_object('branch',p_branch)));
end $function$
;
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
        and lower(s.supplier_name) not like '%دواء %'
        and lower(s.supplier_name) not like '%جرد%'
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
;
CREATE OR REPLACE FUNCTION public.smart_purchase_demand_transfer_preview_v4(p_session_token text, p_branch text, p_financial_mode text DEFAULT 'medium'::text, p_rows jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp', 'extensions'
AS $function$
declare
  v_enriched jsonb;
  v_result jsonb;
begin
  v_enriched:=public.smart_purchase_history_enrich_rows_v1(p_session_token,p_branch,p_rows);
  if coalesce((v_enriched->>'ok')::boolean,false)=false then return v_enriched; end if;

  v_result:=public.smart_purchase_demand_transfer_preview_v3(
    p_session_token,p_branch,p_financial_mode,
    coalesce(v_enriched->'data'->'rows','[]'::jsonb)
  );

  if coalesce((v_result->>'ok')::boolean,false)=false then return v_result; end if;
  return jsonb_set(
    v_result,
    '{data,method,history_layer}',
    jsonb_build_object(
      'enabled',true,
      'usage_blend','70% recent + 30% six-month history',
      'customer_priority','historical customer spread boosts priority without creating fake open requests',
      'supplier_reference','historical supplier and cost are references only'
    ),
    true
  );
end $function$
;

revoke all on function public.smart_purchase_history_import_v1(text,text,text,text,jsonb,boolean) from public;
grant execute on function public.smart_purchase_history_import_v1(text,text,text,text,jsonb,boolean) to anon,authenticated;
revoke all on function public.smart_purchase_history_status_v1(text,text) from public;
grant execute on function public.smart_purchase_history_status_v1(text,text) to anon,authenticated;
revoke all on function public.smart_purchase_history_enrich_rows_v1(text,text,jsonb) from public;
grant execute on function public.smart_purchase_history_enrich_rows_v1(text,text,jsonb) to anon,authenticated;
revoke all on function public.smart_purchase_demand_transfer_preview_v4(text,text,text,jsonb) from public;
grant execute on function public.smart_purchase_demand_transfer_preview_v4(text,text,text,jsonb) to anon,authenticated;
