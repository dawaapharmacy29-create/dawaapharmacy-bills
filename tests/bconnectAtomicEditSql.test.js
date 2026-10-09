import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../docs/sql-staging/bconnect_atomic_edit_v1.sql', import.meta.url), 'utf8');

test('edit RPC is staging-only and not executable by clients', () => {
  assert.match(sql, /staging_approval_required/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.bconnect_atomic_edit_v1/);
});
test('edit RPC uses real staff session and branch\/ownership authorization', () => {
  assert.match(sql, /public\.validate_staff_session\(p_session_token\)/);
  assert.match(sql, /forbidden_branch/);
  assert.match(sql, /entered_by_account_id/);
});
test('edit RPC is serialized and idempotent', () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /idempotency_conflict/);
  assert.match(sql, /INSERT INTO public\.bconnect_invoice_operations_v1/);
});
test('edit RPC locks row and checks shared revision', () => {
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /stale_revision/);
  assert.match(sql, /source_review_required/);
});
test('edit RPC validates supplier, financial fields and keeps reconciliation identity immutable', () => {
  assert.match(sql, /FROM public\.suppliers s/);
  assert.match(sql, /invalid_supplier/);
  assert.match(sql, /returned_value = v_returned/);
  assert.match(sql, /total_value = v_total/);
  assert.match(sql, /invoice_date = v_invoice_date/);
  assert.match(sql, /identity_change_forbidden/);
  assert.match(sql, /legacy_identity_collision/);
  const updateSet = sql.match(/UPDATE public\.purchase_invoices SET([\s\S]*?)WHERE id = p_invoice_id/)?.[1] || '';
  assert.doesNotMatch(updateSet, /\bsystem_invoice_number\s*=/);
  assert.doesNotMatch(updateSet, /(?:^|\n)\s*branch\s*=/);
});
test('edit RPC does not expose workflow or audit ownership as writable patch fields', () => {
  const whitelist = sql.match(/ARRAY\[([\s\S]*?)\]\)\), false\)/)?.[1] || '';
  for (const field of ['workflow_status', 'status', 'entered_by', 'entered_by_account_id', 'reviewed_by_account_id', 'approved_by_account_id']) {
    assert.equal(whitelist.includes(`'${field}'`), false, field);
  }
});
test('edit RPC returns database revision, not an assumed increment', () => {
  assert.match(sql, /RETURNING bconnect_revision_v1 INTO v_actual_revision/);
  assert.match(sql, /'revision',v_actual_revision/);
});
