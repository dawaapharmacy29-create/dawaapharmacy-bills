import { invoiceBusinessNumberKey } from './purchaseInvoiceCollisionAudit.js';
import { normalizeInvoiceNumber, normalizeBranch } from './purchaseInvoiceTruth.js';
import { normalizeText } from './dataIntegrity.js';

const DUPLICATE_FLAGS = new Set(['duplicate_program', 'duplicate']);

export function isInvoiceQualityDuplicate(row) {
  return Array.isArray(row?.issues) && row.issues.some((issue) => DUPLICATE_FLAGS.has(issue));
}

export function invoiceQualitySupplierKey(row) {
  const branch = normalizeBranch(row?.branch);
  const supplier = normalizeText(row?.supplier_name);
  const reference = normalizeText(row?.supplier_invoice_number);
  if (!branch || !supplier || !reference) return null;
  return JSON.stringify([branch, supplier, reference]);
}

function numericTextCompare(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'ar', { numeric: true, sensitivity: 'base' });
}

function invoiceRowCompare(a, b) {
  const byBranch = numericTextCompare(normalizeBranch(a.branch), normalizeBranch(b.branch));
  if (byBranch) return byBranch;
  const byProgram = numericTextCompare(normalizeInvoiceNumber(a.system_invoice_number), normalizeInvoiceNumber(b.system_invoice_number));
  if (byProgram) return byProgram;
  const byDate = numericTextCompare(a.invoice_date, b.invoice_date);
  if (byDate) return byDate;
  return numericTextCompare(a.id, b.id);
}

function groupMetadata(records, index, type) {
  const sorted = [...records].sort(invoiceRowCompare);
  const programKeys = [...new Set(sorted.map(invoiceBusinessNumberKey).filter(Boolean))];
  const supplierKeys = [...new Set(sorted.map(invoiceQualitySupplierKey).filter(Boolean))];
  const duplicate = sorted.length > 1;
  let kind = 'single';
  if (duplicate) {
    if (type === 'program' || (programKeys.length === 1 && sorted.every((row) => row.issues?.includes('duplicate_program')))) kind = 'program';
    else if (type === 'supplier' || (supplierKeys.length === 1 && sorted.every((row) => row.issues?.includes('duplicate')))) kind = 'supplier';
    else kind = 'linked';
  }
  const branch = normalizeBranch(sorted[0]?.branch) || sorted[0]?.branch || '';
  const programNumber = kind === 'program' ? normalizeInvoiceNumber(sorted[0]?.system_invoice_number) : null;
  const supplierNumber = kind === 'supplier' ? sorted[0]?.supplier_invoice_number : null;
  return {
    key: kind + ':' + (programKeys[0] || supplierKeys[0] || 'row') + ':' + index,
    kind,
    branch,
    programNumber,
    supplierNumber,
    numbers: [...new Set(sorted.map((row) => normalizeInvoiceNumber(row.system_invoice_number)).filter(Boolean))],
    rows: sorted,
    size: sorted.length,
    isDuplicate: duplicate && sorted.some(isInvoiceQualityDuplicate),
  };
}

/**
 * Build connected duplicate groups for review, not accounting equivalence.
 * One invoice may have both a program-number collision and a supplier-reference
 * collision. Linking the groups keeps every involved record together exactly
 * once instead of making the user hunt through different pagination pages.
 *
 * mode = program: same normalized program number within branch
 * mode = supplier: same supplier reference within branch and supplier
 * mode = all: connected groups on either evidence type
 */
export function buildInvoiceQualityGroups(rows, mode = 'all') {
  const list = Array.isArray(rows) ? rows : [];
  const parent = list.map((_, i) => i);
  const find = (n) => {
    let i = n;
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const unite = (a, b) => { parent[find(a)] = find(b); };
  const map = new Map();
  const useProgram = mode === 'program' || mode === 'all';
  const useSupplier = mode === 'supplier' || mode === 'all';

  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    const keys = [];
    if (useProgram && row.issues?.includes('duplicate_program')) {
      const key = invoiceBusinessNumberKey(row);
      if (key) keys.push('program:' + key);
    }
    if (useSupplier && row.issues?.includes('duplicate')) {
      const key = invoiceQualitySupplierKey(row);
      if (key) keys.push('supplier:' + key);
    }
    for (const key of keys) {
      if (map.has(key)) unite(i, map.get(key));
      else map.set(key, i);
    }
  }

  const buckets = new Map();
  for (let i = 0; i < list.length; i += 1) {
    const key = find(i);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(list[i]);
  }
  const groups = [...buckets.values()].map((records, i) => groupMetadata(records, i, mode));
  return groups.sort((a, b) => {
    if (a.isDuplicate !== b.isDuplicate) return a.isDuplicate ? -1 : 1;
    const branch = numericTextCompare(a.branch, b.branch);
    if (branch) return branch;
    const invoice = numericTextCompare(a.numbers[0], b.numbers[0]);
    if (invoice) return invoice;
    return numericTextCompare(a.key, b.key);
  });
}

export function filterInvoiceQualityGroups(groups, query) {
  const term = normalizeText(query);
  if (!term) return groups;
  return groups.filter((group) => group.rows.some((row) =>
    [row.system_invoice_number, row.supplier_invoice_number, row.supplier_name, row.entered_by, row.id]
      .some((value) => normalizeText(value).includes(term))
  ));
}

/** Paginate whole groups; never put two related records on separate pages. */
export function paginateInvoiceQualityGroups(groups, limit = 250) {
  const max = Number.isSafeInteger(limit) && limit > 0 ? limit : 250;
  const pages = [];
  let page = [];
  let count = 0;
  for (const group of groups) {
    if (page.length && count + group.rows.length > max) {
      pages.push(page);
      page = [];
      count = 0;
    }
    page.push(group);
    count += group.rows.length;
  }
  if (page.length || pages.length === 0) pages.push(page);
  return pages;
}
