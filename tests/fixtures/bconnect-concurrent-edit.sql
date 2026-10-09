-- Disposable PostgreSQL concurrent write assertion.
-- Run in GitHub Actions only against synthetic fixture rows.
-- Two sessions submit the same expected revision simultaneously.
-- Exactly one succeeds, the other must report stale_revision.
CREATE EXTENSION IF NOT EXISTS dblink;
DO $$
DECLARE
  v_conn text := 'host=localhost port=5432 dbname=bconnect_fixture user=postgres password=fixture-only';
  v_a jsonb;
  v_b jsonb;
  v_revision bigint;
  v_notes text;
  v_count integer;
BEGIN
  SELECT bconnect_revision_v1 INTO v_revision FROM public.purchase_invoices
    WHERE id='fixture-owned-draft';
  PERFORM dblink_connect('bconnect_race_a',v_conn);
  PERFORM dblink_connect('bconnect_race_b',v_conn);
  PERFORM dblink_send_query('bconnect_race_a',
    format('SELECT public.bconnect_atomic_edit_v1(%L,%L,%L,%s,%L::jsonb)::text',
      'fixture-entry-token','test_concurrent_race_a001','fixture-owned-draft',
      v_revision,'{"notes":"race A"}'));
  PERFORM dblink_send_query('bconnect_race_b',
    format('SELECT public.bconnect_atomic_edit_v1(%L,%L,%L,%s,%L::jsonb)::text',
      'fixture-entry-token','test_concurrent_race_b001','fixture-owned-draft',
      v_revision,'{"notes":"race B"}'));
  SELECT result::jsonb INTO v_a FROM dblink_get_result('bconnect_race_a') AS t(result text);
  SELECT result::jsonb INTO v_b FROM dblink_get_result('bconnect_race_b') AS t(result text);
  PERFORM dblink_disconnect('bconnect_race_a');
  PERFORM dblink_disconnect('bconnect_race_b');
  v_count := (CASE WHEN v_a->>'ok'='true' THEN 1 ELSE 0 END)
           + (CASE WHEN v_b->>'ok'='true' THEN 1 ELSE 0 END);
  IF v_count <> 1 OR NOT (v_a->>'error'='stale_revision' OR v_b->>'error'='stale_revision') THEN
    RAISE EXCEPTION 'concurrency_violation: % / %',v_a,v_b;
  END IF;
  SELECT notes INTO v_notes FROM public.purchase_invoices WHERE id='fixture-owned-draft';
  IF v_notes NOT IN ('race A','race B') THEN
    RAISE EXCEPTION 'concurrent_final_value_unexpected: %',v_notes;
  END IF;
END $$;

-- Concurrent retries sharing the SAME idempotency key must return the same
-- successful result and must create one operation and one revision increment.
DO $same_key$
DECLARE
  v_conn text := 'host=localhost port=5432 dbname=bconnect_fixture user=postgres password=fixture-only';
  v_a jsonb;
  v_b jsonb;
  v_revision bigint;
  v_after bigint;
  v_count integer;
BEGIN
  SELECT bconnect_revision_v1 INTO v_revision FROM public.purchase_invoices
    WHERE id='fixture-owned-draft';
  PERFORM dblink_connect('bconnect_retry_a',v_conn);
  PERFORM dblink_connect('bconnect_retry_b',v_conn);
  PERFORM dblink_send_query('bconnect_retry_a',
    format('SELECT public.bconnect_atomic_edit_v1(%L,%L,%L,%s,%L::jsonb)::text',
      'fixture-entry-token','test_concurrent_same_key001','fixture-owned-draft',
      v_revision,'{"notes":"retry safe"}'));
  PERFORM dblink_send_query('bconnect_retry_b',
    format('SELECT public.bconnect_atomic_edit_v1(%L,%L,%L,%s,%L::jsonb)::text',
      'fixture-entry-token','test_concurrent_same_key001','fixture-owned-draft',
      v_revision,'{"notes":"retry safe"}'));
  SELECT result::jsonb INTO v_a FROM dblink_get_result('bconnect_retry_a') AS t(result text);
  SELECT result::jsonb INTO v_b FROM dblink_get_result('bconnect_retry_b') AS t(result text);
  PERFORM dblink_disconnect('bconnect_retry_a');
  PERFORM dblink_disconnect('bconnect_retry_b');
  SELECT bconnect_revision_v1 INTO v_after FROM public.purchase_invoices WHERE id='fixture-owned-draft';
  SELECT count(*) INTO v_count FROM public.bconnect_invoice_operations_v1
    WHERE operation_id='test_concurrent_same_key001';
  IF v_a IS DISTINCT FROM v_b OR v_a->>'ok' IS DISTINCT FROM 'true'
     OR v_after <> v_revision + 1 OR v_count <> 1
     OR (SELECT notes FROM public.purchase_invoices WHERE id='fixture-owned-draft') IS DISTINCT FROM 'retry safe' THEN
    RAISE EXCEPTION 'same_key_concurrent_retry_failed: % / %, revision % -> %, ledger %',
      v_a,v_b,v_revision,v_after,v_count;
  END IF;
END $same_key$;
