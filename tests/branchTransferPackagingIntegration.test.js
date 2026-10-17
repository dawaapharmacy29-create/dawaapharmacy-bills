import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBranchTransfers } from '../src/lib/branchTransferControl.js';
import { applyLearnedUnitRules } from '../src/lib/branchTransferUnitRules.js';

test('end-to-end: strip sale and fractional B-Connect box purchase are interpreted physically', () => {
  const sales = [
    {
      id: 'sale-1', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم',
      product_name: 'SOLUPRED 5 MG 30 TAB', code: '55750', qty: 1, unit: 'شريط',
      invoice: '70952', date: '2026-10-13 12:00:00', user: 'د اختبار', source_format: 'flat_transfer_rows',
    },
  ];
  const purchases = [
    {
      id: 'purchase-1', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي',
      product_name: 'SOLUPRED 5 MG 30 TAB', code: '55750', qty: 0.34, unit: '',
      invoice: '47757', date: '2026-10-13 12:10:00', user: 'د شراء', source_format: 'bconnect_purchase_report',
    },
  ];

  const cases = reconcileBranchTransfers(sales, purchases);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].type, 'unit_conversion_review');
  assert.match(cases[0].sale_qty_label, /^1 شريط/);
  assert.match(cases[0].purchase_qty_label, /^0\.34 وحدة شراء — نوع العبوة غير مؤكد/);
  assert.equal(cases[0].packaging_profile.strips_per_box, 3);
  assert.equal(cases[0].purchase_quantity.canonical_unit, null);
  assert.equal(cases[0].purchase_quantity.conversion_confidence, 'unknown');
});

test('end-to-end: an approved packaging rule survives future uploads and outranks a legacy generic unit rule', () => {
  const sales = [
    {
      branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم',
      product_name: 'SOLUPRED 5 MG 30 TAB', code: '55750', qty: 3, unit: 'شريط',
      invoice: 'S9', date: '2026-10-14 12:00:00', source_format: 'flat_transfer_rows',
    },
  ];
  const purchases = [
    {
      branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي',
      product_name: 'SOLUPRED 5 MG 30 TAB', code: '55750', qty: 1, unit: '',
      invoice: 'P9', date: '2026-10-14 12:10:00', source_format: 'bconnect_purchase_report',
    },
  ];
  const packagingRules = {
    '55750': { code: '55750', strips_per_box: 3, active: true, approvals: 1 },
  };
  const [packaged] = reconcileBranchTransfers(sales, purchases, { packagingRules });
  assert.equal(packaged.type, 'matched');
  assert.equal(packaged.matched_by_packaging_profile, true);

  const legacyKey = `${packaged.from}::${packaged.to}::solupred 5 mg 30 tab`;
  const [afterLegacy] = applyLearnedUnitRules([packaged], {
    [legacyKey]: { key: legacyKey, active: true, purchase_per_sale: 1 / 3, relative_tolerance: 0.035, absolute_tolerance: 0.02 },
  });
  assert.equal(afterLegacy.type, 'matched');
  assert.equal(afterLegacy.matched_by_packaging_profile, true);
  assert.equal(afterLegacy.matched_by_unit_rule, undefined);
});

test('end-to-end: confirmed three-strip profile balances split sale invoices against one box purchase', () => {
  const sales = [
    {
      branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم',
      product_name: 'SOLUPRED 5 MG 30 TAB', code: '55750', qty: 1, unit: 'شريط',
      invoice: 'SPLIT-1', date: '2026-10-15 12:00:00', source_format: 'flat_transfer_rows',
    },
    {
      branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم',
      product_name: 'SOLUPRED 5 MG 30 TAB', code: '55750', qty: 2, unit: 'شريط',
      invoice: 'SPLIT-2', date: '2026-10-15 12:20:00', source_format: 'flat_transfer_rows',
    },
  ];
  const purchases = [
    {
      branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي',
      product_name: 'SOLUPRED 5 MG 30 TAB', code: '55750', qty: 1, unit: '',
      invoice: 'BOX-1', date: '2026-10-15 12:10:00', source_format: 'bconnect_purchase_report',
    },
  ];
  const packagingRules = {
    '55750': { code: '55750', strips_per_box: 3, active: true, approvals: 1 },
  };

  const cases = reconcileBranchTransfers(sales, purchases, { packagingRules });
  assert.equal(cases.length, 1);
  assert.equal(cases[0].type, 'matched');
  assert.deepEqual(new Set(cases[0].sale_invoices), new Set(['SPLIT-1', 'SPLIT-2']));
  assert.deepEqual(cases[0].purchase_invoices, ['BOX-1']);
  assert.equal(cases[0].canonical_quantity_comparable, true);
  assert.equal(cases[0].canonical_sale_qty, 1);
  assert.equal(cases[0].canonical_purchase_qty, 1);
});
