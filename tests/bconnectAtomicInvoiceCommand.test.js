import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBconnectWriteCommand } from '../src/lib/bconnectAtomicInvoiceCommand.js';

const invoice = { system_invoice_number: '19527.0', branch: 'شكري', total_value: 100, returned_value: 10, invoice_date: '2026-10-09', supplier_id: 'supplier-1', supplier_name: 'مورد تجريبي' };
const operationId = 'bconnect-create-19527';

test('create command canonicalizes identity and amounts', () => {
  const command = prepareBconnectWriteCommand({ operationId, mode: 'create', invoice });
  assert.equal(command.invoice.system_invoice_number, '19527');
  assert.equal(command.invoice.branch, 'دواء شكري');
  assert.equal(command.invoice.total_value, 100);
  assert.equal(command.invoice.returned_value, 10);
  assert.equal(command.record_id, null);
});

test('edit requires a server revision and record identity', () => {
  assert.throws(() => prepareBconnectWriteCommand({ operationId, mode: 'edit', invoice }), /missing_revision/);
  const command = prepareBconnectWriteCommand({ operationId, mode: 'edit', invoice, recordId: 'invoice-1', expectedRevision: 'rev-2' });
  assert.equal(command.expected_revision, 'rev-2');
});

test('rejects invalid amounts, operation IDs and unexpected create revisions', () => {
  assert.throws(() => prepareBconnectWriteCommand({ operationId, mode: 'create', invoice: { ...invoice, returned_value: 101 } }), /invalid_amounts/);
  assert.throws(() => prepareBconnectWriteCommand({ operationId: 'short', mode: 'create', invoice }), /invalid_operation_id/);
  assert.throws(() => prepareBconnectWriteCommand({ operationId, mode: 'create', invoice, expectedRevision: 'x' }), /unexpected_revision/);
});

test('rejects nonexistent calendar dates and missing supplier', () => {
  assert.throws(() => prepareBconnectWriteCommand({ operationId, mode: 'create', invoice: { ...invoice, invoice_date: '2026-02-30' } }), /invalid_invoice_date/);
  assert.throws(() => prepareBconnectWriteCommand({ operationId, mode: 'create', invoice: { ...invoice, supplier_id: '' } }), /missing_supplier/);
});
