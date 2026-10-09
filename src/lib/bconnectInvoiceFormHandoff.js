import { normalizeBranch, normalizeDate, normalizeInvoiceNumber, normalizeMoney } from './purchaseInvoiceTruth.js';

/** Reject calendar-impossible dates without changing shared reconciliation normalization. */
function validCalendarDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Transfer only source-backed fields into the existing purchase invoice form. */
export function buildBConnectFormHandoff(row = {}) {
  if (!row.number || !row.bconnect || ['duplicate_app', 'duplicate_bconnect', 'unverified', 'unauthorized_or_incomplete', 'conflict'].includes(row.identity)) return null;
  const edit = row.identity === 'confirmed' && Boolean(row.app?.id);
  if (!edit && row.identity !== 'missing') return null;
  // A confirmed identity without a unique, stable app record cannot be safely edited.
  if (row.identity === 'confirmed' && !edit) return null;
  const b = row.bconnect;
  const total = normalizeMoney(b.invoice_value);
  const returned = normalizeMoney(b.return_value);
  const branch = normalizeBranch(b.branch);
  const date = normalizeDate(b.date);
  // A missing or invalid source date must never become the form default (today).
  if (!validCalendarDate(date)) return null;
  const serial = normalizeInvoiceNumber(b.serial);
  if (!serial || serial !== normalizeInvoiceNumber(row.number) || !['دواء شكري', 'دواء الشامي'].includes(branch)) return null;
  // Never pass impossible source amounts to the form, including on confirmed invoices.
  if ((total !== null && total < 0) || (returned !== null && returned < 0) ||
      (total !== null && returned !== null && returned > total)) return null;
  // Missing invoices need a real gross amount before a useful prefilled form can be offered.
  if (!edit && total === null) return null;
  // For edits, compare a partial source amount with the existing value it would retain.
  if (edit) {
    const effectiveTotal = total ?? normalizeMoney(row.app.total_value);
    const effectiveReturned = returned ?? normalizeMoney(row.app.returned_value) ?? 0;
    if (effectiveTotal === null || effectiveTotal < 0 || effectiveReturned < 0 || effectiveReturned > effectiveTotal) return null;
  }
  if (edit && (normalizeInvoiceNumber(row.app.system_invoice_number) !== serial || normalizeBranch(row.app.branch) !== branch)) return null;
  if (edit) return {
    mode: 'edit', recordId: row.app.id, expectedInvoiceNumber: serial,
    expectedBranch: branch, expectedTotal: normalizeMoney(row.app.total_value),
    expectedReturned: normalizeMoney(row.app.returned_value),
    expectedSupplierId: row.app.supplier_id ?? null,
    expectedDate: normalizeDate(row.app.invoice_date),
    source: 'bconnect-review', proposed: {
      ...row.app,
      system_invoice_number: serial,
      branch,
      ...(total !== null ? { total_value: total } : {}),
      ...(returned !== null ? { returned_value: returned } : {}),
      ...(date ? { invoice_date: date } : {}),
    },
    bconnectSupplier: b.supplier || '',
  };
  return {
    mode: 'create', source: 'bconnect-review',
    proposed: {
      system_invoice_number: serial, branch,
      ...(total !== null ? { total_value: total } : {}),
      ...(returned !== null ? { returned_value: returned } : {}),
      ...(date ? { invoice_date: date } : {}),
      // Supplier is deliberately left unselected until matched to the registry.
      notes: 'مقترح من مراجعة B-Connect — يرجى تأكيد المورد وطريقة الدفع والتصنيف قبل الحفظ.',
    },
    bconnectSupplier: b.supplier || '',
  };
}
