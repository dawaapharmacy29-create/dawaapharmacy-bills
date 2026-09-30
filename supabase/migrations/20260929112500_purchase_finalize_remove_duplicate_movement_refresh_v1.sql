-- Keep dual stock finalize focused on the atomic stock swap only.
-- The planner immediately refreshes movement review, so doing it here doubled work in the critical save path.

CREATE OR REPLACE FUNCTION public.smart_purchase_finalize_dual_stock_master_v1(p_session_token text, p_stock_sync_id text, p_expected_rows integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp', 'extensions'
AS $function$
declare
  a record;
  v_stage_count int:=0;
  v_started_at timestamptz;
  v_latest_finalized_started_at timestamptz;
  v_shokry_applied int:=0;
  v_shamy_applied int:=0;
  v_shokry_stale int:=0;
  v_shamy_stale int:=0;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null
    and ss.expires_at>now()
    and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,'دواء شكري')
     or not public.smart_purchase_branch_allowed_v2(a.id,'دواء الشامي') then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;
  if coalesce(trim(p_stock_sync_id),'')='' then
    return jsonb_build_object('ok',false,'error','missing_stock_sync_id');
  end if;
  if coalesce(p_expected_rows,0)<=0 then
    return jsonb_build_object('ok',false,'error','invalid_expected_rows');
  end if;

  perform pg_advisory_xact_lock(hashtext('dual-stock-finalize-global'));

  select r.started_at
  into v_started_at
  from public.purchase_dual_stock_sync_runs r
  where r.stock_sync_id=p_stock_sync_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'error','stock_sync_not_staged');
  end if;

  if exists(
    select 1
    from public.purchase_dual_stock_sync_runs r
    where r.stock_sync_id=p_stock_sync_id
      and r.status='finalized'
  ) then
    return jsonb_build_object('ok',true,'data',jsonb_build_object(
      'stock_sync_id',p_stock_sync_id,
      'expected_rows',coalesce((select expected_rows from public.purchase_dual_stock_sync_runs where stock_sync_id=p_stock_sync_id),p_expected_rows),
      'shokry_saved',(select count(*) from public.purchase_branch_current_snapshots where branch='دواء شكري' and stock_sync_id=p_stock_sync_id),
      'shamy_saved',(select count(*) from public.purchase_branch_current_snapshots where branch='دواء الشامي' and stock_sync_id=p_stock_sync_id),
      'shokry_stale_disabled',0,
      'shamy_stale_disabled',0,
      'already_finalized',true,
      'dual_atomic_finalize',true,
      'row_count_verified',true
    ));
  end if;

  select max(r.started_at)
  into v_latest_finalized_started_at
  from public.purchase_dual_stock_sync_runs r
  where r.status='finalized'
    and r.stock_sync_id<>p_stock_sync_id;

  if v_latest_finalized_started_at is not null
     and v_started_at<v_latest_finalized_started_at then
    update public.purchase_dual_stock_sync_runs
    set status='superseded',
        finalized_at=now(),
        expected_rows=p_expected_rows,
        error_code='stock_sync_superseded'
    where stock_sync_id=p_stock_sync_id;

    return jsonb_build_object('ok',false,'error','stock_sync_superseded','data',jsonb_build_object(
      'stock_sync_id',p_stock_sync_id,
      'started_at',v_started_at,
      'newer_sync_started_at',v_latest_finalized_started_at
    ));
  end if;

  select count(*) into v_stage_count
  from public.purchase_dual_branch_stock_sync_stage
  where stock_sync_id=p_stock_sync_id;

  if v_stage_count<>p_expected_rows then
    update public.purchase_dual_stock_sync_runs
    set expected_rows=p_expected_rows,
        error_code='stage_count_mismatch'
    where stock_sync_id=p_stock_sync_id;

    return jsonb_build_object('ok',false,'error','stage_count_mismatch','data',jsonb_build_object(
      'expected_rows',p_expected_rows,
      'staged_rows',v_stage_count,
      'stock_sync_id',p_stock_sync_id
    ));
  end if;

  insert into public.purchase_branch_current_snapshots(
    branch,product_key,product_code,product_name,code_key,name_key,current_stock,
    pending_incoming,safety_stock,sales_30,sales_60,sales_90,avg_daily_usage,
    unit_cost,customer_requests_count,priority_score,source_row,captured_at,
    stock_unit,company_name,inventory_eligible,stock_source,stock_captured_at,
    movement_captured_at,stock_sync_id
  )
  select
    'دواء شكري',st.product_key,st.product_code,st.product_name,
    regexp_replace(nullif(trim(st.product_code),''),'\.0+$','','g'),
    public.purchase_normalize_product_name(st.product_name),
    st.shokry_stock,
    0,0,0,0,0,0,0,0,0,
    st.source_row,now(),st.stock_unit,st.company_name,st.inventory_eligible,
    st.stock_source,now(),null,st.stock_sync_id
  from public.purchase_dual_branch_stock_sync_stage st
  where st.stock_sync_id=p_stock_sync_id
  on conflict(branch,product_key) do update set
    product_code=excluded.product_code,
    product_name=excluded.product_name,
    code_key=excluded.code_key,
    name_key=excluded.name_key,
    current_stock=excluded.current_stock,
    source_row=coalesce(purchase_branch_current_snapshots.source_row,'{}'::jsonb)||excluded.source_row,
    captured_at=excluded.captured_at,
    stock_unit=coalesce(excluded.stock_unit,purchase_branch_current_snapshots.stock_unit),
    company_name=coalesce(excluded.company_name,purchase_branch_current_snapshots.company_name),
    inventory_eligible=excluded.inventory_eligible,
    stock_source=excluded.stock_source,
    stock_captured_at=excluded.stock_captured_at,
    stock_sync_id=excluded.stock_sync_id;

  get diagnostics v_shokry_applied=row_count;

  insert into public.purchase_branch_current_snapshots(
    branch,product_key,product_code,product_name,code_key,name_key,current_stock,
    pending_incoming,safety_stock,sales_30,sales_60,sales_90,avg_daily_usage,
    unit_cost,customer_requests_count,priority_score,source_row,captured_at,
    stock_unit,company_name,inventory_eligible,stock_source,stock_captured_at,
    movement_captured_at,stock_sync_id
  )
  select
    'دواء الشامي',st.product_key,st.product_code,st.product_name,
    regexp_replace(nullif(trim(st.product_code),''),'\.0+$','','g'),
    public.purchase_normalize_product_name(st.product_name),
    st.shamy_stock,
    0,0,0,0,0,0,0,0,0,
    st.source_row,now(),st.stock_unit,st.company_name,st.inventory_eligible,
    st.stock_source,now(),null,st.stock_sync_id
  from public.purchase_dual_branch_stock_sync_stage st
  where st.stock_sync_id=p_stock_sync_id
  on conflict(branch,product_key) do update set
    product_code=excluded.product_code,
    product_name=excluded.product_name,
    code_key=excluded.code_key,
    name_key=excluded.name_key,
    current_stock=excluded.current_stock,
    source_row=coalesce(purchase_branch_current_snapshots.source_row,'{}'::jsonb)||excluded.source_row,
    captured_at=excluded.captured_at,
    stock_unit=coalesce(excluded.stock_unit,purchase_branch_current_snapshots.stock_unit),
    company_name=coalesce(excluded.company_name,purchase_branch_current_snapshots.company_name),
    inventory_eligible=excluded.inventory_eligible,
    stock_source=excluded.stock_source,
    stock_captured_at=excluded.stock_captured_at,
    stock_sync_id=excluded.stock_sync_id;

  get diagnostics v_shamy_applied=row_count;

  update public.purchase_branch_current_snapshots s
  set current_stock=0,
      inventory_eligible=false,
      stock_source='stale_not_in_latest_stock_master'
  where s.branch='دواء شكري'
    and not exists(
      select 1
      from public.purchase_dual_branch_stock_sync_stage st
      where st.stock_sync_id=p_stock_sync_id
        and st.product_key=s.product_key
    );
  get diagnostics v_shokry_stale=row_count;

  update public.purchase_branch_current_snapshots s
  set current_stock=0,
      inventory_eligible=false,
      stock_source='stale_not_in_latest_stock_master'
  where s.branch='دواء الشامي'
    and not exists(
      select 1
      from public.purchase_dual_branch_stock_sync_stage st
      where st.stock_sync_id=p_stock_sync_id
        and st.product_key=s.product_key
    );
  get diagnostics v_shamy_stale=row_count;

  update public.purchase_dual_stock_sync_runs
  set status='finalized',
      finalized_at=now(),
      expected_rows=p_expected_rows,
      error_code=null
  where stock_sync_id=p_stock_sync_id;


  delete from public.purchase_dual_branch_stock_sync_stage
  where stock_sync_id=p_stock_sync_id;

  delete from public.purchase_dual_branch_stock_sync_stage
  where staged_at<now()-interval '2 days';

  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'stock_sync_id',p_stock_sync_id,
    'expected_rows',p_expected_rows,
    'shokry_saved',v_shokry_applied,
    'shamy_saved',v_shamy_applied,
    'shokry_stale_disabled',v_shokry_stale,
    'shamy_stale_disabled',v_shamy_stale,
    'atomic_finalize',true,
    'dual_atomic_finalize',true,
    'row_count_verified',true,
    'already_finalized',false
  ));
end
$function$
