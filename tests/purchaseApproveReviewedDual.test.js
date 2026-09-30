import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(
  new URL('../supabase/migrations/20260930110000_purchase_approve_reviewed_dual_v1.sql', import.meta.url),
  'utf8'
);

test('clean dual approval requires exact reviewed historical snapshot', () => {
  assert.match(sql, /dual_order_pair_required/);
  assert.match(sql, /historical_allocation_hash_required/);
  assert.match(sql, /smart_purchase_historical_allocation_preview_v1/);
  assert.match(sql, /historical_allocation_changed/);
  assert.match(sql, /reviewed_allocation_not_persisted/);
  assert.match(sql, /reviewed_total_mismatch/);
});

test('clean dual approval is atomic and does not dispatch', () => {
  assert.match(sql, /for update/);
  assert.match(sql, /get diagnostics v_updated = row_count/);
  assert.match(sql, /dual_approval_update_count_mismatch/);
  assert.match(sql, /status='معتمدة'/);
  assert.doesNotMatch(sql, /mark_supplier_sent/);
  assert.doesNotMatch(sql, /sent_at\s*=\s*now/);
});

test('clean dual approval records actual actor and requires both draft branches', () => {
  assert.match(sql, /approved_by_account_id=a\.id/);
  assert.match(sql, /approved_by_name=a\.display_name/);
  assert.match(sql, /approval_requires_draft_pair/);
  assert.match(sql, /invalid_dual_order_pair/);
  assert.match(sql, /دواء شكري/);
  assert.match(sql, /دواء الشامي/);
});
