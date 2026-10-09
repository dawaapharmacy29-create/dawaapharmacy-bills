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
