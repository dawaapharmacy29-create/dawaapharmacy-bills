import { buildOneSecondDecision } from './branchTransferOneSecondDecision.js';

function weight(incident) {
  const decision = buildOneSecondDecision(incident);
  const confidence = Number(incident?.triage?.confidence || 0);
  const priority = Number(incident?.triage?.priority || 0);
  const impact = Math.max(1, Number(incident?.triage?.same_pattern_count || incident?.triage?.pattern_count || 1));
  const lane = incident?.operational_lane || incident?.action_plan?.lane || 'human';
  const laneWeight = lane === 'quick' ? 500 : lane === 'learning' ? 350 : lane === 'human' ? 220 : 20;
  const safetyPenalty = decision?.can_resolve === false && lane !== 'waiting' ? 80 : 0;
  return laneWeight + priority * 2 + confidence + Math.min(impact, 20) * 4 - safetyPenalty;
}

function actionKey(incident) {
  const decision = buildOneSecondDecision(incident);
  const item = incident?.cases?.[0] || {};
  const product = String(item?.product_name || incident?.product_names?.[0] || '').trim().toLowerCase();
  return `${decision?.mode || 'review'}::${decision?.title || ''}::${product}`;
}

export function buildNextBestActionQueue(incidents = []) {
  const seen = new Set();
  const items = [];

  [...(incidents || [])]
    .sort((a, b) => weight(b) - weight(a))
    .forEach((incident) => {
      const key = actionKey(incident);
      if (seen.has(key)) return;
      seen.add(key);
      const decision = buildOneSecondDecision(incident);
      const item = incident?.cases?.[0] || {};
      items.push({
        incident,
        decision,
        product_name: item?.product_name || incident?.product_names?.[0] || 'صنف',
        score: weight(incident),
        mode: decision?.mode || 'review',
        can_resolve: Boolean(decision?.can_resolve),
      });
    });

  const summary = items.reduce((acc, item) => {
    acc.total += 1;
    if (item.mode === 'wait') acc.wait += 1;
    else if (item.mode === 'learn') acc.learn += 1;
    else if (item.can_resolve) acc.fast += 1;
    else acc.review += 1;
    return acc;
  }, { total: 0, fast: 0, learn: 0, review: 0, wait: 0 });

  return { items, summary };
}

export function nextBestAction(queue) {
  return queue?.items?.[0] || null;
}
