-- Disposable fixture test for bconnect_atomic_edit_v1.
-- Execute ONLY in an isolated test database after both staging SQL scripts.
-- Never run against the real pharmacy project.
-- Required: fixture helper provisions an active staff account/session and a
-- draft invoice owned by that account, then substitutes the placeholders.
BEGIN;
DO $$
DECLARE
  v_first jsonb;
  v_retry jsonb;
  v_stale jsonb;
  v_changed jsonb;
  v_revision bigint;
  v_denied jsonb;
  v_before_count bigint;
  v_after_count bigint;
  v_id text := 'REPLACE_TEST_INVOICE_ID';
  v_token text := 'REPLACE_TEST_STAFF_SESSION_TOKEN';
  v_op text := 'test_atomic_edit_000001';
BEGIN
  IF current_setting('app.bconnect_staging_approved', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'staging_approval_required';
  END IF;
  IF v_id LIKE 'REPLACE_%' OR v_token LIKE 'REPLACE_%' THEN
    RAISE EXCEPTION 'test_fixture_not_configured';
  END IF;
  SELECT bconnect_revision_v1 INTO v_revision
    FROM public.purchase_invoices WHERE id=v_id;
  IF v_revision IS NULL THEN RAISE EXCEPTION 'test_invoice_missing'; END IF;
  -- Fail-closed security checks: none may change the invoice or ledger.
  SELECT count(*) INTO v_before_count FROM public.bconnect_invoice_operations_v1;
  v_denied := public.bconnect_atomic_edit_v1('invalid-session','test_atomic_edit_denied01',v_id,v_revision,
    '{"notes":"unauthorized"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'invalid_session' THEN
    RAISE EXCEPTION 'invalid_session_not_rejected: %',v_denied;
  END IF;
  v_denied := public.bconnect_atomic_edit_v1(v_token,'short',v_id,v_revision,
    '{"notes":"bad operation"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'invalid_request' THEN
    RAISE EXCEPTION 'invalid_operation_not_rejected: %',v_denied;
  END IF;
  v_denied := public.bconnect_atomic_edit_v1(v_token,'test_atomic_edit_denied02',v_id,v_revision,
    '{"branch":"دواء الشامي"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'invalid_request' THEN
    RAISE EXCEPTION 'forbidden_field_not_rejected: %',v_denied;
  END IF;
  v_denied := public.bconnect_atomic_edit_v1(v_token,'test_atomic_edit_denied03',v_id,v_revision,
    '{"notes":"x","system_invoice_number":"999"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'invalid_request' THEN
    RAISE EXCEPTION 'mixed_field_patch_not_rejected: %',v_denied;
  END IF;
  v_denied := public.bconnect_atomic_edit_v1(v_token,'test_atomic_edit_missing01',
    'invoice-does-not-exist',1,'{"notes":"not found"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'missing_invoice_not_rejected: %',v_denied;
  END IF;
  v_denied := public.bconnect_atomic_edit_v1(v_token,'test_atomic_edit_badtype01',
    v_id,v_revision,'{"notes":123}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'invalid_request' THEN
    RAISE EXCEPTION 'numeric_notes_not_rejected: %',v_denied;
  END IF;
  -- Verify actual server-side branch, role, ownership and workflow gates.
  v_denied := public.bconnect_atomic_edit_v1('fixture-other-token','test_atomic_edit_other01',
    'fixture-owned-draft',1,'{"notes":"cross branch"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'forbidden_branch' THEN
    RAISE EXCEPTION 'cross_branch_not_rejected: %',v_denied;
  END IF;
  v_denied := public.bconnect_atomic_edit_v1('fixture-viewer-token','test_atomic_edit_view01',
    'fixture-owned-draft',1,'{"notes":"viewer"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'viewer_not_rejected: %',v_denied;
  END IF;
  v_denied := public.bconnect_atomic_edit_v1('fixture-entry-token','test_atomic_edit_approved01',
    'fixture-approved',1,'{"notes":"approved"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'forbidden_edit' THEN
    RAISE EXCEPTION 'approved_invoice_not_rejected: %',v_denied;
  END IF;
  v_denied := public.bconnect_atomic_edit_v1('fixture-entry-token','test_atomic_edit_source01',
    'fixture-source-pending',1,'{"notes":"pending"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'source_review_required' THEN
    RAISE EXCEPTION 'source_pending_not_rejected: %',v_denied;
  END IF;
  v_denied := public.bconnect_atomic_edit_v1('fixture-entry-token','test_atomic_edit_owner01',
    'fixture-invoice-1',1,'{"notes":"other owner"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'forbidden_edit' THEN
    RAISE EXCEPTION 'owner_mismatch_not_rejected: %',v_denied;
  END IF;
  v_denied := public.bconnect_atomic_edit_v1('fixture-entry-token','test_atomic_edit_owned01',
    'fixture-owned-draft',1,'{"notes":"owned edit"}'::jsonb);
  IF v_denied->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'owned_draft_not_editable: %',v_denied;
  END IF;
  SELECT count(*) INTO v_after_count FROM public.bconnect_invoice_operations_v1;
  IF v_after_count <> v_before_count + 1 THEN
    RAISE EXCEPTION 'rejected_requests_changed_ledger';
  END IF;
  IF (SELECT notes FROM public.purchase_invoices WHERE id=v_id) IS DISTINCT FROM 'original' THEN
    RAISE EXCEPTION 'rejected_requests_modified_invoice';
  END IF;

  v_first := public.bconnect_atomic_edit_v1(v_token,v_op,v_id,v_revision,
    '{"notes":"atomic fixture one"}'::jsonb);
  IF v_first->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'first_write_failed: %', v_first;
  END IF;
  v_retry := public.bconnect_atomic_edit_v1(v_token,v_op,v_id,v_revision,
    '{"notes":"atomic fixture one"}'::jsonb);
  IF v_retry IS DISTINCT FROM v_first THEN
    RAISE EXCEPTION 'idempotent_retry_mismatch: % <> %',v_retry,v_first;
  END IF;
  v_changed := public.bconnect_atomic_edit_v1(v_token,v_op,v_id,v_revision,
    '{"notes":"different payload"}'::jsonb);
  IF v_changed->>'error' IS DISTINCT FROM 'idempotency_conflict' THEN
    RAISE EXCEPTION 'operation_reuse_not_rejected: %',v_changed;
  END IF;
  v_stale := public.bconnect_atomic_edit_v1(v_token,'test_atomic_edit_000002',v_id,v_revision,
    '{"notes":"stale fixture"}'::jsonb);
  IF v_stale->>'error' IS DISTINCT FROM 'stale_revision' THEN
    RAISE EXCEPTION 'stale_revision_not_rejected: %',v_stale;
  END IF;
END $$;
ROLLBACK;
