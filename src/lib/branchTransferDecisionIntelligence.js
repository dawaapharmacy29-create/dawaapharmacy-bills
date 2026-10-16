import { buildDecisionEvidence } from './branchTransferDecisionEvidence.js';

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(Number(value) || 0)));

function confidenceLabel(score) {
  if (score >= 90) return 'عالية جدًا';
  if (score >= 75) return 'عالية';
  if (score >= 55) return 'متوسطة';
  if (score > 0) return 'منخفضة';
  return 'غير متاحة';
}

function qtyDifference(item) {
  const sale = Number(item?.sale_qty || 0);
  const purchase = Number(item?.purchase_qty || 0);
  const absolute = Math.abs(sale - purchase);
  const relative = absolute / Math.max(sale, purchase, 1);
  return { sale, purchase, absolute, relative };
}

function journeyConfidence(item) {
  if (!item?.sale_lines?.length || !item?.purchase_lines?.length) {
    return { score: 0, label: 'غير متاحة', reason: 'لا يوجد طرفان حتى نقيس هل الحركتان لنفس رحلة التحويل.' };
  }
  const score = clamp(item.confidence_score || 0);
  return {
    score,
    label: confidenceLabel(score),
    reason: item.match_reason || 'تم ربط البيع والشراء من مجموعة الأدلة المتاحة.',
  };
}

function issueConfidence(item, journey) {
  const type = item?.type;
  const diff = qtyDifference(item);

  if (type === 'matched') {
    return { score: 0, label: 'لا يوجد خطأ ظاهر', reason: 'البيع والشراء متوازنان بعد المطابقة الذكية.' };
  }

  if (type === 'unit_conversion_review') {
    const evidence = item.unit_conversion_evidence;
    const score = evidence?.confidence === 'high' ? 12 : 24;
    return {
      score,
      label: confidenceLabel(score),
      reason: evidence?.reason
        ? `فرق الكمية له تفسير عبوة/وحدة قوي: ${evidence.reason}. لذلك لا يُعامل كخطأ مؤكد.`
        : 'فرق الكمية يشبه تحويل وحدة، لذلك لا يُعامل كخطأ مؤكد قبل اعتماد معامل التحويل.',
    };
  }

  if (type === 'code_mismatch') {
    const diagnosisRisk = item.identity_diagnosis?.risk;
    const base = diagnosisRisk === 'high' ? 88 : 64;
    return {
      score: clamp(base + (journey.score >= 85 ? 6 : 0)),
      label: confidenceLabel(clamp(base + (journey.score >= 85 ? 6 : 0))),
      reason: item.identity_diagnosis?.diagnosis || 'هناك تعارض في هوية الصنف بين جانبي التحويل.',
    };
  }

  if (type === 'quantity_mismatch') {
    let score = 48;
    if (journey.score >= 90) score += 28;
    else if (journey.score >= 75) score += 18;
    else if (journey.score >= 55) score += 8;
    if (diff.relative >= 0.5) score += 12;
    else if (diff.relative >= 0.2) score += 8;
    else if (diff.relative >= 0.05) score += 4;
    score = clamp(score);
    return {
      score,
      label: confidenceLabel(score),
      reason: `بعد تجميع سطور نفس الصنف داخل الفاتورة، ما زالت الكمية غير متوازنة: بيع ${diff.sale} مقابل شراء ${diff.purchase}.`,
    };
  }

  if (type === 'sale_without_purchase') {
    return {
      score: 72,
      label: confidenceLabel(72),
      reason: 'يوجد بيع تحويل ولم يُعثر على شراء مقابل داخل نافذة المطابقة. هذا إنذار قوي لكنه قد يكون سببه ملف شراء ناقص أو تسجيل متأخر.',
    };
  }

  if (type === 'purchase_without_sale') {
    return {
      score: 76,
      label: confidenceLabel(76),
      reason: 'يوجد شراء تحويل ولم يُعثر على بيع مقابل داخل نافذة المطابقة. هذا يحتاج مراجعة المصدر قبل اعتباره خطأ موظف.',
    };
  }

  return { score: 40, label: confidenceLabel(40), reason: 'الأدلة غير كافية لتقدير قوة المشكلة.' };
}

function buildSignals(item, journey, issue, evidence) {
  const signals = [];
  if (item?.sale_lines?.length && item?.purchase_lines?.length) {
    signals.push({
      key: 'journey-link',
      kind: 'supports_match',
      strength: journey.score,
      label: 'قوة ربط الرحلة',
      detail: journey.reason,
    });
  }
  if (evidence?.quantity?.consolidated) {
    signals.push({
      key: 'invoice-consolidation',
      kind: 'context',
      strength: 98,
      label: 'تجميع سطور الفاتورة',
      detail: evidence.quantity.detail,
    });
  }
  if (evidence?.actor?.status === 'complete') {
    signals.push({
      key: 'actor-coverage',
      kind: 'context',
      strength: 94,
      label: 'البائع والمشتري معروفان',
      detail: evidence.actor.detail,
    });
  }
  if (item?.cross_midnight) signals.push({ key: 'cross-midnight', kind: 'context', strength: 90, label: 'عبور منتصف الليل', detail: 'اختلاف تاريخ اليوم لا يُعتبر اختلاف رحلة طالما باقي الأدلة متماسكة.' });
  if (item?.episode_balanced) signals.push({ key: 'episode-balance', kind: 'supports_match', strength: 96, label: 'دفعة متوازنة', detail: 'عدة فواتير قريبة تم تجميعها لأن إجمالي البيع والشراء متساوٍ.' });
  if (item?.unit_conversion_evidence) signals.push({ key: 'unit-conversion', kind: 'reduces_issue', strength: item.unit_conversion_evidence.confidence === 'high' ? 92 : 70, label: 'تفسير عبوة/وحدة', detail: item.unit_conversion_evidence.reason });
  if (item?.identity_diagnosis) signals.push({ key: 'identity-risk', kind: 'supports_issue', strength: item.identity_diagnosis.risk === 'high' ? 95 : 70, label: 'مخاطرة هوية الصنف', detail: item.identity_diagnosis.diagnosis });
  if (['quantity_mismatch', 'sale_without_purchase', 'purchase_without_sale', 'code_mismatch'].includes(item?.type)) signals.push({ key: 'issue-evidence', kind: 'supports_issue', strength: issue.score, label: 'قوة دليل المشكلة', detail: issue.reason });
  return signals.sort((a, b) => b.strength - a.strength);
}

function uncertainties(item, journey) {
  const list = [];
  if (!item?.sale_lines?.length) list.push('لا يوجد بيع مقابل في البيانات المحملة؛ تأكد أن ملفات البيع للفترة المطلوبة كاملة.');
  if (!item?.purchase_lines?.length) list.push('لا يوجد شراء مقابل في البيانات المحملة؛ تأكد أن ملفات الشراء للفترة المطلوبة كاملة.');
  if (item?.time_gap_minutes == null && item?.sale_lines?.length && item?.purchase_lines?.length) list.push('وقت إحدى الحركتين أو كلتيهما غير مكتمل؛ المطابقة تعتمد بدرجة أكبر على الكود والكمية.');
  if (journey.score > 0 && journey.score < 75) list.push('ربط البيع بالشراء متوسط/ضعيف؛ لا تعتمد فرق الكمية كخطأ موظف قبل مراجعة الفاتورتين.');
  if (item?.type === 'unit_conversion_review') list.push('لا يتم اعتماد معامل التحويل تلقائيًا؛ يلزم تأكيد بشري مرة واحدة قبل تعميمه على نفس الصنف والاتجاه.');
  if (item?.type === 'code_mismatch') list.push('اختلاف الكود قد يكون SKU مختلفًا فعلًا أو كودًا مكررًا؛ لا يتم دمج الأكواد تلقائيًا.');
  if (item?.sale_lines?.some((line) => line?.raw?.invoice_header_conflict || line?.invoice_header_conflict)) list.push('وجد النظام أكثر من رأس فاتورة بيع متعارض لنفس الرقم؛ لم يختر اسم دكتور تلقائيًا حتى لا ينسب الحركة للشخص الخطأ.');
  return list;
}

function decisionMode(item, issue) {
  if (item?.type === 'matched') return 'silent';
  if (item?.type === 'unit_conversion_review') return 'review_conversion';
  if (item?.severity >= 90 && issue.score >= 70) return 'urgent_review';
  return 'investigate';
}

function recommendedCheck(item, evidence) {
  if (item?.type === 'sale_without_purchase') return 'ابدأ بفاتورة الشراء في الفرع المستلم، ثم تحقق هل الصنف وصل فعليًا أم لا.';
  if (item?.type === 'purchase_without_sale') return 'ابدأ بفاتورة البيع في الفرع المصدر قبل مساءلة موظف الشراء.';
  if (item?.type === 'quantity_mismatch') return evidence?.quantity?.consolidated
    ? 'النظام جمع سطور نفس الصنف داخل الفاتورة بالفعل وما زال الفرق موجودًا؛ راجع الوحدة ثم الحركات اللاحقة.'
    : 'افتح فاتورتي البيع والشراء جنبًا إلى جنب، ثم راجع الوحدة/العبوة قبل اعتبار الفرق عجزًا.';
  if (item?.type === 'unit_conversion_review') return 'أكد علاقة الوحدة مرة واحدة فقط إذا كانت صحيحة، وبعدها يسمح للنظام بتطبيقها على نفس الصنف والاتجاه.';
  if (item?.type === 'code_mismatch') return 'راجع العبوة والتركيز والشكل الدوائي أولًا؛ لو كلها متطابقة فالمشكلة غالبًا Master Data وليست حركة مخزون.';
  return 'لا يوجد إجراء مطلوب.';
}

export function explainTransferCase(item = {}) {
  const evidence = buildDecisionEvidence(item);
  const journey = journeyConfidence(item);
  const issue = issueConfidence(item, journey);
  const mode = decisionMode(item, issue);
  return {
    version: 'decision-intelligence-v2',
    evidence,
    decision_score: evidence.decision_score,
    journey_confidence: journey,
    issue_confidence: issue,
    mode,
    human_decision_required: !['silent'].includes(mode),
    signals: buildSignals(item, journey, issue, evidence),
    uncertainties: uncertainties(item, journey),
    recommended_check: recommendedCheck(item, evidence),
    summary: mode === 'silent'
      ? evidence.explanation
      : mode === 'review_conversion'
        ? 'النظام واثق من ربط الرحلة، لكنه غير واثق أن فرق الكمية خطأ؛ الاحتمال الأقوى تحويل عبوة/وحدة.'
        : issue.score >= 80
          ? 'الأدلة تشير بقوة إلى مشكلة حقيقية، مع إبقاء سبب القرار ظاهرًا وقابلًا للمراجعة.'
          : 'توجد علامة تستحق التحقيق، لكن الأدلة لا تكفي لاعتبارها خطأ مؤكدًا.',
  };
}

export function enrichTransferDecisionIntelligence(item = {}) {
  return { ...item, decision_intelligence: explainTransferCase(item) };
}

export function summarizeDecisionIntelligence(cases = []) {
  return cases.reduce((acc, item) => {
    const intel = item.decision_intelligence || explainTransferCase(item);
    acc[intel.mode] = (acc[intel.mode] || 0) + 1;
    if (intel.issue_confidence.score >= 75) acc.high_issue_confidence += 1;
    if (intel.journey_confidence.score >= 90) acc.high_journey_confidence += 1;
    return acc;
  }, { silent: 0, review_conversion: 0, investigate: 0, urgent_review: 0, high_issue_confidence: 0, high_journey_confidence: 0 });
}
