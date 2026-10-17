import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBranchTransfers } from '../src/lib/branchTransferControl.js';

function sale(invoice, qty, hour, minute = 0, code = '90001', dayOffset = 0) {
  return {
    invoice, code, product_name: 'SMART JOURNEY PRODUCT', qty, unit: 'علبة',
    date: new Date(2026, 9, 10 + dayOffset, hour, minute),
    branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي',
  };
}

function purchase(invoice, qty, hour, minute = 0, code = '90001', dayOffset = 0) {
  return {
    invoice, code, product_name: 'SMART JOURNEY PRODUCT', qty, unit: 'علبة',
    date: new Date(2026, 9, 10 + dayOffset, hour, minute), user: 'د مشتري',
    branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم',
  };
}

test('completes an exact-code residual quantity gap from a later split purchase on the same day', () => {
  const cases = reconcileBranchTransfers(
    [sale('S1', 3, 10, 0)],
    [purchase('P1', 2, 10, 30), purchase('P2', 1, 18, 30)],
  );

  const item = cases.find((entry) => entry.sale_codes?.includes('90001'));
  assert.ok(item);
  assert.equal(item.type, 'matched');
  assert.equal(item.sale_qty, 3);
  assert.equal(item.purchase_qty, 3);
  assert.equal(item.residual_journey_completed, true);
  assert.equal(item.residual_quantity_basis, 'canonical_box');
  assert.equal(item.residual_completion_policy, 'exact-code + trusted-canonical-box + exact-cumulative-residual + same-direction + later-same-or-next-day + unique-settlement');
  assert.equal(item.residual_settlement_count, 1);
  assert.equal(item.residual_settlement_next_day, false);
  assert.deepEqual(new Set(item.purchase_invoices), new Set(['P1', 'P2']));
  assert.match(item.match_reason, /اكتملت الكمية/);
});

test('completes one residual from multiple later movements whose cumulative quantity exactly balances', () => {
  const cases = reconcileBranchTransfers(
    [sale('S1', 3, 10, 0)],
    [
      purchase('P1', 1, 10, 30),
      purchase('P2', 1, 13, 0),
      purchase('P3', 1, 17, 0),
    ],
  );

  const item = cases.find((entry) => entry.residual_journey_completed);
  assert.ok(item);
  assert.equal(item.type, 'matched');
  assert.equal(item.sale_qty, 3);
  assert.equal(item.purchase_qty, 3);
  assert.equal(item.residual_settlement_count, 2);
  assert.equal(item.residual_settlement_qty, 2);
  assert.deepEqual(new Set(item.purchase_invoices), new Set(['P1', 'P2', 'P3']));
});

test('understands the reverse journey when the missing sale is recorded on the next day', () => {
  const cases = reconcileBranchTransfers(
    [sale('S1', 1, 11, 0), sale('S2', 1, 9, 0, '90001', 1)],
    [purchase('P1', 2, 11, 20)],
  );

  const item = cases.find((entry) => entry.residual_journey_completed);
  assert.ok(item);
  assert.equal(item.type, 'matched');
  assert.equal(item.sale_qty, 2);
  assert.equal(item.purchase_qty, 2);
  assert.equal(item.residual_settlement_side, 'sale');
  assert.equal(item.residual_settlement_next_day, true);
  assert.equal(item.confidence_score, 92);
});

test('keeps a partial delayed correction as progress and asks only for the remaining quantity', () => {
  const cases = reconcileBranchTransfers(
    [sale('S1', 3, 10, 0)],
    [purchase('P1', 1, 10, 30), purchase('P2', 1, 9, 0, '90001', 1)],
  );

  const mismatch = cases.find((entry) => entry.type === 'quantity_mismatch');
  assert.ok(mismatch);
  assert.equal(mismatch.sale_qty, 3);
  assert.equal(mismatch.purchase_qty, 1);
  assert.equal(mismatch.residual_progress_status, 'partial');
  assert.equal(mismatch.residual_needed_qty, 2);
  assert.equal(mismatch.residual_progress_qty, 1);
  assert.equal(mismatch.residual_remaining_qty, 1);
  assert.equal(mismatch.residual_progress_candidate_count, 1);
  assert.match(mismatch.next_action, /المتبقي 1/);
});

test('does not auto-complete a residual movement recorded two calendar days later', () => {
  const cases = reconcileBranchTransfers(
    [sale('S1', 3, 10, 0)],
    [purchase('P1', 2, 10, 30), purchase('P2', 1, 9, 0, '90001', 2)],
  );

  assert.ok(cases.some((entry) => entry.type === 'quantity_mismatch'));
  assert.ok(cases.some((entry) => entry.type === 'purchase_without_sale'));
  assert.equal(cases.some((entry) => entry.residual_journey_completed), false);
});

test('does not use a different product code to close a quantity gap', () => {
  const cases = reconcileBranchTransfers(
    [sale('S1', 3, 10, 0, '90001')],
    [purchase('P1', 2, 10, 30, '90001'), purchase('P2', 1, 11, 0, '90002')],
  );

  assert.equal(cases.some((entry) => entry.residual_journey_completed), false);
  assert.ok(cases.some((entry) => entry.type !== 'matched'));
});

test('does not choose arbitrarily when two different later movements can each explain the same residual', () => {
  const cases = reconcileBranchTransfers(
    [sale('S1', 3, 10, 0)],
    [
      purchase('P1', 2, 10, 30),
      purchase('P2', 1, 13, 0),
      purchase('P3', 1, 16, 0),
    ],
  );

  assert.equal(cases.some((entry) => entry.residual_journey_completed), false);
  const mismatch = cases.find((entry) => entry.type === 'quantity_mismatch');
  assert.ok(mismatch);
  assert.equal(mismatch.residual_candidate_count, 2);
  assert.equal(mismatch.residual_needed_qty, 1);
  assert.equal(mismatch.residual_candidates.length, 2);
  assert.equal(mismatch.residual_exact_solution_count, 2);
  assert.match(mismatch.residual_review_reason, /أكثر من مجموعة/);
  assert.equal(cases.filter((entry) => entry.type === 'purchase_without_sale').length, 2);
});
