-- Fix stale staff_accounts name-field references used by purchase RPCs.
-- staff_accounts stores the operator name in display_name, not full_name.

create or replace function public.smart_purchase_begin_movement_import_v1(
  p_session_token text,
  p_branch text,
  p_source_file text default null::text,
  p_expected_rows integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp', 'extensions'
as $function$
declare
  a record;
  v_id uuid;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null
    and ss.expires_at>now()
    and sa.status='active'
  order by ss.created_at desc
  limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,p_branch) then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;

  insert into public.smart_purchase_movement_import_runs_v1(
    branch,source_file,expected_rows,created_by_account_id,created_by_name
  )
  values(
    p_branch,nullif(trim(p_source_file),''),greatest(0,coalesce(p_expected_rows,0)),a.id,a.display_name
  )
  returning import_id into v_id;

  return jsonb_build_object(
    'ok',true,
    'data',jsonb_build_object('import_id',v_id,'branch',p_branch,'status','staging')
  );
end
$function$;

create or replace function public.smart_purchase_set_manual_inventory_policy_v1(
  p_session_token text,
  p_branch text,
  p_product_key text,
  p_min_stock numeric default null::numeric,
  p_reorder_point numeric default null::numeric,
  p_max_stock numeric default null::numeric,
  p_note text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp', 'extensions'
as $function$
declare
  a record;
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
  if not public.smart_purchase_branch_allowed_v2(a.id,p_branch) then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;

  update public.purchase_inventory_intelligence_profiles
  set
    manual_min_stock=case when p_min_stock is null then null else greatest(0,p_min_stock) end,
    manual_reorder_point=case when p_reorder_point is null then null else greatest(0,p_reorder_point) end,
    manual_max_stock=case when p_max_stock is null then null else greatest(0,p_max_stock) end,
    manual_note=nullif(trim(p_note),''),
    manual_updated_at=now(),
    manual_updated_by_name=a.display_name
  where branch=p_branch and product_key=p_product_key;

  if not found then return jsonb_build_object('ok',false,'error','product_profile_not_found'); end if;

  return jsonb_build_object('ok',true,'data',(
    select to_jsonb(x)
    from public.purchase_inventory_effective_policy_v1 x
    where x.branch=p_branch and x.product_key=p_product_key
  ));
end
$function$;
