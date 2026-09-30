create or replace function public.smart_purchase_resolve_receiving_item_v1(
  p_session_token text,p_order_id uuid,p_item_id uuid,p_resolution_status text,p_note text default null
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','public','extensions'
as $$
declare a record; o record; i public.smart_purchase_order_items%rowtype; v_resolution text:=trim(coalesce(p_resolution_status,''));
begin
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if a.role not in ('general_manager','branch_manager','purchasing','accountant','invoice_reviewer') then return jsonb_build_object('ok',false,'error','forbidden'); end if;
  select id,branch,status into o from public.smart_purchase_orders where id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;
  if not exists(select 1 from public.purchase_order_receipts r where r.order_id=p_order_id) then
    return jsonb_build_object('ok',false,'error','receiving_not_started');
  end if;
  select * into i from public.smart_purchase_order_items where id=p_item_id and order_id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','item_not_found'); end if;
  if v_resolution not in ('accepted_ok','accepted_shortage','accepted_overage','accepted_price_variance','accepted_invoice_variance','followup_required') then
    return jsonb_build_object('ok',false,'error','invalid_resolution');
  end if;
  update public.smart_purchase_order_items
  set resolution_status=v_resolution,resolution_note=nullif(trim(coalesce(p_note,'')),''),
      resolved_at=now(),resolved_by_account_id=a.id,resolved_by_name=a.display_name,updated_at=now()
  where id=p_item_id and order_id=p_order_id;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('item_id',p_item_id,'resolution_status',v_resolution,'resolved_by_name',a.display_name,'resolved_at',now()));
end $$;
