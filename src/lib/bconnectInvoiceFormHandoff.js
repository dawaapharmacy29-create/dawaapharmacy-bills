import { normalizeBranch, normalizeDate, normalizeInvoiceNumber, normalizeMoney } from './purchaseInvoiceTruth.js';

/** Transfer only source-backed fields into the existing purchase invoice form. */
export function buildBConnectFormHandoff(row = {}) {
  if (!row.number || !row.bconnect || ['duplicate_app', 'duplicate_bconnect', 'unverified', 'unauthorized_or_incomplete', 'conflict'].includes(row.identity)) return null;
  const edit = row.identity === 'confirmed' && Boolean(row.app?.id);
  if (!edit && row.identity !== 'missing') return null;
  const b = row.bconnect;
  const total = normalizeMoney(b.invoice_value);
  const returned = normalizeMoney(b.return_value);
  const branch = normalizeBranch(b.branch);
  const date = normalizeDate(b.date);
  const serial = normalizeInvoiceNumber(b.serial);
  if (!serial || serial !== normalizeInvoiceNumber(row.number) || !['دواء شكري', 'دواء الشامي'].includes(branch)) return null;
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
