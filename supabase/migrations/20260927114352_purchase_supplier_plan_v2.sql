-- Apply reviewed supplier recommendations atomically while enforcing purchase limits.
create or replace function public.smart_purchase_apply_supplier_plan_v2(
  p_session_token text,p_order_id uuid,p_items jsonb
) returns jsonb
language plpgsql security definer
set search_path='pg_catalog','public','extensions'
as $$
declare
  v_account record; v_order public.smart_purchase_orders%rowtype;
  v_expected integer:=0; v_valid integer:=0; v_invalid integer:=0;
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

  select count(*) into v_expected from jsonb_array_elements(p_items);
  if v_expected=0 then return jsonb_build_object('ok',false,'error','empty_plan'); end if;

  with plan as materialized (
    select (x->>'item_id')::uuid item_id,(x->>'offer_id')::uuid offer_id,
      case when x?'approved_quantity' then greatest(0,floor(coalesce(nullif(x->>'approved_quantity','')::numeric,0))) end approved_quantity
    from jsonb_array_elements(p_items) x
  ), checked as (
    select p.*,i.product_code,i.product_name,i.minimum_order_quantity,i.maximum_order_quantity,
      o.supplier_name,o.product_code offer_product_code,o.product_name offer_product_name,
      o.net_unit_cost,o.discount_percent,o.minimum_order_quantity supplier_moq,
      o.available_quantity,o.valid_until,o.is_available
    from plan p
    join public.smart_purchase_order_items i on i.id=p.item_id and i.order_id=p_order_id
    join public.supplier_product_offers o on o.id=p.offer_id
  )
  select count(*) into v_valid from checked c
  where coalesce(c.is_available,true)=true and (c.valid_until is null or c.valid_until>=current_date)
    and ((nullif(trim(c.product_code),'') is not null and c.offer_product_code=c.product_code)
      or lower(regexp_replace(trim(c.offer_product_name),'[\s_\-]+',' ','g'))=lower(regexp_replace(trim(c.product_name),'[\s_\-]+',' ','g')));
  if v_valid<>v_expected then return jsonb_build_object('ok',false,'error','supplier_plan_invalid_offer','submitted',v_expected,'valid',v_valid); end if;

  with plan as materialized (
    select (x->>'item_id')::uuid item_id,(x->>'offer_id')::uuid offer_id,
      case when x?'approved_quantity' then greatest(0,floor(coalesce(nullif(x->>'approved_quantity','')::numeric,0))) end approved_quantity
    from jsonb_array_elements(p_items) x
  ), candidate as (
    select i.id,coalesce(p.approved_quantity,i.approved_quantity,0) next_qty,
      greatest(0,coalesce(i.minimum_order_quantity,0)) internal_min,
      greatest(0,coalesce(i.maximum_order_quantity,0)) internal_max,
      greatest(0,coalesce(o.minimum_order_quantity,0)) supplier_moq,o.available_quantity
    from plan p join public.smart_purchase_order_items i on i.id=p.item_id and i.order_id=p_order_id
    join public.supplier_product_offers o on o.id=p.offer_id
  )
  select count(*) into v_invalid from candidate
  where (next_qty>0 and internal_min>0 and next_qty<internal_min)
     or (next_qty>0 and internal_max>0 and next_qty>internal_max)
     or (next_qty>0 and supplier_moq>0 and next_qty<supplier_moq)
     or (coalesce(available_quantity,0)>0 and next_qty>available_quantity);
  if v_invalid>0 then return jsonb_build_object('ok',false,'error','supplier_plan_quantity_violation','invalid_items',v_invalid); end if;

  with plan as materialized (
    select (x->>'item_id')::uuid item_id,(x->>'offer_id')::uuid offer_id,
      case when x?'approved_quantity' then greatest(0,floor(coalesce(nullif(x->>'approved_quantity','')::numeric,0))) end approved_quantity
    from jsonb_array_elements(p_items) x
  ), resolved as (
    select i.id,coalesce(p.approved_quantity,i.approved_quantity,0) next_qty,
      o.id offer_id,o.supplier_name,greatest(0,coalesce(o.net_unit_cost,0)) unit_cost,
      greatest(0,least(100,coalesce(o.discount_percent,0))) discount_percent,
      greatest(0,coalesce(o.minimum_order_quantity,0)) supplier_moq
    from plan p join public.smart_purchase_order_items i on i.id=p.item_id and i.order_id=p_order_id
    join public.supplier_product_offers o on o.id=p.offer_id
  )
  update public.smart_purchase_order_items i
  set approved_quantity=r.next_qty,supplier_offer_id=r.offer_id,supplier_name=r.supplier_name,
      expected_unit_cost=r.unit_cost,expected_discount=r.discount_percent,expected_total=r.next_qty*r.unit_cost,
      supplier_reason=case when r.supplier_moq>0 then 'اختيار معتمد من مقارنة الموردين — تمت مراعاة MOQ' else 'اختيار معتمد من مقارنة الموردين' end,
      manual_override=true,updated_at=now()
  from resolved r where i.id=r.id and i.order_id=p_order_id;

  select coalesce(sum(greatest(0,coalesce(approved_quantity,0))*greatest(0,coalesce(expected_unit_cost,0))),0)
  into v_total from public.smart_purchase_order_items where order_id=p_order_id;
  v_max:=greatest(coalesce(v_order.maximum_order_value,0),coalesce(v_order.budget,0),0);
  if v_max>0 and v_total>v_max+0.01 then raise exception 'order_max_exceeded'; end if;

  update public.smart_purchase_orders set expected_total=v_total,approved_total=v_total,updated_at=now() where id=p_order_id;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('updated',v_expected,'order_total',v_total,'maximum_order_value',v_max));
exception when others then
  if sqlerrm='order_max_exceeded' then return jsonb_build_object('ok',false,'error','order_max_exceeded'); end if;
  return jsonb_build_object('ok',false,'error','apply_supplier_plan_failed','message',sqlerrm);
end $$;

revoke all on function public.smart_purchase_apply_supplier_plan_v2(text,uuid,jsonb) from public;
grant execute on function public.smart_purchase_apply_supplier_plan_v2(text,uuid,jsonb) to anon,authenticated;
