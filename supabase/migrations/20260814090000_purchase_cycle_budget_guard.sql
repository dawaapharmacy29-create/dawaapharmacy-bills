create table if not exists public.purchase_cycle_budget_settings (
  branch text primary key,
  cycle_budget numeric not null check (cycle_budget > 0),
  reserve_percent numeric not null default 20 check (reserve_percent between 0 and 80),
  reserve_days integer not null default 8 check (reserve_days between 1 and 20),
  warning_percent numeric not null default 85 check (warning_percent between 50 and 100),
  updated_by_account_id uuid,
  updated_by_name text,
  updated_at timestamptz not null default now()
);

alter table public.purchase_cycle_budget_settings enable row level security;
revoke all on public.purchase_cycle_budget_settings from anon, authenticated;

create or replace function public.smart_purchase_cycle_budget_guard(
  p_session_token text,
  p_branch text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp','extensions'
as $function$
declare
  v_account record;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_cycle_start date;
  v_cycle_end date;
  v_prev1_start date;
  v_prev1_end date;
  v_prev2_start date;
  v_prev2_end date;
  v_cycle_days int;
  v_elapsed int;
  v_remaining_days int;
  v_result jsonb := '[]'::jsonb;
  r record;
begin
  select sa.* into v_account
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_account.role not in ('general_manager','branch_manager','purchasing','accountant') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  if extract(day from v_today) >= 26 then
    v_cycle_start := make_date(extract(year from v_today)::int,extract(month from v_today)::int,26);
  else
    v_cycle_start := (date_trunc('month',v_today)::date - interval '1 month')::date + 25;
  end if;
  v_cycle_end := (v_cycle_start + interval '1 month')::date - 1;
  v_prev1_end := v_cycle_start - 1;
  v_prev1_start := (v_prev1_end - interval '1 month')::date + 1;
  v_prev2_end := v_prev1_start - 1;
  v_prev2_start := (v_prev2_end - interval '1 month')::date + 1;
  v_cycle_days := (v_cycle_end-v_cycle_start)+1;
  v_elapsed := greatest(1,(v_today-v_cycle_start)+1);
  v_remaining_days := greatest(0,(v_cycle_end-v_today));

  for r in
    with branches(branch) as (
      select unnest(array['دواء الشامي'::text,'دواء شكري'::text])
    ), current_spend as (
      select pi.branch,coalesce(sum(greatest(0,coalesce(pi.total_value,0)-coalesce(pi.returned_value,0))),0) amount
      from public.purchase_invoices pi
      where pi.invoice_date between v_cycle_start and v_today
        and coalesce(pi.is_sample,false)=false and pi.excluded_at is null
        and coalesce(pi.duplicate_review_status,'')<>'confirmed_duplicate'
      group by pi.branch
    ), prev1 as (
      select pi.branch,coalesce(sum(greatest(0,coalesce(pi.total_value,0)-coalesce(pi.returned_value,0))),0) amount
      from public.purchase_invoices pi
      where pi.invoice_date between v_prev1_start and v_prev1_end
        and coalesce(pi.is_sample,false)=false and pi.excluded_at is null
        and coalesce(pi.duplicate_review_status,'')<>'confirmed_duplicate'
      group by pi.branch
    ), prev2 as (
      select pi.branch,coalesce(sum(greatest(0,coalesce(pi.total_value,0)-coalesce(pi.returned_value,0))),0) amount
      from public.purchase_invoices pi
      where pi.invoice_date between v_prev2_start and v_prev2_end
        and coalesce(pi.is_sample,false)=false and pi.excluded_at is null
        and coalesce(pi.duplicate_review_status,'')<>'confirmed_duplicate'
      group by pi.branch
    ), commitments as (
      select spo.branch,coalesce(sum(greatest(0,coalesce(spo.approved_total,spo.expected_total,0)-coalesce(spo.received_total,0))),0) amount
      from public.smart_purchase_orders spo
      where spo.status in ('معتمدة','تم الإرسال للمورد','وصلت جزئيًا')
      group by spo.branch
    )
    select b.branch,
      coalesce(cs.amount,0)::numeric current_spend,
      coalesce(c.amount,0)::numeric open_commitments,
      coalesce(p1.amount,0)::numeric prev1_spend,
      coalesce(p2.amount,0)::numeric prev2_spend,
      s.cycle_budget configured_budget,
      coalesce(s.reserve_percent,20)::numeric reserve_percent,
      coalesce(s.reserve_days,8)::int reserve_days,
      coalesce(s.warning_percent,85)::numeric warning_percent
    from branches b
    left join current_spend cs on cs.branch=b.branch
    left join prev1 p1 on p1.branch=b.branch
    left join prev2 p2 on p2.branch=b.branch
    left join commitments c on c.branch=b.branch
    left join public.purchase_cycle_budget_settings s on s.branch=b.branch
    where p_branch is null or p_branch='all' or b.branch=p_branch
  loop
    declare
      v_recommended numeric := round(greatest(0,(r.prev1_spend+r.prev2_spend)/2),2);
      v_budget numeric := coalesce(r.configured_budget,round(greatest(0,(r.prev1_spend+r.prev2_spend)/2),2));
      v_committed numeric := r.current_spend+r.open_commitments;
      v_hist_daily numeric := case when (r.prev1_spend+r.prev2_spend)>0 then (r.prev1_spend+r.prev2_spend)/(2.0*v_cycle_days) else 0 end;
      v_forecast numeric := 0;
      v_paced_to_date numeric := 0;
      v_remaining numeric := 0;
      v_reserve numeric := 0;
      v_safe_now numeric := 0;
      v_daily_cap numeric := 0;
      v_safe_order_today numeric := 0;
      v_days_power numeric := 0;
      v_status text := 'safe';
    begin
      if v_budget<=0 then v_budget:=greatest(r.current_spend+r.open_commitments,1); end if;
      v_forecast := round((r.current_spend/v_elapsed)*v_cycle_days+r.open_commitments,2);
      v_paced_to_date := round(v_budget*(v_elapsed::numeric/v_cycle_days),2);
      v_remaining := greatest(0,v_budget-v_committed);
      if v_remaining_days > r.reserve_days then
        v_reserve := greatest(v_budget*(r.reserve_percent/100.0),v_hist_daily*r.reserve_days);
      else
        v_reserve := v_hist_daily*v_remaining_days;
      end if;
      v_reserve := least(v_remaining,greatest(0,v_reserve));
      v_safe_now := greatest(0,v_remaining-v_reserve);
      v_daily_cap := case when v_remaining_days>0 then v_remaining/(v_remaining_days+1) else v_remaining end;
      v_safe_order_today := least(v_safe_now,greatest(v_daily_cap,v_hist_daily)*1.25);
      v_days_power := case when v_hist_daily>0 then v_remaining/v_hist_daily else 0 end;

      if v_committed>=v_budget then v_status:='blocked';
      elsif v_forecast>v_budget*1.05 then v_status:='critical';
      elsif v_forecast>v_budget or v_committed>v_paced_to_date*1.05 or (v_committed/v_budget*100)>=r.warning_percent then v_status:='warning';
      else v_status:='safe'; end if;

      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'branch',r.branch,
        'cycle_start',v_cycle_start,'cycle_end',v_cycle_end,'cycle_day',v_elapsed,'cycle_days',v_cycle_days,'days_remaining',v_remaining_days,
        'configured',r.configured_budget is not null,
        'cycle_budget',round(v_budget,2),'recommended_cycle_budget',v_recommended,
        'current_spend',round(r.current_spend,2),'open_commitments',round(r.open_commitments,2),'committed_total',round(v_committed,2),
        'remaining_budget',round(v_remaining,2),'paced_limit_to_date',round(v_paced_to_date,2),'pace_variance',round(v_committed-v_paced_to_date,2),
        'forecast_end_cycle',v_forecast,'forecast_over_budget',round(greatest(0,v_forecast-v_budget),2),
        'reserve_required',round(v_reserve,2),'safe_available_now',round(v_safe_now,2),
        'suggested_daily_cap',round(v_daily_cap,2),'safe_order_today',round(v_safe_order_today,2),
        'historical_daily_purchase',round(v_hist_daily,2),'days_of_purchasing_power',round(v_days_power,1),
        'previous_cycle_1',round(r.prev1_spend,2),'previous_cycle_2',round(r.prev2_spend,2),
        'usage_percent',round(v_committed/v_budget*100,1),'status',v_status,
        'reserve_percent',r.reserve_percent,'reserve_days',r.reserve_days,'warning_percent',r.warning_percent
      ));
    end;
  end loop;

  return jsonb_build_object('ok',true,'data',jsonb_build_object('branches',v_result,'generated_at',now()));
end;
$function$;

create or replace function public.smart_purchase_set_cycle_budget(
  p_session_token text,
  p_branch text,
  p_cycle_budget numeric,
  p_reserve_percent numeric default 20,
  p_reserve_days integer default 8,
  p_warning_percent numeric default 85
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp','extensions'
as $function$
declare v_account record;
begin
  select sa.* into v_account
  from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_account.role not in ('general_manager','purchasing','accountant') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
  if p_branch not in ('دواء الشامي','دواء شكري') or coalesce(p_cycle_budget,0)<=0 then return jsonb_build_object('ok',false,'error','invalid_budget'); end if;

  insert into public.purchase_cycle_budget_settings(branch,cycle_budget,reserve_percent,reserve_days,warning_percent,updated_by_account_id,updated_by_name,updated_at)
  values(p_branch,p_cycle_budget,least(80,greatest(0,coalesce(p_reserve_percent,20))),least(20,greatest(1,coalesce(p_reserve_days,8))),least(100,greatest(50,coalesce(p_warning_percent,85))),v_account.id,v_account.display_name,now())
  on conflict(branch) do update set cycle_budget=excluded.cycle_budget,reserve_percent=excluded.reserve_percent,reserve_days=excluded.reserve_days,warning_percent=excluded.warning_percent,updated_by_account_id=excluded.updated_by_account_id,updated_by_name=excluded.updated_by_name,updated_at=now();

  return jsonb_build_object('ok',true,'data',jsonb_build_object('branch',p_branch,'cycle_budget',p_cycle_budget));
end;
$function$;

grant execute on function public.smart_purchase_cycle_budget_guard(text,text) to anon,authenticated;
grant execute on function public.smart_purchase_set_cycle_budget(text,text,numeric,numeric,integer,numeric) to anon,authenticated;
