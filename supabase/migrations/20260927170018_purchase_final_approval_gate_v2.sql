create or replace function public.smart_purchase_approval_readiness_v2(
  p_session_token text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','extensions'
as $$
declare
  a record;
  o public.smart_purchase_orders%rowtype;
  v_total numeric:=0;
  v_header numeric:=0;
  v_min numeric:=0;
  v_max numeric:=0;
  v_active integer:=0;
  v_missing_supplier integer:=0;
  v_missing_cost integer:=0;
  v_unverified_cost integer:=0;
  v_limit_violations integer:=0;
  v_package_violations integer:=0;
  v_header_gap numeric:=0;
  v_ready boolean:=false;
begin
  select sa.* into a
  from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  select * into o from public.smart_purchase_orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;

  select
    count(*) filter(where coalesce(i.approved_quantity,0)>0),
    count(*) filter(where coalesce(i.approved_quantity,0)>0 and nullif(trim(coalesce(i.supplier_name,'')),'') is null),
    count(*) filter(where coalesce(i.approved_quantity,0)>0 and coalesce(i.expected_unit_cost,0)<=0),
    count(*) filter(where coalesce(i.approved_quantity,0)>0 and coalesce(i.expected_unit_cost,0)>0 and i.cost_verified_at is null),
    count(*) filter(where
      (coalesce(i.minimum_order_quantity,0)>0 and coalesce(i.maximum_order_quantity,0)>0 and i.minimum_order_quantity>i.maximum_order_quantity)
      or (coalesce(i.approved_quantity,0)>0 and coalesce(i.minimum_order_quantity,0)>0 and i.approved_quantity<i.minimum_order_quantity)
      or (coalesce(i.approved_quantity,0)>0 and coalesce(i.maximum_order_quantity,0)>0 and i.approved_quantity>i.maximum_order_quantity)
    ),
    count(*) filter(where coalesce(i.approved_quantity,0)>0 and coalesce(i.package_multiple,0)>1 and mod(i.approved_quantity,i.package_multiple)<>0),
    coalesce(sum(greatest(0,coalesce(i.approved_quantity,0))*greatest(0,coalesce(i.expected_unit_cost,0))),0)
  into v_active,v_missing_supplier,v_missing_cost,v_unverified_cost,v_limit_violations,v_package_violations,v_total
  from public.smart_purchase_order_items i where i.order_id=p_order_id;

  v_header:=coalesce(o.approved_total,o.expected_total,0);
  v_header_gap:=abs(v_header-v_total);
  v_min:=greatest(coalesce(o.minimum_order_value,0),0);
  v_max:=greatest(coalesce(o.maximum_order_value,0),coalesce(o.budget,0),0);

  v_ready :=
    coalesce(o.status,'مسودة') in ('مسودة','تم التحليل','draft')
    and v_active>0
    and v_missing_supplier=0
    and v_missing_cost=0
    and v_unverified_cost=0
    and v_limit_violations=0
    and v_package_violations=0
    and v_total>0
    and (v_min<=0 or v_total>=v_min-0.01)
    and (v_max<=0 or v_total<=v_max+0.01)
    and v_header_gap<=0.01;

  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'ready',v_ready,'order_id',p_order_id,'status',o.status,'active_items',v_active,
    'missing_supplier_items',v_missing_supplier,'missing_cost_items',v_missing_cost,
    'unverified_cost_items',v_unverified_cost,'limit_violations',v_limit_violations,
    'package_violations',v_package_violations,'calculated_total',v_total,'stored_total',v_header,
    'header_gap',v_header_gap,'minimum_order_value',v_min,'maximum_order_value',v_max,
    'below_minimum',(v_min>0 and v_total<v_min-0.01),
    'above_maximum',(v_max>0 and v_total>v_max+0.01),
    'status_editable',(coalesce(o.status,'مسودة') in ('مسودة','تم التحليل','draft'))
  ));
end $$;

create or replace function public.smart_purchase_approve_order_final_guarded_v2(
  p_session_token text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','extensions'
as $$
declare v_check jsonb; c jsonb;
begin
  v_check:=public.smart_purchase_approval_readiness_v2(p_session_token,p_order_id);
  if coalesce((v_check->>'ok')::boolean,false)=false then return v_check; end if;
  c:=v_check->'data';

  if coalesce((c->>'status_editable')::boolean,false)=false then return jsonb_build_object('ok',false,'error','order_not_approvable','readiness',c); end if;
  if coalesce((c->>'active_items')::int,0)<=0 then return jsonb_build_object('ok',false,'error','empty_order','readiness',c); end if;
  if coalesce((c->>'missing_supplier_items')::int,0)>0 then return jsonb_build_object('ok',false,'error','items_without_supplier','readiness',c); end if;
  if coalesce((c->>'missing_cost_items')::int,0)>0 then return jsonb_build_object('ok',false,'error','items_without_cost','readiness',c); end if;
  if coalesce((c->>'unverified_cost_items')::int,0)>0 then return jsonb_build_object('ok',false,'error','unverified_item_costs','readiness',c); end if;
  if coalesce((c->>'limit_violations')::int,0)>0 then return jsonb_build_object('ok',false,'error','item_limits_violation','readiness',c); end if;
  if coalesce((c->>'package_violations')::int,0)>0 then return jsonb_build_object('ok',false,'error','package_multiple_violation','readiness',c); end if;
  if coalesce((c->>'below_minimum')::boolean,false) then return jsonb_build_object('ok',false,'error','order_below_minimum','readiness',c); end if;
  if coalesce((c->>'above_maximum')::boolean,false) then return jsonb_build_object('ok',false,'error','order_above_maximum','readiness',c); end if;
  if coalesce((c->>'header_gap')::numeric,0)>0.01 then return jsonb_build_object('ok',false,'error','order_total_mismatch','readiness',c); end if;

  return public.smart_purchase_approve_order_cost_guarded_v2(p_session_token,p_order_id);
end $$;

revoke all on function public.smart_purchase_approval_readiness_v2(text,uuid) from public;
revoke all on function public.smart_purchase_approve_order_final_guarded_v2(text,uuid) from public;
grant execute on function public.smart_purchase_approval_readiness_v2(text,uuid) to anon,authenticated;
grant execute on function public.smart_purchase_approve_order_final_guarded_v2(text,uuid) to anon,authenticated;
