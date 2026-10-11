import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferBranchFromBConnectLocation,
  inferBranchFromBConnectSupplier,
  parseBConnectRows,
} from '../src/lib/bconnectPurchaseInvoiceParser.js';

const header = ['المستخدم', 'الصافى', 'ض.إضافة', 'مصاريف', 'خصم %', 'خصم قيمة', 'ق.المرتجع', 'ق.الفاتورة', 'العدد', 'مسلسل', 'التاريخ'];

function invoiceRow(serial = '20001', value = 100, date = '2026-10-11') {
  return ['د عمر', value, 0, 0, 0, 0, 0, value, 1, serial, date];
}

test('maps internal warehouse names to canonical branches', () => {
  assert.equal(inferBranchFromBConnectLocation('مخزن د وائل'), 'دواء شكري');
  assert.equal(inferBranchFromBConnectLocation('مخزن د.وائل'), 'دواء شكري');
  assert.equal(inferBranchFromBConnectLocation('مخزن د/ وائل'), 'دواء شكري');
  assert.equal(inferBranchFromBConnectLocation('مخزن د معاذ'), 'دواء الشامي');
  assert.equal(inferBranchFromBConnectLocation('مخزن د. معاذ'), 'دواء الشامي');
  assert.equal(inferBranchFromBConnectLocation('مخزن د/ معاذ'), 'دواء الشامي');
});

test('maps real branch captions from B-Connect exports', () => {
  assert.equal(inferBranchFromBConnectLocation('الادارة فرع شكري'), 'دواء شكري');
  assert.equal(inferBranchFromBConnectLocation('الفرعية الشامي'), 'دواء الشامي');
  assert.equal(inferBranchFromBConnectLocation('فرع الشامي'), 'دواء الشامي');
});

test('parses real Shokry warehouse export shape where warehouse is in payment row', () => {
  const result = parseBConnectRows([
    ['تم الإسترجاع حسب: تاريخ الإنشاء , المخزن مخزن د.وائل , النوع << الكل >> , فواتير مباشرة'],
    ['اتحاد الصيادله', 'موردين'],
    ['مخزن د.وائل', 'آجل'],
    header,
    invoiceRow('19712', 7566.9),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.invoices[0].supplier, 'اتحاد الصيادله');
  assert.equal(result.invoices[0].branch, 'دواء شكري');
  assert.equal(result.invoices[0].payment_type, 'آجل');
});

test('parses real El Shamy warehouse export shape where warehouse is in payment row', () => {
  const result = parseBConnectRows([
    ['تم الإسترجاع حسب: تاريخ الإنشاء , المخزن مخزن د معاذ , النوع << الكل >> , فواتير مباشرة'],
    ['AAPE Company', 'موردين'],
    ['مخزن د معاذ', 'آجل'],
    header,
    invoiceRow('11164', 547.2),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.invoices[0].supplier, 'AAPE Company');
  assert.equal(result.invoices[0].branch, 'دواء الشامي');
  assert.equal(result.invoices[0].payment_type, 'آجل');
});

test('parses direct Shokry branch export as canonical branch', () => {
  const result = parseBConnectRows([
    ['تم الإسترجاع حسب: تاريخ الإنشاء , المخزن الادارة فرع شكري , النوع << الكل >>'],
    ['المدينة المنورة اكسسوار', 'موردين'],
    ['الادارة فرع شكري', 'آجل'],
    header,
    invoiceRow('19792', 102),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.invoices[0].supplier, 'المدينة المنورة اكسسوار');
  assert.equal(result.invoices[0].branch, 'دواء شكري');
});

test('parses direct El Shamy branch export as canonical branch', () => {
  const result = parseBConnectRows([
    ['تم الإسترجاع حسب: تاريخ الإنشاء , المخزن الفرعية الشامي , النوع << الكل >>'],
    ['الطرشوبي شكري', 'موردين'],
    ['الفرعية الشامي', 'نقدى'],
    header,
    invoiceRow('11136', 110),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.invoices[0].supplier, 'الطرشوبي شكري');
  assert.equal(result.invoices[0].branch, 'دواء الشامي');
  assert.equal(result.invoices[0].payment_type, 'نقدى');
});

test('supplier names do not reclassify the branch', () => {
  assert.equal(inferBranchFromBConnectSupplier('شركة وائل للأدوية'), null);
  assert.equal(inferBranchFromBConnectSupplier('مخزن المدينة المنوره للاكسسوار'), null);
  assert.equal(inferBranchFromBConnectSupplier('دواء الشامي'), null);

  const result = parseBConnectRows([
    ['تم الإسترجاع حسب: تاريخ الإنشاء , المخزن الادارة فرع شكري , النوع << الكل >>'],
    ['دواء الشامي', 'موردين'],
    ['الادارة فرع شكري', 'آجل'],
    header,
    invoiceRow('19683', 120),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.invoices[0].supplier, 'دواء الشامي');
  assert.equal(result.invoices[0].branch, 'دواء شكري');
});
