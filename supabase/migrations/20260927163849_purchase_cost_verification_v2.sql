-- Purchase cost verification: reference prices cannot be approved until reviewed.
alter table public.smart_purchase_order_items
  add column if not exists cost_source text not null default 'reference',
  add column if not exists cost_verified_at timestamptz,
  add column if not exists cost_verified_by_account_id uuid,
  add column if not exists cost_verified_by_name text;

alter table public.smart_purchase_order_items
  drop constraint if exists smart_purchase_order_items_cost_source_chk;
alter table public.smart_purchase_order_items
  add constraint smart_purchase_order_items_cost_source_chk
  check (cost_source in ('reference','manual','supplier_offer'));

update public.smart_purchase_order_items
set cost_source='supplier_offer',
    cost_verified_at=coalesce(cost_verified_at,updated_at,created_at,now())
where supplier_offer_id is not null
  and coalesce(expected_unit_cost,0)>0;

create or replace function public.smart_purchase_apply_item_plan_cost_guarded_v2(
  p_session_token text,p_order_id uuid,p_items jsonb
) returns jsonb
language plpgsql security definer
set search_path='pg_catalog','public','extensions'
as $$
declare a record; o record; v_result jsonb;
begin
  select sa.* into a
  from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select id,branch into o from public.smart_purchase_orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;

  v_result:=public.smart_purchase_apply_item_plan_package_guarded_v2(p_session_token,p_order_id,p_items);
  if coalesce((v_result->>'ok')::boolean,false)=false then return v_result; end if;

  update public.smart_purchase_order_items i
  set cost_source='manual',cost_verified_at=now(),
      cost_verified_by_account_id=a.id,cost_verified_by_name=a.display_name,updated_at=now()
  from jsonb_array_elements(p_items) x
  where i.order_id=p_order_id and i.id=(x->>'id')::uuid
    and x ? 'expected_unit_cost'
    and greatest(0,coalesce(nullif(x->>'expected_unit_cost','')::numeric,0))>0;
  return v_result;
end $$;

create or replace function public.smart_purchase_apply_supplier_plan_cost_guarded_v2(
  p_session_token text,p_order_id uuid,p_items jsonb
) returns jsonb
language plpgsql security definer
set search_path='pg_catalog','public','extensions'
as $$
declare a record; o record; v_result jsonb;
begin
  select sa.* into a
  from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select id,branch into o from public.smart_purchase_orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;

  if exists(
    select 1
    from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x
    join public.supplier_product_offers s on s.id=(x->>'offer_id')::uuid
    where greatest(0,coalesce(s.net_unit_cost,0))<=0
  ) then return jsonb_build_object('ok',false,'error','supplier_offer_missing_cost'); end if;

  v_result:=public.smart_purchase_apply_supplier_plan_guarded_v2(p_session_token,p_order_id,p_items);
  if coalesce((v_result->>'ok')::boolean,false)=false then return v_result; end if;

  update public.smart_purchase_order_items i
  set cost_source='supplier_offer',cost_verified_at=now(),
      cost_verified_by_account_id=a.id,cost_verified_by_name=a.display_name,updated_at=now()
  from jsonb_array_elements(p_items) x
  where i.order_id=p_order_id and i.id=(x->>'item_id')::uuid
    and coalesce(i.expected_unit_cost,0)>0;
  return v_result;
end $$;

create or replace function public.smart_purchase_verify_order_costs_v2(
  p_session_token text,p_order_id uuid
) returns jsonb
language plpgsql security definer
set search_path='pg_catalog','public','extensions'
as $$
declare a record; o record; v_count integer:=0;
begin
  select sa.* into a
  from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing') then return jsonb_build_object('ok',false,'error','forbidden'); end if;

  select id,branch,status into o from public.smart_purchase_orders where id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;
  if coalesce(o.status,'مسودة') not in ('مسودة','تم التحليل','draft') then return jsonb_build_object('ok',false,'error','order_items_locked'); end if;

  if exists(
    select 1 from public.smart_purchase_order_items i
    where i.order_id=p_order_id and coalesce(i.approved_quantity,0)>0 and coalesce(i.expected_unit_cost,0)<=0
  ) then return jsonb_build_object('ok',false,'error','items_without_cost'); end if;

  update public.smart_purchase_order_items
  set cost_verified_at=now(),cost_verified_by_account_id=a.id,cost_verified_by_name=a.display_name,updated_at=now()
  where order_id=p_order_id and coalesce(approved_quantity,0)>0
    and coalesce(expected_unit_cost,0)>0 and cost_verified_at is null;
  get diagnostics v_count=row_count;

  return jsonb_build_object('ok',true,'data',jsonb_build_object('verified',v_count));
end $$;

create or replace function public.smart_purchase_approve_order_cost_guarded_v2(
  p_session_token text,p_order_id uuid
) returns jsonb
language plpgsql security definer
set search_path='pg_catalog','public','extensions'
as $$
declare a record; o record;
begin
  select sa.* into a
  from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select id,branch into o from public.smart_purchase_orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;

  if exists(
    select 1 from public.smart_purchase_order_items i
    where i.order_id=p_order_id and coalesce(i.approved_quantity,0)>0 and coalesce(i.expected_unit_cost,0)<=0
  ) then return jsonb_build_object('ok',false,'error','items_without_cost'); end if;

  if exists(
    select 1 from public.smart_purchase_order_items i
    where i.order_id=p_order_id and coalesce(i.approved_quantity,0)>0
      and coalesce(i.expected_unit_cost,0)>0 and i.cost_verified_at is null
  ) then return jsonb_build_object('ok',false,'error','unverified_item_costs'); end if;

  return public.smart_purchase_approve_order_package_guarded_v2(p_session_token,p_order_id);
end $$;

revoke all on function public.smart_purchase_apply_item_plan_cost_guarded_v2(text,uuid,jsonb) from public;
revoke all on function public.smart_purchase_apply_supplier_plan_cost_guarded_v2(text,uuid,jsonb) from public;
revoke all on function public.smart_purchase_verify_order_costs_v2(text,uuid) from public;
revoke all on function public.smart_purchase_approve_order_cost_guarded_v2(text,uuid) from public;
grant execute on function public.smart_purchase_apply_item_plan_cost_guarded_v2(text,uuid,jsonb) to anon,authenticated;
grant execute on function public.smart_purchase_apply_supplier_plan_cost_guarded_v2(text,uuid,jsonb) to anon,authenticated;
grant execute on function public.smart_purchase_verify_order_costs_v2(text,uuid) to anon,authenticated;
grant execute on function public.smart_purchase_approve_order_cost_guarded_v2(text,uuid) to anon,authenticated;
