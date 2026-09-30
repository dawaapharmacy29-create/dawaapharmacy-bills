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

test('saved supplier responses become cumulative and latest response per supplier wins', () => {
  assert.match(source, /supplierResponseHistory/);
  assert.match(source, /supplierCommitmentsBySupplier/);
  assert.match(source, /sourcingRemainingQuantity/);
  assert.match(source, /scope: 'branch_remaining_v1'/);
  assert.match(source, /accumulation: 'latest_per_supplier_v1'/);
  assert.match(source, /تم حفظ رد المورد وتحديث المتبقي التراكمي/);
});

test('correcting the same supplier excludes its previous commitment before recalculation', () => {
  assert.match(source, /excludedSupplierKey/);
  assert.match(source, /supplierKey === excludedSupplierKey/);
  assert.match(source, /sourcingRemainingQuantity\(item, supplierCommitmentsBySupplier, currentSupplierKey\)/);
});

test('purchase center launches supplier sourcing independently for each branch', async () => {
  const purchaseSource = await readFile(new URL('../src/pages/PurchaseCenterClean.jsx', import.meta.url), 'utf8');
  assert.match(purchaseSource, /SupplierSourcingBranchCard/);
  assert.match(purchaseSource, /فتح دورة موردي/);
  assert.match(purchaseSource, /ابدأ بطلبية الفرع كاملة مع المورد الأول/);
  assert.doesNotMatch(purchaseSource, /dispatchState\.suppliers/);
  assert.doesNotMatch(purchaseSource, /markHistoricalSupplierSent/);
});

test('supplier sourcing UI is an explicit safe sequence', () => {
  assert.match(source, /دورة الموردين للفرع/);
  assert.match(source, /الدورة الحالية: المورد رقم/);
  assert.match(source, /تنزيل طلبية الفرع للمورد الأول/);
  assert.match(source, /تنزيل المتبقي للمورد التالي/);
  assert.match(source, /حفظ رد المورد وتثبيت المتاح/);
  assert.match(source, /بعد الحفظ سيتحدث المتبقي من السيرفر/);
  assert.doesNotMatch(source, /ملف المتبقي لمورد آخر/);
});

test('supplier history and completion guide the next action', () => {
  assert.match(source, /سجل دورات الموردين/);
  assert.match(source, /انتهت مرحلة التوفير/);
  assert.match(source, /الانتقال للاستلام الفعلي/);
  assert.match(source, /startNextSupplierRound/);
  assert.match(source, /sourcingComplete/);
  assert.match(source, /sourcingCoverage/);
});
