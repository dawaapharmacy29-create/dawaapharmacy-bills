import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBConnectInvoiceDraft } from '../src/lib/bconnectInvoiceDraftPreparation.js';

const source = { serial: '19522', supplier: 'شركة اختبار', branch: 'فرع شكري', invoice_value: 144.5, return_value: 4.5, date: '2026-09-15', payment_type: 'آجل', user: 'مستخدم بي كونكت' };
const supplier = { id: 'supplier-1', name: 'شركة اختبار' };

test('prepares financial review draft without overwriting application entrant', () => {
  const result = prepareBConnectInvoiceDraft(source, supplier);
  assert.equal(result.ready_for_review, true);
  assert.equal(result.invoice.net_value, 140);
  assert.equal(result.invoice.status, 'انتظار المراجعة');
  assert.equal(result.invoice.branch, 'دواء شكري');
  assert.equal(result.source.user, 'مستخدم بي كونكت');
  assert.equal(result.invoice.entered_by, undefined);
});

test('requires an exact confirmed supplier identity', () => {
  assert.equal(prepareBConnectInvoiceDraft(source).ready_for_review, false);
  assert.equal(prepareBConnectInvoiceDraft(source, {id:'other',name:'شركة أخرى'}).ready_for_review, false);
});

test('rejects invalid amounts and uncertain payment', () => {
  const result = prepareBConnectInvoiceDraft({...source, return_value: 150, payment_type: 'غير معروف'}, supplier);
  assert.equal(result.ready_for_review, false);
  assert.ok(result.issues.length >= 2);
});

test('never assigns a branch based on supplier name', () => {
  const result = prepareBConnectInvoiceDraft({...source, branch: null, supplier:'دواء الشامي'}, {id:'s',name:'دواء الشامي'});
  assert.equal(result.ready_for_review, false);
  assert.equal(result.invoice.branch, null);
});

test('missing gross value is not silently treated as zero', () => {
  for (const value of [null, undefined, '', '  ']) {
    const result = prepareBConnectInvoiceDraft({...source, invoice_value:value}, supplier);
    assert.equal(result.ready_for_review, false);
    assert.equal(result.invoice.total_value, null);
  }
});
test('day-first dates normalize and impossible calendar dates are rejected', () => {
  assert.equal(prepareBConnectInvoiceDraft({...source,date:'15/09/2026'}, supplier).invoice.invoice_date,'2026-09-15');
  assert.equal(prepareBConnectInvoiceDraft({...source,date:'31/02/2026'}, supplier).ready_for_review,false);
});
