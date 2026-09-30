-- Idempotent supplier dispatch for the clean historical purchase journey.
-- Requires approval by smart_purchase_approve_reviewed_dual_v1 and historical V2 item persistence.
create or replace function public.smart_purchase_mark_historical_supplier_sent_v1(
  p_session_token text,
  p_order_id uuid,
  p_supplier_name text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  a record;
  o public.smart_purchase_orders%rowtype;
  v_supplier text;
  v_existing public.purchase_order_supplier_dispatches%rowtype;
  v_snapshot jsonb;
  v_items_count int := 0;
  v_quantity numeric := 0;
  v_total numeric := 0;
  v_hash text;
  v_required int := 0;
  v_sent int := 0;
  v_inserted int := 0;
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

  if p_order_id is null then
    return jsonb_build_object('ok',false,'error','order_required');
  end if;

  if nullif(trim(coalesce(p_supplier_name,'')),'') is null then
    return jsonb_build_object('ok',false,'error','supplier_required');
  end if;

  select * into o
  from public.smart_purchase_orders
  where id=p_order_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'error','order_not_found');
  end if;

  if not public.smart_purchase_branch_allowed_v2(a.id,o.branch) then
    return jsonb_build_object('ok',false,'error','forbidden_branch');
  end if;

  if o.status not in ('معتمدة','تم الإرسال للمورد') then
    return jsonb_build_object('ok',false,'error','order_not_ready_to_send','status',o.status);
  end if;

  if exists (
    select 1
    from public.purchase_order_receipts r
    where r.order_id=o.id
  ) then
    return jsonb_build_object('ok',false,'error','order_receiving_started');
  end if;

  if not exists (
    select 1
    from public.purchase_status_history h
    where h.source_type='smart_purchase_order'
      and h.record_id=o.id::text
      and h.new_status='معتمدة'
      and h.reason like 'Approved reviewed historical dual allocation %'
  ) then
    return jsonb_build_object('ok',false,'error','clean_approval_required');
  end if;

  select min(trim(i.supplier_name))
  into v_supplier
  from public.smart_purchase_order_items i
  where i.order_id=o.id
    and coalesce(i.approved_quantity,0)>0
    and lower(trim(coalesce(i.supplier_name,'')))=lower(trim(p_supplier_name));

  if v_supplier is null then
    return jsonb_build_object('ok',false,'error','supplier_not_in_order');
  end if;

  select * into v_existing
  from public.purchase_order_supplier_dispatches d
  where d.order_id=o.id
    and lower(trim(d.supplier_name))=lower(trim(v_supplier))
    and d.sent_at is not null
  order by d.sent_at desc
  limit 1
  for update;

  if found then
    return jsonb_build_object('ok',true,'data',jsonb_build_object(
      'supplier_name',v_supplier,
      'already_sent',true,
      'sent_at',v_existing.sent_at,
      'sent_by_name',v_existing.sent_by_name,
      'snapshot_items_count',v_existing.snapshot_items_count,
      'snapshot_quantity',v_existing.snapshot_quantity,
      'snapshot_total',v_existing.snapshot_total,
      'snapshot_hash',v_existing.snapshot_hash
    ));
  end if;

  perform 1
  from public.smart_purchase_order_items i
  where i.order_id=o.id
    and coalesce(i.approved_quantity,0)>0
    and lower(trim(coalesce(i.supplier_name,'')))=lower(trim(v_supplier))
  order by i.id
  for update;

  if exists (
    select 1
    from public.smart_purchase_order_items i
    where i.order_id=o.id
      and coalesce(i.approved_quantity,0)>0
      and lower(trim(coalesce(i.supplier_name,'')))=lower(trim(v_supplier))
      and (
        coalesce(i.expected_unit_cost,0)<=0
        or abs(coalesce(i.expected_total,0)-round((i.approved_quantity*i.expected_unit_cost)::numeric,2))>0.01
        or i.supplier_reason not like 'historical_purchase_v2:%'
        or i.cost_source<>'reference'
      )
  ) then
    return jsonb_build_object('ok',false,'error','historical_supplier_items_not_send_ready');
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id',i.id,
      'product_code',coalesce(i.product_code,''),
      'product_name',coalesce(i.product_name,''),
      'approved_quantity',coalesce(i.approved_quantity,0),
      'expected_unit_cost',coalesce(i.expected_unit_cost,0),
      'expected_total',coalesce(i.expected_total,0),
      'supplier_reason',coalesce(i.supplier_reason,''),
      'cost_source',coalesce(i.cost_source,'')
    ) order by coalesce(i.product_code,''),coalesce(i.product_name,''),i.id),'[]'::jsonb),
    count(*)::int,
    coalesce(sum(i.approved_quantity),0)::numeric,
    round(coalesce(sum(i.expected_total),0)::numeric,2)
  into v_snapshot,v_items_count,v_quantity,v_total
  from public.smart_purchase_order_items i
  where i.order_id=o.id
    and coalesce(i.approved_quantity,0)>0
    and lower(trim(coalesce(i.supplier_name,'')))=lower(trim(v_supplier));

  if v_items_count=0 then
    return jsonb_build_object('ok',false,'error','supplier_not_in_order');
  end if;

  v_hash:=encode(extensions.digest(v_snapshot::text,'sha256'),'hex');

  insert into public.purchase_order_supplier_dispatches(
    order_id,supplier_name,sent_at,sent_by_account_id,sent_by_name,
    snapshot_items,snapshot_items_count,snapshot_quantity,snapshot_total,snapshot_hash,
    snapshot_order_approved_at,created_at,updated_at
  ) values (
    o.id,v_supplier,now(),a.id,a.display_name,
    v_snapshot,v_items_count,v_quantity,v_total,v_hash,
    o.approved_at,now(),now()
  )
  on conflict(order_id,supplier_name) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted=0 then
    select * into v_existing
    from public.purchase_order_supplier_dispatches d
    where d.order_id=o.id
      and lower(trim(d.supplier_name))=lower(trim(v_supplier))
      and d.sent_at is not null
    order by d.sent_at desc
    limit 1;

    if found then
      return jsonb_build_object('ok',true,'data',jsonb_build_object(
        'supplier_name',v_supplier,
        'already_sent',true,
        'sent_at',v_existing.sent_at,
        'sent_by_name',v_existing.sent_by_name,
        'snapshot_items_count',v_existing.snapshot_items_count,
        'snapshot_quantity',v_existing.snapshot_quantity,
        'snapshot_total',v_existing.snapshot_total,
        'snapshot_hash',v_existing.snapshot_hash
      ));
    end if;

    raise exception 'supplier_dispatch_insert_conflict_without_sent_row:%',v_supplier;
  end if;

  select count(distinct lower(trim(i.supplier_name))) into v_required
  from public.smart_purchase_order_items i
  where i.order_id=o.id
    and coalesce(i.approved_quantity,0)>0
    and nullif(trim(coalesce(i.supplier_name,'')),'') is not null;

  select count(distinct lower(trim(d.supplier_name))) into v_sent
  from public.purchase_order_supplier_dispatches d
  where d.order_id=o.id
    and d.sent_at is not null;

  if v_required>0 and v_sent>=v_required then
    update public.smart_purchase_orders
    set status='تم الإرسال للمورد',
        sent_at=coalesce(sent_at,now()),
        sent_by_name=a.display_name,
        updated_at=now()
    where id=o.id
      and status='معتمدة';
  end if;

  return jsonb_build_object('ok',true,'data',jsonb_build_object(
    'supplier_name',v_supplier,
    'already_sent',false,
    'required_suppliers',v_required,
    'sent_suppliers',v_sent,
    'all_sent',(v_required>0 and v_sent>=v_required),
    'snapshot_items_count',v_items_count,
    'snapshot_quantity',v_quantity,
    'snapshot_total',v_total,
    'snapshot_hash',v_hash
  ));
end
$function$;

revoke all on function public.smart_purchase_mark_historical_supplier_sent_v1(text,uuid,text) from public;
grant execute on function public.smart_purchase_mark_historical_supplier_sent_v1(text,uuid,text) to anon,authenticated;
