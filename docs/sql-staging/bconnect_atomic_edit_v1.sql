-- STAGING-ONLY PROTOTYPE. Never run on the production project.
-- Requires bconnect_atomic_foundation_v1.sql and synthetic invoice fixtures.
-- Edit-only on purpose: create is blocked until invoice-number policy is approved.
BEGIN;
DO $$
BEGIN
  IF current_setting('app.bconnect_staging_approved', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'staging_approval_required';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.bconnect_atomic_edit_v1(
  p_session_token text,
  p_operation_id text,
  p_invoice_id text,
  p_expected_revision bigint,
  p_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE
  v_auth jsonb;
  v_account jsonb;
  v_current public.purchase_invoices%ROWTYPE;
  v_hash text;
  v_existing public.bconnect_invoice_operations_v1%ROWTYPE;
  v_result jsonb;
  v_notes text;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id !~ '^[A-Za-z0-9_-]{16,128}$'
     OR p_invoice_id IS NULL OR btrim(p_invoice_id) = ''
     OR p_expected_revision IS NULL OR p_expected_revision < 1
     OR p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_patch)) <> 1
     OR NOT p_patch ? 'notes'
     OR jsonb_typeof(p_patch->'notes') NOT IN ('string', 'null')
  THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_request'); END IF;

  v_auth := public.validate_staff_session(p_session_token);
  IF COALESCE((v_auth->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_session');
  END IF;
  v_account := v_auth->'account';
  IF COALESCE(v_account->>'role','') NOT IN ('general_manager','branch_manager','purchasing','invoice_entry') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  -- Lock same idempotency key even if the operation ledger has no row yet.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id, 0));
  v_hash := encode(digest(
    jsonb_build_object('invoice_id',p_invoice_id,'revision',p_expected_revision,'patch',p_patch)::text,
    'sha256'), 'hex');
  SELECT * INTO v_existing FROM public.bconnect_invoice_operations_v1
    WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.actor_id::text <> v_account->>'id' OR v_existing.request_hash <> v_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
    END IF;
    RETURN v_existing.result;
  END IF;

  SELECT * INTO v_current FROM public.purchase_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF v_account->>'role' <> 'general_manager'
     AND NOT COALESCE((v_account->'branch_ids') ? v_current.branch, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden_branch');
  END IF;
  IF v_account->>'role' <> 'general_manager' AND
    (COALESCE(v_current.workflow_status,'approved') NOT IN ('draft','returned')
     OR (v_current.entered_by_account_id IS NOT NULL
       AND v_current.entered_by_account_id::text <> v_account->>'id')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden_edit');
  END IF;
  IF COALESCE(v_current.base44_sync_state, 'active') <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'source_review_required');
  END IF;
  IF v_current.bconnect_revision_v1 <> p_expected_revision THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stale_revision');
  END IF;

  -- Deliberately narrow: no invoice identity, amount, workflow or audit changes.
  v_notes := p_patch->>'notes';
  UPDATE public.purchase_invoices SET notes = v_notes WHERE id = p_invoice_id;
  v_result := jsonb_build_object('ok',true,'invoice_id',p_invoice_id,
    'revision',p_expected_revision + 1);
  INSERT INTO public.bconnect_invoice_operations_v1
    (operation_id,request_hash,invoice_id,result,actor_id)
  VALUES (p_operation_id,v_hash,p_invoice_id,v_result,(v_account->>'id')::uuid);
  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.bconnect_atomic_edit_v1(text,text,text,bigint,jsonb)
  FROM PUBLIC, anon, authenticated;
COMMIT;
