-- Reviewed historical allocation snapshot.
-- The preview and the apply operation both read the single canonical owner
-- public.purchase_historical_supplier_choice_v1.
-- Apply requires the exact preview hash, so a history change between review and click fails closed.

create or replace function public.smart_purchase_historical_allocation_preview_v1(
  p_session_token text,
  p_order_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  a record;
  v_requested int := coalesce(cardinality(p_order_ids),0);
  v_found int;
  v_items int;
  v_mapped int;
  v_rows jsonb;
  v_hash text;
  v_total numeric;
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

  if a.role not in ('general_manager','branch_manager','purchasing') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  if v_requested<1 then
    return jsonb_build_object('ok',false,'error','order_not_found');
  end if;

  if (select count(distinct x) from unnest(p_order_ids) x)<>v_requested then
    return jsonb_build_object('ok',false,'error','duplicate_order_id');
  end if;

  select count(*) into v_found
  from public.smart_purchase_orders
  where id=any(p_order_ids);

  if v_found<>v_requested then
    return jsonb_build_object('ok',false,'error','order_not_found');
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
      and coalesce(o.status,'مسودة') not in ('draft','مسودة')
  ) then
    return jsonb_build_object('ok',false,'error','historical_allocation_requires_draft');
  end if;

  if exists (
    select 1
    from public.smart_purchase_orders o
    where o.id=any(p_order_ids)
      and (
        o.sent_at is not null
        or exists (
          select 1 from public.purchase_order_supplier_dispatches d
          where d.order_id=o.id and d.sent_at is not null
        )
        or exists (
          select 1 from public.purchase_order_receipts r
          where r.order_id=o.id
        )
      )
  ) then
    return jsonb_build_object('ok',false,'error','order_execution_started');
  end if;

  select count(*) into v_items
  from public.smart_purchase_order_items i
  where i.order_id=any(p_order_ids)
    and coalesce(i.approved_quantity,0)>0;

  with choices as (
    select
      i.id item_id,
      i.order_id,
      o.order_number,
      o.branch,
      i.product_code,
      i.product_name,
      i.approved_quantity quantity,
      h.supplier_name,
      h.selected_unit_cost unit_cost,
      round((i.approved_quantity*h.selected_unit_cost)::numeric,2) line_total,
      h.historical_confidence,
      h.historical_cost_source,
      h.purchase_events,
      h.last_purchase_date
    from public.smart_purchase_order_items i
    join public.smart_purchase_orders o on o.id=i.order_id
    left join public.purchase_historical_supplier_choice_v1 h
      on h.branch=o.branch
     and h.product_key=coalesce(
       nullif(trim(i.product_code),''),
       public.purchase_normalize_product_name(i.product_name)
     )
    where i.order_id=any(p_order_ids)
      and coalesce(i.approved_quantity,0)>0
  )
  select count(*) into v_mapped
  from choices
  where nullif(trim(supplier_name),'') is not null and coalesce(unit_cost,0)>0;

  if v_items=0 or v_mapped<>v_items then
    return jsonb_build_object(
      'ok',false,
      'error','historical_allocation_incomplete',
      'items_count',v_items,
      'mapped_count',v_mapped
    );
  end if;

  with choices as (
    select
      i.id item_id,
      i.order_id,
      o.order_number,
      o.branch,
      i.product_code,
      i.product_name,
      i.approved_quantity quantity,
      h.supplier_name,
      h.selected_unit_cost unit_cost,
      round((i.approved_quantity*h.selected_unit_cost)::numeric,2) line_total,
      h.historical_confidence,
      h.historical_cost_source,
      h.purchase_events,
      h.last_purchase_date
    from public.smart_purchase_order_items i
    join public.smart_purchase_orders o on o.id=i.order_id
    join public.purchase_historical_supplier_choice_v1 h
      on h.branch=o.branch
     and h.product_key=coalesce(
       nullif(trim(i.product_code),''),
       public.purchase_normalize_product_name(i.product_name)
     )
    where i.order_id=any(p_order_ids)
      and coalesce(i.approved_quantity,0)>0
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'item_id',item_id,
        'order_id',order_id,
        'order_number',order_number,
        'branch',branch,
        'product_code',product_code,
        'product_name',product_name,
        'quantity',quantity,
        'supplier_name',supplier_name,
        'unit_cost',unit_cost,
        'cash_cost',line_total,
        'historical_confidence',historical_confidence,
        'historical_purchase_events',purchase_events,
        'historical_last_purchase_date',last_purchase_date,
        'cost_source',historical_cost_source
      )
      order by branch,product_name,item_id
    ),'[]'::jsonb),
    encode(
      extensions.digest(
        string_agg(
          item_id::text||'|'||quantity::text||'|'||supplier_name||'|'||unit_cost::text||'|'||
          historical_confidence||'|'||historical_cost_source||'|'||
          coalesce(purchase_events,0)::text||'|'||coalesce(last_purchase_date::text,''),
          E'\n' order by item_id
        ),
        'sha256'
      ),
      'hex'
    ),
    round(coalesce(sum(line_total),0)::numeric,2)
  into v_rows,v_hash,v_total
  from choices;

  return jsonb_build_object(
    'ok',true,
    'data',jsonb_build_object(
      'rows',v_rows,
      'allocation_hash',v_hash,
      'orders_count',v_requested,
      'items_count',v_items,
      'grand_total',v_total,
      'owner','purchase_historical_supplier_choice_v1'
    )
  );
end
$function$;

revoke all on function public.smart_purchase_historical_allocation_preview_v1(text,uuid[]) from public;
grant execute on function public.smart_purchase_historical_allocation_preview_v1(text,uuid[]) to anon,authenticated;


create or replace function public.smart_purchase_apply_historical_allocation_v2(
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
  v_total numeric;
  v_expected_total numeric;
  v_expected_items int;
  v_updated_items int;
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

  if a.role not in ('general_manager','branch_manager','purchasing') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;
  if nullif(trim(coalesce(p_expected_hash,'')),'') is null then
    return jsonb_build_object('ok',false,'error','historical_allocation_hash_required');
  end if;

  -- Lock the reviewed drafts and their active rows before rebuilding the snapshot.
  perform 1
  from public.smart_purchase_orders
  where id=any(p_order_ids)
  for update;

  perform 1
  from public.smart_purchase_order_items
  where order_id=any(p_order_ids)
    and coalesce(approved_quantity,0)>0
  for update;

  v_preview := public.smart_purchase_historical_allocation_preview_v1(p_session_token,p_order_ids);

  if coalesce((v_preview->>'ok')::boolean,false) is false then
    return v_preview;
  end if;

  v_hash := v_preview#>>'{data,allocation_hash}';
  v_expected_total := coalesce((v_preview#>>'{data,grand_total}')::numeric,0);
  v_expected_items := coalesce((v_preview#>>'{data,items_count}')::int,0);

  if v_hash is distinct from p_expected_hash then
    return jsonb_build_object(
      'ok',false,
      'error','historical_allocation_changed',
      'expected_hash',p_expected_hash,
      'current_hash',v_hash
    );
  end if;

  with p as (
    select *
    from jsonb_to_recordset(v_preview#>'{data,rows}') as x(
      item_id uuid,
      order_id uuid,
      supplier_name text,
      unit_cost numeric,
      cash_cost numeric,
      historical_confidence text
    )
  )
  update public.smart_purchase_order_items i
  set supplier_name=p.supplier_name,
      expected_unit_cost=round(p.unit_cost::numeric,4),
      expected_total=round(p.cash_cost::numeric,2),
      supplier_offer_id=null,
      supplier_reason='historical_purchase_v2:'||p.historical_confidence,
      cost_source='reference',
      cost_verified_at=null,
      cost_verified_by_account_id=null,
      cost_verified_by_name=null,
      updated_at=now()
  from p
  where i.id=p.item_id and i.order_id=p.order_id;

  get diagnostics v_updated_items = row_count;
  if v_updated_items<>v_expected_items then
    raise exception 'historical_allocation_apply_count_mismatch:%/%',v_updated_items,v_expected_items;
  end if;

  update public.smart_purchase_orders o
  set expected_total=x.total,
      approved_total=x.total,
      updated_at=now()
  from (
    select i.order_id,round(coalesce(sum(i.expected_total),0)::numeric,2) total
    from public.smart_purchase_order_items i
    where i.order_id=any(p_order_ids)
      and coalesce(i.approved_quantity,0)>0
    group by i.order_id
  ) x
  where o.id=x.order_id;

  select round(coalesce(sum(approved_total),0)::numeric,2)
  into v_total
  from public.smart_purchase_orders
  where id=any(p_order_ids);

  if abs(v_total-v_expected_total)>0.01 then
    raise exception 'historical_allocation_total_mismatch:%/%',v_total,v_expected_total;
  end if;

  insert into public.purchase_status_history(
    source_type,record_id,old_status,new_status,reason,
    changed_by_account_id,changed_by_name,changed_at
  )
  select
    'smart_purchase_order',
    o.id::text,
    o.status,
    o.status,
    'Applied reviewed historical allocation snapshot '||v_hash,
    a.id,
    a.display_name,
    now()
  from public.smart_purchase_orders o
  where o.id=any(p_order_ids);

  return jsonb_build_object(
    'ok',true,
    'data',jsonb_build_object(
      'allocation_hash',v_hash,
      'orders_count',coalesce(cardinality(p_order_ids),0),
      'items_count',jsonb_array_length(v_preview#>'{data,rows}'),
      'grand_total',v_total
    )
  );
end
$function$;

revoke all on function public.smart_purchase_apply_historical_allocation_v2(text,uuid[],text) from public;
grant execute on function public.smart_purchase_apply_historical_allocation_v2(text,uuid[],text) to anon,authenticated;
