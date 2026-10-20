import test from 'node:test';
import assert from 'node:assert/strict';
import { mayRetryAppDataAction, validatePurchaseInvoiceCreateEvidence } from '../src/lib/purchaseInvoiceWriteSafety.js';

test('only explicitly read-only app-data actions may be transparently retried', () => {
  for (const name of ['list', 'filter', 'get']) assert.equal(mayRetryAppDataAction(name), true, name);
  for (const name of ['create', 'bulkCreate', 'update', 'bulkUpdate', 'delete',
    'adminAccounts', 'approve', 'unknown', '', null]) {
    assert.equal(mayRetryAppDataAction(name), false, String(name));
  }
});

const shamy = (number = '11205') => ({ branch: 'دواء الشامي', system_invoice_number: number });
const count = (number, rows) => ({ number, record_count: rows.length, rows });

test('read-only RPC proves an unused number is eligible for an attempt, never atomic uniqueness', () => {
  assert.equal(validatePurchaseInvoiceCreateEvidence(shamy(), [count('11205', [])]), true);
});

test('reject a second ID with the same normalized number and branch', () => {
  assert.throws(() => validatePurchaseInvoiceCreateEvidence(shamy(), [count('11205', [
    { id: 'a', branch: 'دواء الشامي', system_invoice_number: '11205.0' },
  ])]), /مسجل بالفعل/);
});

test('different branch with complete visible evidence does not conflict', () => {
  assert.equal(validatePurchaseInvoiceCreateEvidence(shamy(), [count('11205', [
    { id: 'a', branch: 'دواء شكري', system_invoice_number: '11205' },
  ])]), true);
});

test('a hidden row makes permission-limited global lookup inconclusive', () => {
  assert.throws(() => validatePurchaseInvoiceCreateEvidence(shamy(), [
    { number: '11205', record_count: 2, rows: [{ branch: 'دواء شكري', system_invoice_number: '11205', id: 'a' }] },
  ]), /مطلوب فحص مدير/);
});

test('a missing or broken RPC response fails closed', () => {
  assert.throws(() => validatePurchaseInvoiceCreateEvidence(shamy(), null), /تعذر التأكد/);
  assert.throws(() => validatePurchaseInvoiceCreateEvidence(shamy(), []), /غير مكتمل/);
  assert.throws(() => validatePurchaseInvoiceCreateEvidence(shamy(), [{ number: '11205', record_count: 1 }]), /غير مكتمل/);
});

test('batch cannot contain two creates for the same normalized invoice identity', () => {
  const invoices = [shamy('11205'), shamy('11205.0')];
  assert.throws(() => validatePurchaseInvoiceCreateEvidence(invoices, [count('11205', [])]), /طلب الإنشاء نفسه/);
});

test('batch may contain distinct numbers in the same branch', () => {
  assert.equal(validatePurchaseInvoiceCreateEvidence([shamy('11205'), shamy('11206')], [
    count('11205', []), count('11206', []),
  ]), true);
});

test('branch and number are required and cannot be guessed', () => {
  assert.throws(() => validatePurchaseInvoiceCreateEvidence({ branch: 'دواء الشامي' }, []), /بدون رقم برنامج/);
  assert.throws(() => validatePurchaseInvoiceCreateEvidence([], []), /فارغة/);
});
