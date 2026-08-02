create or replace function public.app_system_sync_health(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_result jsonb;
begin
  select a.* into v_account
  from public.staff_sessions s
  join public.staff_accounts a on a.id = s.account_id
  where s.token_hash = encode(digest(coalesce(p_session_token,''),'sha256'),'hex')
    and s.revoked_at is null
    and s.expires_at > now()
    and a.status = 'active'
  order by s.created_at desc
  limit 1;

  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if coalesce(v_account.role,'') <> 'general_manager' then return jsonb_build_object('ok',false,'error','forbidden'); end if;

  with latest_snapshot as (
    select sr.snapshot_id, max(sr.received_at) as received_at
    from public.base44_snapshot_records sr
    where sr.source_entity = 'PurchaseInvoice'
    group by sr.snapshot_id
    order by max(sr.received_at) desc
    limit 1
  ), snapshot_rows as (
    select distinct on (sr.source_record_id)
      sr.source_record_id, sr.payload, sr.source_updated_at, sr.received_at
    from public.base44_snapshot_records sr
    join latest_snapshot ls on ls.snapshot_id = sr.snapshot_id
    where sr.source_entity = 'PurchaseInvoice' and coalesce(sr.is_deleted,false) = false
    order by sr.source_record_id, sr.source_updated_at desc nulls last, sr.received_at desc
  ), latest_events as (
    select distinct on (e.source_record_id)
      e.source_record_id, e.event_type, e.payload, e.source_updated_at, e.received_at, e.status
    from public.base44_sync_events e
    where e.source_entity = 'PurchaseInvoice'
      and e.source_record_id is not null
      and e.received_at >= coalesce((select received_at from latest_snapshot), '-infinity'::timestamptz)
    order by e.source_record_id, e.source_updated_at desc nulls last, e.received_at desc
  ), reconstructed as (
    select coalesce(le.source_record_id,sr.source_record_id) source_record_id,
      coalesce(le.payload,sr.payload) payload,
      coalesce(le.event_type,'snapshot') last_event_type
    from snapshot_rows sr
    left join latest_events le on le.source_record_id=sr.source_record_id
    where coalesce(le.event_type,'') <> 'delete'
    union all
    select le.source_record_id,le.payload,le.event_type
    from latest_events le
    left join snapshot_rows sr on sr.source_record_id=le.source_record_id
    where sr.source_record_id is null and le.event_type <> 'delete'
  ), reconstructed_totals as (
    select count(*)::bigint invoice_count,
      count(*) filter (where coalesce(payload->>'status','')='انتظار المراجعة')::bigint pending_count,
      coalesce(sum(case when nullif(regexp_replace(coalesce(payload->>'total_value','0'),'[^0-9.-]','','g'),'') is null then 0 else nullif(regexp_replace(coalesce(payload->>'total_value','0'),'[^0-9.-]','','g'),'')::numeric end),0) total_value
    from reconstructed
  ), current_totals as (
    select count(*)::bigint invoice_count,
      count(*) filter (where public.purchase_invoice_canonical_status(workflow_status,status)='submitted')::bigint pending_count,
      coalesce(sum(coalesce(total_value,0)),0)::numeric total_value
    from public.purchase_invoices
    where coalesce(is_sample,false)=false
  ), event_health as (
    select count(*) filter (where status='applied')::bigint applied,
      count(*) filter (where status in ('failed','processing_error'))::bigint failed,
      count(*) filter (where status='delete_requires_review')::bigint delete_requires_review,
      count(*) filter (where status in ('received','classified','pending'))::bigint unresolved,
      max(received_at) last_event_at,
      max(processed_at) filter (where status='applied') last_applied_at
    from public.base44_sync_events where source_entity='PurchaseInvoice'
  )
  select jsonb_build_object(
    'mode','base44_to_supabase_only',
    'snapshot',jsonb_build_object('id',(select snapshot_id from latest_snapshot),'received_at',(select received_at from latest_snapshot)),
    'base44_reconstructed',jsonb_build_object('invoice_count',rt.invoice_count,'pending_count',rt.pending_count,'total_value',rt.total_value),
    'supabase_current',jsonb_build_object('invoice_count',ct.invoice_count,'pending_count',ct.pending_count,'total_value',ct.total_value),
    'difference',jsonb_build_object(
      'invoice_count',ct.invoice_count-rt.invoice_count,
      'pending_count',ct.pending_count-rt.pending_count,
      'total_value',ct.total_value-rt.total_value,
      'is_matched',(ct.invoice_count=rt.invoice_count and ct.pending_count=rt.pending_count and abs(ct.total_value-rt.total_value)<0.01)
    ),
    'incoming',jsonb_build_object('applied',eh.applied,'failed',eh.failed,'delete_requires_review',eh.delete_requires_review,'unresolved',eh.unresolved,'last_event_at',eh.last_event_at,'last_applied_at',eh.last_applied_at),
    'outgoing',jsonb_build_object('enabled',false,'pending',0),
    'checked_at',now()
  ) into v_result
  from reconstructed_totals rt cross join current_totals ct cross join event_health eh;

  return jsonb_build_object('ok',true,'data',v_result);
exception when others then
  return jsonb_build_object('ok',false,'error','system_sync_health_failed','message',sqlerrm);
end;
$$;

revoke all on function public.app_system_sync_health(text) from public;
grant execute on function public.app_system_sync_health(text) to anon,authenticated;
