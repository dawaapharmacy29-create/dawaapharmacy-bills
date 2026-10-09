-- STAGING-ONLY PROTOTYPE. Never run on the production project.
-- Requires bconnect_atomic_foundation_v1.sql and synthetic invoice fixtures.
-- Edit-only on purpose: create remains blocked until branch-scoped uniqueness can be enforced safely.
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
  v_actual_revision bigint;
  v_number text;
  v_branch text;
  v_supplier_id text;
  v_supplier_name text;
  v_date_text text;
  v_invoice_date date;
  v_total numeric;
  v_returned numeric;
  v_cash numeric;
  v_unknown boolean;
  v_bad_text_type boolean;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id !~ '^[A-Za-z0-9_-]{16,128}$'
     OR p_invoice_id IS NULL OR btrim(p_invoice_id) = ''
     OR p_expected_revision IS NULL OR p_expected_revision < 1
     OR p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_patch)) = 0
  THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_request'); END IF;

  SELECT COALESCE(bool_or(key <> ALL (ARRAY[
    'system_invoice_number','branch','supplier_id','supplier_name','invoice_date',
    'total_value','returned_value','cash_amount','supplier_invoice_number','payment_type','notes',
    'purchase_category','purchase_category_source','transaction_type','net_purchase_mode',
    'exclusion_reason','exclusion_note','source_branch','destination_branch'
  ])), false)
  INTO v_unknown
  FROM jsonb_object_keys(p_patch) AS key;
  IF v_unknown THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_request'); END IF;

  -- Nullable monetary evidence remains NULL unless the reviewer explicitly changes it.
  IF (p_patch ? 'system_invoice_number' AND jsonb_typeof(p_patch->'system_invoice_number') <> 'string')
     OR (p_patch ? 'branch' AND jsonb_typeof(p_patch->'branch') <> 'string')
     OR (p_patch ? 'supplier_id' AND jsonb_typeof(p_patch->'supplier_id') <> 'string')
     OR (p_patch ? 'supplier_name' AND jsonb_typeof(p_patch->'supplier_name') <> 'string')
     OR (p_patch ? 'invoice_date' AND jsonb_typeof(p_patch->'invoice_date') <> 'string')
     OR (p_patch ? 'total_value' AND jsonb_typeof(p_patch->'total_value') NOT IN ('number','string'))
     OR (p_patch ? 'returned_value' AND jsonb_typeof(p_patch->'returned_value') NOT IN ('number','string','null'))
     OR (p_patch ? 'cash_amount' AND jsonb_typeof(p_patch->'cash_amount') NOT IN ('number','string','null'))
  THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_request'); END IF;

  SELECT COALESCE(bool_or(jsonb_typeof(p_patch->key) NOT IN ('string','null')), false)
  INTO v_bad_text_type
  FROM unnest(ARRAY[
    'supplier_invoice_number','payment_type','notes','purchase_category','purchase_category_source',
    'transaction_type','net_purchase_mode','exclusion_reason','exclusion_note','source_branch','destination_branch'
  ]) AS key
  WHERE p_patch ? key;
  IF v_bad_text_type THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_request'); END IF;

  v_auth := public.validate_staff_session(p_session_token);
  IF COALESCE((v_auth->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_session');
  END IF;
  v_account := v_auth->'account';
  IF COALESCE(v_account->>'role','') NOT IN ('general_manager','branch_manager','purchasing','invoice_entry') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

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

  BEGIN
    v_number := public.bconnect_canonical_invoice_number_v1(
      CASE WHEN p_patch ? 'system_invoice_number' THEN p_patch->>'system_invoice_number' ELSE v_current.system_invoice_number END);
    v_branch := btrim(CASE WHEN p_patch ? 'branch' THEN p_patch->>'branch' ELSE v_current.branch END);
    v_supplier_id := btrim(CASE WHEN p_patch ? 'supplier_id' THEN p_patch->>'supplier_id' ELSE v_current.supplier_id END);
    v_supplier_name := btrim(CASE WHEN p_patch ? 'supplier_name' THEN p_patch->>'supplier_name' ELSE v_current.supplier_name END);
    v_date_text := CASE WHEN p_patch ? 'invoice_date' THEN p_patch->>'invoice_date' ELSE to_char(v_current.invoice_date,'YYYY-MM-DD') END;
    v_invoice_date := v_date_text::date;
    v_total := CASE WHEN p_patch ? 'total_value' THEN (p_patch->>'total_value')::numeric ELSE v_current.total_value END;
    v_returned := CASE
      WHEN p_patch ? 'returned_value' AND jsonb_typeof(p_patch->'returned_value') = 'null' THEN NULL
      WHEN p_patch ? 'returned_value' THEN (p_patch->>'returned_value')::numeric
      ELSE v_current.returned_value END;
    v_cash := CASE
      WHEN p_patch ? 'cash_amount' AND jsonb_typeof(p_patch->'cash_amount') = 'null' THEN NULL
      WHEN p_patch ? 'cash_amount' THEN (p_patch->>'cash_amount')::numeric
      ELSE v_current.cash_amount END;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_invoice');
  END;

  IF v_number IS NULL OR v_number !~ '^[0-9]+$' OR v_number !~ '[1-9]'
     OR v_branch NOT IN ('دواء شكري','دواء الشامي')
     OR v_supplier_id IS NULL OR v_supplier_id = '' OR v_supplier_name IS NULL OR v_supplier_name = ''
     OR v_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR to_char(v_invoice_date,'YYYY-MM-DD') <> v_date_text
     OR v_total IS NULL OR v_total < 0
     OR (v_returned IS NOT NULL AND (v_returned < 0 OR v_returned > v_total))
     OR (v_cash IS NOT NULL AND (v_cash < 0 OR v_cash > v_total - COALESCE(v_returned,0)))
  THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_invoice'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = v_supplier_id AND btrim(s.name) = v_supplier_name
      AND COALESCE(s.is_sample,false) = false
  ) THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_supplier'); END IF;

  IF public.bconnect_canonical_invoice_number_v1(v_current.system_invoice_number) IS DISTINCT FROM v_number
     OR v_current.branch IS DISTINCT FROM v_branch THEN
    RETURN jsonb_build_object('ok', false, 'error', 'identity_change_forbidden');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.purchase_invoices p
    WHERE p.id <> v_current.id
      AND p.branch = v_branch
      AND public.bconnect_canonical_invoice_number_v1(p.system_invoice_number) = v_number
      AND COALESCE(p.is_sample,false)=false
  ) THEN RETURN jsonb_build_object('ok', false, 'error', 'legacy_identity_collision'); END IF;

  UPDATE public.purchase_invoices SET
    supplier_id = v_supplier_id,
    supplier_name = v_supplier_name,
    invoice_date = v_invoice_date,
    total_value = v_total,
    returned_value = v_returned,
    cash_amount = v_cash,
    supplier_invoice_number = CASE WHEN p_patch ? 'supplier_invoice_number' THEN p_patch->>'supplier_invoice_number' ELSE supplier_invoice_number END,
    payment_type = CASE WHEN p_patch ? 'payment_type' THEN p_patch->>'payment_type' ELSE payment_type END,
    notes = CASE WHEN p_patch ? 'notes' THEN p_patch->>'notes' ELSE notes END,
    purchase_category = CASE WHEN p_patch ? 'purchase_category' THEN p_patch->>'purchase_category' ELSE purchase_category END,
    purchase_category_source = CASE WHEN p_patch ? 'purchase_category_source' THEN p_patch->>'purchase_category_source' ELSE purchase_category_source END,
    transaction_type = CASE WHEN p_patch ? 'transaction_type' THEN p_patch->>'transaction_type' ELSE transaction_type END,
    net_purchase_mode = CASE WHEN p_patch ? 'net_purchase_mode' THEN p_patch->>'net_purchase_mode' ELSE net_purchase_mode END,
    exclusion_reason = CASE WHEN p_patch ? 'exclusion_reason' THEN p_patch->>'exclusion_reason' ELSE exclusion_reason END,
    exclusion_note = CASE WHEN p_patch ? 'exclusion_note' THEN p_patch->>'exclusion_note' ELSE exclusion_note END,
    source_branch = CASE WHEN p_patch ? 'source_branch' THEN p_patch->>'source_branch' ELSE source_branch END,
    destination_branch = CASE WHEN p_patch ? 'destination_branch' THEN p_patch->>'destination_branch' ELSE destination_branch END,
    updated_at = now()
  WHERE id = p_invoice_id
  RETURNING bconnect_revision_v1 INTO v_actual_revision;

  v_result := jsonb_build_object('ok',true,'invoice_id',p_invoice_id,'revision',v_actual_revision);
  INSERT INTO public.bconnect_invoice_operations_v1
    (operation_id,request_hash,invoice_id,result,actor_id)
  VALUES (p_operation_id,v_hash,p_invoice_id,v_result,(v_account->>'id')::uuid);
  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.bconnect_atomic_edit_v1(text,text,text,bigint,jsonb)
  FROM PUBLIC, anon, authenticated;
COMMIT;
