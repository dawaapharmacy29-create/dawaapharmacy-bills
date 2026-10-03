-- Add diagnostic exceptions to movement preview without changing finalize semantics.
create or replace function public.smart_purchase_movement_import_preview_v1(p_session_token text, p_import_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','public','pg_temp','extensions'
as $function$
declare
  a record;
  rrun record;
  v_preview jsonb;
  v_exceptions jsonb;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  select * into rrun from public.smart_purchase_movement_import_runs_v1 where import_id=p_import_id;
  if not found then return jsonb_build_object('ok',false,'error','import_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,rrun.branch) then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;

  v_preview:=public.smart_purchase_movement_import_preview_core_v1(p_import_id);

  with staged as (
    select x.*,
      nullif(regexp_replace(trim(coalesce(x.product_code,'')),'\.0+$','','g'),'') code_key2,
      public.purchase_normalize_product_name(x.product_name) name_key2
    from public.smart_purchase_movement_import_stage_v1 x where x.import_id=p_import_id
  ), matched as (
    select s.*,
      coalesce(by_code.product_key,by_name.product_key) product_key,
      coalesce(by_code.inventory_eligible,by_name.inventory_eligible) inventory_eligible,
      coalesce(by_code.product_code,by_name.product_code) target_code,
      coalesce(by_code.product_name,by_name.product_name) target_name
    from staged s
    left join lateral (
      select t.product_key,t.inventory_eligible,t.product_code,t.product_name
      from public.purchase_branch_current_snapshots t
      where t.branch=rrun.branch and s.code_key2 is not null and t.code_key=s.code_key2
      order by coalesce(t.inventory_eligible,true) desc,t.stock_captured_at desc nulls last limit 1
    ) by_code on true
    left join lateral (
      select t.product_key,t.inventory_eligible,t.product_code,t.product_name
      from public.purchase_branch_current_snapshots t
      where t.branch=rrun.branch and by_code.product_key is null and t.name_key=s.name_key2
      order by coalesce(t.inventory_eligible,true) desc,t.stock_captured_at desc nulls last limit 1
    ) by_name on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'row_no',row_no,'product_code',product_code,'product_name',product_name,
    'reason',case when product_key is null then 'unmatched' else 'inventory_ineligible' end,
    'target_code',target_code,'target_name',target_name
  ) order by row_no),'[]'::jsonb)
  into v_exceptions
  from matched
  where product_key is null or coalesce(inventory_eligible,true)=false;

  return jsonb_set(v_preview,'{data,exceptions}',v_exceptions,true);
end
$function$;
