import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../docs/sql-staging/bconnect_atomic_edit_v1.sql', import.meta.url), 'utf8');

test('edit RPC is staging-only and not executable by clients', () => {
  assert.match(sql, /staging_approval_required/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.bconnect_atomic_edit_v1/);
});
test('edit RPC uses real staff session and branch/ownership authorization', () => {
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
test('edit RPC is narrow and does not mutate identity or amounts', () => {
  assert.match(sql, /UPDATE public\.purchase_invoices SET notes = v_notes/);
  assert.doesNotMatch(sql, /UPDATE public\.purchase_invoices SET (?:system_invoice_number|total_value|branch)/);
});
