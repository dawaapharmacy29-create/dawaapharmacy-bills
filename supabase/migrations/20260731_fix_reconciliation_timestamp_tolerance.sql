-- Root-cause fix for a false-positive flood discovered in base44_reconciliation_reviews:
-- 376 PurchaseInvoice rows were classified 'supabase_newer' / risk='high' purely because
-- Base44's event timestamp is millisecond-precision while Supabase's updated_at is
-- microsecond-precision. Every single one of those 376 rows had IDENTICAL payload data
-- (same total_value, same status) with a timestamp gap under 1 millisecond — not a real
-- conflict, just a rounding artifact. This was verified against the full dataset before
-- this fix (not a sample) on 2026-07-31.
--
-- Fix: require a >= 2 second gap before classifying as base44_newer/supabase_newer.
-- Genuine edits in the sampled base44_newer conflicts showed gaps of minutes to hours,
-- so a 2-second tolerance safely absorbs the precision artifact without hiding real edits.

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
  v_gap_seconds double precision;
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
    else
      v_gap_seconds := extract(epoch from (v_target_updated - e.source_updated_at));
      if abs(v_gap_seconds) < 2 then
        -- Same moment, within clock/precision tolerance: treat as already in sync.
        v_classification := 'in_sync';
      elsif v_gap_seconds < 0 then
        v_classification := 'base44_newer';
      else
        v_classification := 'supabase_newer';
        v_risk := 'high';
      end if;
    end if;
  end if;

  insert into public.base44_reconciliation_reviews (
    event_id, source_entity, source_record_id, target_table, target_record_id,
    classification, source_updated_at, target_updated_at,
    source_payload, target_payload, risk_level,
    review_status, reviewed_at, review_notes
  ) values (
    e.event_id, e.source_entity, e.source_record_id, v_target_table,
    case when v_target is null then null else e.source_record_id end,
    v_classification, e.source_updated_at, v_target_updated,
    e.payload, coalesce(v_target, '{}'::jsonb), v_risk,
    case when v_classification = 'in_sync' then 'dismissed' else 'pending' end,
    case when v_classification = 'in_sync' then now() else null end,
    case when v_classification = 'in_sync' then 'مطابق تلقائيًا: فرق التوقيت أقل من ثانيتين — لا يوجد تعارض بيانات.' else null end
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
    review_status = case when excluded.classification = 'in_sync' then 'dismissed' else 'pending' end,
    review_notes = case when excluded.classification = 'in_sync' then 'مطابق تلقائيًا: فرق التوقيت أقل من ثانيتين — لا يوجد تعارض بيانات.' else null end,
    reviewed_at = case when excluded.classification = 'in_sync' then now() else null end;

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
