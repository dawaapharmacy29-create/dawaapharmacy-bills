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

function dateMs(value) {
  if (!validDateValue(value)) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function unique(values = []) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function chooseHeaderCandidate(line, candidates = []) {
  if (!candidates.length) return { header: null, conflict: false, reason: 'missing' };
  if (candidates.length === 1) return { header: candidates[0], conflict: false, reason: 'single' };

  const lineTime = dateMs(line?.date);
  if (lineTime != null) {
    const exactTime = candidates.filter((item) => dateMs(item?.date) === lineTime);
    if (exactTime.length === 1) return { header: exactTime[0], conflict: false, reason: 'exact_time' };
    if (exactTime.length > 1) candidates = exactTime;
  }

  const users = unique(candidates.map((item) => item?.user));
  const times = [...new Set(candidates.map((item) => dateMs(item?.date)).filter((value) => value != null))];
  if (users.length <= 1 && times.length <= 1) {
    const header = candidates.find((item) => text(item?.user) && validDateValue(item?.date))
      || candidates.find((item) => text(item?.user))
      || candidates[0];
    return { header, conflict: false, reason: 'equivalent_duplicates' };
  }

  return { header: null, conflict: true, reason: 'conflicting_headers', candidates };
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

    const selected = chooseHeaderCandidate(line, candidates);
    if (selected.conflict || !selected.header) {
      return {
        ...line,
        invoice_header_enriched: false,
        invoice_header_conflict: true,
        invoice_header_conflict_reason: selected.reason,
        invoice_header_candidates: candidates.map((item) => ({
          user: text(item?.user),
          date: item?.date || '',
          source_file: text(item?.source_file),
        })),
      };
    }

    const header = selected.header;
    const headerUser = text(header?.user);
    const headerDate = header?.date;
    return {
      ...line,
      user: text(line?.user) || headerUser,
      date: validDateValue(line?.date) ? line.date : headerDate,
      invoice_header_user: headerUser,
      invoice_header_date: headerDate || '',
      invoice_header_source: text(header?.source_file),
      invoice_header_match_reason: selected.reason,
      invoice_header_conflict: false,
      invoice_header_enriched: Boolean(headerUser || validDateValue(headerDate)),
    };
  });
}

export function saleHeaderCoverage(lines = [], headers = []) {
  const index = buildSaleInvoiceHeaderIndex(headers);
  const invoices = [...new Set(lines.map((line) => invoiceKey(line?.invoice)).filter(Boolean))];
  const covered = [];
  const ambiguous = [];
  invoices.forEach((invoice) => {
    const sampleLine = lines.find((line) => invoiceKey(line?.invoice) === invoice);
    const selected = chooseHeaderCandidate(sampleLine, index.get(invoice) || []);
    if (selected.conflict) ambiguous.push(invoice);
    else if (selected.header) covered.push(invoice);
  });
  return {
    total_invoices: invoices.length,
    covered_invoices: covered.length,
    ambiguous_invoices: ambiguous.length,
    missing_invoices: invoices.filter((invoice) => !index.has(invoice)),
    ambiguous_invoice_numbers: ambiguous,
    coverage_percent: invoices.length ? Number(((covered.length / invoices.length) * 100).toFixed(1)) : 0,
  };
}
