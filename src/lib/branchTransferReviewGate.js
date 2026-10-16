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

function suppressionReason(item, sourcePresence) {
  if (item?.type === 'matched') return 'resolved_by_evidence';
  if (CLOSED_STATUSES.has(item?.decision?.status)) return 'already_reviewed';
  if (!counterpartSourceLoaded(item, sourcePresence)) return 'counterpart_source_not_loaded';
  return null;
}

export function gateTransferReviewCases(cases = [], sourcePresence = {}) {
  const actionable = [];
  const suppressed = [];
  cases.forEach((item) => {
    const reason = suppressionReason(item, sourcePresence);
    if (reason) suppressed.push({ item, reason });
    else actionable.push(item);
  });
  const counts = suppressed.reduce((acc, entry) => {
    acc[entry.reason] = (acc[entry.reason] || 0) + 1;
    return acc;
  }, {});
  return {
    actionable,
    suppressed,
    summary: {
      actionable: actionable.length,
      resolved_by_evidence: counts.resolved_by_evidence || 0,
      already_reviewed: counts.already_reviewed || 0,
      incomplete_source: counts.counterpart_source_not_loaded || 0,
      suppressed_total: suppressed.length,
    },
  };
}

export function isClosedTransferDecisionStatus(status) {
  return CLOSED_STATUSES.has(status);
}
