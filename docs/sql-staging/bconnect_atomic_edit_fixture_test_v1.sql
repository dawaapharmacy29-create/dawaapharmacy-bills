-- Disposable fixture test for bconnect_atomic_edit_v1.
-- Execute ONLY in an isolated test database after both staging SQL scripts.
-- Never run against the real pharmacy project.
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
  v_full_patch jsonb := '{"system_invoice_number":"10001","branch":"دواء شكري","supplier_id":"supplier-2","supplier_name":"مورد بديل","invoice_date":"2026-10-08","total_value":150.5,"returned_value":5.5,"cash_amount":20,"payment_type":"نقدي","purchase_category":"supplies_accessories","transaction_type":"external_purchase","notes":"atomic fixture one"}'::jsonb;
BEGIN
  IF current_setting('app.bconnect_staging_approved', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'staging_approval_required';
  END IF;
  IF v_id LIKE 'REPLACE_%' OR v_token LIKE 'REPLACE_%' THEN
    RAISE EXCEPTION 'test_fixture_not_configured';
  END IF;
  SELECT bconnect_revision_v1 INTO v_revision FROM public.purchase_invoices WHERE id=v_id;
  IF v_revision IS NULL THEN RAISE EXCEPTION 'test_invoice_missing'; END IF;

  -- Fail-closed security and validation checks: none may change this invoice or ledger.
  SELECT count(*) INTO v_before_count FROM public.bconnect_invoice_operations_v1;
  v_denied := public.bconnect_atomic_edit_v1('invalid-session','test_atomic_edit_denied01',v_id,v_revision,'{"notes":"unauthorized"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'invalid_session' THEN RAISE EXCEPTION 'invalid_session_not_rejected: %',v_denied; END IF;
  v_denied := public.bconnect_atomic_edit_v1(v_token,'short',v_id,v_revision,'{"notes":"bad operation"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'invalid_request' THEN RAISE EXCEPTION 'invalid_operation_not_rejected: %',v_denied; END IF;
  v_denied := public.bconnect_atomic_edit_v1(v_token,'test_atomic_edit_denied02',v_id,v_revision,'{"branch":"دواء الشامي"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'identity_change_forbidden' THEN RAISE EXCEPTION 'branch_identity_change_not_rejected: %',v_denied; END IF;
  v_denied := public.bconnect_atomic_edit_v1(v_token,'test_atomic_edit_denied03',v_id,v_revision,'{"notes":"x","system_invoice_number":"999"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'identity_change_forbidden' THEN RAISE EXCEPTION 'number_identity_change_not_rejected: %',v_denied; END IF;
  v_denied := public.bconnect_atomic_edit_v1(v_token,'test_atomic_edit_missing01','invoice-does-not-exist',1,'{"notes":"not found"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'not_found' THEN RAISE EXCEPTION 'missing_invoice_not_rejected: %',v_denied; END IF;
  v_denied := public.bconnect_atomic_edit_v1(v_token,'test_atomic_edit_badtype01',v_id,v_revision,'{"notes":123}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'invalid_request' THEN RAISE EXCEPTION 'numeric_notes_not_rejected: %',v_denied; END IF;
  v_denied := public.bconnect_atomic_edit_v1(v_token,'test_atomic_edit_supplier01',v_id,v_revision,'{"supplier_id":"missing-supplier","supplier_name":"غير موجود"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'invalid_supplier' THEN RAISE EXCEPTION 'invalid_supplier_not_rejected: %',v_denied; END IF;
  v_denied := public.bconnect_atomic_edit_v1(v_token,'test_atomic_edit_amount01',v_id,v_revision,'{"total_value":5,"returned_value":6}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'invalid_invoice' THEN RAISE EXCEPTION 'invalid_amount_not_rejected: %',v_denied; END IF;

  -- Verify actual server-side branch, role, ownership and workflow gates.
  v_denied := public.bconnect_atomic_edit_v1('fixture-other-token','test_atomic_edit_other01','fixture-owned-draft',1,'{"notes":"cross branch"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'forbidden_branch' THEN RAISE EXCEPTION 'cross_branch_not_rejected: %',v_denied; END IF;
  v_denied := public.bconnect_atomic_edit_v1('fixture-viewer-token','test_atomic_edit_view01','fixture-owned-draft',1,'{"notes":"viewer"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'forbidden' THEN RAISE EXCEPTION 'viewer_not_rejected: %',v_denied; END IF;
  v_denied := public.bconnect_atomic_edit_v1('fixture-entry-token','test_atomic_edit_approved01','fixture-approved',1,'{"notes":"approved"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'forbidden_edit' THEN RAISE EXCEPTION 'approved_invoice_not_rejected: %',v_denied; END IF;
  v_denied := public.bconnect_atomic_edit_v1('fixture-entry-token','test_atomic_edit_source01','fixture-source-pending',1,'{"notes":"pending"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'source_review_required' THEN RAISE EXCEPTION 'source_pending_not_rejected: %',v_denied; END IF;
  v_denied := public.bconnect_atomic_edit_v1('fixture-entry-token','test_atomic_edit_owner01','fixture-invoice-1',1,'{"notes":"other owner"}'::jsonb);
  IF v_denied->>'error' IS DISTINCT FROM 'forbidden_edit' THEN RAISE EXCEPTION 'owner_mismatch_not_rejected: %',v_denied; END IF;
  v_denied := public.bconnect_atomic_edit_v1('fixture-entry-token','test_atomic_edit_owned01','fixture-owned-draft',1,'{"notes":"owned edit"}'::jsonb);
  IF v_denied->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'owned_draft_not_editable: %',v_denied; END IF;
  SELECT count(*) INTO v_after_count FROM public.bconnect_invoice_operations_v1;
  IF v_after_count <> v_before_count + 1 THEN RAISE EXCEPTION 'rejected_requests_changed_ledger'; END IF;
  IF (SELECT notes FROM public.purchase_invoices WHERE id=v_id) IS DISTINCT FROM 'original' THEN RAISE EXCEPTION 'rejected_requests_modified_invoice'; END IF;

  -- Full save, reopen/readback, idempotent retry, payload conflict and stale revision.
  v_first := public.bconnect_atomic_edit_v1(v_token,v_op,v_id,v_revision,v_full_patch);
  IF v_first->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'first_write_failed: %', v_first; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_invoices p WHERE p.id=v_id
      AND p.system_invoice_number='10001' AND p.branch='دواء شكري'
      AND p.supplier_id='supplier-2' AND p.supplier_name='مورد بديل'
      AND p.invoice_date='2026-10-08'::date AND p.total_value=150.5
      AND p.returned_value=5.5 AND p.cash_amount=20 AND p.payment_type='نقدي'
      AND p.purchase_category='supplies_accessories' AND p.transaction_type='external_purchase'
      AND p.notes='atomic fixture one' AND p.bconnect_revision_v1=v_revision+1
  ) THEN RAISE EXCEPTION 'reopen_readback_mismatch'; END IF;

  v_retry := public.bconnect_atomic_edit_v1(v_token,v_op,v_id,v_revision,v_full_patch);
  IF v_retry IS DISTINCT FROM v_first THEN RAISE EXCEPTION 'idempotent_retry_mismatch: % <> %',v_retry,v_first; END IF;
  v_changed := public.bconnect_atomic_edit_v1(v_token,v_op,v_id,v_revision,v_full_patch || '{"notes":"different payload"}'::jsonb);
  IF v_changed->>'error' IS DISTINCT FROM 'idempotency_conflict' THEN RAISE EXCEPTION 'operation_reuse_not_rejected: %',v_changed; END IF;
  v_stale := public.bconnect_atomic_edit_v1(v_token,'test_atomic_edit_000002',v_id,v_revision,'{"notes":"stale fixture"}'::jsonb);
  IF v_stale->>'error' IS DISTINCT FROM 'stale_revision' THEN RAISE EXCEPTION 'stale_revision_not_rejected: %',v_stale; END IF;
END $$;
ROLLBACK;
