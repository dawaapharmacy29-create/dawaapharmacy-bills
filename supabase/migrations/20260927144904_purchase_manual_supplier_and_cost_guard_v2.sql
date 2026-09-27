-- Safe manual supplier assignment and approval guard for zero-cost active items.

CREATE OR REPLACE FUNCTION public.smart_purchase_approve_order_guarded_v2(p_session_token text, p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  a record;
  o record;
  v_missing_cost integer:=0;
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;

  select id,branch into o from public.smart_purchase_orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;

  select count(*) into v_missing_cost
  from public.smart_purchase_order_items i
  where i.order_id=p_order_id
    and coalesce(i.approved_quantity,0)>0
    and coalesce(i.expected_unit_cost,0)<=0;

  if v_missing_cost>0 then
    return jsonb_build_object('ok',false,'error','items_without_cost','invalid_items',v_missing_cost);
  end if;

  return public.smart_purchase_approve_order_v2(p_session_token,p_order_id);
end $function$


CREATE OR REPLACE FUNCTION public.smart_purchase_assign_supplier_v2(p_session_token text, p_order_id uuid, p_item_id uuid, p_supplier_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  a record;
  o public.smart_purchase_orders%rowtype;
  v_supplier text:=nullif(trim(coalesce(p_supplier_name,'')),'');
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  select * into o from public.smart_purchase_orders where id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;
  if coalesce(o.status,'مسودة') not in ('draft','مسودة','تم التحليل') then
    return jsonb_build_object('ok',false,'error','order_items_locked');
  end if;

  if not exists(
    select 1 from public.smart_purchase_order_items i
    where i.id=p_item_id and i.order_id=p_order_id
  ) then
    return jsonb_build_object('ok',false,'error','item_not_found');
  end if;

  update public.smart_purchase_order_items
  set supplier_name=v_supplier,
      supplier_offer_id=null,
      supplier_reason=case when v_supplier is null then null else 'اختيار مورد يدوي بواسطة '||coalesce(a.display_name,'المستخدم') end,
      manual_override=true,
      updated_at=now()
  where id=p_item_id and order_id=p_order_id;

  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'item_id',p_item_id,'supplier_name',v_supplier,'manual',true
  ));
end $function$


revoke all on function public.smart_purchase_assign_supplier_v2(text,uuid,uuid,text) from public;
revoke all on function public.smart_purchase_approve_order_guarded_v2(text,uuid) from public;
grant execute on function public.smart_purchase_assign_supplier_v2(text,uuid,uuid,text) to anon,authenticated;
grant execute on function public.smart_purchase_approve_order_guarded_v2(text,uuid) to anon,authenticated;
