import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBranchTransfers } from '../src/lib/branchTransferControl.js';

function sale(invoice, qty, hour, minute = 0, code = '90001') {
  return {
    invoice, code, product_name: 'SMART JOURNEY PRODUCT', qty, unit: 'علبة',
    date: new Date(2026, 9, 10, hour, minute),
    branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي',
  };
}

function purchase(invoice, qty, hour, minute = 0, code = '90001') {
  return {
    invoice, code, product_name: 'SMART JOURNEY PRODUCT', qty, unit: 'علبة',
    date: new Date(2026, 9, 10, hour, minute), user: 'د مشتري',
    branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم',
  };
}

test('completes an exact-code residual quantity gap from a later split purchase within four hours', () => {
  const cases = reconcileBranchTransfers(
    [sale('S1', 3, 10, 0)],
    [purchase('P1', 2, 10, 30), purchase('P2', 1, 13, 30)],
  );

  const item = cases.find((entry) => entry.sale_codes?.includes('90001'));
  assert.ok(item);
  assert.equal(item.type, 'matched');
  assert.equal(item.sale_qty, 3);
  assert.equal(item.purchase_qty, 3);
  assert.equal(item.residual_journey_completed, true);
  assert.deepEqual(new Set(item.purchase_invoices), new Set(['P1', 'P2']));
  assert.match(item.match_reason, /اكتملت الكمية/);
});

test('does not auto-complete a residual movement outside the bounded four-hour window', () => {
  const cases = reconcileBranchTransfers(
    [sale('S1', 3, 10, 0)],
    [purchase('P1', 2, 10, 30), purchase('P2', 1, 15, 0)],
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

test('does not choose arbitrarily when two residual movements could both explain the same gap', () => {
  const cases = reconcileBranchTransfers(
    [sale('S1', 3, 10, 0)],
    [
      purchase('P1', 2, 10, 30),
      purchase('P2', 1, 11, 0),
      purchase('P3', 1, 11, 20),
    ],
  );

  assert.equal(cases.some((entry) => entry.residual_journey_completed), false);
  assert.ok(cases.some((entry) => entry.type === 'quantity_mismatch'));
  assert.equal(cases.filter((entry) => entry.type === 'purchase_without_sale').length, 2);
});
