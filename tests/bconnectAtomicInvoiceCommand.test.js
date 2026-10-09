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

test('edit requires a numeric server revision and record identity', () => {
  assert.throws(() => prepareBconnectWriteCommand({ operationId, mode: 'edit', invoice }), /missing_revision/);
  assert.throws(() => prepareBconnectWriteCommand({ operationId, mode: 'edit', invoice, recordId: 'invoice-1', expectedRevision: 'rev-2' }), /missing_revision/);
  const command = prepareBconnectWriteCommand({ operationId, mode: 'edit', invoice, recordId: 'invoice-1', expectedRevision: 2 });
  assert.equal(command.expected_revision, 2);
});

test('rejects invalid amounts, operation IDs and unexpected create revisions', () => {
  assert.throws(() => prepareBconnectWriteCommand({ operationId, mode: 'create', invoice: { ...invoice, returned_value: 101 } }), /invalid_amounts/);
  assert.throws(() => prepareBconnectWriteCommand({ operationId: 'short', mode: 'create', invoice }), /invalid_operation_id/);
  assert.throws(() => prepareBconnectWriteCommand({ operationId, mode: 'create', invoice, expectedRevision: 1 }), /unexpected_revision/);
});

test('rejects nonexistent calendar dates and missing supplier', () => {
  assert.throws(() => prepareBconnectWriteCommand({ operationId, mode: 'create', invoice: { ...invoice, invoice_date: '2026-02-30' } }), /invalid_invoice_date/);
  assert.throws(() => prepareBconnectWriteCommand({ operationId, mode: 'create', invoice: { ...invoice, supplier_id: '' } }), /missing_supplier/);
});

test('rejects malformed invoice number and non-string server identifiers', () => {
  assert.throws(() => prepareBconnectWriteCommand({ operationId, mode: 'create', invoice: { ...invoice, system_invoice_number: 'ABC-1' } }), /invalid_invoice_identity/);
  assert.throws(() => prepareBconnectWriteCommand({ operationId, mode: 'create', invoice: { ...invoice, supplier_id: { id: 'supplier-1' } } }), /missing_supplier/);
  assert.throws(() => prepareBconnectWriteCommand({ operationId, mode: 'edit', invoice, recordId: {}, expectedRevision: 2 }), /missing_revision/);
});

test('atomic command excludes server-owned and unknown invoice fields', () => {
  const command = prepareBconnectWriteCommand({ operationId, mode: 'create', invoice: {
    ...invoice, id: 'forged-id', revision: 'forged-revision', created_at: 'forged-time',
    audit_actor: 'forged-actor', unknown_field: 'forged-value', payment_type: 'نقدي',
    status: 'معتمدة', workflow_status: 'approved', entered_by: 'forged-user', entered_by_account_id: 'forged-account',
  } });
  for (const key of ['id', 'revision', 'created_at', 'audit_actor', 'unknown_field', 'status', 'workflow_status', 'entered_by', 'entered_by_account_id']) {
    assert.equal(Object.hasOwn(command.invoice, key), false, key);
  }
  assert.equal(command.invoice.payment_type, 'نقدي');
});

test('edit identifiers are trimmed and invalid revisions are rejected', () => {
  const command = prepareBconnectWriteCommand({ operationId, mode: 'edit', invoice, recordId: '  invoice-1  ', expectedRevision: '2' });
  assert.equal(command.record_id, 'invoice-1');
  assert.equal(command.expected_revision, 2);
  for (const expectedRevision of ['   ', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => prepareBconnectWriteCommand({ operationId, mode: 'edit', invoice, recordId: 'invoice-1', expectedRevision }), /missing_revision/);
  }
});

test('rejects missing invoice payload and invalid cash amounts', () => {
  assert.throws(() => prepareBconnectWriteCommand({ operationId, mode: 'create' }), /invalid_invoice_payload/);
  assert.throws(() => prepareBconnectWriteCommand({ operationId, mode: 'create', invoice: [] }), /invalid_invoice_payload/);
  for (const cash_amount of [-1, 91, 'not-money']) {
    assert.throws(() => prepareBconnectWriteCommand({ operationId, mode: 'create', invoice: { ...invoice, cash_amount } }), /invalid_cash_amount/);
  }
  const command = prepareBconnectWriteCommand({ operationId, mode: 'create', invoice: { ...invoice, cash_amount: '25.50' } });
  assert.equal(command.invoice.cash_amount, 25.5);
});

test('rejects zero-only system invoice numbers in the disabled write contract', () => {
  for (const system_invoice_number of ['0', '000', '000.0']) {
    assert.throws(() => prepareBconnectWriteCommand({ operationId, mode: 'create', invoice: { ...invoice, system_invoice_number } }), /invalid_invoice_identity/);
  }
});
