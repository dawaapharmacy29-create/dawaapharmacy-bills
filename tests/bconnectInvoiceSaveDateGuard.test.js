import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareBconnectWriteCommand } from '../src/lib/bconnectAtomicInvoiceCommand.js';

const source = readFileSync(new URL('../src/pages/PurchaseInvoices.jsx', import.meta.url), 'utf8');
const operationId = 'operation_20261009_12345';
const invoice = {
  system_invoice_number: '18021', branch: 'دواء شكري',
  total_value: 220, returned_value: 0,
  invoice_date: '2026-09-08', supplier_id: 'supplier-1', supplier_name: 'مورد اختبار',
};

test('B-Connect handoff never reaches legacy create or update mutations', () => {
  const start = source.indexOf('const handleSubmit = async (formData) => {');
  const end = source.indexOf('// Bulk actions', start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /if \(!activeHandoff\)/);
  assert.match(handler, /setHandoffWriteWarning\(/);
  assert.ok(!handler.includes('mutateAsync('));
  assert.ok(!handler.includes('writeAttempted'));
});

test('atomic command validates calendar dates instead of truncating date-time', () => {
  assert.equal(prepareBconnectWriteCommand({ operationId, mode: 'create', invoice }).invoice.invoice_date, '2026-09-08');
  for (const date of ['2026-09-08T10:13:00', '2026-02-30', '2026-9-8', '2026-13-01']) {
    assert.throws(() => prepareBconnectWriteCommand({
      operationId, mode: 'create', invoice: { ...invoice, invoice_date: date },
    }), /invalid_invoice_date/);
  }
});
