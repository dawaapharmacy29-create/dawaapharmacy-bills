import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const receiving = await readFile(new URL('../src/pages/SmartPurchaseReceiving.jsx', import.meta.url), 'utf8');
const page = await readFile(new URL('../src/pages/PurchaseShortages.jsx', import.meta.url), 'utf8');
const api = await readFile(new URL('../src/api/purchaseShortageApi.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const layout = await readFile(new URL('../src/components/layout/AppLayout.jsx', import.meta.url), 'utf8');

test('supplier sourcing can persist remaining demand to shortage registry without ending follow-up', () => {
  assert.match(receiving, /registerCurrentShortages/);
  assert.match(receiving, /تسجيل المتبقي في قائمة النواقص/);
  assert.match(receiving, /يمكنك الاستمرار في محاولة توفيرها لاحقًا/);
  assert.match(receiving, /purchaseShortageApi\.registerOrder/);
});

test('shortage page distinguishes unavailable, limited supply and recurring shortage', () => {
  assert.match(page, /غير متوفر/);
  assert.match(page, /توريد محدود/);
  assert.match(page, /نقص متكرر/);
  assert.match(page, /نقص مزمن/);
  assert.match(page, /open_shortage_quantity/);
  assert.match(page, /shortage_occurrences/);
});

test('shortage page shows ordered, allocated and actually received quantities', () => {
  assert.match(page, /آخر طلب/);
  assert.match(page, /آخر ما توفر/);
  assert.match(page, /آخر ما استلم/);
  assert.match(page, /received_coverage_pct/);
});

test('open shortages link back to exact purchase order for continued sourcing', () => {
  assert.match(page, /smart-purchase-receiving\?orderIds=/);
  assert.match(page, /متابعة التوفير/);
});

test('shortage registry is routable and visible in purchases navigation', () => {
  assert.match(app, /PurchaseShortages/);
  assert.match(app, /path="\/purchase-shortages"/);
  assert.match(layout, /path: "\/purchase-shortages", label: "الأصناف الناقصة"/);
});

test('shortage client uses only guarded RPC', () => {
  assert.match(api, /smart_purchase_shortage_registry_v1/);
  assert.match(api, /register_order/);
  assert.match(api, /supplier_response_required/);
});

test('closed shortage orders do not send follow-up back to a dead receiving journey', () => {
  assert.match(page, /function canContinueOrder/);
  assert.match(page, /last_order_status/);
  assert.match(page, /متابعة في الطلبية القادمة/);
  assert.match(page, /to="\/purchase-center"/);
  assert.match(page, /متابعة التوفير/);
});
