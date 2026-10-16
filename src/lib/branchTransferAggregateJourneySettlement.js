const EPSILON = 0.0001;

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function unique(values = []) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function nearlyEqual(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= EPSILON;
}

function exactCode(item) {
  const codes = unique([...(item?.sale_codes || []), ...(item?.purchase_codes || [])]);
  return codes.length === 1 ? codes[0] : null;
}

function validTimestamp(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function lineTimes(item) {
  return [...(item?.sale_lines || []), ...(item?.purchase_lines || [])]
    .map((line) => validTimestamp(line?.timestamp_ms))
    .filter((value) => value != null);
}

function caseStart(item) {
  const times = lineTimes(item);
  return times.length ? Math.min(...times) : null;
}

function dayNumber(timestamp) {
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

function eligible(item) {
  return ['quantity_mismatch', 'sale_without_purchase', 'purchase_without_sale'].includes(item?.type)
    && exactCode(item)
    && Number.isFinite(caseStart(item));
}

function groupKey(item) {
  return [item?.from || '', item?.to || '', exactCode(item) || ''].join('::');
}

function mergeLines(items, field) {
  return items.flatMap((item) => item?.[field] || []);
}

function buildSettledCase(items) {
  const first = items[0];
  const saleQty = items.reduce((sum, item) => sum + Number(item?.sale_qty || 0), 0);
  const purchaseQty = items.reduce((sum, item) => sum + Number(item?.purchase_qty || 0), 0);
  const saleLines = mergeLines(items, 'sale_lines');
  const purchaseLines = mergeLines(items, 'purchase_lines');
  const saleInvoices = unique(items.flatMap((item) => item?.sale_invoices || []));
  const purchaseInvoices = unique(items.flatMap((item) => item?.purchase_invoices || []));
  const starts = items.map(caseStart).filter(Number.isFinite);
  const startDay = starts.length ? Math.min(...starts) : null;
  const endDay = starts.length ? Math.max(...starts) : null;
  const crossesDay = startDay != null && endDay != null && dayNumber(endDay) > dayNumber(startDay);

  return {
    ...first,
    id: [first?.from || 'unknown', first?.to || 'unknown', exactCode(first) || 'unknown', 'aggregate-settled', saleInvoices.join('+') || 'no-sale', purchaseInvoices.join('+') || 'no-purchase'].join('::'),
    type: 'matched',
    severity: 0,
    sale_qty: saleQty,
    purchase_qty: purchaseQty,
    sale_lines: saleLines,
    purchase_lines: purchaseLines,
    sale_invoices: saleInvoices,
    purchase_invoices: purchaseInvoices,
    sale_users: unique(items.flatMap((item) => item?.sale_users || [])),
    purchase_users: unique(items.flatMap((item) => item?.purchase_users || [])),
    match_confidence: 'high',
    confidence_score: crossesDay ? 88 : 90,
    episode_balanced: true,
    aggregate_journey_settled: true,
    aggregate_settlement_scope: crossesDay ? 'same-or-next-day' : 'same-day',
    aggregate_component_case_ids: items.map((item) => item?.id).filter(Boolean),
    match_reason: `إجمالي رحلة الصنف متوازن بعد جمع كل تسجيلات نفس الكود في ${crossesDay ? 'نفس اليوم واليوم التالي' : 'نفس اليوم'}؛ لا يوجد فرق كمية فعلي يحتاج قرارًا.`,
    next_action: 'لا يوجد إجراء مطلوب؛ الكمية متوازنة على مستوى رحلة الصنف.',
  };
}

export function settleAggregateProductJourneys(cases = []) {
  const consumed = new Set();
  const settled = [];
  const groups = new Map();

  cases.forEach((item, index) => {
    if (!eligible(item)) return;
    const key = groupKey(item);
    const bucket = groups.get(key) || [];
    bucket.push({ item, index, start: caseStart(item), day: dayNumber(caseStart(item)) });
    groups.set(key, bucket);
  });

  groups.forEach((entries) => {
    entries.sort((a, b) => a.start - b.start);
    let cursor = 0;
    while (cursor < entries.length) {
      const anchorDay = entries[cursor].day;
      const cluster = [];
      let i = cursor;
      while (i < entries.length && entries[i].day != null && anchorDay != null && entries[i].day - anchorDay <= 1) {
        cluster.push(entries[i]);
        i += 1;
      }

      if (cluster.length >= 2) {
        const saleQty = cluster.reduce((sum, entry) => sum + Number(entry.item?.sale_qty || 0), 0);
        const purchaseQty = cluster.reduce((sum, entry) => sum + Number(entry.item?.purchase_qty || 0), 0);
        if (nearlyEqual(saleQty, purchaseQty) && saleQty > EPSILON) {
          cluster.forEach((entry) => consumed.add(entry.index));
          settled.push(buildSettledCase(cluster.map((entry) => entry.item)));
          cursor = i;
          continue;
        }
      }
      cursor += 1;
    }
  });

  return [
    ...cases.filter((_, index) => !consumed.has(index)),
    ...settled,
  ].sort((a, b) => Number(b?.severity || 0) - Number(a?.severity || 0)
    || Number(b?.confidence_score || 0) - Number(a?.confidence_score || 0)
    || String(a?.product_name || '').localeCompare(String(b?.product_name || ''), 'ar'));
}

export function summarizeAggregateSettlement(before = [], after = []) {
  const beforeReview = before.filter((item) => item?.type !== 'matched').length;
  const afterReview = after.filter((item) => item?.type !== 'matched').length;
  const settledJourneys = after.filter((item) => item?.aggregate_journey_settled).length;
  return {
    before_review: beforeReview,
    after_review: afterReview,
    hidden_resolved_cases: Math.max(0, beforeReview - afterReview),
    settled_journeys: settledJourneys,
  };
}
