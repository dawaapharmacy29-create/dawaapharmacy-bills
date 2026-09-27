alter table public.smart_purchase_order_items
  add column if not exists resolution_status text not null default 'pending',
  add column if not exists resolution_note text,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by_account_id uuid,
  add column if not exists resolved_by_name text;

alter table public.smart_purchase_order_items
  drop constraint if exists smart_purchase_order_items_resolution_status_chk;
alter table public.smart_purchase_order_items
  add constraint smart_purchase_order_items_resolution_status_chk
  check (resolution_status in (
    'pending','accepted_ok','accepted_shortage','accepted_overage',
    'accepted_price_variance','accepted_invoice_variance','followup_required'
  ));

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

create or replace function public.smart_purchase_receiving_close_readiness_v1(
  p_session_token text,p_order_id uuid
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','public','extensions'
as $$
declare a record; o public.smart_purchase_orders%rowtype; v_active integer:=0; v_unreceived integer:=0; v_unresolved integer:=0;
v_followup integer:=0; v_qty_issues integer:=0; v_price_issues integer:=0; v_invoice_issues integer:=0; v_ready boolean:=false;
begin
  select sa.* into a from public.staff_sessions ss join public.staff_accounts sa on sa.id=ss.account_id
  where ss.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null and ss.expires_at>now() and sa.status='active'
  order by ss.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into o from public.smart_purchase_orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then return jsonb_build_object('ok',false,'error','forbidden_branch'); end if;
  select
    count(*) filter(where coalesce(i.approved_quantity,0)>0),
    count(*) filter(where coalesce(i.approved_quantity,0)>0 and coalesce(i.received_quantity,0)<=0),
    count(*) filter(where coalesce(i.approved_quantity,0)>0 and coalesce(i.resolution_status,'pending')='pending'),
    count(*) filter(where coalesce(i.approved_quantity,0)>0 and i.resolution_status='followup_required'),
    count(*) filter(where coalesce(i.approved_quantity,0)>0 and coalesce(i.received_quantity,0)<>coalesce(i.approved_quantity,0)),
    count(*) filter(where coalesce(i.approved_quantity,0)>0 and coalesce(i.actual_unit_cost,0)>0 and coalesce(i.expected_unit_cost,0)>0
      and abs(i.actual_unit_cost-i.expected_unit_cost)>greatest(0.01,i.expected_unit_cost*0.03)),
    count(*) filter(where coalesce(i.approved_quantity,0)>0 and coalesce(i.invoiced_quantity,0)<>coalesce(i.received_quantity,0))
  into v_active,v_unreceived,v_unresolved,v_followup,v_qty_issues,v_price_issues,v_invoice_issues
  from public.smart_purchase_order_items i where i.order_id=p_order_id;
  v_ready:=v_active>0 and v_unresolved=0 and v_followup=0;
  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'ready',v_ready,'active_items',v_active,'unreceived_items',v_unreceived,'unresolved_items',v_unresolved,
    'followup_items',v_followup,'quantity_issue_items',v_qty_issues,'price_issue_items',v_price_issues,'invoice_issue_items',v_invoice_issues
  ));
end $$;

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
  if coalesce(o.status,'') not in ('received','partially_received','وصلت جزئيًا','تم الإرسال للمورد','معتمدة') then return jsonb_build_object('ok',false,'error','order_not_closable','status',o.status); end if;
  v_check:=public.smart_purchase_receiving_close_readiness_v1(p_session_token,p_order_id);
  if coalesce((v_check->>'ok')::boolean,false)=false then return v_check; end if;
  c:=v_check->'data';
  if coalesce((c->>'unresolved_items')::int,0)>0 then return jsonb_build_object('ok',false,'error','receiving_items_unresolved','readiness',c); end if;
  if coalesce((c->>'followup_items')::int,0)>0 then return jsonb_build_object('ok',false,'error','receiving_followup_open','readiness',c); end if;
  if coalesce((c->>'active_items')::int,0)<=0 then return jsonb_build_object('ok',false,'error','empty_order','readiness',c); end if;
  update public.smart_purchase_orders set status='مغلقة',updated_at=now() where id=p_order_id;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('order_id',p_order_id,'status','مغلقة','closed_by_name',a.display_name,'closed_at',now()));
end $$;

revoke all on function public.smart_purchase_resolve_receiving_item_v1(text,uuid,uuid,text,text) from public;
revoke all on function public.smart_purchase_receiving_close_readiness_v1(text,uuid) from public;
revoke all on function public.smart_purchase_close_order_v1(text,uuid) from public;
grant execute on function public.smart_purchase_resolve_receiving_item_v1(text,uuid,uuid,text,text) to anon,authenticated;
grant execute on function public.smart_purchase_receiving_close_readiness_v1(text,uuid) to anon,authenticated;
grant execute on function public.smart_purchase_close_order_v1(text,uuid) to anon,authenticated;
