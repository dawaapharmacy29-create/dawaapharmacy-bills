-- Branch-aware guarded entrypoint for purchase imports, order creation and hydration.

CREATE OR REPLACE FUNCTION public.smart_purchase_center_guarded_v2(p_session_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  a record;
  v_branch text;
  v_import uuid;
  v_order uuid;
  v_import_branch text;
  v_order_branch text;
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

  if p_action='import' then
    v_branch:=coalesce(nullif(trim(p_payload->>'branch'),''),'دواء الشامي');
    if not public.smart_purchase_branch_allowed_v2(a.id,v_branch) then
      return jsonb_build_object('ok',false,'error','forbidden_branch');
    end if;
    return public.smart_purchase_center(p_session_token,p_action,p_payload);

  elsif p_action='create_order' then
    v_branch:=nullif(trim(p_payload->>'branch'),'');
    v_import:=nullif(p_payload->>'import_id','')::uuid;
    if v_branch is null or v_import is null then
      return jsonb_build_object('ok',false,'error','invalid_create_payload');
    end if;
    if not public.smart_purchase_branch_allowed_v2(a.id,v_branch) then
      return jsonb_build_object('ok',false,'error','forbidden_branch');
    end if;

    select branch into v_import_branch
    from public.purchase_analysis_imports
    where id=v_import;
    if not found then return jsonb_build_object('ok',false,'error','import_not_found'); end if;
    if trim(coalesce(v_import_branch,''))<>trim(v_branch) then
      return jsonb_build_object('ok',false,'error','import_branch_mismatch');
    end if;

    if exists(
      select 1 from public.smart_purchase_orders o
      where o.branch=v_branch
        and o.status in ('draft','مسودة','تم التحليل','معتمدة','تم الإرسال للمورد','partially_received','وصلت جزئيًا')
    ) then
      return jsonb_build_object('ok',false,'error','open_order_exists');
    end if;

    return public.smart_purchase_center(p_session_token,p_action,p_payload);

  elsif p_action='get_import' then
    v_import:=nullif(p_payload->>'id','')::uuid;
    select branch into v_import_branch
    from public.purchase_analysis_imports
    where id=v_import;
    if not found then return jsonb_build_object('ok',false,'error','import_not_found'); end if;
    if not public.smart_purchase_branch_allowed_v2(a.id,v_import_branch) then
      return jsonb_build_object('ok',false,'error','forbidden_branch');
    end if;
    return public.smart_purchase_center(p_session_token,p_action,p_payload);

  elsif p_action='list_imports' then
    return jsonb_build_object('ok',true,'data',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from public.purchase_analysis_imports x
      where public.smart_purchase_branch_allowed_v2(a.id,x.branch)
    ),'[]'::jsonb));

  elsif p_action='get_order' then
    v_order:=nullif(p_payload->>'id','')::uuid;
    select branch into v_order_branch from public.smart_purchase_orders where id=v_order;
    if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
    if not public.smart_purchase_branch_allowed_v2(a.id,v_order_branch) then
      return jsonb_build_object('ok',false,'error','forbidden_branch');
    end if;
    return public.smart_purchase_center(p_session_token,p_action,p_payload);

  elsif p_action='list_orders' then
    return jsonb_build_object('ok',true,'data',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from public.smart_purchase_orders x
      where public.smart_purchase_branch_allowed_v2(a.id,x.branch)
    ),'[]'::jsonb));
  end if;

  return jsonb_build_object('ok',false,'error','unsupported_action');
end $function$


revoke all on function public.smart_purchase_center_guarded_v2(text,text,jsonb) from public;
grant execute on function public.smart_purchase_center_guarded_v2(text,text,jsonb) to anon,authenticated;
