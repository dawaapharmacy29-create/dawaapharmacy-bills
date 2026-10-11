import test from 'node:test';
import assert from 'node:assert/strict';
import { inferBranchFromBConnectSupplier, parseBConnectRows } from '../src/lib/bconnectPurchaseInvoiceParser.js';

const header = ['المستخدم', 'الصافى', 'ض.إضافة', 'مصاريف', 'خصم %', 'خصم قيمة', 'ق.المرتجع', 'ق.الفاتورة', 'العدد', 'مسلسل', 'التاريخ'];

function invoiceRow(serial = '20001', value = 100, date = '2026-10-11') {
  return ['د عمر', value, 0, 0, 0, 0, 0, value, 1, serial, date];
}

test('maps مخزن د وائل to دواء شكري', () => {
  assert.equal(inferBranchFromBConnectSupplier('مخزن د وائل'), 'دواء شكري');
  assert.equal(inferBranchFromBConnectSupplier('مخزن د. وائل'), 'دواء شكري');
  const result = parseBConnectRows([
    header,
    ['مخزن د وائل', 'موردين'],
    invoiceRow('20001'),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.invoices[0].supplier, 'مخزن د وائل');
  assert.equal(result.invoices[0].branch, 'دواء شكري');
});

test('maps مخزن د معاذ to دواء الشامي', () => {
  assert.equal(inferBranchFromBConnectSupplier('مخزن د معاذ'), 'دواء الشامي');
  assert.equal(inferBranchFromBConnectSupplier('مخزن د/ معاذ'), 'دواء الشامي');
  const result = parseBConnectRows([
    header,
    ['مخزن د معاذ', 'موردين'],
    invoiceRow('20002'),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.invoices[0].supplier, 'مخزن د معاذ');
  assert.equal(result.invoices[0].branch, 'دواء الشامي');
});

test('does not infer a branch for unrelated suppliers', () => {
  assert.equal(inferBranchFromBConnectSupplier('شركة وائل للأدوية'), null);
  assert.equal(inferBranchFromBConnectSupplier('مخزن المدينة المنوره للاكسسوار'), null);
});
