-- Keep purchase-order cancellation fast and deterministic.
-- The original v2 function updated order items by order_id without a general order_id index,
-- which can turn a simple cancellation into a full-table scan on a large item history.

create index if not exists smart_purchase_order_items_order_idx
  on public.smart_purchase_order_items(order_id);

create index if not exists purchase_order_supplier_dispatches_order_sent_idx
  on public.purchase_order_supplier_dispatches(order_id)
  where sent_at is not null;

create index if not exists purchase_order_receipts_order_idx
  on public.purchase_order_receipts(order_id);

create or replace function public.smart_purchase_cancel_order_v2(
  p_session_token text,
  p_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  a record;
  o public.smart_purchase_orders%rowtype;
  v_reason text := trim(coalesce(p_reason,''));
begin
  select sa.* into a
  from public.staff_sessions ss
  join public.staff_accounts sa on sa.id = ss.account_id
  where ss.token_hash = encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and ss.revoked_at is null
    and ss.expires_at > now()
    and sa.status = 'active'
  order by ss.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'error','invalid_session');
  end if;

  if a.role not in ('general_manager','branch_manager','purchasing') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  if char_length(v_reason) < 3 then
    return jsonb_build_object('ok',false,'error','cancel_reason_required');
  end if;

  select * into o
  from public.smart_purchase_orders
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'error','order_not_found');
  end if;

  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;

  if coalesce(o.status,'مسودة') not in ('draft','مسودة','تم التحليل','معتمدة','approved') then
    return jsonb_build_object('ok',false,'error','order_not_cancelable','status',o.status);
  end if;

  if o.sent_at is not null
     or exists (
       select 1
       from public.purchase_order_supplier_dispatches d
       where d.order_id = o.id and d.sent_at is not null
       limit 1
     )
     or exists (
       select 1
       from public.purchase_order_receipts r
       where r.order_id = o.id
       limit 1
     )
  then
    return jsonb_build_object('ok',false,'error','order_execution_started');
  end if;

  update public.smart_purchase_orders
  set status = 'ملغاة',
      reserved_amount = 0,
      reservation_id = null,
      updated_at = now()
  where id = o.id;

  update public.smart_purchase_order_items
  set status = 'ملغي',
      updated_at = now()
  where order_id = o.id
    and status is distinct from 'ملغي';

  insert into public.purchase_status_history(
    source_type,
    record_id,
    old_status,
    new_status,
    reason,
    changed_by_account_id,
    changed_by_name,
    changed_at
  )
  values (
    'smart_purchase_order',
    o.id::text,
    o.status,
    'ملغاة',
    v_reason,
    a.id,
    a.display_name,
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'order_id', o.id,
      'old_status', o.status,
      'new_status', 'ملغاة',
      'reason', v_reason
    )
  );
end
$function$;

revoke all on function public.smart_purchase_cancel_order_v2(text,uuid,text) from public;
grant execute on function public.smart_purchase_cancel_order_v2(text,uuid,text) to anon, authenticated;
