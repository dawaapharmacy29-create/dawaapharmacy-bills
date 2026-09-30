import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20260930043000_purchase_apply_historical_allocation_v1.sql', import.meta.url),
  'utf8'
);
const page = await readFile(new URL('../src/pages/PurchaseCenterClean.jsx', import.meta.url), 'utf8');
const workspace = await readFile(
  new URL('../src/components/purchases/CleanSupplierFinancialWorkspace.jsx', import.meta.url),
  'utf8'
);

test('historical allocation stays draft-only, complete and non-executing', () => {
  assert.match(migration, /historical_allocation_requires_draft/);
  assert.match(migration, /order_execution_started/);
  assert.match(migration, /historical_allocation_incomplete/);
  assert.match(migration, /supplier_name=p\.supplier_name/);
  assert.match(migration, /expected_unit_cost=round\(p\.hist_cost/);
  assert.match(migration, /expected_total=round/);
  assert.doesNotMatch(migration, /status='approved'/);
  assert.doesNotMatch(migration, /mark_supplier_sent/);
});

test('clean page prevents overlapping supplier-history reloads', () => {
  assert.match(page, /supplierLoadRef/);
  assert.match(page, /supplierLoadRef\.current = true/);
  assert.match(page, /supplierLoadRef\.current = false/);
});

test('applied historical totals reconcile to persisted draft totals', () => {
  assert.match(workspace, /historicalComparisonTotal/);
  assert.match(workspace, /historicalApplied && storedDraftTotal > 0/);
  assert.match(page, /displayedBranchTotals/);
});
