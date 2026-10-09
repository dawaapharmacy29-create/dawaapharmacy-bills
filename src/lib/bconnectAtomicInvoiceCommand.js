import { normalizeBranch, normalizeInvoiceNumber, normalizeMoney, normalizeDate } from './purchaseInvoiceTruth.js';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function validateDate(rawValue) {
  const rawDate = String(rawValue ?? '').trim();
  const normalizedDate = normalizeDate(rawDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate) || normalizedDate !== rawDate) throw new Error('invalid_invoice_date');
  const [year, month, day] = rawDate.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error('invalid_invoice_date');
  return rawDate;
}

function normalizeRequiredMoney(value, errorCode) {
  const normalized = normalizeMoney(value);
  if (normalized === null || normalized < 0) throw new Error(errorCode);
  return normalized;
}

// Pure contract preparation. Does not send requests or change persisted invoices.
export function prepareBconnectWriteCommand({ operationId, mode, invoice, recordId, expectedRevision } = {}) {
  const operation = String(operationId ?? '').trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(operation)) throw new Error('invalid_operation_id');
  if (mode !== 'create' && mode !== 'edit') throw new Error('invalid_mode');
  if (!invoice || typeof invoice !== 'object' || Array.isArray(invoice)) throw new Error('invalid_invoice_payload');

  let revision = null;
  if (mode === 'edit') {
    if (typeof recordId !== 'string' || !recordId.trim()) throw new Error('missing_revision');
    const numericRevision = typeof expectedRevision === 'number' ? expectedRevision : Number(String(expectedRevision ?? '').trim());
    if (!Number.isSafeInteger(numericRevision) || numericRevision < 1) throw new Error('missing_revision');
    revision = numericRevision;
  } else if (recordId || expectedRevision != null) {
    throw new Error('unexpected_revision');
  }

  const writableFields = [
    'supplier_invoice_number', 'payment_type', 'notes',
    'purchase_category', 'purchase_category_source', 'transaction_type',
    'net_purchase_mode', 'exclusion_reason', 'exclusion_note',
    'source_branch', 'destination_branch',
  ];
  const writable = Object.fromEntries(writableFields
    .filter((key) => hasOwn(invoice, key))
    .map((key) => [key, invoice[key]]));

  if (mode === 'edit') {
    const patch = { ...writable };

    if (hasOwn(invoice, 'system_invoice_number')) {
      const number = normalizeInvoiceNumber(invoice.system_invoice_number);
      if (!number || !/^[0-9]+$/.test(number) || !/[1-9]/.test(number)) throw new Error('invalid_invoice_identity');
      patch.system_invoice_number = number;
    }
    if (hasOwn(invoice, 'branch')) {
      const branch = normalizeBranch(invoice.branch);
      if (!['دواء شكري', 'دواء الشامي'].includes(branch)) throw new Error('invalid_invoice_identity');
      patch.branch = branch;
    }
    if (hasOwn(invoice, 'invoice_date')) patch.invoice_date = validateDate(invoice.invoice_date);
    if (hasOwn(invoice, 'total_value')) patch.total_value = normalizeRequiredMoney(invoice.total_value, 'invalid_amounts');
    if (hasOwn(invoice, 'returned_value')) patch.returned_value = normalizeRequiredMoney(invoice.returned_value, 'invalid_amounts');
    if (hasOwn(invoice, 'cash_amount')) patch.cash_amount = normalizeRequiredMoney(invoice.cash_amount, 'invalid_cash_amount');

    const hasSupplierId = hasOwn(invoice, 'supplier_id');
    const hasSupplierName = hasOwn(invoice, 'supplier_name');
    if (hasSupplierId !== hasSupplierName) throw new Error('missing_supplier');
    if (hasSupplierId) {
      if (typeof invoice.supplier_id !== 'string' || !invoice.supplier_id.trim() || typeof invoice.supplier_name !== 'string' || !invoice.supplier_name.trim()) throw new Error('missing_supplier');
      patch.supplier_id = invoice.supplier_id.trim();
      patch.supplier_name = invoice.supplier_name.trim();
    }

    if (!Object.keys(patch).length) throw new Error('empty_edit_patch');
    return {
      contract: 'bconnect_atomic_invoice_write_v1',
      operation_id: operation,
      mode,
      record_id: recordId.trim(),
      expected_revision: revision,
      invoice: patch,
    };
  }

  const number = normalizeInvoiceNumber(invoice.system_invoice_number);
  const branch = normalizeBranch(invoice.branch);
  const total = normalizeMoney(invoice.total_value);
  const returned = invoice.returned_value == null || invoice.returned_value === '' ? 0 : normalizeMoney(invoice.returned_value);
  if (!number || !/^[0-9]+$/.test(number) || !/[1-9]/.test(number) || !['دواء شكري', 'دواء الشامي'].includes(branch)) throw new Error('invalid_invoice_identity');
  if (total === null || total < 0 || returned === null || returned < 0 || returned > total) throw new Error('invalid_amounts');
  if (hasOwn(invoice, 'cash_amount')) {
    const cash = normalizeMoney(invoice.cash_amount);
    if (cash === null || cash < 0 || cash > total - returned) throw new Error('invalid_cash_amount');
    writable.cash_amount = cash;
  }
  const rawDate = validateDate(invoice.invoice_date);
  if (typeof invoice.supplier_id !== 'string' || !invoice.supplier_id.trim() || typeof invoice.supplier_name !== 'string' || !invoice.supplier_name.trim()) throw new Error('missing_supplier');

  return {
    contract: 'bconnect_atomic_invoice_write_v1',
    operation_id: operation,
    mode,
    record_id: null,
    expected_revision: null,
    invoice: {
      ...writable,
      system_invoice_number: number,
      branch,
      total_value: total,
      returned_value: returned,
      invoice_date: rawDate,
      supplier_id: invoice.supplier_id.trim(),
      supplier_name: invoice.supplier_name.trim(),
    },
  };
}
