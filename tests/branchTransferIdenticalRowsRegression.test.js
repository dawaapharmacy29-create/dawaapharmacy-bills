import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBranchTransfers } from '../src/lib/branchTransferControl.js';
import { preserveRepeatedRowsWithinSource } from '../src/lib/branchTransferRawEvidencePreparation.js';

test('real regression: identical repeated sale rows in one B-Connect file are summed, not deduped away', () => {
  const saleRows = [
    {
      source_file: 'بيع الشامي(1).xlsx', source_fingerprint: 'sale-file', row_number: 900,
      invoice: '38346', code: '70865', product_name: 'TEST PRODUCT', qty: 0.5,
      unit: 'علبة', expiration_raw: '2027/12', date: new Date(2026, 9, 10, 12, 0),
      branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم',
    },
    {
      source_file: 'بيع الشامي(1).xlsx', source_fingerprint: 'sale-file', row_number: 901,
      invoice: '38346', code: '70865', product_name: 'TEST PRODUCT', qty: 0.5,
      unit: 'علبة', expiration_raw: '2027/12', date: new Date(2026, 9, 10, 12, 0),
      branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم',
    },
  ];

  const prepared = preserveRepeatedRowsWithinSource(saleRows, 'sale');
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].qty, 1);
  assert.equal(prepared[0].evidence_row_count, 2);

  const purchases = [{
    invoice: 'P38346', code: '70865', product_name: 'TEST PRODUCT', qty: 1,
    date: new Date(2026, 9, 10, 12, 15), user: 'د مشتري',
    branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي',
  }];

  const cases = reconcileBranchTransfers(saleRows, purchases);
  const matched = cases.find((item) => item.sale_codes?.includes('70865'));
  assert.ok(matched);
  assert.equal(matched.type, 'matched');
  assert.equal(matched.sale_qty, 1);
  assert.equal(matched.purchase_qty, 1);
});

test('does not collapse identical-looking rows when they came from separate source files', () => {
  const rows = [
    { source_file: 'a.xlsx', source_fingerprint: 'a', invoice: '1', code: '100', product_name: 'X', qty: 1, unit: 'علبة', expiration_raw: '2028/01', date: '2026-10-10' },
    { source_file: 'b.xlsx', source_fingerprint: 'b', invoice: '1', code: '100', product_name: 'X', qty: 1, unit: 'علبة', expiration_raw: '2028/01', date: '2026-10-10' },
  ];
  const prepared = preserveRepeatedRowsWithinSource(rows, 'sale');
  assert.equal(prepared.length, 2);
});
