function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function unique(values = []) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function caseCodes(item = {}) {
  return unique([...(item.sale_codes || []), ...(item.purchase_codes || [])]);
}

function caseIdentity(item = {}) {
  const code = caseCodes(item)[0];
  if (code) return `code:${code}`;
  const name = text(item.product_name).toLowerCase();
  return name ? `name:${name}` : `case:${text(item.id)}`;
}

function incidentIdentity(incident = {}) {
  const first = incident.cases?.[0] || {};
  return `${caseIdentity(first)}::${text(incident.kind || first.type || 'review')}`;
}

function issueConfidence(item = {}) {
  const value = item.decision_intelligence?.issue_confidence?.score;
  if (Number.isFinite(Number(value))) return clamp(value);
  if (item.packaging_profile?.confidence === 'confirmed') return 98;
  if (item.packaging_profile?.confidence === 'high') return 90;
  if (item.packaging_profile?.confidence === 'medium') return 72;
  if (item.type === 'code_mismatch') return 92;
  return 65;
}

function journeyConfidence(item = {}) {
  const value = item.decision_intelligence?.journey_confidence?.score;
  return Number.isFinite(Number(value)) ? clamp(value) : 60;
}

function hasMixedUnits(item = {}) {
  return Boolean(item.sale_quantity?.mixed_units || item.purchase_quantity?.mixed_units);
}

function hasPackagingCandidate(item = {}) {
  return Boolean(item.packaging_profile_candidate || item.type === 'unit_conversion_review');
}

function decisionDifficulty(incident = {}, item = {}) {
  if (hasMixedUnits(item)) return 3;
  if (incident.kind === 'code_mismatch') return 3;
  if (hasPackagingCandidate(item) && ['high', 'confirmed'].includes(item.packaging_profile?.confidence)) return 1;
  if (['whole_sale_invoice_missing', 'whole_purchase_invoice_missing', 'partial_sale_invoice_missing', 'partial_purchase_invoice_missing', 'single_missing'].includes(incident.kind)) return 1;
  if (incident.kind === 'quantity_mismatch') return 2;
  if (incident.kind === 'unit_conversion') return 2;
  return 2;
}

function previousDecisionCount(identity, ledger = {}) {
  const events = Array.isArray(ledger.events) ? ledger.events : [];
  return events.filter((event) => {
    const eventIdentity = event.product_code
      ? `code:${text(event.product_code)}`
      : event.product_name ? `name:${text(event.product_name).toLowerCase()}` : '';
    return eventIdentity && identity.startsWith(eventIdentity);
  }).length;
}

function repeatMap(incidents = []) {
  const map = new Map();
  incidents.forEach((incident) => {
    const key = incidentIdentity(incident);
    map.set(key, (map.get(key) || 0) + 1);
  });
  return map;
}

function recommendation(incident = {}, item = {}, meta = {}) {
  if (hasMixedUnits(item)) return {
    label: 'تحقق من علاقة الوحدات',
    reason: 'الحركة تحتوي وحدات مختلفة؛ لا يوجد طرح رقمي آمن قبل توحيد العبوة.',
    action: 'human_review',
  };
  if (incident.kind === 'code_mismatch') return {
    label: 'احسم هوية الصنف',
    reason: 'الكود مختلف؛ تأكيد الهوية يمنع دمج صنفين مختلفين بالخطأ.',
    action: 'identity_review',
  };
  if (hasPackagingCandidate(item)) {
    const trusted = ['high', 'confirmed'].includes(item.packaging_profile?.confidence);
    return {
      label: trusted ? `اعتماد ${item.packaging_profile?.label || 'علاقة العبوة'}` : 'راجع علاقة العبوة',
      reason: trusted
        ? `الدليل قوي، واعتماد العلاقة قد يحسم ${meta.repeatCount || 1} حالة مشابهة.`
        : 'العلاقة مرشحة لكنها ليست قوية بما يكفي للاعتماد التلقائي.',
      action: trusted ? 'approve_packaging' : 'human_review',
    };
  }
  if (incident.side === 'sale') return {
    label: 'تحقق من الشراء المقابل',
    reason: 'البيع موجود والطرف المقابل غير ظاهر في الأدلة الحالية.',
    action: 'missing_counterpart',
  };
  if (incident.side === 'purchase') return {
    label: 'تحقق من البيع المقابل',
    reason: 'الشراء موجود والطرف المقابل غير ظاهر في الأدلة الحالية.',
    action: 'missing_counterpart',
  };
  if (incident.kind === 'quantity_mismatch') return {
    label: 'راجع الفرق الصافي',
    reason: 'الحركة موجودة من الطرفين لكن الكمية النهائية ما زالت غير متوازنة.',
    action: 'quantity_review',
  };
  return { label: 'راجع الحالة', reason: 'الحالة تحتاج قرارًا بشريًا.', action: 'human_review' };
}

export function buildDecisionTriage(incidents = [], ledger = {}) {
  const repeats = repeatMap(incidents);
  const enriched = incidents.map((incident) => {
    const item = incident.cases?.[0] || {};
    const identity = incidentIdentity(incident);
    const repeatCount = repeats.get(identity) || 1;
    const previousCount = previousDecisionCount(identity, ledger);
    const confidence = issueConfidence(item);
    const journey = journeyConfidence(item);
    const difficulty = decisionDifficulty(incident, item);
    const impact = Math.min(20, repeatCount * 3 + previousCount * 2);
    const speedBonus = difficulty === 1 ? 18 : difficulty === 2 ? 8 : 0;
    const riskPenalty = hasMixedUnits(item) ? 24 : incident.kind === 'code_mismatch' ? 10 : 0;
    const priority = clamp(confidence * 0.5 + journey * 0.15 + impact + speedBonus - riskPenalty);
    const quick = difficulty === 1 && confidence >= 78 && !hasMixedUnits(item);
    const needsHuman = difficulty === 3 || confidence < 60 || hasMixedUnits(item);
    const learning = hasPackagingCandidate(item) || repeatCount >= 3;
    const bucket = quick ? 'quick' : needsHuman ? 'human' : learning ? 'learning' : 'important';
    const meta = { repeatCount, previousCount };
    return {
      ...incident,
      triage: {
        identity,
        confidence: Math.round(confidence),
        journey_confidence: Math.round(journey),
        priority: Math.round(priority),
        difficulty,
        repeat_count: repeatCount,
        previous_decision_count: previousCount,
        impact_count: repeatCount,
        bucket,
        quick,
        needs_human: needsHuman,
        learning,
        recommendation: recommendation(incident, item, meta),
      },
    };
  });

  const summary = enriched.reduce((acc, incident) => {
    acc.total += 1;
    acc[incident.triage.bucket] += 1;
    if (incident.triage.repeat_count >= 2) acc.repeated += 1;
    if (incident.triage.confidence >= 85) acc.high_confidence += 1;
    return acc;
  }, { total: 0, quick: 0, important: 0, human: 0, learning: 0, repeated: 0, high_confidence: 0 });

  return { incidents: enriched, summary };
}

export function incidentMatchesTriage(incident, mode = 'all') {
  if (!mode || mode === 'all') return true;
  return incident?.triage?.bucket === mode;
}

export function compareDecisionTriage(a, b) {
  const priority = Number(b?.triage?.priority || 0) - Number(a?.triage?.priority || 0);
  if (priority) return priority;
  return Number(b?.triage?.confidence || 0) - Number(a?.triage?.confidence || 0);
}
