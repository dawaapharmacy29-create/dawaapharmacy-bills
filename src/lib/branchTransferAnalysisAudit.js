import { buildDecisionEvidence } from './branchTransferDecisionEvidence.js';

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function expiries(lines = []) {
  return unique(lines.map((line) => line?.raw?.expiration_raw ?? line?.expiration_raw ?? line?.raw?.expiration ?? line?.raw?.expiry));
}

function hasExpiryConsolidation(item) {
  const saleLines = item?.sale_lines || [];
  const purchaseLines = item?.purchase_lines || [];
  return (saleLines.length > 1 && expiries(saleLines).length > 1)
    || (purchaseLines.length > 1 && expiries(purchaseLines).length > 1);
}

function hasCompositeJourney(item) {
  return Boolean(item?.episode_balanced)
    || Boolean(item?.residual_journey_completed)
    || unique(item?.sale_invoices || []).length > 1
    || unique(item?.purchase_invoices || []).length > 1;
}

function actorComplete(item) {
  const evidence = item?.decision_evidence || buildDecisionEvidence(item);
  return evidence?.actor?.status === 'complete';
}

export function auditTransferAnalysis(cases = []) {
  const result = {
    total_cases: cases.length,
    matched: 0,
    review: 0,
    false_positive_prevented: 0,
    expiry_consolidation_matched: 0,
    composite_journey_matched: 0,
    residual_journey_completed: 0,
    actor_complete: 0,
    actor_partial_or_missing: 0,
    identity_conflicts: 0,
    quantity_reviews_after_consolidation: 0,
    exact_code_matched: 0,
  };

  cases.forEach((item) => {
    const evidence = item?.decision_evidence || buildDecisionEvidence(item);
    const matched = item?.type === 'matched';
    if (matched) result.matched += 1;
    else result.review += 1;

    if (actorComplete(item)) result.actor_complete += 1;
    else result.actor_partial_or_missing += 1;

    if (evidence?.identity?.status === 'conflict') result.identity_conflicts += 1;
    if (evidence?.identity?.status === 'strong' && matched) result.exact_code_matched += 1;

    const expiryConsolidated = hasExpiryConsolidation(item);
    const composite = hasCompositeJourney(item);
    if (matched && expiryConsolidated) {
      result.expiry_consolidation_matched += 1;
      result.false_positive_prevented += 1;
    }
    if (matched && item?.residual_journey_completed) {
      result.residual_journey_completed += 1;
      if (!expiryConsolidated) result.false_positive_prevented += 1;
    }
    if (matched && composite) {
      result.composite_journey_matched += 1;
      if (!expiryConsolidated && !item?.residual_journey_completed) result.false_positive_prevented += 1;
    }
    if (!matched && item?.type === 'quantity_mismatch' && evidence?.quantity?.consolidated) {
      result.quantity_reviews_after_consolidation += 1;
    }
  });

  const denominator = Math.max(1, result.total_cases);
  return {
    ...result,
    actor_complete_percent: Number(((result.actor_complete / denominator) * 100).toFixed(1)),
    matched_percent: Number(((result.matched / denominator) * 100).toFixed(1)),
  };
}
