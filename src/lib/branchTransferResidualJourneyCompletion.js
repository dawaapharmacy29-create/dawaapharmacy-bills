const MAX_COMPLETION_GAP_MINUTES = 4 * 60;
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

function lineTimes(item) {
  return [...(item?.sale_lines || []), ...(item?.purchase_lines || [])]
    .map((line) => Number(line?.timestamp_ms))
    .filter(Number.isFinite);
}

function caseStart(item) {
  const times = lineTimes(item);
  return times.length ? Math.min(...times) : null;
}

function minuteGap(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(a - b) / 60000;
}

function sameJourneyIdentity(a, b) {
  const codeA = exactCode(a);
  const codeB = exactCode(b);
  return Boolean(codeA && codeB && codeA === codeB && a?.from === b?.from && a?.to === b?.to);
}

function neededResidual(anchor) {
  const sale = Number(anchor?.sale_qty || 0);
  const purchase = Number(anchor?.purchase_qty || 0);
  const diff = sale - purchase;
  if (Math.abs(diff) <= EPSILON) return null;
  return diff > 0
    ? { side: 'purchase', qty: diff }
    : { side: 'sale', qty: Math.abs(diff) };
}

function isPureMissingSide(item, side) {
  if (side === 'purchase') {
    return Number(item?.sale_qty || 0) <= EPSILON
      && Number(item?.purchase_qty || 0) > EPSILON
      && item?.type === 'purchase_without_sale';
  }
  return Number(item?.purchase_qty || 0) <= EPSILON
    && Number(item?.sale_qty || 0) > EPSILON
    && item?.type === 'sale_without_purchase';
}

function mergeLines(items, field) {
  return items.flatMap((item) => item?.[field] || []);
}

function mergedTimeGap(saleLines, purchaseLines) {
  const saleTimes = saleLines.map((line) => Number(line?.timestamp_ms)).filter(Number.isFinite);
  const purchaseTimes = purchaseLines.map((line) => Number(line?.timestamp_ms)).filter(Number.isFinite);
  if (!saleTimes.length || !purchaseTimes.length) return null;
  return Math.abs(Math.min(...saleTimes) - Math.min(...purchaseTimes)) / 60000;
}

function candidateEvidence(anchorTime, candidate) {
  return {
    case_id: candidate.item?.id || null,
    invoice_numbers: unique([...(candidate.item?.sale_invoices || []), ...(candidate.item?.purchase_invoices || [])]),
    qty: Number(candidate.item?.sale_qty || candidate.item?.purchase_qty || 0),
    users: unique([...(candidate.item?.sale_users || []), ...(candidate.item?.purchase_users || [])]),
    gap_minutes: Number((minuteGap(anchorTime, caseStart(candidate.item)) || 0).toFixed(1)),
  };
}

function buildCompletedCase(items) {
  const anchor = items.find((item) => item.type === 'quantity_mismatch') || items[0];
  const saleLines = mergeLines(items, 'sale_lines');
  const purchaseLines = mergeLines(items, 'purchase_lines');
  const saleQty = items.reduce((sum, item) => sum + Number(item?.sale_qty || 0), 0);
  const purchaseQty = items.reduce((sum, item) => sum + Number(item?.purchase_qty || 0), 0);
  const saleInvoices = unique(items.flatMap((item) => item?.sale_invoices || []));
  const purchaseInvoices = unique(items.flatMap((item) => item?.purchase_invoices || []));
  const gap = mergedTimeGap(saleLines, purchaseLines);
  const reasons = unique([
    ...items.map((item) => item?.match_reason),
    'اكتملت الكمية من حركة إضافية لنفس الكود داخل نافذة زمنية محدودة',
  ]);
  return {
    ...anchor,
    id: [anchor?.from || 'unknown', anchor?.to || 'unknown', exactCode(anchor) || 'unknown', saleInvoices.join('+') || 'no-sale', purchaseInvoices.join('+') || 'no-purchase', 'completed'].join('::'),
    type: 'matched',
    severity: 0,
    sale_qty: saleQty,
    purchase_qty: purchaseQty,
    sale_invoices: saleInvoices,
    purchase_invoices: purchaseInvoices,
    sale_users: unique(items.flatMap((item) => item?.sale_users || [])),
    purchase_users: unique(items.flatMap((item) => item?.purchase_users || [])),
    sale_lines: saleLines,
    purchase_lines: purchaseLines,
    match_confidence: 'high',
    confidence_score: 94,
    match_reason: reasons.join(' · '),
    time_gap_minutes: gap == null ? null : Number(gap.toFixed(1)),
    episode_balanced: true,
    residual_journey_completed: true,
    residual_component_case_ids: items.map((item) => item?.id).filter(Boolean),
    next_action: 'لا يوجد إجراء مطلوب؛ اكتملت الكمية بعد فهم رحلة التحويل الموزعة على أكثر من تسجيل.',
  };
}

export function completeResidualBalancedJourneys(cases = []) {
  const consumed = new Set();
  const completed = [];
  const ambiguousEvidence = new Map();

  cases.forEach((anchor, anchorIndex) => {
    if (consumed.has(anchorIndex) || anchor?.type !== 'quantity_mismatch') return;
    const needed = neededResidual(anchor);
    if (!needed) return;
    const anchorTime = caseStart(anchor);
    if (!Number.isFinite(anchorTime)) return;

    const candidates = cases
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => index !== anchorIndex
        && !consumed.has(index)
        && sameJourneyIdentity(anchor, item)
        && isPureMissingSide(item, needed.side)
        && nearlyEqual(needed.side === 'purchase' ? item.purchase_qty : item.sale_qty, needed.qty)
        && Number.isFinite(caseStart(item))
        && minuteGap(anchorTime, caseStart(item)) <= MAX_COMPLETION_GAP_MINUTES)
      .sort((a, b) => minuteGap(anchorTime, caseStart(a.item)) - minuteGap(anchorTime, caseStart(b.item)));

    if (candidates.length > 1) {
      ambiguousEvidence.set(anchorIndex, {
        residual_review_reason: 'يوجد أكثر من تسجيل بنفس الكود والكمية يمكنه تفسير الفرق؛ لم يتم اختيار أي واحد تلقائيًا.',
        residual_needed_side: needed.side,
        residual_needed_qty: Number(needed.qty.toFixed(3)),
        residual_candidate_count: candidates.length,
        residual_candidates: candidates.map((candidate) => candidateEvidence(anchorTime, candidate)),
      });
      return;
    }
    if (candidates.length !== 1) return;

    const match = candidates[0];
    const merged = buildCompletedCase([anchor, match.item]);
    if (!nearlyEqual(merged.sale_qty, merged.purchase_qty)) return;

    consumed.add(anchorIndex);
    consumed.add(match.index);
    completed.push(merged);
  });

  return [
    ...cases
      .map((item, index) => ambiguousEvidence.has(index) ? { ...item, ...ambiguousEvidence.get(index) } : item)
      .filter((_, index) => !consumed.has(index)),
    ...completed,
  ].sort((a, b) => Number(b?.severity || 0) - Number(a?.severity || 0)
    || Number(b?.confidence_score || 0) - Number(a?.confidence_score || 0)
    || String(a?.product_name || '').localeCompare(String(b?.product_name || ''), 'ar'));
}
