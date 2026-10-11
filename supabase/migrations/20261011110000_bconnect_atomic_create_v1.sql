CREATE OR REPLACE FUNCTION public.bconnect_atomic_create_v1(
  p_session_token text,
  p_operation_id text,
  p_invoice jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $fn$
DECLARE
  v_auth jsonb; v_account jsonb; v_hash text;
  v_existing public.bconnect_invoice_operations_v1%ROWTYPE; v_result jsonb;
  v_number text; v_branch text; v_supplier_id text; v_supplier_name text;
  v_date_text text; v_invoice_date date; v_total numeric; v_returned numeric; v_cash numeric;
  v_payment_type text; v_invoice_id text; v_revision bigint; v_unknown boolean; v_bad_text_type boolean;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id !~ '^[A-Za-z0-9_-]{16,128}$'
     OR p_invoice IS NULL OR jsonb_typeof(p_invoice)<>'object'
  THEN RETURN jsonb_build_object('ok',false,'error','invalid_request'); END IF;

  SELECT COALESCE(bool_or(key <> ALL (ARRAY[
    'system_invoice_number','branch','supplier_id','supplier_name','invoice_date','total_value','returned_value','cash_amount',
    'supplier_invoice_number','payment_type','notes','purchase_category','purchase_category_source','transaction_type',
    'net_purchase_mode','exclusion_reason','exclusion_note','source_branch','destination_branch'
  ])),false) INTO v_unknown FROM jsonb_object_keys(p_invoice) AS key;
  IF v_unknown THEN RETURN jsonb_build_object('ok',false,'error','invalid_request'); END IF;

  IF jsonb_typeof(p_invoice->'system_invoice_number')<>'string'
     OR jsonb_typeof(p_invoice->'branch')<>'string'
     OR jsonb_typeof(p_invoice->'supplier_id')<>'string'
     OR jsonb_typeof(p_invoice->'supplier_name')<>'string'
     OR jsonb_typeof(p_invoice->'invoice_date')<>'string'
     OR jsonb_typeof(p_invoice->'total_value') NOT IN ('number','string')
     OR (p_invoice ? 'returned_value' AND jsonb_typeof(p_invoice->'returned_value') NOT IN ('number','string'))
     OR (p_invoice ? 'cash_amount' AND jsonb_typeof(p_invoice->'cash_amount') NOT IN ('number','string'))
  THEN RETURN jsonb_build_object('ok',false,'error','invalid_request'); END IF;

  SELECT COALESCE(bool_or(jsonb_typeof(p_invoice->key) NOT IN ('string','null')),false) INTO v_bad_text_type
  FROM unnest(ARRAY['supplier_invoice_number','payment_type','notes','purchase_category','purchase_category_source','transaction_type','net_purchase_mode','exclusion_reason','exclusion_note','source_branch','destination_branch']) AS key
  WHERE p_invoice ? key;
  IF v_bad_text_type THEN RETURN jsonb_build_object('ok',false,'error','invalid_request'); END IF;

  v_auth := public.validate_staff_session(p_session_token);
  IF COALESCE((v_auth->>'ok')::boolean,false) IS NOT TRUE THEN RETURN jsonb_build_object('ok',false,'error','invalid_session'); END IF;
  v_account := v_auth->'account';
  IF COALESCE(v_account->>'role','') NOT IN ('general_manager','branch_manager','purchasing','invoice_entry') THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id,0));
  v_hash := encode(digest(jsonb_build_object('mode','create','invoice',p_invoice)::text,'sha256'),'hex');
  SELECT * INTO v_existing FROM public.bconnect_invoice_operations_v1 WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF v_existing.actor_id::text<>v_account->>'id' OR v_existing.request_hash<>v_hash THEN RETURN jsonb_build_object('ok',false,'error','idempotency_conflict'); END IF;
    RETURN v_existing.result;
  END IF;

  BEGIN
    v_number := public.bconnect_canonical_invoice_number_v1(p_invoice->>'system_invoice_number');
    v_branch := btrim(p_invoice->>'branch');
    v_supplier_id := btrim(p_invoice->>'supplier_id');
    v_supplier_name := btrim(p_invoice->>'supplier_name');
    v_date_text := p_invoice->>'invoice_date';
    v_invoice_date := v_date_text::date;
    v_total := (p_invoice->>'total_value')::numeric;
    v_returned := CASE WHEN p_invoice ? 'returned_value' THEN (p_invoice->>'returned_value')::numeric ELSE 0 END;
    v_cash := CASE WHEN p_invoice ? 'cash_amount' THEN (p_invoice->>'cash_amount')::numeric ELSE 0 END;
    v_payment_type := btrim(COALESCE(p_invoice->>'payment_type',''));
  EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok',false,'error','invalid_invoice'); END;

  IF v_number IS NULL OR v_number !~ '^[0-9]+$' OR v_number !~ '[1-9]' OR v_branch NOT IN ('دواء شكري','دواء الشامي')
     OR v_supplier_id IS NULL OR v_supplier_id='' OR v_supplier_name IS NULL OR v_supplier_name=''
     OR v_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR to_char(v_invoice_date,'YYYY-MM-DD')<>v_date_text
     OR v_total IS NULL OR v_total<0 OR v_returned IS NULL OR v_returned<0 OR v_returned>v_total
     OR v_cash IS NULL OR v_cash<0 OR v_cash>v_total-v_returned
  THEN RETURN jsonb_build_object('ok',false,'error','invalid_invoice'); END IF;
  IF v_payment_type NOT IN ('كاش','آجل') THEN RETURN jsonb_build_object('ok',false,'error','invalid_payment_type'); END IF;

  IF v_account->>'role'<>'general_manager' AND NOT COALESCE((v_account->'branch_ids') ? v_branch,false) THEN RETURN jsonb_build_object('ok',false,'error','forbidden_branch'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id=v_supplier_id AND btrim(s.name)=v_supplier_name AND COALESCE(s.is_sample,false)=false) THEN RETURN jsonb_build_object('ok',false,'error','invalid_supplier'); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('bconnect-create:'||v_branch||':'||v_number,0));
  IF EXISTS (
    SELECT 1 FROM public.purchase_invoices p
    WHERE p.branch=v_branch
      AND public.bconnect_canonical_invoice_number_v1(p.system_invoice_number)=v_number
      AND COALESCE(p.is_sample,false)=false
  ) THEN RETURN jsonb_build_object('ok',false,'error','invoice_already_exists'); END IF;

  LOOP
    v_invoice_id := encode(gen_random_bytes(12),'hex');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.purchase_invoices p WHERE p.id=v_invoice_id);
  END LOOP;

  INSERT INTO public.purchase_invoices(
    id, system_invoice_number, supplier_invoice_number, invoice_date, branch, supplier_id, supplier_name,
    total_value, returned_value, cash_amount, notes, source_branch, destination_branch,
    exclusion_reason, exclusion_note, purchase_category, purchase_category_source, net_purchase_mode,
    transaction_type, payment_type, status, workflow_status,
    entered_by_account_id, entered_by_name, entered_by, created_by_id, created_by,
    created_at, updated_at, is_sample, base44_sync_state
  ) VALUES (
    v_invoice_id, v_number, NULLIF(p_invoice->>'supplier_invoice_number',''), v_invoice_date, v_branch, v_supplier_id, v_supplier_name,
    v_total, v_returned, v_cash, NULLIF(p_invoice->>'notes',''), NULLIF(p_invoice->>'source_branch',''), NULLIF(p_invoice->>'destination_branch',''),
    NULLIF(p_invoice->>'exclusion_reason',''), NULLIF(p_invoice->>'exclusion_note',''), NULLIF(p_invoice->>'purchase_category',''), NULLIF(p_invoice->>'purchase_category_source',''), NULLIF(p_invoice->>'net_purchase_mode',''),
    NULLIF(p_invoice->>'transaction_type',''), v_payment_type, 'تحت المراجعة', 'draft',
    (v_account->>'id')::uuid, NULLIF(v_account->>'display_name',''), NULLIF(v_account->>'display_name',''), v_account->>'id', NULLIF(v_account->>'display_name',''),
    now(), now(), false, 'active'
  ) RETURNING bconnect_revision_v1 INTO v_revision;

  v_result := jsonb_build_object('ok',true,'invoice_id',v_invoice_id,'revision',v_revision);
  INSERT INTO public.bconnect_invoice_operations_v1(operation_id,request_hash,invoice_id,result,actor_id)
  VALUES(p_operation_id,v_hash,v_invoice_id,v_result,(v_account->>'id')::uuid);
  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.bconnect_atomic_create_v1(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bconnect_atomic_create_v1(text,text,jsonb) TO anon, authenticated, service_role;
