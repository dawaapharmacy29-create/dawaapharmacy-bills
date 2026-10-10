import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../docs/sql-staging/bconnect_atomic_foundation_v1.sql', import.meta.url), 'utf8');

test('staging foundation fails closed without explicit approval', () => {
  assert.match(sql, /app\.bconnect_staging_approved/);
  assert.match(sql, /staging_approval_required/);
});

test('branch-scoped uniqueness is approved but enforcement remains blocked by legacy collisions', () => {
  assert.match(sql, /Approved policy: invoice numbers are unique WITHIN each branch/);
  assert.match(sql, /^-- CREATE UNIQUE INDEX CONCURRENTLY bconnect_branch_invoice_number_v1_idx/m);
  assert.doesNotMatch(sql, /^CREATE UNIQUE INDEX(?: CONCURRENTLY)? bconnect_branch_invoice_number_v1_idx/m);
});

test('all invoice update paths advance a shared revision through a database trigger', () => {
  assert.match(sql, /bconnect_revision_v1 bigint NOT NULL DEFAULT 1/);
  assert.match(sql, /NEW\.bconnect_revision_v1 := OLD\.bconnect_revision_v1 \+ 1/);
  assert.match(sql, /BEFORE UPDATE ON public\.purchase_invoices/);
});

test('operation ledger is not exposed to direct client writes', () => {
  assert.match(sql, /operation_id text PRIMARY KEY/);
  assert.match(sql, /REVOKE ALL ON public\.bconnect_invoice_operations_v1 FROM PUBLIC, anon, authenticated/);
});
