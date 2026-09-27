-- Branch-guarded supplier decision reads.

CREATE OR REPLACE FUNCTION public.smart_purchase_supplier_allocation_plan_guarded_v2(p_session_token text, p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare a record; o record;
begin
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select id,branch into o from public.smart_purchase_orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;
  return public.smart_purchase_supplier_allocation_plan_v1(p_session_token,p_order_id);
end $function$


CREATE OR REPLACE FUNCTION public.smart_purchase_supplier_decision_guarded_v2(p_session_token text, p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare a record; o record;
begin
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select id,branch into o from public.smart_purchase_orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;
  return public.smart_purchase_supplier_decision_v2(p_session_token,p_order_id);
end $function$


revoke all on function public.smart_purchase_supplier_decision_guarded_v2(text,uuid) from public;
revoke all on function public.smart_purchase_supplier_allocation_plan_guarded_v2(text,uuid) from public;
grant execute on function public.smart_purchase_supplier_decision_guarded_v2(text,uuid) to anon,authenticated;
grant execute on function public.smart_purchase_supplier_allocation_plan_guarded_v2(text,uuid) to anon,authenticated;
