import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../docs/sql-staging/bconnect_atomic_create_v1.sql', import.meta.url), 'utf8');

test('create RPC is guarded and not directly executable in staging fixture', () => {
  assert.match(sql, /staging_approval_required/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.bconnect_atomic_create_v1/);
});

test('create RPC authenticates staff and enforces roles and branch access', () => {
  assert.match(sql, /public\.validate_staff_session\(p_session_token\)/);
  assert.match(sql, /general_manager.*branch_manager.*purchasing.*invoice_entry/s);
  assert.match(sql, /forbidden_branch/);
});

test('create RPC is idempotent and serializes branch plus invoice identity', () => {
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_operation_id,0\)\)/);
  assert.match(sql, /bconnect-create:/);
  assert.match(sql, /invoice_already_exists/);
  assert.match(sql, /INSERT INTO public\.bconnect_invoice_operations_v1/);
  assert.match(sql, /idempotency_conflict/);
});

test('create RPC validates supplier, amounts, date and payment type', () => {
  assert.match(sql, /FROM public\.suppliers s/);
  assert.match(sql, /invalid_supplier/);
  assert.match(sql, /invalid_invoice/);
  assert.match(sql, /invalid_payment_type/);
  assert.match(sql, /'كاش','آجل'/);
});

test('create RPC writes review draft ownership from authenticated account', () => {
  assert.match(sql, /'تحت المراجعة', 'draft'/);
  assert.match(sql, /entered_by_account_id/);
  assert.match(sql, /entered_by_name/);
  assert.match(sql, /v_account->>'display_name'/);
  assert.match(sql, /base44_sync_state/);
});

test('create RPC allowlist excludes server-owned workflow and audit fields', () => {
  const whitelist = sql.match(/ARRAY\[([\s\S]*?)\]\)\),false\)/)?.[1] || '';
  for (const field of ['id', 'status', 'workflow_status', 'entered_by', 'entered_by_account_id', 'created_by', 'created_at', 'bconnect_revision_v1']) {
    assert.equal(whitelist.includes(`'${field}'`), false, field);
  }
});
