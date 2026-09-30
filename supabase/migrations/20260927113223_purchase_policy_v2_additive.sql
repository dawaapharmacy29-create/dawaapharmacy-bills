-- Purchase policy V2: additive, backward-compatible controls for item and order limits.

alter table public.smart_purchase_order_items
  add column if not exists minimum_order_quantity numeric not null default 0,
  add column if not exists maximum_order_quantity numeric not null default 0;

alter table public.smart_purchase_orders
  add column if not exists minimum_order_value numeric not null default 0,
  add column if not exists maximum_order_value numeric not null default 0;

update public.smart_purchase_orders
set maximum_order_value = greatest(coalesce(budget, 0), 0)
where coalesce(maximum_order_value, 0) = 0 and coalesce(budget, 0) > 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='smart_purchase_order_items_limits_v2_chk') then
    alter table public.smart_purchase_order_items
      add constraint smart_purchase_order_items_limits_v2_chk
      check (
        minimum_order_quantity >= 0 and maximum_order_quantity >= 0
        and (minimum_order_quantity=0 or maximum_order_quantity=0 or minimum_order_quantity<=maximum_order_quantity)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname='smart_purchase_orders_value_limits_v2_chk') then
    alter table public.smart_purchase_orders
      add constraint smart_purchase_orders_value_limits_v2_chk
      check (
        minimum_order_value >= 0 and maximum_order_value >= 0
        and (minimum_order_value=0 or maximum_order_value=0 or minimum_order_value<=maximum_order_value)
      );
  end if;
end $$;

create or replace function public.smart_purchase_set_order_policy_v2(
  p_session_token text, p_order_id uuid,
  p_minimum_order_value numeric default 0,
  p_maximum_order_value numeric default 0
) returns jsonb
language plpgsql security definer
set search_path='pg_catalog','public','extensions'
as $$
declare
  v_account record; v_order public.smart_purchase_orders%rowtype;
  v_min numeric:=greatest(coalesce(p_minimum_order_value,0),0);
  v_max numeric:=greatest(coalesce(p_maximum_order_value,0),0);
  v_total numeric:=0;
begin
  select sa.* into v_account
  from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_account.role not in ('general_manager','branch_manager','purchasing') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
  if v_min>0 and v_max>0 and v_min>v_max then return jsonb_build_object('ok',false,'error','order_min_exceeds_max'); end if;

  select * into v_order from public.smart_purchase_orders where id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if coalesce(v_order.status,'مسودة') not in ('مسودة','تم التحليل','draft') then return jsonb_build_object('ok',false,'error','order_policy_locked'); end if;

  select coalesce(sum(greatest(0,coalesce(i.approved_quantity,0))*greatest(0,coalesce(i.expected_unit_cost,0))),0)
  into v_total from public.smart_purchase_order_items i where i.order_id=p_order_id;

  update public.smart_purchase_orders
  set minimum_order_value=v_min, maximum_order_value=v_max, budget=nullif(v_max,0),
      expected_total=v_total, approved_total=v_total, updated_at=now()
  where id=p_order_id;

  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'order_id',p_order_id,'minimum_order_value',v_min,'maximum_order_value',v_max,
    'order_total',v_total,'below_minimum',(v_min>0 and v_total<v_min),'above_maximum',(v_max>0 and v_total>v_max)
  ));
end $$;

create or replace function public.smart_purchase_apply_item_plan_v2(
  p_session_token text, p_order_id uuid, p_items jsonb
) returns jsonb
language plpgsql security definer
set search_path='pg_catalog','public','extensions'
as $$
declare
  v_account record; v_order public.smart_purchase_orders%rowtype;
  v_submitted integer:=0; v_matched integer:=0; v_invalid integer:=0;
  v_total numeric:=0; v_max numeric:=0;
begin
  if jsonb_typeof(p_items)<>'array' then return jsonb_build_object('ok',false,'error','invalid_items'); end if;
  select sa.* into v_account
  from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_account.role not in ('general_manager','branch_manager','purchasing') then return jsonb_build_object('ok',false,'error','forbidden'); end if;

  select * into v_order from public.smart_purchase_orders where id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if coalesce(v_order.status,'مسودة') not in ('مسودة','تم التحليل','draft') then return jsonb_build_object('ok',false,'error','order_items_locked'); end if;

  select count(*) into v_submitted from jsonb_array_elements(p_items);
  if v_submitted=0 then return jsonb_build_object('ok',false,'error','empty_plan'); end if;

  with plan as materialized (
    select (x->>'id')::uuid id from jsonb_array_elements(p_items) x
  )
  select count(*) into v_matched
  from plan p join public.smart_purchase_order_items i on i.id=p.id and i.order_id=p_order_id;
  if v_matched<>v_submitted then return jsonb_build_object('ok',false,'error','item_plan_mismatch','submitted',v_submitted,'matched',v_matched); end if;

  with plan as materialized (
    select
      (x->>'id')::uuid id,
      x?'approved_quantity' has_qty, greatest(0,floor(coalesce(nullif(x->>'approved_quantity','')::numeric,0))) qty,
      x?'minimum_order_quantity' has_min, greatest(0,floor(coalesce(nullif(x->>'minimum_order_quantity','')::numeric,0))) min_qty,
      x?'maximum_order_quantity' has_max, greatest(0,floor(coalesce(nullif(x->>'maximum_order_quantity','')::numeric,0))) max_qty
    from jsonb_array_elements(p_items) x
  ), candidate as (
    select i.id,
      case when p.has_qty then p.qty else greatest(0,coalesce(i.approved_quantity,0)) end next_qty,
      case when p.has_min then p.min_qty else greatest(0,coalesce(i.minimum_order_quantity,0)) end next_min,
      case when p.has_max then p.max_qty else greatest(0,coalesce(i.maximum_order_quantity,0)) end next_max
    from public.smart_purchase_order_items i join plan p on p.id=i.id where i.order_id=p_order_id
  )
  select count(*) into v_invalid from candidate
  where (next_min>0 and next_max>0 and next_min>next_max)
     or (next_qty>0 and next_min>0 and next_qty<next_min)
     or (next_qty>0 and next_max>0 and next_qty>next_max);
  if v_invalid>0 then return jsonb_build_object('ok',false,'error','item_limits_violation','invalid_items',v_invalid); end if;

  with plan as materialized (
    select
      (x->>'id')::uuid id,
      x?'approved_quantity' has_qty, greatest(0,floor(coalesce(nullif(x->>'approved_quantity','')::numeric,0))) qty,
      x?'expected_unit_cost' has_cost, greatest(0,coalesce(nullif(x->>'expected_unit_cost','')::numeric,0)) cost,
      x?'expected_discount' has_discount, least(100,greatest(0,coalesce(nullif(x->>'expected_discount','')::numeric,0))) discount,
      x?'minimum_order_quantity' has_min, greatest(0,floor(coalesce(nullif(x->>'minimum_order_quantity','')::numeric,0))) min_qty,
      x?'maximum_order_quantity' has_max, greatest(0,floor(coalesce(nullif(x->>'maximum_order_quantity','')::numeric,0))) max_qty,
      x?'supplier_name' has_supplier, nullif(trim(x->>'supplier_name'),'') supplier_name
    from jsonb_array_elements(p_items) x
  ), candidate as (
    select i.id,
      case when p.has_qty then p.qty else greatest(0,coalesce(i.approved_quantity,0)) end next_qty,
      case when p.has_cost then p.cost else greatest(0,coalesce(i.expected_unit_cost,0)) end next_cost,
      case when p.has_discount then p.discount else greatest(0,coalesce(i.expected_discount,0)) end next_discount,
      case when p.has_min then p.min_qty else greatest(0,coalesce(i.minimum_order_quantity,0)) end next_min,
      case when p.has_max then p.max_qty else greatest(0,coalesce(i.maximum_order_quantity,0)) end next_max,
      case when p.has_supplier then p.supplier_name else i.supplier_name end next_supplier
    from public.smart_purchase_order_items i join plan p on p.id=i.id where i.order_id=p_order_id
  )
  update public.smart_purchase_order_items i
  set approved_quantity=c.next_qty, expected_unit_cost=c.next_cost, expected_discount=c.next_discount,
      minimum_order_quantity=c.next_min, maximum_order_quantity=c.next_max, supplier_name=c.next_supplier,
      expected_total=c.next_qty*c.next_cost, manual_override=true, updated_at=now()
  from candidate c where i.id=c.id and i.order_id=p_order_id;

  select coalesce(sum(greatest(0,coalesce(i.approved_quantity,0))*greatest(0,coalesce(i.expected_unit_cost,0))),0)
  into v_total from public.smart_purchase_order_items i where i.order_id=p_order_id;
  v_max:=greatest(coalesce(v_order.maximum_order_value,0),coalesce(v_order.budget,0),0);
  if v_max>0 and v_total>v_max+0.01 then raise exception 'order_max_exceeded'; end if;

  update public.smart_purchase_orders set expected_total=v_total,approved_total=v_total,updated_at=now() where id=p_order_id;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('updated',v_submitted,'order_total',v_total,'maximum_order_value',v_max));
exception when others then
  if sqlerrm='order_max_exceeded' then return jsonb_build_object('ok',false,'error','order_max_exceeded'); end if;
  return jsonb_build_object('ok',false,'error','apply_item_plan_failed','message',sqlerrm);
end $$;

create or replace function public.smart_purchase_approve_order_v2(
  p_session_token text, p_order_id uuid
) returns jsonb
language plpgsql security definer
set search_path='pg_catalog','public','extensions'
as $$
declare
  v_account record; v_order public.smart_purchase_orders%rowtype;
  v_total numeric:=0; v_min numeric:=0; v_max numeric:=0; v_invalid integer:=0;
begin
  select sa.* into v_account
  from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if v_account.role not in ('general_manager','branch_manager','purchasing') then return jsonb_build_object('ok',false,'error','forbidden'); end if;

  select * into v_order from public.smart_purchase_orders where id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if coalesce(v_order.status,'مسودة') not in ('مسودة','تم التحليل','draft') then return jsonb_build_object('ok',false,'error','order_not_approvable'); end if;

  select count(*) into v_invalid from public.smart_purchase_order_items i
  where i.order_id=p_order_id and (
    (coalesce(i.minimum_order_quantity,0)>0 and coalesce(i.maximum_order_quantity,0)>0 and i.minimum_order_quantity>i.maximum_order_quantity)
    or (coalesce(i.approved_quantity,0)>0 and coalesce(i.minimum_order_quantity,0)>0 and i.approved_quantity<i.minimum_order_quantity)
    or (coalesce(i.approved_quantity,0)>0 and coalesce(i.maximum_order_quantity,0)>0 and i.approved_quantity>i.maximum_order_quantity)
  );
  if v_invalid>0 then return jsonb_build_object('ok',false,'error','item_limits_violation','invalid_items',v_invalid); end if;
  if exists(select 1 from public.smart_purchase_order_items where order_id=p_order_id and coalesce(approved_quantity,0)>0 and coalesce(supplier_name,'')='') then
    return jsonb_build_object('ok',false,'error','items_without_supplier');
  end if;

  select coalesce(sum(greatest(0,coalesce(i.approved_quantity,0))*greatest(0,coalesce(i.expected_unit_cost,0))),0)
  into v_total from public.smart_purchase_order_items i where i.order_id=p_order_id;
  if v_total<=0 then return jsonb_build_object('ok',false,'error','empty_order'); end if;

  v_min:=greatest(coalesce(v_order.minimum_order_value,0),0);
  v_max:=greatest(coalesce(v_order.maximum_order_value,0),coalesce(v_order.budget,0),0);
  if v_min>0 and v_total<v_min-0.01 then return jsonb_build_object('ok',false,'error','order_below_minimum','order_total',v_total,'minimum_order_value',v_min); end if;
  if v_max>0 and v_total>v_max+0.01 then return jsonb_build_object('ok',false,'error','order_above_maximum','order_total',v_total,'maximum_order_value',v_max); end if;

  update public.smart_purchase_orders set status='معتمدة',expected_total=v_total,approved_total=v_total,
    approved_by_account_id=v_account.id,approved_by_name=v_account.display_name,approved_at=now(),updated_at=now()
  where id=p_order_id;
  update public.smart_purchase_order_items set status='معتمد',
    approved_by_account_id=v_account.id,approved_by_name=v_account.display_name,approved_at=now(),updated_at=now()
  where order_id=p_order_id;

  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'order_id',p_order_id,'approved_total',v_total,'minimum_order_value',v_min,'maximum_order_value',v_max
  ));
end $$;

revoke all on function public.smart_purchase_set_order_policy_v2(text,uuid,numeric,numeric) from public;
revoke all on function public.smart_purchase_apply_item_plan_v2(text,uuid,jsonb) from public;
revoke all on function public.smart_purchase_approve_order_v2(text,uuid) from public;
grant execute on function public.smart_purchase_set_order_policy_v2(text,uuid,numeric,numeric) to anon,authenticated;
grant execute on function public.smart_purchase_apply_item_plan_v2(text,uuid,jsonb) to anon,authenticated;
grant execute on function public.smart_purchase_approve_order_v2(text,uuid) to anon,authenticated;
