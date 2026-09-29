import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectDualBranchStockColumns,
  normalizeDualBranchStockRows,
  runBoundedChunkPool,
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
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].shamy_stock, 1.5);
  assert.equal(result.rows[0].shokry_stock, 2.25);
  assert.equal(result.shamy[0].current_stock, 1.5);
  assert.equal(result.shokry[0].current_stock, 2.25);
  assert.equal(result.shamy[0].product_code, '1001');
});

test('marks delivery/service rows as non-inventory', () => {
  const result = normalizeDualBranchStockRows([{
    'الكود': '9999',
    'إسم الصنف': 'توصيل منزلي',
    'الوحدة': '',
    'الفرعية الشامي': 0,
    'الادارة فرع شكري': 0,
  }], 'stock.xlsx');

  assert.equal(result.rows_count, 1);
  assert.equal(result.inventory_rows, 0);
  assert.equal(result.shamy[0].inventory_eligible, false);
});

test('rejects duplicate product codes before any stock write', () => {
  const rows = [
    { 'الكود': '7', 'إسم الصنف': 'A', 'الوحدة': 'علبة', 'الفرعية الشامي': 1, 'الادارة فرع شكري': 2 },
    { 'الكود': '7', 'إسم الصنف': 'B', 'الوحدة': 'علبة', 'الفرعية الشامي': 3, 'الادارة فرع شكري': 4 },
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
    'الوحدة': 'علبة',
    'الفرعية الشامي': 1,
  }];
  assert.throws(
    () => normalizeDualBranchStockRows(rows, 'stock.xlsx'),
    /ملف الرصيد لازم يحتوي/
  );
});


test('tracks negative stock as a quality signal while clamping it to zero for planning', () => {
  const result = normalizeDualBranchStockRows([{
    'الكود': '2002',
    'إسم الصنف': 'Negative Stock Item',
    'الوحدة': 'علبة',
    'الفرعية الشامي': '-2',
    'الادارة فرع شكري': '-0.5',
  }], 'stock.xlsx');

  assert.equal(result.quality.negative_shamy, 1);
  assert.equal(result.quality.negative_shokry, 1);
  assert.equal(result.rows[0].shamy_stock, 0);
  assert.equal(result.rows[0].shokry_stock, 0);
  assert.equal(result.rows[0].shamy_stock_negative, true);
  assert.equal(result.rows[0].shokry_stock_negative, true);
});

test('counts fractional stock without rounding it away', () => {
  const result = normalizeDualBranchStockRows([{
    'الكود': '3003',
    'إسم الصنف': 'Fractional Stock Item',
    'الوحدة': 'علبة',
    'الفرعية الشامي': '1.25',
    'الادارة فرع شكري': '2.5',
  }], 'stock.xlsx');

  assert.equal(result.quality.fractional_shamy, 1);
  assert.equal(result.quality.fractional_shokry, 1);
  assert.equal(result.rows[0].shamy_stock, 1.25);
  assert.equal(result.rows[0].shokry_stock, 2.5);
});


test('runs stock staging chunks with bounded concurrency and preserves result order', async () => {
  let active = 0;
  let maxActive = 0;
  const completed = [];

  const result = await runBoundedChunkPool(
    [[1], [2], [3], [4], [5], [6]],
    async (chunk, index) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, index % 2 === 0 ? 8 : 4));
      active -= 1;
      return chunk[0] * 10;
    },
    {
      concurrency: 2,
      onComplete: ({ completed: done }) => completed.push(done),
    }
  );

  assert.ok(maxActive <= 2);
  assert.equal(maxActive, 2);
  assert.deepEqual(result, [10, 20, 30, 40, 50, 60]);
  assert.equal(completed.at(-1), 6);
});

test('stops scheduling new stock chunks after a staging failure', async () => {
  const started = [];

  await assert.rejects(
    runBoundedChunkPool(
      [[1], [2], [3], [4]],
      async (chunk) => {
        started.push(chunk[0]);
        if (chunk[0] === 1) throw new Error('stage failed');
        await new Promise((resolve) => setTimeout(resolve, 5));
        return chunk[0];
      },
      { concurrency: 2 }
    ),
    /stage failed/
  );

  assert.ok(started.length <= 2);
  assert.ok(started.includes(1));
});


test('rejects a nonblank row with missing product identity instead of silently dropping it', () => {
  const rows = [{
    'الكود': '',
    'إسم الصنف': 'Missing Code Item',
    'الوحدة': 'علبة',
    'الفرعية الشامي': 1,
    'الادارة فرع شكري': 2,
  }];
  assert.throws(
    () => normalizeDualBranchStockRows(rows, 'stock.xlsx'),
    /كود أو اسم الصنف ناقص/
  );
});

test('rejects non-numeric stock instead of turning it into a false zero stockout', () => {
  const rows = [{
    'الكود': '4004',
    'إسم الصنف': 'Bad Stock Item',
    'الوحدة': 'علبة',
    'الفرعية الشامي': 'غير معروف',
    'الادارة فرع شكري': 2,
  }];
  assert.throws(
    () => normalizeDualBranchStockRows(rows, 'stock.xlsx'),
    /رصيد الشامي غير رقمي/
  );
});

test('accepts Arabic digits and preserves the actual stock value', () => {
  const result = normalizeDualBranchStockRows([{
    'الكود': '5005',
    'إسم الصنف': 'Arabic Digits Item',
    'الوحدة': 'علبة',
    'الفرعية الشامي': '١٫٥',
    'الادارة فرع شكري': '٢',
  }], 'stock.xlsx');

  assert.equal(result.rows[0].shamy_stock, 1.5);
  assert.equal(result.rows[0].shokry_stock, 2);
});

test('reports original source row count without counting blank rows as products', () => {
  const result = normalizeDualBranchStockRows([
    {
      'الكود': '6006',
      'إسم الصنف': 'Valid Item',
      'الوحدة': 'علبة',
      'الفرعية الشامي': 1,
      'الادارة فرع شكري': 2,
    },
    {
      'الكود': '',
      'إسم الصنف': '',
      'الوحدة': '',
      'الفرعية الشامي': '',
      'الادارة فرع شكري': '',
    },
  ], 'stock.xlsx');

  assert.equal(result.source_rows_count, 2);
  assert.equal(result.rows_count, 1);
  assert.equal(result.quality.ignored_blank_rows, 1);
});


test('rejects a file missing the unit column', () => {
  const rows = [{
    'الكود': '7007',
    'إسم الصنف': 'No Unit Header',
    'الفرعية الشامي': 1,
    'الادارة فرع شكري': 2,
  }];
  assert.throws(
    () => normalizeDualBranchStockRows(rows, 'stock.xlsx'),
    /الوحدة/
  );
});

test('rejects an inventory row with an empty unit', () => {
  const rows = [{
    'الكود': '8008',
    'إسم الصنف': 'Inventory Without Unit',
    'الوحدة': '',
    'الفرعية الشامي': 1,
    'الادارة فرع شكري': 2,
  }];
  assert.throws(
    () => normalizeDualBranchStockRows(rows, 'stock.xlsx'),
    /وحدة الصنف المخزني غير موجودة/
  );
});

test('allows a non-inventory service row to have an empty unit', () => {
  const result = normalizeDualBranchStockRows([{
    'الكود': '9009',
    'إسم الصنف': 'توصيل منزلي',
    'الوحدة': '',
    'الفرعية الشامي': 0,
    'الادارة فرع شكري': 0,
  }], 'stock.xlsx');

  assert.equal(result.rows[0].inventory_eligible, false);
});


test('accepts common Arabic header spelling variants safely', () => {
  const result = normalizeDualBranchStockRows([{
    'الكود': '1010',
    'اسم الصنف': 'Header Variant Item',
    'الوحده': 'علبة',
    'الفرعيه الشامي': 1,
    'الاداره فرع شكري': 2,
  }], 'stock.xlsx');

  assert.equal(result.rows[0].stock_unit, 'علبة');
  assert.equal(result.rows[0].shamy_stock, 1);
  assert.equal(result.rows[0].shokry_stock, 2);
});

test('parses decimal comma stock values without multiplying them by ten', () => {
  const result = normalizeDualBranchStockRows([{
    'الكود': '1111',
    'إسم الصنف': 'Decimal Comma Item',
    'الوحدة': 'علبة',
    'الفرعية الشامي': '1,5',
    'الادارة فرع شكري': '2,25',
  }], 'stock.xlsx');

  assert.equal(result.rows[0].shamy_stock, 1.5);
  assert.equal(result.rows[0].shokry_stock, 2.25);
});
