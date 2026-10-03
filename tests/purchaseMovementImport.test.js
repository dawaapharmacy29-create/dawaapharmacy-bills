import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMovementWorkbookRows } from '../src/lib/purchaseMovementImport.js';

test('movement workbook maps newest three months into cumulative 30/60/90 windows', () => {
  const result = normalizeMovementWorkbookRows([
    ['2026/09', '2026/08', '2026/07', 'الرصيد', 'السعر', 'الوحدة', 'الشركة', 'الإسم', 'الكود'],
    [1.5, 6, 3, 3, 24, 'علبة', 'جلاكسو', 'ABIMOL 500 MG 20 TAB', '21728'],
  ], '99.xlsx');
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.months, ['2026/09', '2026/08', '2026/07']);
  assert.deepEqual(result.rows[0], {
    row_no: 1,
    product_code: '21728',
    product_name: 'ABIMOL 500 MG 20 TAB',
    sales_30: 1.5,
    sales_60: 7.5,
    sales_90: 10.5,
  });
});

test('movement workbook ignores report footer rows', () => {
  const result = normalizeMovementWorkbookRows([
    ['2026/09', '2026/08', '2026/07', 'الرصيد', 'السعر', 'الوحدة', 'الشركة', 'الإسم', 'الكود'],
    [2, 2, 1.5, 0, 300, 'علبة', 'BPI', '360 PROBIOTICS', '82831'],
    [5904, 'عدد الأصناف'],
    ['Page -1 of 1', 'E-pharmacy Plus', '', '', '', '', 'وقت الطباعة', 'Copyright © B-Connect 2006', ''],
  ], '99.xlsx');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].sales_90, 5.5);
});

test('movement workbook rejects duplicate product codes', () => {
  assert.throws(() => normalizeMovementWorkbookRows([
    ['2026/09', '2026/08', '2026/07', 'الإسم', 'الكود'],
    [1, 2, 3, 'A', '10'],
    [1, 2, 3, 'A duplicate', '10'],
  ]), /مكرر/);
});

test('movement workbook rejects malformed product rows instead of silently dropping them', () => {
  assert.throws(() => normalizeMovementWorkbookRows([
    ['2026/09', '2026/08', '2026/07', 'الإسم', 'الكود'],
    [1, 2, 3, 'Missing code', ''],
  ]), /كود الصنف مفقود/);
});

test('movement workbook rejects negative sales', () => {
  assert.throws(() => normalizeMovementWorkbookRows([
    ['2026/09', '2026/08', '2026/07', 'الإسم', 'الكود'],
    [-1, 2, 3, 'A', '10'],
  ]), /غير صالحة/);
});
