import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../src/pages/SmartPurchaseReceiving.jsx', import.meta.url),
  'utf8'
);

test('supplier response works against the whole remaining branch order', () => {
  assert.match(source, /const branchRemainingItems = useMemo/);
  assert.match(source, /mode === 'supplier_response' \? branchRemainingItems : supplierRemainingItems/);
  assert.match(source, /رد المورد هيتطابق مع كل الأصناف المتبقية في طلبية الفرع/);
});

test('branch order can be exported before the supplier responds', () => {
  assert.match(source, /function exportBranchRequest\(\)/);
  assert.match(source, /_طلبية_الفرع_للمورد\.xlsx/);
  assert.match(source, /تنزيل طلبية الفرع للمورد/);
  assert.match(source, /'كود الصنف': item\.product_code/);
});

test('supplier response may document any supplier while actual receipt remains assigned-supplier scoped', () => {
  assert.match(source, /list="supplier-response-options"/);
  assert.match(source, /اكتب أو اختر اسم المورد/);
  assert.match(source, /const supplierAllItems = useMemo/);
  assert.match(source, /String\(item\.supplier_name \|\| ''\)\.trim\(\)\.toLowerCase\(\) === supplierKey/);
  assert.match(source, /الاستلام الفعلي يظل مقيدًا بالأصناف المسندة للمورد داخل الطلبية/);
});
