/**
 * Canonical purchase-invoice truth helpers.
 *
 * This module is deliberately source-agnostic. Base44, Supabase projections and
 * B-Connect reconciliation must normalize into this shape before comparison.
 * It does not write, mutate or sync business data.
 */

export const PURCHASE_INVOICE_TRUTH_VERSION = "v2";

export function cleanInvoiceText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeArabicText(value) {
  return cleanInvoiceText(value)
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .toLowerCase();
}

export function normalizeBranch(value) {
  const raw = cleanInvoiceText(value);
  const normalized = normalizeArabicText(raw);
  if (!raw) return null;
  if (normalized.includes("شكري")) return "دواء شكري";
  if (normalized.includes("شامي")) return "دواء الشامي";
  return raw;
}

export function normalizeInvoiceNumber(value) {
  const text = cleanInvoiceText(value);
  if (!text) return null;
  // Excel/API sources sometimes serialize integer identifiers as 19527.0.
  return /^\d+\.0+$/.test(text) ? text.replace(/\.0+$/, "") : text;
}

export function normalizeMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  const cleaned = String(value).replace(/,/g, "").trim();
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

export function normalizeDate(value) {
  const text = cleanInvoiceText(value);
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, "0")}-${String(dmy[1]).padStart(2, "0")}`;
  return null;
}

export function canonicalPurchaseInvoice(input = {}, source = "unknown") {
  return {
    truth_version: PURCHASE_INVOICE_TRUTH_VERSION,
    source,
    source_record_id: cleanInvoiceText(input.source_record_id ?? input.base44_id ?? input.id) || null,
    system_invoice_number: normalizeInvoiceNumber(input.system_invoice_number ?? input.program_number ?? input.serial),
    supplier_invoice_number: normalizeInvoiceNumber(input.supplier_invoice_number),
    supplier_id: cleanInvoiceText(input.supplier_id ?? input.base44_supplier_id) || null,
    supplier_name: cleanInvoiceText(input.supplier_name ?? input.supplier) || null,
    supplier_name_key: normalizeArabicText(input.supplier_name ?? input.supplier) || null,
    branch: normalizeBranch(input.branch),
    // invoice_date is the business date only. Source timestamps remain separate evidence.
    invoice_date: normalizeDate(input.invoice_date ?? input.date),
    total_value: normalizeMoney(input.total_value ?? input.invoice_value),
    returned_value: normalizeMoney(input.returned_value ?? input.return_value),
    paid_value: normalizeMoney(input.paid_value),
    cash_amount: normalizeMoney(input.cash_amount),
    payment_type: cleanInvoiceText(input.payment_type) || null,
    entered_by: cleanInvoiceText(input.entered_by ?? input.user) || null,
    // B-Connect's "العدد" is intentionally retained as an uninterpreted source value.
    // We do not call it SKU count, line count or units until its semantics are proven.
    source_count_raw: normalizeMoney(input.source_count_raw ?? input.count),
    source_created_at: cleanInvoiceText(input.source_created_at ?? input.created_date ?? input.created_at) || null,
    source_updated_at: cleanInvoiceText(input.source_updated_at ?? input.updated_date ?? input.updated_at) || null,
  };
}

export function invoiceIdentityEvidence(invoice) {
  return {
    system_invoice_number: invoice.system_invoice_number,
    branch: invoice.branch,
    supplier_id: invoice.supplier_id,
    supplier_name_key: invoice.supplier_name_key,
    invoice_date: invoice.invoice_date,
    total_value: invoice.total_value,
  };
}
