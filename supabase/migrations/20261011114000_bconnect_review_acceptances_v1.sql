CREATE TABLE IF NOT EXISTS public.bconnect_review_acceptances_v1 (
  fingerprint text PRIMARY KEY,
  invoice_id text NOT NULL,
  branch text NOT NULL,
  invoice_number text NOT NULL,
  bconnect_supplier text,
  bconnect_date date,
  app_supplier text,
  app_date date,
  total_value numeric NOT NULL,
  accepted_by uuid NOT NULL,
  accepted_by_name text,
  accepted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bconnect_review_acceptances_v1_invoice_idx
  ON public.bconnect_review_acceptances_v1 (branch, invoice_number, invoice_id);

REVOKE ALL ON public.bconnect_review_acceptances_v1 FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bconnect_review_accept_v1(
  p_session_token text,
  p_fingerprint text,
  p_invoice_id text,
  p_branch text,
  p_invoice_number text,
  p_bconnect_supplier text,
  p_bconnect_date date,
  p_app_supplier text,
  p_app_date date,
  p_total_value numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_auth jsonb;
  v_account jsonb;
  v_invoice public.purchase_invoices%ROWTYPE;
  v_number text;
BEGIN
  IF p_fingerprint IS NULL OR length(p_fingerprint) < 12 OR length(p_fingerprint) > 2000
     OR p_invoice_id IS NULL OR p_invoice_id = '' OR p_branch IS NULL OR p_branch = ''
     OR p_invoice_number IS NULL OR p_invoice_number = '' OR p_total_value IS NULL
  THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_acceptance'); END IF;

  v_auth := public.validate_staff_session(p_session_token);
  IF COALESCE((v_auth->>'ok')::boolean, false) IS NOT TRUE
  THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_session'); END IF;
  v_account := v_auth->'account';

  IF COALESCE(v_account->>'role','') NOT IN ('general_manager','branch_manager','purchasing','invoice_entry')
  THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;

  SELECT * INTO v_invoice
  FROM public.purchase_invoices
  WHERE id = p_invoice_id AND COALESCE(is_sample, false) = false;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'invoice_not_found'); END IF;

  v_number := public.bconnect_canonical_invoice_number_v1(v_invoice.system_invoice_number);
  IF v_invoice.branch <> p_branch
     OR v_number <> public.bconnect_canonical_invoice_number_v1(p_invoice_number)
     OR COALESCE(v_invoice.total_value, 0) <> p_total_value
     OR COALESCE(btrim(v_invoice.supplier_name), '') <> COALESCE(btrim(p_app_supplier), '')
     OR v_invoice.invoice_date IS DISTINCT FROM p_app_date
  THEN RETURN jsonb_build_object('ok', false, 'error', 'stale_acceptance'); END IF;

  IF v_account->>'role' <> 'general_manager'
     AND NOT COALESCE((v_account->'branch_ids') ? p_branch, false)
  THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden_branch'); END IF;

  INSERT INTO public.bconnect_review_acceptances_v1(
    fingerprint, invoice_id, branch, invoice_number,
    bconnect_supplier, bconnect_date, app_supplier, app_date, total_value,
    accepted_by, accepted_by_name, accepted_at
  ) VALUES (
    p_fingerprint, p_invoice_id, p_branch, v_number,
    p_bconnect_supplier, p_bconnect_date, p_app_supplier, p_app_date, p_total_value,
    (v_account->>'id')::uuid, NULLIF(v_account->>'display_name',''), now()
  )
  ON CONFLICT (fingerprint) DO UPDATE SET
    accepted_by = EXCLUDED.accepted_by,
    accepted_by_name = EXCLUDED.accepted_by_name,
    accepted_at = now();

  RETURN jsonb_build_object('ok', true, 'fingerprint', p_fingerprint);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.bconnect_review_acceptance_lookup_v1(
  p_session_token text,
  p_fingerprints text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_auth jsonb;
BEGIN
  v_auth := public.validate_staff_session(p_session_token);
  IF COALESCE((v_auth->>'ok')::boolean, false) IS NOT TRUE
  THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_session'); END IF;

  IF p_fingerprints IS NULL OR cardinality(p_fingerprints) = 0
  THEN RETURN '[]'::jsonb; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'fingerprint', a.fingerprint,
      'accepted_at', a.accepted_at,
      'accepted_by_name', a.accepted_by_name
    ) ORDER BY a.accepted_at DESC)
    FROM public.bconnect_review_acceptances_v1 a
    WHERE a.fingerprint = ANY(p_fingerprints)
  ), '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.bconnect_review_accept_v1(text,text,text,text,text,text,date,text,date,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bconnect_review_acceptance_lookup_v1(text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bconnect_review_accept_v1(text,text,text,text,text,text,date,text,date,numeric) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bconnect_review_acceptance_lookup_v1(text,text[]) TO anon, authenticated, service_role;
