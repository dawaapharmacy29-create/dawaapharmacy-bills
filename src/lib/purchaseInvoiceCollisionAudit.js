import { normalizeBranch, normalizeInvoiceNumber } from './purchaseInvoiceTruth.js';
import { dedupeInvoiceRowsByStableId } from './invoiceIdentityGuard.js';

/**
 * A repeated stable ID is a transport/pagination repeat, not a new invoice.
 * Different stable IDs with the same program number in the same branch are
 * collisions that must remain visible for financial/source-event review.
 */
export function canonicalizeInvoicePageRows(rows) {
  return dedupeInvoiceRowsByStableId(rows);
}

export function invoiceBusinessNumberKey(row) {
  const branch = normalizeBranch(row?.branch);
  const number = normalizeInvoiceNumber(row?.system_invoice_number);
  if (!branch || !number) return null;
  return JSON.stringify([branch, number]);
}

export function findInvoiceProgramNumberCollisions(rows = []) {
  const groups = new Map();
  const canonicalRows = canonicalizeInvoicePageRows(rows);
  for (const row of canonicalRows) {
    const key = invoiceBusinessNumberKey(row);
    if (!key) continue;
    const current = groups.get(key) || [];
    current.push(row);
    groups.set(key, current);
  }
  // Explicitly do not merge or choose a winner for distinct business records.
  return new Map([...groups].filter(([, group]) => group.length > 1));
}

export function collisionGroupsForReview(rows = []) {
  const collisions = findInvoiceProgramNumberCollisions(rows);
  return [...collisions].map(([key, records]) => {
    const [branch, number] = JSON.parse(key);
    return {
      key,
      branch,
      number,
      records,
      distinct_ids: new Set(records.map((row) => String(row?.id || '').trim()).filter(Boolean)).size,
      has_missing_id: records.some((row) => !String(row?.id || '').trim()),
    };
  }).sort((a, b) => b.records.length - a.records.length);
}
