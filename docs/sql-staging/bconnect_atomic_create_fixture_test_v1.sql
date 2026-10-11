-- Rollback-only integration assertions for bconnect_atomic_create_v1.
BEGIN;

DO $test$
DECLARE
  v_first jsonb;
  v_replay jsonb;
  v_duplicate jsonb;
  v_wrong_branch jsonb;
  v_bad_supplier jsonb;
  v_bad_payment jsonb;
  v_created_id text;
  v_count integer;
BEGIN
  v_first := public.bconnect_atomic_create_v1(
    'fixture-token-only',
    'bconnect-create-fixture-20001',
    jsonb_build_object(
      'system_invoice_number','20001.0',
      'branch','دواء شكري',
      'supplier_id','supplier-1',
      'supplier_name','مورد تجريبي',
      'invoice_date','2026-10-10',
      'total_value',102,
      'returned_value',0,
      'cash_amount',0,
      'payment_type','آجل',
      'notes','created from fixture'
    )
  );
  IF COALESCE((v_first->>'ok')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'create failed: %', v_first;
  END IF;
  v_created_id := v_first->>'invoice_id';
  IF v_created_id IS NULL OR length(v_created_id)<>24 OR (v_first->>'revision')::bigint<>1 THEN
    RAISE EXCEPTION 'unexpected create result: %', v_first;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.purchase_invoices
  WHERE id=v_created_id
    AND system_invoice_number='20001'
    AND branch='دواء شكري'
    AND supplier_id='supplier-1'
    AND supplier_name='مورد تجريبي'
    AND invoice_date='2026-10-10'
    AND total_value=102
    AND returned_value=0
    AND cash_amount=0
    AND payment_type='آجل'
    AND status='تحت المراجعة'
    AND workflow_status='draft'
    AND entered_by_account_id='11111111-1111-4111-8111-111111111111'::uuid
    AND entered_by_name='Fixture'
    AND base44_sync_state='active';
  IF v_count<>1 THEN RAISE EXCEPTION 'created invoice fields are wrong'; END IF;

  v_replay := public.bconnect_atomic_create_v1(
    'fixture-token-only',
    'bconnect-create-fixture-20001',
    jsonb_build_object(
      'system_invoice_number','20001.0','branch','دواء شكري','supplier_id','supplier-1','supplier_name','مورد تجريبي',
      'invoice_date','2026-10-10','total_value',102,'returned_value',0,'cash_amount',0,'payment_type','آجل','notes','created from fixture'
    )
  );
  IF v_replay IS DISTINCT FROM v_first THEN RAISE EXCEPTION 'idempotent replay changed result'; END IF;

  v_duplicate := public.bconnect_atomic_create_v1(
    'fixture-token-only',
    'bconnect-create-fixture-duplicate',
    jsonb_build_object(
      'system_invoice_number','20001','branch','دواء شكري','supplier_id','supplier-1','supplier_name','مورد تجريبي',
      'invoice_date','2026-10-10','total_value',102,'returned_value',0,'payment_type','آجل'
    )
  );
  IF v_duplicate->>'error'<>'invoice_already_exists' THEN RAISE EXCEPTION 'same-branch duplicate was not blocked: %', v_duplicate; END IF;

  -- Same invoice number in the other branch is allowed for an authorized general manager.
  v_wrong_branch := public.bconnect_atomic_create_v1(
    'fixture-token-only',
    'bconnect-create-fixture-otherbranch',
    jsonb_build_object(
      'system_invoice_number','20001','branch','دواء الشامي','supplier_id','supplier-1','supplier_name','مورد تجريبي',
      'invoice_date','2026-10-10','total_value',99,'returned_value',0,'payment_type','كاش'
    )
  );
  IF COALESCE((v_wrong_branch->>'ok')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'cross-branch number should be allowed: %', v_wrong_branch; END IF;

  v_bad_supplier := public.bconnect_atomic_create_v1(
    'fixture-token-only',
    'bconnect-create-fixture-badsupp',
    jsonb_build_object(
      'system_invoice_number','20002','branch','دواء شكري','supplier_id','supplier-sample','supplier_name','مورد عينة',
      'invoice_date','2026-10-10','total_value',10,'returned_value',0,'payment_type','آجل'
    )
  );
  IF v_bad_supplier->>'error'<>'invalid_supplier' THEN RAISE EXCEPTION 'sample supplier should be blocked: %', v_bad_supplier; END IF;

  v_bad_payment := public.bconnect_atomic_create_v1(
    'fixture-token-only',
    'bconnect-create-fixture-badpayment',
    jsonb_build_object(
      'system_invoice_number','20003','branch','دواء شكري','supplier_id','supplier-1','supplier_name','مورد تجريبي',
      'invoice_date','2026-10-10','total_value',10,'returned_value',0,'payment_type','غير معروف'
    )
  );
  IF v_bad_payment->>'error'<>'invalid_payment_type' THEN RAISE EXCEPTION 'invalid payment should be blocked: %', v_bad_payment; END IF;

  IF (public.bconnect_atomic_create_v1(
      'fixture-entry-token','bconnect-create-fixture-forbiddenbranch',
      jsonb_build_object('system_invoice_number','20004','branch','دواء الشامي','supplier_id','supplier-1','supplier_name','مورد تجريبي','invoice_date','2026-10-10','total_value',10,'returned_value',0,'payment_type','آجل')
    )->>'error') <> 'forbidden_branch' THEN
    RAISE EXCEPTION 'branch authorization was not enforced';
  END IF;

  IF (public.bconnect_atomic_create_v1(
      'fixture-viewer-token','bconnect-create-fixture-viewer',
      jsonb_build_object('system_invoice_number','20005','branch','دواء شكري','supplier_id','supplier-1','supplier_name','مورد تجريبي','invoice_date','2026-10-10','total_value',10,'returned_value',0,'payment_type','آجل')
    )->>'error') <> 'forbidden' THEN
    RAISE EXCEPTION 'role authorization was not enforced';
  END IF;
END
$test$;

ROLLBACK;
