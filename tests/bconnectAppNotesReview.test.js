import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePurchaseInvoice } from '../src/lib/purchaseInvoiceReconciliation.js';

test('shows application invoice note in review reasons without changing the financial decision', () => {
  const result = reconcilePurchaseInvoice({
    system_invoice_number: '19794',
    branch: 'دواء شكري',
    supplier_name: 'مخزن المدينة المنوره للاكسسوار',
    invoice_date: '2026-10-11',
    total_value: 300,
    notes: 'تم تجميع فاتورتين من B-Connect في فاتورة واحدة حسب الفاتورة الورقية للمورد.',
  }, {
    system_invoice_number: '19794',
    branch: 'دواء شكري',
    supplier_name: 'المدينة المنوره للاكسسوار',
    invoice_date: '2026-10-10',
    total_value: 546,
  });

  assert.equal(result.status, 'review');
  assert.equal(result.financial.difference, 246);
  assert.equal(result.app_note, 'تم تجميع فاتورتين من B-Connect في فاتورة واحدة حسب الفاتورة الورقية للمورد.');
  assert.ok(result.reasons.includes('ملاحظة التطبيق: تم تجميع فاتورتين من B-Connect في فاتورة واحدة حسب الفاتورة الورقية للمورد.'));
});

test('does not add an empty note', () => {
  const result = reconcilePurchaseInvoice({
    system_invoice_number: '1', branch: 'دواء شكري', invoice_date: '2026-10-10', total_value: 100,
  }, {
    system_invoice_number: '1', branch: 'دواء شكري', invoice_date: '2026-10-10', total_value: 100,
  });
  assert.equal(result.app_note, null);
  assert.equal(result.reasons.some((reason) => reason.startsWith('ملاحظة التطبيق:')), false);
});
