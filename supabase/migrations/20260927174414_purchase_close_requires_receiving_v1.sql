create or replace function public.smart_purchase_close_order_v1(
  p_session_token text,p_order_id uuid
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','public','extensions'
as $$
declare a record; o public.smart_purchase_orders%rowtype; v_check jsonb; c jsonb;
begin
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing','accountant') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
  select * into o from public.smart_purchase_orders where id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;
  if coalesce(o.status,'') not in ('received','partially_received','وصلت جزئيًا','وصلت بالكامل') then
    return jsonb_build_object('ok',false,'error','order_not_closable','status',o.status);
  end if;
  if not exists(select 1 from public.purchase_order_receipts r where r.order_id=p_order_id) then
    return jsonb_build_object('ok',false,'error','receiving_not_started');
  end if;
  v_check:=public.smart_purchase_receiving_close_readiness_v1(p_session_token,p_order_id);
  if coalesce((v_check->>'ok')::boolean,false)=false then return v_check; end if;
  c:=v_check->'data';
  if coalesce((c->>'unresolved_items')::int,0)>0 then return jsonb_build_object('ok',false,'error','receiving_items_unresolved','readiness',c); end if;
  if coalesce((c->>'followup_items')::int,0)>0 then return jsonb_build_object('ok',false,'error','receiving_followup_open','readiness',c); end if;
  if coalesce((c->>'active_items')::int,0)<=0 then return jsonb_build_object('ok',false,'error','empty_order','readiness',c); end if;
  update public.smart_purchase_orders set status='مغلقة',updated_at=now() where id=p_order_id;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('order_id',p_order_id,'status','مغلقة','closed_by_name',a.display_name,'closed_at',now()));
end $$;
