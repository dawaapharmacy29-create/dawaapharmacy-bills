create or replace function public.smart_purchase_apply_supplier_plan_policy_guarded_v2(
  p_session_token text,
  p_order_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','extensions'
as $$
declare
  a record;
  o record;
  v_invalid integer:=0;
  v_result jsonb;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select id,branch,status into o from public.smart_purchase_orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then return jsonb_build_object('ok',false,'error','invalid_items'); end if;

  with plan as materialized (
    select (x->>'item_id')::uuid item_id,(x->>'offer_id')::uuid offer_id,
      case when x ? 'approved_quantity'
        then greatest(0,floor(coalesce(nullif(x->>'approved_quantity','')::numeric,0)))
        else null end approved_quantity
    from jsonb_array_elements(p_items) x
  ), candidate as (
    select i.id,
      coalesce(p.approved_quantity,i.approved_quantity,0) next_qty,
      greatest(0,coalesce(i.minimum_order_quantity,0)) internal_min,
      greatest(0,coalesce(i.maximum_order_quantity,0)) internal_max,
      greatest(0,coalesce(i.package_multiple,0)) package_multiple,
      greatest(0,coalesce(s.minimum_order_quantity,0)) supplier_moq,
      greatest(0,coalesce(s.available_quantity,0)) available_quantity,
      coalesce(s.is_available,true) is_available,s.valid_until,
      greatest(0,coalesce(s.net_unit_cost,0)) net_unit_cost
    from plan p
    join public.smart_purchase_order_items i on i.id=p.item_id and i.order_id=p_order_id
    join public.supplier_product_offers s on s.id=p.offer_id
  )
  select count(*) into v_invalid
  from candidate
  where is_available=false
     or (valid_until is not null and valid_until<current_date)
     or net_unit_cost<=0
     or (next_qty>0 and internal_min>0 and next_qty<internal_min)
     or (next_qty>0 and internal_max>0 and next_qty>internal_max)
     or (next_qty>0 and supplier_moq>0 and next_qty<supplier_moq)
     or (next_qty>0 and package_multiple>1 and mod(next_qty,package_multiple)<>0)
     or (available_quantity>0 and next_qty>available_quantity);

  if v_invalid>0 then return jsonb_build_object('ok',false,'error','supplier_plan_policy_violation','invalid_items',v_invalid); end if;

  v_result:=public.smart_purchase_apply_supplier_plan_cost_guarded_v2(p_session_token,p_order_id,p_items);
  return v_result;
end $$;

revoke all on function public.smart_purchase_apply_supplier_plan_policy_guarded_v2(text,uuid,jsonb) from public;
grant execute on function public.smart_purchase_apply_supplier_plan_policy_guarded_v2(text,uuid,jsonb) to anon,authenticated;
