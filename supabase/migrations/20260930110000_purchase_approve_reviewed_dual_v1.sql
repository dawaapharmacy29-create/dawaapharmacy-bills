-- Atomic approval for the clean dual-branch historical purchase journey.
-- Approval is allowed only for the exact reviewed historical snapshot.
create or replace function public.smart_purchase_approve_reviewed_dual_v1(
  p_session_token text,
  p_order_ids uuid[],
  p_expected_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  a record;
  v_preview jsonb;
  v_hash text;
  v_requested int := coalesce(cardinality(p_order_ids),0);
  v_orders int := 0;
  v_items int := 0;
  v_matching int := 0;
  v_updated int := 0;
  v_total numeric := 0;
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

  if not found then
    return jsonb_build_object('ok',false,'error','invalid_session');
  end if;

  if a.role not in ('general_manager','purchasing') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  if v_requested<>2
     or (select count(distinct x) from unnest(p_order_ids) x)<>2 then
    return jsonb_build_object('ok',false,'error','dual_order_pair_required');
  end if;

  if nullif(trim(coalesce(p_expected_hash,'')),'') is null then
    return jsonb_build_object('ok',false,'error','historical_allocation_hash_required');
  end if;

  perform 1
  from public.smart_purchase_orders
  where id=any(p_order_ids)
  order by id
  for update;

  select count(*) into v_orders
  from public.smart_purchase_orders
  where id=any(p_order_ids);

  if v_orders<>2 then
    return jsonb_build_object('ok',false,'error','order_not_found');
  end if;

  if (
    select count(distinct branch)
    from public.smart_purchase_orders
    where id=any(p_order_ids)
  )<>2
  or exists (
    select 1
    from public.smart_purchase_orders
    where id=any(p_order_ids)
      and branch not in ('دواء شكري','دواء الشامي')
  ) then
    return jsonb_build_object('ok',false,'error','invalid_dual_order_pair');
  end if;

  if exists (
    select 1
    from public.smart_purchase_orders o
    where o.id=any(p_order_ids)
      and not public.smart_purchase_branch_allowed_v2(a.id,o.branch)
  ) then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;

  if exists (
    select 1
    from public.smart_purchase_orders o
    where o.id=any(p_order_ids)
      and coalesce(o.status,'') not in ('draft','مسودة')
  ) then
    return jsonb_build_object('ok',false,'error','approval_requires_draft_pair');
  end if;

  if exists (
    select 1
    from public.smart_purchase_orders o
    where o.id=any(p_order_ids)
      and (
        o.sent_at is not null
        or exists (
          select 1
          from public.purchase_order_supplier_dispatches d
          where d.order_id=o.id and d.sent_at is not null
        )
        or exists (
          select 1
          from public.purchase_order_receipts r
          where r.order_id=o.id
        )
      )
  ) then
    return jsonb_build_object('ok',false,'error','order_execution_started');
  end if;

  perform 1
  from public.smart_purchase_order_items
  where order_id=any(p_order_ids)
    and coalesce(approved_quantity,0)>0
  order by id
  for update;

  v_preview := public.smart_purchase_historical_allocation_preview_v1(
    p_session_token,
    p_order_ids
  );

  if coalesce((v_preview->>'ok')::boolean,false) is false then
    return v_preview;
  end if;

  v_hash := v_preview#>>'{data,allocation_hash}';

  if v_hash is distinct from p_expected_hash then
    return jsonb_build_object(
      'ok',false,
      'error','historical_allocation_changed',
      'expected_hash',p_expected_hash,
      'current_hash',v_hash
    );
  end if;

  select count(*) into v_items
  from public.smart_purchase_order_items i
  where i.order_id=any(p_order_ids)
    and coalesce(i.approved_quantity,0)>0;

  with p as (
    select *
    from jsonb_to_recordset(v_preview#>'{data,rows}') as x(
      item_id uuid,
      order_id uuid,
      quantity numeric,
      supplier_name text,
      unit_cost numeric,
      cash_cost numeric,
      historical_confidence text
    )
  )
  select count(*) into v_matching
  from public.smart_purchase_order_items i
  join p on p.item_id=i.id and p.order_id=i.order_id
  where i.order_id=any(p_order_ids)
    and coalesce(i.approved_quantity,0)>0
    and i.approved_quantity=p.quantity
    and nullif(trim(i.supplier_name),'')=nullif(trim(p.supplier_name),'')
    and abs(coalesce(i.expected_unit_cost,0)-coalesce(p.unit_cost,0))<=0.0001
    and abs(coalesce(i.expected_total,0)-coalesce(p.cash_cost,0))<=0.01
    and i.supplier_reason='historical_purchase_v2:'||p.historical_confidence
    and i.cost_source='reference';

  if v_items=0 or v_matching<>v_items
     or v_items<>coalesce((v_preview#>>'{data,items_count}')::int,0) then
    return jsonb_build_object(
      'ok',false,
      'error','reviewed_allocation_not_persisted',
      'items_count',v_items,
      'matching_count',v_matching
    );
  end if;

  select round(coalesce(sum(approved_total),0)::numeric,2)
  into v_total
  from public.smart_purchase_orders
  where id=any(p_order_ids);

  if abs(v_total-coalesce((v_preview#>>'{data,grand_total}')::numeric,0))>0.01 then
    return jsonb_build_object('ok',false,'error','reviewed_total_mismatch');
  end if;

  update public.smart_purchase_orders
  set status='معتمدة',
      approved_at=now(),
      approved_by_account_id=a.id,
      approved_by_name=a.display_name,
      updated_at=now()
  where id=any(p_order_ids)
    and coalesce(status,'') in ('draft','مسودة');

  get diagnostics v_updated = row_count;

  if v_updated<>2 then
    raise exception 'dual_approval_update_count_mismatch:%',v_updated;
  end if;

  insert into public.purchase_status_history(
    source_type,record_id,old_status,new_status,reason,
    changed_by_account_id,changed_by_name,changed_at
  )
  select
    'smart_purchase_order',
    o.id::text,
    'draft',
    'معتمدة',
    'Approved reviewed historical dual allocation '||v_hash,
    a.id,
    a.display_name,
    now()
  from public.smart_purchase_orders o
  where o.id=any(p_order_ids);

  return jsonb_build_object(
    'ok',true,
    'data',jsonb_build_object(
      'allocation_hash',v_hash,
      'orders_count',2,
      'items_count',v_items,
      'grand_total',v_total,
      'status','معتمدة'
    )
  );
end
$function$;

revoke all on function public.smart_purchase_approve_reviewed_dual_v1(text,uuid[],text) from public;
grant execute on function public.smart_purchase_approve_reviewed_dual_v1(text,uuid[],text) to anon,authenticated;
