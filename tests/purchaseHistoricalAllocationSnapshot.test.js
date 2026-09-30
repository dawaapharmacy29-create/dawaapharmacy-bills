import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(
  new URL('../supabase/migrations/20260930093000_purchase_historical_allocation_snapshot_v2.sql', import.meta.url),
  'utf8'
);

test('historical allocation preview and apply share the canonical owner', () => {
  assert.match(sql, /smart_purchase_historical_allocation_preview_v1/);
  assert.match(sql, /smart_purchase_apply_historical_allocation_v2/);
  assert.ok((sql.match(/purchase_historical_supplier_choice_v1/g) || []).length >= 3);
});

test('apply fails closed when reviewed history changed', () => {
  assert.match(sql, /historical_allocation_hash_required/);
  assert.match(sql, /historical_allocation_changed/);
  assert.match(sql, /p_expected_hash/);
  assert.match(sql, /allocation_hash/);
  assert.match(sql, /sha256/);
});

test('snapshot apply remains draft-only and does not approve, send, or receive', () => {
  assert.match(sql, /historical_allocation_requires_draft/);
  assert.match(sql, /order_execution_started/);
  assert.doesNotMatch(sql, /status\s*=\s*'approved'/);
  assert.doesNotMatch(sql, /sent_at\s*=\s*now/);
  assert.doesNotMatch(sql, /purchase_order_receipts\s*\(/);
});


test('snapshot hash covers quantity and evidence, and apply is transactionally verified', () => {
  assert.match(sql, /quantity::text/);
  assert.match(sql, /purchase_events,0/);
  assert.match(sql, /last_purchase_date::text/);
  assert.match(sql, /for update/);
  assert.match(sql, /get diagnostics v_updated_items = row_count/);
  assert.match(sql, /historical_allocation_apply_count_mismatch/);
  assert.match(sql, /historical_allocation_total_mismatch/);
  assert.match(sql, /a\.id/);
  assert.match(sql, /a\.display_name/);
});
