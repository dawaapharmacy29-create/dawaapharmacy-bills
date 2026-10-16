const CLOSED_STATUSES = new Set(['dismissed', 'verified', 'waiting_verification']);

function branchToken(value) {
  const text = String(value || '').toLowerCase();
  if (/shokry|شكري|العزم/.test(text)) return 'shokry';
  if (/shamy|شامي/.test(text)) return 'shamy';
  return null;
}

function counterpartSourceLoaded(item, sourcePresence = {}) {
  const from = branchToken(item?.from);
  const to = branchToken(item?.to);
  if (item?.type === 'sale_without_purchase') {
    if (from === 'shokry' && to === 'shamy') return Boolean(sourcePresence.shamyPurchase);
    if (from === 'shamy' && to === 'shokry') return Boolean(sourcePresence.shokryPurchase);
  }
  if (item?.type === 'purchase_without_sale') {
    if (from === 'shokry' && to === 'shamy') return Boolean(sourcePresence.shokrySale);
    if (from === 'shamy' && to === 'shokry') return Boolean(sourcePresence.shamySale);
  }
  return true;
}

function validTimestamp(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function itemSideTimestamps(item, side) {
  const lines = side === 'sale' ? (item?.sale_lines || []) : (item?.purchase_lines || []);
  return lines.map((line) => validTimestamp(line?.timestamp_ms)).filter((value) => value != null);
}

function itemTimestamps(item) {
  return [...itemSideTimestamps(item, 'sale'), ...itemSideTimestamps(item, 'purchase')];
}

function dayKey(timestamp) {
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function itemDay(item) {
  const timestamps = itemTimestamps(item);
  return timestamps.length ? dayKey(Math.min(...timestamps)) : null;
}

function directionKey(item) {
  const from = branchToken(item?.from) || String(item?.from || 'unknown');
  const to = branchToken(item?.to) || String(item?.to || 'unknown');
  return `${from}::${to}`;
}

function minDay(values = []) {
  return values.filter(Boolean).sort()[0] || null;
}

function maxDay(values = []) {
  return values.filter(Boolean).sort().at(-1) || null;
}

export function buildDirectionalEvidenceCoverage(cases = []) {
  const coverage = {};
  cases.forEach((item) => {
    const key = directionKey(item);
    const bucket = coverage[key] || {
      sale_min_day: null,
      sale_max_day: null,
      purchase_min_day: null,
      purchase_max_day: null,
    };
    const saleDays = itemSideTimestamps(item, 'sale').map(dayKey).filter(Boolean);
    const purchaseDays = itemSideTimestamps(item, 'purchase').map(dayKey).filter(Boolean);
    bucket.sale_min_day = minDay([bucket.sale_min_day, ...saleDays]);
    bucket.sale_max_day = maxDay([bucket.sale_max_day, ...saleDays]);
    bucket.purchase_min_day = minDay([bucket.purchase_min_day, ...purchaseDays]);
    bucket.purchase_max_day = maxDay([bucket.purchase_max_day, ...purchaseDays]);
    coverage[key] = bucket;
  });
  return coverage;
}

function coverageSpansReviewDay(minEvidenceDay, maxEvidenceDay, caseDay) {
  if (!caseDay) return true;
  if (!minEvidenceDay || !maxEvidenceDay) return false;
  return minEvidenceDay <= caseDay && maxEvidenceDay > caseDay;
}

function neededCoverageSides(item) {
  if (item?.type === 'sale_without_purchase') return ['purchase'];
  if (item?.type === 'purchase_without_sale') return ['sale'];
  if (['quantity_mismatch', 'unit_conversion_review'].includes(item?.type)) return ['sale', 'purchase'];
  return [];
}

function directionalHorizonMature(item, directionalCoverage = {}) {
  const caseDay = itemDay(item);
  if (!caseDay) return true;
  const bucket = directionalCoverage[directionKey(item)];
  if (!bucket) return false;
  const sides = neededCoverageSides(item);
  if (!sides.length) return true;
  return sides.every((side) => coverageSpansReviewDay(
    bucket[`${side}_min_day`],
    bucket[`${side}_max_day`],
    caseDay,
  ));
}

function needsMaturity(item) {
  return ['quantity_mismatch', 'sale_without_purchase', 'purchase_without_sale', 'unit_conversion_review'].includes(item?.type);
}

function suppressionReason(item, sourcePresence, context) {
  if (item?.type === 'matched') return 'resolved_by_evidence';
  if (CLOSED_STATUSES.has(item?.decision?.status)) return 'already_reviewed';
  if (!counterpartSourceLoaded(item, sourcePresence)) return 'counterpart_source_not_loaded';
  if (context?.directionalCoverage && needsMaturity(item) && !directionalHorizonMature(item, context.directionalCoverage)) return 'directional_evidence_horizon_open';
  if (context?.latestEvidenceDay && needsMaturity(item) && itemDay(item) === context.latestEvidenceDay) return 'evidence_horizon_open';
  return null;
}

export function latestTransferEvidenceDay(cases = []) {
  const timestamps = cases.flatMap(itemTimestamps);
  return timestamps.length ? dayKey(Math.max(...timestamps)) : null;
}

export function gateTransferReviewCases(cases = [], sourcePresence = {}, context = {}) {
  const effectiveContext = {
    ...context,
    latestEvidenceDay: Object.prototype.hasOwnProperty.call(context, 'latestEvidenceDay')
      ? context.latestEvidenceDay
      : latestTransferEvidenceDay(cases),
    directionalCoverage: context.directionalCoverage || buildDirectionalEvidenceCoverage(cases),
  };
  const reviewable = [];
  const matchedContext = [];
  const suppressed = [];
  cases.forEach((item) => {
    const reason = suppressionReason(item, sourcePresence, effectiveContext);
    if (item?.type === 'matched') {
      matchedContext.push(item);
      suppressed.push({ item, reason: 'resolved_by_evidence' });
      return;
    }
    if (reason) suppressed.push({ item, reason });
    else reviewable.push(item);
  });
  const counts = suppressed.reduce((acc, entry) => {
    acc[entry.reason] = (acc[entry.reason] || 0) + 1;
    return acc;
  }, {});
  return {
    // buildTransferIncidents needs matched rows as context to distinguish a whole missing invoice
    // from a partial missing invoice, but matched rows are never rendered as incidents.
    actionable: [...matchedContext, ...reviewable],
    reviewable,
    suppressed,
    latest_evidence_day: effectiveContext.latestEvidenceDay || null,
    directional_coverage: effectiveContext.directionalCoverage,
    summary: {
      actionable: reviewable.length,
      resolved_by_evidence: counts.resolved_by_evidence || 0,
      already_reviewed: counts.already_reviewed || 0,
      incomplete_source: counts.counterpart_source_not_loaded || 0,
      awaiting_later_evidence: (counts.evidence_horizon_open || 0) + (counts.directional_evidence_horizon_open || 0),
      awaiting_directional_coverage: counts.directional_evidence_horizon_open || 0,
      suppressed_total: suppressed.length,
    },
  };
}

export function isClosedTransferDecisionStatus(status) {
  return CLOSED_STATUSES.has(status);
}
