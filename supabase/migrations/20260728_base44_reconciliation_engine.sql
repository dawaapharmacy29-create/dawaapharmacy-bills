-- Safe reconciliation layer for Base44 -> Supabase.
-- This migration classifies incoming events but does not write to production tables.

create table if not exists public.base44_reconciliation_reviews (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  source_entity text not null,
  source_record_id text not null,
  target_table text,
  target_record_id text,
  classification text not null,
  source_updated_at timestamptz,
  target_updated_at timestamptz,
  source_payload jsonb not null default '{}'::jsonb,
  target_payload jsonb not null default '{}'::jsonb,
  risk_level text not null default 'normal',
  review_status text not null default 'pending',
  review_notes text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists base44_reconciliation_reviews_classification_idx
  on public.base44_reconciliation_reviews(classification, review_status);
create index if not exists base44_reconciliation_reviews_entity_idx
  on public.base44_reconciliation_reviews(source_entity, source_record_id);

alter table public.base44_reconciliation_reviews enable row level security;
grant all on public.base44_reconciliation_reviews to service_role;

create or replace function public.classify_base44_sync_event(p_event_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.base44_sync_events%rowtype;
  v_target_table text;
  v_target jsonb;
  v_target_updated timestamptz;
  v_classification text;
  v_risk text := 'normal';
begin
  select * into e from public.base44_sync_events where event_id = p_event_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'event_not_found');
  end if;

  v_target_table := case e.source_entity
    when 'PurchaseInvoice' then 'purchase_invoices'
    when 'ShiftDelivery' then 'shift_deliveries'
    when 'PharmacyOrder' then 'pharmacy_orders'
    when 'SupplierPayment' then 'supplier_payments'
    when 'Return' then 'purchase_returns'
    when 'Supplier' then 'suppliers'
    else null
  end;

  if v_target_table is null then
    v_classification := 'unmapped_entity';
    v_risk := 'high';
  elsif e.event_type = 'delete' then
    v_classification := 'delete_requires_review';
    v_risk := 'high';
  else
    execute format(
      'select to_jsonb(t), t.updated_at from public.%I t where t.id = $1 limit 1',
      v_target_table
    ) into v_target, v_target_updated using e.source_record_id;

    if v_target is null then
      v_classification := 'new_in_base44';
    elsif e.source_updated_at is null or v_target_updated is null then
      v_classification := 'needs_field_compare';
    elsif e.source_updated_at > v_target_updated then
      v_classification := 'base44_newer';
    elsif e.source_updated_at < v_target_updated then
      v_classification := 'supabase_newer';
      v_risk := 'high';
    else
      v_classification := 'needs_field_compare';
    end if;
  end if;

  insert into public.base44_reconciliation_reviews (
    event_id, source_entity, source_record_id, target_table, target_record_id,
    classification, source_updated_at, target_updated_at,
    source_payload, target_payload, risk_level
  ) values (
    e.event_id, e.source_entity, e.source_record_id, v_target_table,
    case when v_target is null then null else e.source_record_id end,
    v_classification, e.source_updated_at, v_target_updated,
    e.payload, coalesce(v_target, '{}'::jsonb), v_risk
  )
  on conflict (event_id) do update set
    target_table = excluded.target_table,
    target_record_id = excluded.target_record_id,
    classification = excluded.classification,
    source_updated_at = excluded.source_updated_at,
    target_updated_at = excluded.target_updated_at,
    source_payload = excluded.source_payload,
    target_payload = excluded.target_payload,
    risk_level = excluded.risk_level,
    review_status = 'pending',
    review_notes = null,
    reviewed_at = null;

  update public.base44_sync_events
  set target_table = v_target_table,
      target_record_id = case when v_target is null then null else e.source_record_id end,
      status = 'classified',
      processed_at = now(),
      error_message = null
  where event_id = e.event_id;

  return jsonb_build_object(
    'ok', true,
    'event_id', e.event_id,
    'classification', v_classification,
    'target_table', v_target_table,
    'risk_level', v_risk
  );
exception when others then
  update public.base44_sync_events
  set status = 'classification_failed', error_message = sqlerrm, processed_at = now()
  where event_id = p_event_id;
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

create or replace function public.classify_pending_base44_events(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_processed integer := 0;
  v_failed integer := 0;
  v_result jsonb;
begin
  for r in
    select event_id from public.base44_sync_events
    where status in ('received','classification_failed')
    order by received_at
    limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    v_result := public.classify_base44_sync_event(r.event_id);
    if coalesce((v_result->>'ok')::boolean, false) then
      v_processed := v_processed + 1;
    else
      v_failed := v_failed + 1;
    end if;
  end loop;
  return jsonb_build_object('processed', v_processed, 'failed', v_failed);
end;
$$;

grant execute on function public.classify_base44_sync_event(text) to service_role;
grant execute on function public.classify_pending_base44_events(integer) to service_role;

create or replace view public.base44_reconciliation_summary as
select source_entity, classification, risk_level, review_status, count(*)::bigint as records_count
from public.base44_reconciliation_reviews
group by source_entity, classification, risk_level, review_status;
