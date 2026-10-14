import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTransferLine, reconcileBranchTransfers, resolveTransferBranch } from '../src/lib/branchTransferControl.js';

test('maps internal warehouse Dr Wael to Shokry and Dr Moaz to Shamy', () => {
  assert.equal(resolveTransferBranch('مخزن د/ وائل'), 'shokry');
  assert.equal(resolveTransferBranch('مخزن الدكتور وائل'), 'shokry');
  assert.equal(resolveTransferBranch('مخزن د/ معاذ'), 'shamy');
  assert.equal(resolveTransferBranch('مخزن الدكتور معاذ'), 'shamy');
});

test('preserves physical warehouse identity while normalizing to the parent branch', () => {
  const line = normalizeTransferLine({
    branch: 'مخزن د/ وائل',
    counterparty: 'دواء فرع الشامي',
    product_name: 'Test Product',
    code: '1000',
    qty: 1,
    invoice: 'S-1',
    date: '2026-10-14 10:00',
  }, 'sale');

  assert.equal(line.branch, 'shokry');
  assert.equal(line.from, 'shokry');
  assert.equal(line.to, 'shamy');
  assert.equal(line.raw.physical_branch, 'مخزن د/ وائل');
  assert.equal(line.raw.physical_branch_parent, 'shokry');
});

test('matches sales and purchases through internal warehouses as their parent branches', () => {
  const sales = [{
    branch: 'مخزن د/ وائل',
    counterparty: 'مخزن د/ معاذ',
    product_name: 'Alphintern 30 tab',
    code: '100',
    qty: 2,
    invoice: 'S-100',
    user: 'د/ أحمد',
    date: '2026-10-14 10:00',
  }];
  const purchases = [{
    branch: 'مخزن د/ معاذ',
    counterparty: 'مخزن د/ وائل',
    product_name: 'Alphintern 30 tab',
    code: '100',
    qty: 2,
    invoice: 'P-100',
    user: 'د/ محمود',
    date: '2026-10-14 10:10',
  }];

  const cases = reconcileBranchTransfers(sales, purchases);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].type, 'matched');
  assert.equal(cases[0].from, 'shokry');
  assert.equal(cases[0].to, 'shamy');
});

test('treats buying into Dr Wael warehouse as Shokry purchase and buying into Dr Moaz as Shamy purchase', () => {
  const waelPurchase = normalizeTransferLine({
    branch: 'مخزن د/ وائل',
    counterparty: 'دواء فرع الشامي',
    product_name: 'P1', code: '1', qty: 1, invoice: 'P1', date: '2026-10-14 11:00',
  }, 'purchase');
  const moazPurchase = normalizeTransferLine({
    branch: 'مخزن د/ معاذ',
    counterparty: 'دواء فرع ابو العزم',
    product_name: 'P2', code: '2', qty: 1, invoice: 'P2', date: '2026-10-14 11:00',
  }, 'purchase');

  assert.equal(waelPurchase.branch, 'shokry');
  assert.equal(waelPurchase.to, 'shokry');
  assert.equal(moazPurchase.branch, 'shamy');
  assert.equal(moazPurchase.to, 'shamy');
});
