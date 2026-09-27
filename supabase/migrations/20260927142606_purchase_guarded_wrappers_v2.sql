-- Branch-guarded wrappers for purchase V2 mutations and policy reads.

CREATE OR REPLACE FUNCTION public.smart_purchase_apply_item_plan_guarded_v2(p_session_token text, p_order_id uuid, p_items jsonb)
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
  return public.smart_purchase_apply_item_plan_v2(p_session_token,p_order_id,p_items);
end $function$


CREATE OR REPLACE FUNCTION public.smart_purchase_apply_supplier_plan_guarded_v2(p_session_token text, p_order_id uuid, p_items jsonb)
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
  return public.smart_purchase_apply_supplier_plan_v2(p_session_token,p_order_id,p_items);
end $function$


CREATE OR REPLACE FUNCTION public.smart_purchase_approve_order_guarded_v2(p_session_token text, p_order_id uuid)
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
  return public.smart_purchase_approve_order_v2(p_session_token,p_order_id);
end $function$


CREATE OR REPLACE FUNCTION public.smart_purchase_branch_policy_guarded_v2(p_session_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare a record; v_branch text;
begin
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  v_branch:=nullif(trim(p_payload->>'branch'),'');
  if v_branch is null then return jsonb_build_object('ok',false,'error','branch_required'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,v_branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;
  return public.smart_purchase_branch_policy_v2(p_session_token,p_action,p_payload);
end $function$


CREATE OR REPLACE FUNCTION public.smart_purchase_order_evaluation_guarded_v2(p_session_token text, p_order_id uuid)
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
  return public.smart_purchase_order_evaluation_v2(p_session_token,p_order_id);
end $function$


CREATE OR REPLACE FUNCTION public.smart_purchase_product_policies_guarded_v2(p_session_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare a record; v_branch text;
begin
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  v_branch:=nullif(trim(p_payload->>'branch'),'');
  if v_branch is null then return jsonb_build_object('ok',false,'error','branch_required'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,v_branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;
  return public.smart_purchase_product_policies_v2(p_session_token,p_action,p_payload);
end $function$


CREATE OR REPLACE FUNCTION public.smart_purchase_set_order_policy_guarded_v2(p_session_token text, p_order_id uuid, p_minimum_order_value numeric DEFAULT 0, p_maximum_order_value numeric DEFAULT 0)
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
  return public.smart_purchase_set_order_policy_v2(p_session_token,p_order_id,p_minimum_order_value,p_maximum_order_value);
end $function$


CREATE OR REPLACE FUNCTION public.smart_purchase_supplier_dispatch_guarded_v2(p_session_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare a record; o record; v_order_id uuid;
begin
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  v_order_id:=nullif(p_payload->>'order_id','')::uuid;
  if v_order_id is null then return jsonb_build_object('ok',false,'error','order_required'); end if;
  select id,branch into o from public.smart_purchase_orders where id=v_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;
  return public.smart_purchase_supplier_dispatch_v2(p_session_token,p_action,p_payload);
end $function$


revoke all on function public.smart_purchase_set_order_policy_guarded_v2(text,uuid,numeric,numeric) from public;
revoke all on function public.smart_purchase_apply_item_plan_guarded_v2(text,uuid,jsonb) from public;
revoke all on function public.smart_purchase_approve_order_guarded_v2(text,uuid) from public;
revoke all on function public.smart_purchase_apply_supplier_plan_guarded_v2(text,uuid,jsonb) from public;
revoke all on function public.smart_purchase_supplier_dispatch_guarded_v2(text,text,jsonb) from public;
revoke all on function public.smart_purchase_branch_policy_guarded_v2(text,text,jsonb) from public;
revoke all on function public.smart_purchase_product_policies_guarded_v2(text,text,jsonb) from public;
revoke all on function public.smart_purchase_order_evaluation_guarded_v2(text,uuid) from public;
grant execute on function public.smart_purchase_set_order_policy_guarded_v2(text,uuid,numeric,numeric) to anon,authenticated;
grant execute on function public.smart_purchase_apply_item_plan_guarded_v2(text,uuid,jsonb) to anon,authenticated;
grant execute on function public.smart_purchase_approve_order_guarded_v2(text,uuid) to anon,authenticated;
grant execute on function public.smart_purchase_apply_supplier_plan_guarded_v2(text,uuid,jsonb) to anon,authenticated;
grant execute on function public.smart_purchase_supplier_dispatch_guarded_v2(text,text,jsonb) to anon,authenticated;
grant execute on function public.smart_purchase_branch_policy_guarded_v2(text,text,jsonb) to anon,authenticated;
grant execute on function public.smart_purchase_product_policies_guarded_v2(text,text,jsonb) to anon,authenticated;
grant execute on function public.smart_purchase_order_evaluation_guarded_v2(text,uuid) to anon,authenticated;
