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
