import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBranchTransfers } from '../src/lib/branchTransferControl.js';

function sale(invoice, qty, timestamp, code = '91001') {
  return {
    invoice, code, product_name: 'STABLE ID PRODUCT', qty, unit: 'علبة', date: timestamp,
    branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي',
  };
}

function purchase(invoice, qty, timestamp, code = '91001') {
  return {
    invoice, code, product_name: 'STABLE ID PRODUCT', qty, unit: 'علبة', date: timestamp,
    branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم',
  };
}

test('sale-origin review id stays stable after a later purchase is uploaded', () => {
  const first = reconcileBranchTransfers([
    sale('S100', 3, new Date(2026, 9, 10, 10, 0)),
  ], []);
  const initial = first.find((item) => item.type === 'sale_without_purchase');
  assert.ok(initial);

  const later = reconcileBranchTransfers([
    sale('S100', 3, new Date(2026, 9, 10, 10, 0)),
  ], [
    purchase('P200', 2, new Date(2026, 9, 10, 12, 0)),
  ]);
  const regrouped = later.find((item) => item.type === 'quantity_mismatch');
  assert.ok(regrouped);
  assert.equal(regrouped.id, initial.id);
});

test('purchase-origin review id stays stable after a later sale is uploaded', () => {
  const first = reconcileBranchTransfers([], [
    purchase('P300', 3, new Date(2026, 9, 10, 10, 0)),
  ]);
  const initial = first.find((item) => item.type === 'purchase_without_sale');
  assert.ok(initial);

  const later = reconcileBranchTransfers([
    sale('S400', 2, new Date(2026, 9, 10, 12, 0)),
  ], [
    purchase('P300', 3, new Date(2026, 9, 10, 10, 0)),
  ]);
  const regrouped = later.find((item) => item.type === 'quantity_mismatch');
  assert.ok(regrouped);
  assert.equal(regrouped.id, initial.id);
});

test('undated rows never receive a fake epoch-based stable id anchor', () => {
  const cases = reconcileBranchTransfers([
    sale('S500', 1, ''),
  ], []);
  const item = cases.find((entry) => entry.type === 'sale_without_purchase');
  assert.ok(item);
  assert.equal(item.sale_lines[0].timestamp_ms, undefined);
  assert.equal(item.id, item.legacy_case_id);
});
