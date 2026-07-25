export const normalizeText = (value = "") => String(value).trim().replace(/\s+/g, " ").toLowerCase();

export const normalizeDigits = (value = "") => String(value).replace(/[^0-9]/g, "");

export const isValidEgyptianMobile = (value = "") => /^01[0125][0-9]{8}$/.test(normalizeDigits(value));

export const isFutureDate = (value) => {
  if (!value) return false;
  const selected = new Date(`${value}T23:59:59`);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return selected > today;
};

export const sameNormalized = (a, b) => normalizeText(a) === normalizeText(b);

export const findDuplicateSupplierInvoice = (invoices, candidate, ignoredId) => {
  const supplierNumber = normalizeText(candidate.supplier_invoice_number);
  if (!supplierNumber) return null;
  return invoices.find((invoice) =>
    invoice.id !== ignoredId &&
    sameNormalized(invoice.branch, candidate.branch) &&
    sameNormalized(invoice.supplier_name, candidate.supplier_name) &&
    normalizeText(invoice.supplier_invoice_number) === supplierNumber
  ) || null;
};
