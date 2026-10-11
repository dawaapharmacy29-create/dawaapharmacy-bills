import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeBconnectGateRows, dedupeInvoiceRowsByStableId } from '../src/lib/invoiceIdentityGuard.js';

test('collapses repeated query rows only when stable invoice id is identical', () => {
  const rows = [
    { id: 'inv-1', system_invoice_number: '19719', branch: 'دواء شكري', workflow_status: 'submitted' },
    { id: 'inv-1', system_invoice_number: '19719', branch: 'دواء شكري' },
  ];
  const result = dedupeInvoiceRowsByStableId(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'inv-1');
  assert.equal(result[0].workflow_status, 'submitted');
});

test('prefers the fresher row when the same stable id appears more than once', () => {
  const rows = [
    { id: 'inv-1', workflow_status: 'submitted', workflow_updated_at: '2026-10-10T08:00:00Z' },
    { id: 'inv-1', workflow_status: 'reviewed', workflow_updated_at: '2026-10-10T09:00:00Z' },
  ];
  const result = dedupeInvoiceRowsByStableId(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].workflow_status, 'reviewed');
});

test('never hides true duplicate invoices that have different persistent ids', () => {
  const rows = [
    { id: 'inv-1', system_invoice_number: '19719', branch: 'دواء شكري' },
    { id: 'inv-2', system_invoice_number: '19719', branch: 'دواء شكري' },
  ];
  const result = dedupeInvoiceRowsByStableId(rows);
  assert.equal(result.length, 2);
});

test('preserves rows without a stable id instead of guessing their identity', () => {
  const rows = [
    { system_invoice_number: '19719', branch: 'دواء شكري' },
    { system_invoice_number: '19719', branch: 'دواء شكري' },
  ];
  const result = dedupeInvoiceRowsByStableId(rows);
  assert.equal(result.length, 2);
});

test('B-Connect gate collapses repeated joined rows but preserves record_count safety evidence', () => {
  const entries = [{
    number: '19719',
    record_count: 2,
    rows: [
      { id: 'inv-1', system_invoice_number: '19719', branch: 'دواء شكري', workflow_status: 'submitted' },
      { id: 'inv-1', system_invoice_number: '19719', branch: 'دواء شكري' },
    ],
  }];
  const result = dedupeBconnectGateRows(entries);
  assert.equal(result[0].record_count, 2);
  assert.equal(result[0].rows.length, 1);
  assert.equal(result[0].rows[0].id, 'inv-1');
});
