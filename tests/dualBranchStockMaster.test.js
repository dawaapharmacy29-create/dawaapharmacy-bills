import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectDualBranchStockColumns,
  normalizeDualBranchStockRows,
} from '../src/lib/dualBranchStockMaster.js';

test('detects the canonical B-Connect dual-branch stock headers', () => {
  const headers = ['الكود', 'إسم الصنف', 'الشركة', 'الوحدة', 'الفرعية الشامي', 'الادارة فرع شكري'];
  const map = detectDualBranchStockColumns(headers);
  assert.equal(map.code, 'الكود');
  assert.equal(map.name, 'إسم الصنف');
  assert.equal(map.shamy, 'الفرعية الشامي');
  assert.equal(map.shokry, 'الادارة فرع شكري');
});

test('normalizes one stock row into both branches without losing fractional stock', () => {
  const result = normalizeDualBranchStockRows([{
    'الكود': '1001',
    'إسم الصنف': 'Test Item',
    'الشركة': 'Test Co',
    'الوحدة': 'علبة',
    'الفرعية الشامي': '1.5',
    'الادارة فرع شكري': '2.25',
  }], 'stock.xlsx');

  assert.equal(result.rows_count, 1);
  assert.equal(result.inventory_rows, 1);
  assert.equal(result.shamy[0].current_stock, 1.5);
  assert.equal(result.shokry[0].current_stock, 2.25);
  assert.equal(result.shamy[0].product_code, '1001');
});

test('marks delivery/service rows as non-inventory', () => {
  const result = normalizeDualBranchStockRows([{
    'الكود': '9999',
    'إسم الصنف': 'توصيل منزلي',
    'الفرعية الشامي': 0,
    'الادارة فرع شكري': 0,
  }], 'stock.xlsx');

  assert.equal(result.rows_count, 1);
  assert.equal(result.inventory_rows, 0);
  assert.equal(result.shamy[0].inventory_eligible, false);
});

test('rejects duplicate product codes before any stock write', () => {
  const rows = [
    { 'الكود': '7', 'إسم الصنف': 'A', 'الفرعية الشامي': 1, 'الادارة فرع شكري': 2 },
    { 'الكود': '7', 'إسم الصنف': 'B', 'الفرعية الشامي': 3, 'الادارة فرع شكري': 4 },
  ];
  assert.throws(
    () => normalizeDualBranchStockRows(rows, 'stock.xlsx'),
    /كود صنف مكرر/
  );
});

test('rejects a file missing one branch balance column', () => {
  const rows = [{
    'الكود': '1',
    'إسم الصنف': 'A',
    'الفرعية الشامي': 1,
  }];
  assert.throws(
    () => normalizeDualBranchStockRows(rows, 'stock.xlsx'),
    /ملف الرصيد لازم يحتوي/
  );
});
