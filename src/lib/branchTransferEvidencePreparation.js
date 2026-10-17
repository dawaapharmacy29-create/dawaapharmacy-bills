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

const HEADER_TIME_TOLERANCE_MS = 2 * 60 * 1000;

function candidateTimeGap(line, header) {
  const lineTime = dateMs(line?.date);
  const headerTime = dateMs(header?.date);
  if (lineTime == null || headerTime == null) return null;
  return Math.abs(lineTime - headerTime);
}

function chooseHeaderCandidate(line, inputCandidates = []) {
  if (!inputCandidates.length) return { header: null, conflict: false, reason: 'missing' };
  let candidates = [...inputCandidates];
  const lineTime = dateMs(line?.date);

  if (lineTime != null) {
    const aligned = candidates.filter((item) => {
      const gap = candidateTimeGap(line, item);
      return gap != null && gap <= HEADER_TIME_TOLERANCE_MS;
    });
    if (aligned.length === 1) {
      const gap = candidateTimeGap(line, aligned[0]);
      return { header: aligned[0], conflict: false, reason: gap === 0 ? 'exact_time' : 'time_aligned' };
    }
    if (aligned.length > 1) candidates = aligned;
    else if (candidates.length === 1 && dateMs(candidates[0]?.date) != null) {
      return {
        header: null,
        conflict: true,
        reason: 'invoice_time_mismatch',
        candidates,
        time_gap_ms: candidateTimeGap(line, candidates[0]),
      };
    }
  }

  if (candidates.length === 1) return { header: candidates[0], conflict: false, reason: 'single_invoice' };

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
    if (!candidates.length) return {
      ...line,
      sale_line_user: text(line?.user),
      sale_actor: text(line?.user),
      sale_actor_source: text(line?.user) ? 'sale_line' : '',
      sale_actor_confidence: text(line?.user) ? 'line_only' : 'none',
      invoice_header_enriched: false,
      invoice_header_conflict: false,
      invoice_header_conflict_reason: 'missing',
    };

    const selected = chooseHeaderCandidate(line, candidates);
    if (selected.conflict || !selected.header) {
      const lineUser = text(line?.user);
      return {
        ...line,
        sale_line_user: lineUser,
        sale_actor: lineUser,
        sale_actor_source: lineUser ? 'sale_line' : '',
        sale_actor_confidence: lineUser ? 'line_only' : 'none',
        invoice_header_enriched: false,
        invoice_header_conflict: true,
        invoice_header_conflict_reason: selected.reason,
        invoice_header_time_gap_minutes: Number.isFinite(selected.time_gap_ms)
          ? Number((selected.time_gap_ms / 60000).toFixed(2))
          : null,
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
    const lineUser = text(line?.user);
    const gapMs = candidateTimeGap(line, header);
    const confidence = headerUser
      ? (['exact_time', 'time_aligned'].includes(selected.reason) ? 'verified_invoice_time' : 'invoice_header')
      : (lineUser ? 'line_only' : 'none');

    return {
      ...line,
      // Preserve the original detail-row user for audit. The Sales Bills invoice
      // header is the canonical seller only when the invoice identity is safe.
      sale_line_user: lineUser,
      user: lineUser || headerUser,
      sale_actor: headerUser || lineUser,
      sale_actor_source: headerUser ? 'sales_invoice_header' : (lineUser ? 'sale_line' : ''),
      sale_actor_confidence: confidence,
      date: validDateValue(line?.date) ? line.date : headerDate,
      invoice_header_user: headerUser,
      invoice_header_date: headerDate || '',
      invoice_header_source: text(header?.source_file),
      invoice_header_match_reason: selected.reason,
      invoice_header_time_gap_minutes: gapMs == null ? null : Number((gapMs / 60000).toFixed(2)),
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
  const timeMismatches = [];
  invoices.forEach((invoice) => {
    const invoiceLines = lines.filter((line) => invoiceKey(line?.invoice) === invoice);
    const candidates = index.get(invoice) || [];
    const results = invoiceLines.map((line) => chooseHeaderCandidate(line, candidates));
    if (results.some((selected) => selected.reason === 'invoice_time_mismatch')) timeMismatches.push(invoice);
    else if (results.some((selected) => selected.conflict)) ambiguous.push(invoice);
    else if (results.some((selected) => selected.header)) covered.push(invoice);
  });
  return {
    total_invoices: invoices.length,
    covered_invoices: covered.length,
    ambiguous_invoices: ambiguous.length,
    time_mismatch_invoices: timeMismatches.length,
    missing_invoices: invoices.filter((invoice) => !index.has(invoice)),
    ambiguous_invoice_numbers: ambiguous,
    time_mismatch_invoice_numbers: timeMismatches,
    coverage_percent: invoices.length ? Number(((covered.length / invoices.length) * 100).toFixed(1)) : 0,
  };
}
