create or replace function public.purchase_invoice_canonical_status(
  p_workflow_status text,
  p_legacy_status text
)
returns text
language sql
immutable
as $$
  select case
    when p_workflow_status in ('draft','submitted','reviewed','returned','approved') then p_workflow_status
    when p_workflow_status = 'pending_review' and coalesce(p_legacy_status,'') = 'انتظار المراجعة' then 'submitted'
    when p_workflow_status = 'pending_review' then 'approved'
    when coalesce(p_legacy_status,'') = 'انتظار المراجعة' then 'submitted'
    when coalesce(p_legacy_status,'') = 'مسودة' then 'draft'
    when coalesce(p_legacy_status,'') = 'مرتجعة للتصحيح' then 'returned'
    when coalesce(p_legacy_status,'') = 'تمت المراجعة' then 'reviewed'
    else 'approved'
  end
$$;

create or replace function public.app_purchase_invoice_metrics(
  p_session_token text,
  p_date_from date default null,
  p_date_to date default null,
  p_branch text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth jsonb;
  v_result jsonb;
  v_last_sync timestamptz;
  v_pending_sync bigint := 0;
begin
  select public.smart_purchase_unified(
    p_session_token,
    'dashboard',
    '{}'::jsonb
  ) into v_auth;

  if coalesce((v_auth->>'ok')::boolean, false) is not true then
    return jsonb_build_object(
      'ok', false,
      'error', coalesce(v_auth->>'error', 'invalid_session'),
      'message', coalesce(v_auth->>'message', 'تعذر التحقق من الجلسة.')
    );
  end if;

  select max(received_at)
  into v_last_sync
  from public.base44_delta_import_runs
  where source_entity = 'PurchaseInvoice';

  select coalesce(sum(records_count),0)
  into v_pending_sync
  from public.base44_reconciliation_summary
  where source_entity = 'PurchaseInvoice'
    and review_status = 'pending'
    and classification in (
      'new_in_base44',
      'base44_newer',
      'needs_field_compare',
      'delete_requires_review'
    );

  with scoped as (
    select
      pi.*,
      public.purchase_invoice_canonical_status(pi.workflow_status, pi.status) as canonical_status,
      greatest(coalesce(pi.total_value,0) - coalesce(pi.returned_value,0), 0) as after_returns,
      case
        when pi.transaction_type = 'internal_transfer' then true
        when pi.net_purchase_mode = 'exclude' then true
        else false
      end as directly_excluded
    from public.purchase_invoices pi
    where (p_date_from is null or pi.invoice_date >= p_date_from)
      and (p_date_to is null or pi.invoice_date <= p_date_to)
      and (coalesce(p_branch,'all') = 'all' or pi.branch = p_branch)
      and coalesce(pi.is_sample,false) = false
  ), totals as (
    select
      count(*)::bigint as invoices_count,
      coalesce(sum(total_value),0)::numeric as raw_total,
      coalesce(sum(returned_value),0)::numeric as returned_total,
      coalesce(sum(after_returns),0)::numeric as after_returns_total,
      coalesce(sum(case when directly_excluded then after_returns else 0 end),0)::numeric as directly_excluded_total,
      coalesce(sum(case when not directly_excluded then after_returns else 0 end),0)::numeric as net_total,
      count(*) filter (where canonical_status='draft')::bigint as draft_count,
      count(*) filter (where canonical_status='submitted')::bigint as submitted_count,
      count(*) filter (where canonical_status='reviewed')::bigint as reviewed_count,
      count(*) filter (where canonical_status='returned')::bigint as returned_count,
      count(*) filter (where canonical_status='approved')::bigint as approved_count,
      count(*) filter (where workflow_status='pending_review')::bigint as legacy_pending_review_count,
      count(*) filter (where workflow_status='approved' and status='انتظار المراجعة')::bigint as conflicting_status_count
    from scoped
  )
  select jsonb_build_object(
    'source', 'supabase',
    'period', jsonb_build_object('from', p_date_from, 'to', p_date_to, 'branch', coalesce(p_branch,'all')),
    'invoices_count', invoices_count,
    'raw_total', raw_total,
    'returned_total', returned_total,
    'after_returns_total', after_returns_total,
    'directly_excluded_total', directly_excluded_total,
    'net_total', net_total,
    'workflow_counts', jsonb_build_object(
      'draft', draft_count,
      'submitted', submitted_count,
      'reviewed', reviewed_count,
      'returned', returned_count,
      'approved', approved_count
    ),
    'data_quality', jsonb_build_object(
      'legacy_pending_review_count', legacy_pending_review_count,
      'conflicting_status_count', conflicting_status_count
    ),
    'sync_health', jsonb_build_object(
      'last_base44_invoice_sync_at', v_last_sync,
      'pending_base44_review_records', v_pending_sync,
      'is_stale', v_last_sync is null or v_last_sync < now() - interval '24 hours'
    )
  ) into v_result
  from totals;

  return jsonb_build_object('ok', true, 'data', v_result);
exception when others then
  return jsonb_build_object('ok', false, 'error', 'metrics_failed', 'message', sqlerrm);
end;
$$;

grant execute on function public.purchase_invoice_canonical_status(text,text) to anon, authenticated;
grant execute on function public.app_purchase_invoice_metrics(text,date,date,text) to anon, authenticated;
