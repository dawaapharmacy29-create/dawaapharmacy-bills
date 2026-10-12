import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBranchTransfers, resolveTransferBranch, summarizeTransferCases, transferErrorRate } from '../src/lib/branchTransferControl.js';

const sale = (overrides = {}) => ({
  branch: 'دواء فرع الشامي',
  counterparty: 'دواء فرع ابو العزم',
  product_name: 'Alphintern 30 tab',
  code: '100',
  qty: 2,
  unit: 'علبة',
  invoice: 'S-1',
  user: 'د/ أحمد',
  date: '2026-10-12 10:00',
  ...overrides,
});

const purchase = (overrides = {}) => ({
  branch: 'دواء فرع ابو العزم',
  counterparty: 'دواء فرع الشامي',
  product_name: 'Alphintern 30 tab',
  code: '100',
  qty: 2,
  invoice: 'P-1',
  user: 'د/ محمود',
  date: '2026-10-12 10:20',
  ...overrides,
});

test('resolves the real B-Connect branch aliases and noisy Abu El Azm customer label', () => {
  assert.equal(resolveTransferBranch('دواء فرع ابو العزم'), 'shokry');
  assert.equal(resolveTransferBranch('دواء ابو العزم'), 'shokry');
  assert.equal(resolveTransferBranch('فرع ابو اااااااالعزم'), 'shokry');
  assert.equal(resolveTransferBranch('دواء فرع الشامي'), 'shamy');
});

test('marks equal sale and purchase as matched', () => {
  const cases = reconcileBranchTransfers([sale()], [purchase()]);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].type, 'matched');
  assert.equal(cases[0].sale_qty, 2);
  assert.equal(cases[0].purchase_qty, 2);
});

test('detects quantity mismatch without losing direction', () => {
  const cases = reconcileBranchTransfers([sale({ qty: 2 })], [purchase({ qty: 1 })]);
  assert.equal(cases[0].type, 'quantity_mismatch');
  assert.equal(cases[0].from, 'shamy');
  assert.equal(cases[0].to, 'shokry');
  assert.match(cases[0].next_action, /شراء شكري/);
});

test('treats strip versus fractional-box pattern as unit conversion review, not confirmed error', () => {
  const cases = reconcileBranchTransfers(
    [sale({ product_name: 'ADWISTADINE 5 MG 30 F.C. TABS', code: '78156', qty: 1, unit: 'شريط' })],
    [purchase({ product_name: 'ADWISTADINE 5 MG 30 F.C. TABS', code: '78156', qty: 0.33 })],
  );
  assert.equal(cases[0].type, 'unit_conversion_review');
  const summary = summarizeTransferCases(cases);
  assert.equal(summary.unit_review, 1);
  assert.equal(summary.needs_action, 0);
  assert.equal(transferErrorRate(cases, 'shamy'), 0);
  assert.equal(transferErrorRate(cases, 'shokry'), 0);
});

test('detects code mismatch when product identity by name is otherwise equal', () => {
  const cases = reconcileBranchTransfers([sale({ code: 'A-100' })], [purchase({ code: 'B-900' })]);
  assert.equal(cases[0].type, 'code_mismatch');
});

test('detects sale without purchase and purchase without sale', () => {
  assert.equal(reconcileBranchTransfers([sale()], [])[0].type, 'sale_without_purchase');
  assert.equal(reconcileBranchTransfers([], [purchase()])[0].type, 'purchase_without_sale');
});

test('aggregates split invoices for the same product and day', () => {
  const cases = reconcileBranchTransfers(
    [sale({ qty: 1, invoice: 'S-1' }), sale({ qty: 3, invoice: 'S-2' })],
    [purchase({ qty: 2, invoice: 'P-1' }), purchase({ qty: 2, invoice: 'P-2' })],
  );
  assert.equal(cases.length, 1);
  assert.equal(cases[0].type, 'matched');
  assert.equal(cases[0].sale_qty, 4);
  assert.equal(cases[0].purchase_qty, 4);
  assert.deepEqual(cases[0].sale_invoices, ['S-1', 'S-2']);
});

test('summary and branch error rate reflect only confirmed current evidence', () => {
  const cases = reconcileBranchTransfers(
    [sale(), sale({ product_name: 'Panadol', code: '200', invoice: 'S-2', qty: 1 })],
    [purchase()],
  );
  const summary = summarizeTransferCases(cases);
  assert.equal(summary.total, 2);
  assert.equal(summary.matched, 1);
  assert.equal(summary.needs_action, 1);
  assert.equal(transferErrorRate(cases, 'shamy'), 50);
  assert.equal(transferErrorRate(cases, 'shokry'), 50);
});
