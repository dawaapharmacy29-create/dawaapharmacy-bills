import { normalizeBranch, normalizeInvoiceNumber, normalizeMoney, normalizeDate } from './purchaseInvoiceTruth.js';

// Pure contract preparation. Does not send requests or change persisted invoices.
export function prepareBconnectWriteCommand({ operationId, mode, invoice, recordId, expectedRevision } = {}) {
  const operation = String(operationId ?? '').trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(operation)) throw new Error('invalid_operation_id');
  if (mode !== 'create' && mode !== 'edit') throw new Error('invalid_mode');
  const number = normalizeInvoiceNumber(invoice?.system_invoice_number);
  const branch = normalizeBranch(invoice?.branch);
  const total = normalizeMoney(invoice?.total_value);
  const returned = invoice?.returned_value == null || invoice.returned_value === '' ? 0 : normalizeMoney(invoice.returned_value);
  if (!number || !['دواء شكري', 'دواء الشامي'].includes(branch)) throw new Error('invalid_invoice_identity');
  if (total === null || total < 0 || returned === null || returned < 0 || returned > total) throw new Error('invalid_amounts');
  const rawDate = String(invoice?.invoice_date ?? '').trim();
  const normalizedDate = normalizeDate(rawDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate) || normalizedDate !== rawDate) throw new Error('invalid_invoice_date');
  const [year, month, day] = rawDate.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error('invalid_invoice_date');
  if (!String(invoice?.supplier_id ?? '').trim() || !String(invoice?.supplier_name ?? '').trim()) throw new Error('missing_supplier');
  if (mode === 'edit' && (!recordId || !expectedRevision)) throw new Error('missing_revision');
  if (mode === 'create' && (recordId || expectedRevision)) throw new Error('unexpected_revision');
  return {
    contract: 'bconnect_atomic_invoice_write_v1',
    operation_id: operation,
    mode,
    record_id: mode === 'edit' ? String(recordId) : null,
    expected_revision: mode === 'edit' ? String(expectedRevision) : null,
    invoice: { ...invoice, system_invoice_number: number, branch, total_value: total, returned_value: returned },
  };
}
