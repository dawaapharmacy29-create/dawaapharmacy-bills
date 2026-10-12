import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPurchaseInvoice, normalizeSupplierIdentityKey } from '../src/lib/purchaseInvoiceTruth.js';
import { reconcilePurchaseInvoice } from '../src/lib/purchaseInvoiceReconciliation.js';
import { supplierMatchScore } from '../src/lib/bconnectSupplierMatcher.js';

test('treats دواء شكري and دواء ابو العزم as the same supplier identity', () => {
  assert.equal(normalizeSupplierIdentityKey('دواء شكري'), normalizeSupplierIdentityKey('دواء ابو العزم'));
  assert.equal(supplierMatchScore('دواء شكري', 'دواء ابو العزم'), 1);

  const app = canonicalPurchaseInvoice({
    system_invoice_number: '11104',
    branch: 'دواء الشامي',
    supplier_name: 'دواء شكري',
    invoice_date: '2026-10-10',
    total_value: 100,
  }, 'app');
  const source = canonicalPurchaseInvoice({
    serial: '11104',
    branch: 'دواء الشامي',
    supplier: 'دواء ابو العزم',
    date: '2026-10-10',
    invoice_value: 100,
  }, 'bconnect');

  assert.equal(app.supplier_name_key, source.supplier_name_key);

  const result = reconcilePurchaseInvoice({
    system_invoice_number: '11104',
    branch: 'دواء الشامي',
    supplier_name: 'دواء شكري',
    invoice_date: '2026-10-10',
    total_value: 100,
  }, {
    serial: '11104',
    branch: 'دواء الشامي',
    supplier: 'دواء ابو العزم',
    date: '2026-10-10',
    invoice_value: 100,
  });

  assert.equal(result.checks.supplier, 'match');
  assert.equal(result.status, 'clean');
});
