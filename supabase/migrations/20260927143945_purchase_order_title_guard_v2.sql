-- Restrict purchase order title edits to the owning branch and editable workflow states.

CREATE OR REPLACE FUNCTION public.smart_purchase_update_order_title_v2(p_session_token text, p_order_id uuid, p_title text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  a record;
  o public.smart_purchase_orders%rowtype;
  v_title text:=trim(coalesce(p_title,''));
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
  if a.role not in ('general_manager','branch_manager','purchasing') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  if char_length(v_title)<2 or char_length(v_title)>120 then
    return jsonb_build_object('ok',false,'error','invalid_title');
  end if;

  select * into o
  from public.smart_purchase_orders
  where id=p_order_id
  for update;

  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;
  if coalesce(o.status,'مسودة') not in ('مسودة','تم التحليل','draft') then
    return jsonb_build_object('ok',false,'error','order_title_locked');
  end if;

  update public.smart_purchase_orders
  set title=v_title,updated_at=now()
  where id=p_order_id;

  return jsonb_build_object('ok',true,'data',jsonb_build_object('id',p_order_id,'title',v_title));
end $function$


revoke all on function public.smart_purchase_update_order_title_v2(text,uuid,text) from public;
grant execute on function public.smart_purchase_update_order_title_v2(text,uuid,text) to anon,authenticated;
