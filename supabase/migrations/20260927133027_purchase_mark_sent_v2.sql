-- Validate supplier assignment before moving an approved purchase order to sent.
create or replace function public.smart_purchase_mark_sent_v2(
  p_session_token text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','extensions'
as $$
declare
  a record;
  o public.smart_purchase_orders%rowtype;
  v_suppliers integer:=0;
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
  if o.status<>'معتمدة' then
    return jsonb_build_object('ok',false,'error','order_not_ready_to_send','status',o.status);
  end if;

  if exists(
    select 1 from public.smart_purchase_order_items
    where order_id=p_order_id
      and coalesce(approved_quantity,0)>0
      and nullif(trim(coalesce(supplier_name,'')),'') is null
  ) then
    return jsonb_build_object('ok',false,'error','items_without_supplier');
  end if;

  select count(distinct lower(trim(supplier_name))) into v_suppliers
  from public.smart_purchase_order_items
  where order_id=p_order_id and coalesce(approved_quantity,0)>0 and nullif(trim(supplier_name),'') is not null;

  update public.smart_purchase_orders
  set status='تم الإرسال للمورد',
      sent_at=now(),
      sent_by_name=a.display_name,
      updated_at=now()
  where id=p_order_id;

  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'order_id',p_order_id,'supplier_count',v_suppliers,'sent_at',now()
  ));
end $$;

revoke all on function public.smart_purchase_mark_sent_v2(text,uuid) from public;
grant execute on function public.smart_purchase_mark_sent_v2(text,uuid) to anon,authenticated;
