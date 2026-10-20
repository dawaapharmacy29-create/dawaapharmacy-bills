import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeInvoicePageRows,
  invoiceBusinessNumberKey,
  findInvoiceProgramNumberCollisions,
  collisionGroupsForReview,
} from '../src/lib/purchaseInvoiceCollisionAudit.js';

test('a repeated persistent ID from overlapping RPC pages is a single UI record', () => {
  const rows = [
    { id: 'record-1', branch: 'دواء الشامي', system_invoice_number: '11205', workflow_status: 'submitted', updated_at: '2026-10-11T10:00:00Z' },
    { id: 'record-2', branch: 'دواء شكري', system_invoice_number: '18058' },
    { id: 'record-1', branch: 'دواء الشامي', system_invoice_number: '11205', workflow_status: 'reviewed', updated_at: '2026-10-11T11:00:00Z' },
  ];
  const displayed = canonicalizeInvoicePageRows(rows);
  assert.equal(displayed.length, 2);
  assert.equal(displayed[0].workflow_status, 'reviewed');
  assert.equal(findInvoiceProgramNumberCollisions(displayed).size, 0);
});

test('two persistent IDs for the same number and branch stay visible and are flagged', () => {
  const rows = [
    { id: 'invoice-1', branch: 'دواء الشامي', system_invoice_number: '11205', supplier_name: 'مخزن المدينة', total_value: 10491.23 },
    { id: 'invoice-2', branch: 'دواء الشامي', system_invoice_number: '11205.0', supplier_name: 'مخزن المدينة', total_value: 10491.23 },
  ];
  const collisions = collisionGroupsForReview(rows);
  assert.equal(canonicalizeInvoicePageRows(rows).length, 2);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].number, '11205');
  assert.equal(collisions[0].branch, 'دواء الشامي');
  assert.equal(collisions[0].distinct_ids, 2);
  assert.equal(collisions[0].records.length, 2);
});

test('same invoice number in two different branches is not automatically a collision', () => {
  const rows = [
    { id: 'invoice-1', branch: 'دواء الشامي', system_invoice_number: '11205' },
    { id: 'invoice-2', branch: 'دواء شكري', system_invoice_number: '11205' },
  ];
  assert.equal(findInvoiceProgramNumberCollisions(rows).size, 0);
});

test('an unrelated TESTDUP number is distinct from the integer business invoice', () => {
  const rows = [
    { id: 'real', branch: 'دواء الشامي', system_invoice_number: '11205' },
    { id: 'test', branch: 'دواء الشامي', system_invoice_number: 'TESTDUP-11205' },
  ];
  assert.equal(findInvoiceProgramNumberCollisions(rows).size, 0);
});

test('collision detection never assumes a winner from supplier/date/amount similarities', () => {
  const rows = [
    { id: 'invoice-1', branch: 'دواء شكري', system_invoice_number: '18058', supplier_name: 'مخزن الحياة', total_value: 85 },
    { id: 'invoice-2', branch: 'دواء شكري', system_invoice_number: '18058', supplier_name: 'مورد آخر', total_value: 75 },
  ];
  const collisions = collisionGroupsForReview(rows);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].records.length, 2);
});

test('no invented key for incomplete branch or invoice number', () => {
  assert.equal(invoiceBusinessNumberKey({ branch: 'دواء الشامي' }), null);
  assert.equal(invoiceBusinessNumberKey({ system_invoice_number: '11205' }), null);
  assert.equal(findInvoiceProgramNumberCollisions([
    { id: 'a', branch: 'دواء الشامي', system_invoice_number: '' },
    { id: 'b', branch: 'دواء الشامي', system_invoice_number: '' },
  ]).size, 0);
});

test('canonical helper compares Arabic branch variants consistently', () => {
  assert.equal(invoiceBusinessNumberKey({ branch: 'فرع الشامي', system_invoice_number: '11205.0' }),
    invoiceBusinessNumberKey({ branch: 'دواء الشامي', system_invoice_number: '11205' }));
});
