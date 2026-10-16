function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function invoiceKey(value) {
  return text(value).replace(/\.0$/, '');
}

function validDateValue(value) {
  if (value == null || value === '') return false;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === 'number') return Number.isFinite(value);
  return Boolean(text(value));
}

export function buildSaleInvoiceHeaderIndex(headers = []) {
  const index = new Map();
  headers.forEach((header) => {
    const key = invoiceKey(header?.invoice);
    if (!key) return;
    const current = index.get(key) || [];
    current.push(header);
    index.set(key, current);
  });
  return index;
}

export function enrichSaleRowsWithInvoiceHeaders(lines = [], headers = []) {
  if (!lines.length || !headers.length) return lines.map((line) => ({ ...line }));
  const index = buildSaleInvoiceHeaderIndex(headers);
  return lines.map((line) => {
    const candidates = index.get(invoiceKey(line?.invoice)) || [];
    if (!candidates.length) return { ...line };

    // A transfer direction has one invoice number namespace in the uploaded source.
    // If the export happens to contain duplicate header rows, prefer one carrying user/date.
    const header = candidates.find((item) => text(item?.user) && validDateValue(item?.date))
      || candidates.find((item) => text(item?.user))
      || candidates[0];
    const headerUser = text(header?.user);
    const headerDate = header?.date;

    return {
      ...line,
      user: text(line?.user) || headerUser,
      date: validDateValue(line?.date) ? line.date : headerDate,
      invoice_header_user: headerUser,
      invoice_header_date: headerDate || '',
      invoice_header_source: text(header?.source_file),
      invoice_header_enriched: Boolean(headerUser || validDateValue(headerDate)),
    };
  });
}

export function saleHeaderCoverage(lines = [], headers = []) {
  const index = buildSaleInvoiceHeaderIndex(headers);
  const invoices = [...new Set(lines.map((line) => invoiceKey(line?.invoice)).filter(Boolean))];
  const covered = invoices.filter((invoice) => index.has(invoice));
  return {
    total_invoices: invoices.length,
    covered_invoices: covered.length,
    missing_invoices: invoices.filter((invoice) => !index.has(invoice)),
    coverage_percent: invoices.length ? Number(((covered.length / invoices.length) * 100).toFixed(1)) : 0,
  };
}
