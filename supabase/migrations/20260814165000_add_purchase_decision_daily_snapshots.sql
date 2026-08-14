create table if not exists public.purchase_decision_daily_snapshots (
  snapshot_date date not null,
  branch text not null,
  safe_order_today numeric not null default 0,
  current_spend numeric not null default 0,
  open_commitments numeric not null default 0,
  safe_available_now numeric not null default 0,
  forecast_end_cycle numeric not null default 0,
  stock_needed_count integer not null default 0,
  deadstock_count integer not null default 0,
  cash_locked_count integer not null default 0,
  clearance_count integer not null default 0,
  transfer_count integer not null default 0,
  capital_at_risk numeric not null default 0,
  captured_at timestamptz not null default now(),
  primary key (snapshot_date, branch)
);

create index if not exists purchase_decision_daily_snapshots_branch_date_idx
  on public.purchase_decision_daily_snapshots (branch, snapshot_date desc);

revoke all on table public.purchase_decision_daily_snapshots from anon, authenticated;

create or replace function public.smart_purchase_decision_daily_change_v1(
  p_session_token text,
  p_branch text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','pg_temp','extensions'
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_guard jsonb;
  v_inventory jsonb;
  v_clearance jsonb;
  v_result jsonb := '[]'::jsonb;
  v_row jsonb;
  v_branch text;
  v_prev public.purchase_decision_daily_snapshots%rowtype;
  v_safe_order numeric;
  v_spend numeric;
  v_commitments numeric;
  v_safe_available numeric;
  v_forecast numeric;
  v_stock_needed integer;
  v_deadstock integer;
  v_cash_locked integer;
  v_clearance_count integer;
  v_transfer_count integer;
  v_capital_risk numeric;
begin
  select a.* into v_account
  from public.staff_sessions s
  join public.staff_accounts a on a.id=s.account_id
  where s.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and s.revoked_at is null and s.expires_at>now() and a.status='active'
  order by s.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_account.role not in ('general_manager','branch_manager','purchasing','accountant') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  v_guard := public.smart_purchase_cycle_budget_guard(p_session_token, coalesce(p_branch,'all'));
  v_inventory := public.smart_purchase_inventory_command_center_v3(p_session_token, coalesce(p_branch,'all'));
  v_clearance := public.smart_purchase_clearance_engine_v1(p_session_token, coalesce(p_branch,'all'));

  if coalesce(v_guard->>'ok','true')='false' then return v_guard; end if;
  if coalesce(v_inventory->>'ok','true')='false' then return v_inventory; end if;
  if coalesce(v_clearance->>'ok','true')='false' then return v_clearance; end if;

  for v_row in select value from jsonb_array_elements(coalesce(v_guard->'branches','[]'::jsonb))
  loop
    v_branch := v_row->>'branch';
    if v_branch is null then continue; end if;

    v_safe_order := coalesce((v_row->>'safe_order_today')::numeric,0);
    v_spend := coalesce((v_row->>'current_spend')::numeric,0);
    v_commitments := coalesce((v_row->>'open_commitments')::numeric,0);
    v_safe_available := coalesce((v_row->>'safe_available_now')::numeric,0);
    v_forecast := coalesce((v_row->>'forecast_end_cycle')::numeric,0);

    select count(*) into v_stock_needed
    from jsonb_array_elements(coalesce(v_inventory->'stock_needed','[]'::jsonb)) x
    where x->>'branch'=v_branch;

    select count(*) into v_deadstock
    from jsonb_array_elements(coalesce(v_inventory->'deadstock','[]'::jsonb)) x
    where x->>'branch'=v_branch;

    select count(*) into v_cash_locked
    from jsonb_array_elements(coalesce(v_inventory->'cash_locked','[]'::jsonb)) x
    where x->>'branch'=v_branch;

    select count(*),
           count(*) filter (where coalesce((x->>'suggested_transfer_units')::numeric,0)>0),
           coalesce(sum(coalesce((x->>'capital_at_risk')::numeric,0)),0)
      into v_clearance_count,v_transfer_count,v_capital_risk
    from jsonb_array_elements(coalesce(v_clearance->'plan','[]'::jsonb)) x
    where x->>'branch'=v_branch and coalesce((x->>'units_to_act')::numeric,0)>0;

    select * into v_prev
    from public.purchase_decision_daily_snapshots
    where branch=v_branch and snapshot_date<current_date
    order by snapshot_date desc limit 1;

    insert into public.purchase_decision_daily_snapshots (
      snapshot_date,branch,safe_order_today,current_spend,open_commitments,safe_available_now,
      forecast_end_cycle,stock_needed_count,deadstock_count,cash_locked_count,clearance_count,
      transfer_count,capital_at_risk,captured_at
    ) values (
      current_date,v_branch,v_safe_order,v_spend,v_commitments,v_safe_available,v_forecast,
      v_stock_needed,v_deadstock,v_cash_locked,v_clearance_count,v_transfer_count,v_capital_risk,now()
    )
    on conflict (snapshot_date,branch) do update set
      safe_order_today=excluded.safe_order_today,current_spend=excluded.current_spend,
      open_commitments=excluded.open_commitments,safe_available_now=excluded.safe_available_now,
      forecast_end_cycle=excluded.forecast_end_cycle,stock_needed_count=excluded.stock_needed_count,
      deadstock_count=excluded.deadstock_count,cash_locked_count=excluded.cash_locked_count,
      clearance_count=excluded.clearance_count,transfer_count=excluded.transfer_count,
      capital_at_risk=excluded.capital_at_risk,captured_at=now();

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'branch',v_branch,
      'previous_date',case when v_prev.branch is null then null else v_prev.snapshot_date end,
      'current',jsonb_build_object(
        'safe_order_today',v_safe_order,'current_spend',v_spend,'open_commitments',v_commitments,
        'safe_available_now',v_safe_available,'forecast_end_cycle',v_forecast,
        'stock_needed_count',v_stock_needed,'deadstock_count',v_deadstock,'cash_locked_count',v_cash_locked,
        'clearance_count',v_clearance_count,'transfer_count',v_transfer_count,'capital_at_risk',v_capital_risk
      ),
      'delta',case when v_prev.branch is null then null else jsonb_build_object(
        'safe_order_today',v_safe_order-v_prev.safe_order_today,
        'current_spend',v_spend-v_prev.current_spend,
        'open_commitments',v_commitments-v_prev.open_commitments,
        'safe_available_now',v_safe_available-v_prev.safe_available_now,
        'forecast_end_cycle',v_forecast-v_prev.forecast_end_cycle,
        'stock_needed_count',v_stock_needed-v_prev.stock_needed_count,
        'deadstock_count',v_deadstock-v_prev.deadstock_count,
        'cash_locked_count',v_cash_locked-v_prev.cash_locked_count,
        'clearance_count',v_clearance_count-v_prev.clearance_count,
        'transfer_count',v_transfer_count-v_prev.transfer_count,
        'capital_at_risk',v_capital_risk-v_prev.capital_at_risk
      ) end
    ));

    v_prev := null;
  end loop;

  return jsonb_build_object('ok',true,'snapshot_date',current_date,'branches',v_result);
end;
$$;

grant execute on function public.smart_purchase_decision_daily_change_v1(text,text) to anon,authenticated;
