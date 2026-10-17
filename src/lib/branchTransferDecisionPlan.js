function firstCase(incident) {
  return incident?.cases?.[0] || {};
}

function hasUnsafeUnits(item) {
  return Boolean(item?.mixed_units_detected || item?.unsafe_unit_conversion_blocked);
}

function hasPackagingConflict(item) {
  return Boolean(item?.packaging_conflict || item?.packaging_profile?.status === 'conflict');
}

function hasIdentityConflict(incident, item) {
  return incident?.kind === 'code_mismatch' || item?.type === 'code_mismatch' || Boolean(item?.product_identity_conflict);
}

function isLearningCase(incident, item) {
  return Boolean(
    item?.packaging_profile_candidate ||
    item?.type === 'unit_conversion_review' ||
    incident?.kind === 'unit_conversion'
  );
}

function confidenceOf(incident) {
  const value = Number(incident?.triage?.confidence || 0);
  return Number.isFinite(value) ? value : 0;
}

export function decisionLaneForIncident(incident) {
  const item = firstCase(incident);
  if (hasUnsafeUnits(item) || hasPackagingConflict(item) || hasIdentityConflict(incident, item)) return 'human';
  if (isLearningCase(incident, item)) return 'learning';
  if (incident?.triage?.quick && confidenceOf(incident) >= 90) return 'quick';
  if (confidenceOf(incident) < 65) return 'waiting';
  return 'human';
}

export function decisionLaneLabel(lane) {
  if (lane === 'quick') return 'حسم سريع';
  if (lane === 'learning') return 'تعليم النظام';
  if (lane === 'waiting') return 'دليل ناقص';
  return 'تحقيق يدوي';
}

export function buildCaseActionPlan(incident, item = firstCase(incident)) {
  const lane = decisionLaneForIncident(incident);
  const repeat = Math.max(1, Number(incident?.triage?.repeat_count || incident?.triage?.impact_count || 1));
  const confidence = confidenceOf(incident);

  if (lane === 'quick') {
    return {
      lane,
      label: decisionLaneLabel(lane),
      next_step: 'راجع الدليل المختصر ثم احسم الحالة الحالية فقط.',
      why_now: `الثقة ${confidence}% ولا يوجد مانع سلامة ظاهر.`,
      stop_condition: 'توقف فورًا لو ظهر اختلاف كود أو وحدة أو دليل جديد يناقض التوصية.',
      expected_effect: repeat > 1 ? `القرار قد يقلل مراجعة ${repeat} حالات من نفس النمط لاحقًا.` : 'القرار يغلق هذه الحالة بدون توسيع نطاقه.',
      can_batch_execute: false,
    };
  }

  if (lane === 'learning') {
    return {
      lane,
      label: decisionLaneLabel(lane),
      next_step: 'أكد علاقة العبوة أو التحويل الفيزيائي قبل اعتماد أي كمية.',
      why_now: 'الحالة تحمل معرفة قابلة لإعادة الاستخدام لكن لا يجوز تحويلها إلى حقيقة بدون اعتماد.',
      stop_condition: 'توقف لو الدليل متعارض أو اسم الصنف يوحي بعبوة مختلفة أو الوحدة غير صريحة.',
      expected_effect: repeat > 1 ? `اعتماد القاعدة قد يفسر حتى ${repeat} حالات مشابهة، مع بقاء أي تعارض للمراجعة.` : 'اعتماد القاعدة سيُستخدم فقط كمعرفة موثقة للحركات القادمة.',
      can_batch_execute: false,
    };
  }

  if (lane === 'waiting') {
    return {
      lane,
      label: decisionLaneLabel(lane),
      next_step: 'لا تحسم الآن؛ استكمل الطرف أو التغطية الزمنية الناقصة أولًا.',
      why_now: `الثقة الحالية ${confidence}% أقل من حد الحسم الآمن.`,
      stop_condition: 'ممنوع اعتبار الغياب خطأ طالما مصدر الطرف المقابل أو تغطيته غير مكتملة.',
      expected_effect: 'إضافة الدليل قد تغلق الحالة تلقائيًا بدون قرار بشري.',
      can_batch_execute: false,
    };
  }

  const risk = hasUnsafeUnits(item)
    ? 'الوحدات غير موحدة.'
    : hasPackagingConflict(item)
      ? 'دليل العبوة متعارض.'
      : hasIdentityConflict(incident, item)
        ? 'هوية الصنف أو الكود متعارضة.'
        : 'الحالة تحتاج تفسيرًا بشريًا قبل الإغلاق.';

  return {
    lane,
    label: decisionLaneLabel(lane),
    next_step: 'افتح الدليل الكامل واحسم سبب الاختلاف قبل تغيير حالة المراجعة.',
    why_now: risk,
    stop_condition: 'لا تعتمد قرارًا عامًا من حالة واحدة ولا تنقل قرارًا تاريخيًا إذا اختلف الدليل الحالي.',
    expected_effect: 'الهدف هنا منع إغلاق خاطئ؛ لا يوجد تنفيذ جماعي آمن لهذه الحالة.',
    can_batch_execute: false,
  };
}

export function buildDecisionPlan(incidents = []) {
  const planned = (incidents || []).map((incident) => {
    const item = firstCase(incident);
    const action_plan = buildCaseActionPlan(incident, item);
    return { ...incident, operational_lane: action_plan.lane, action_plan };
  });

  const summary = planned.reduce((acc, incident) => {
    acc.total += 1;
    acc[incident.operational_lane] += 1;
    return acc;
  }, { total: 0, quick: 0, learning: 0, human: 0, waiting: 0 });

  return { incidents: planned, summary };
}

export function incidentMatchesDecisionLane(incident, lane) {
  return lane === 'all' || incident?.operational_lane === lane || decisionLaneForIncident(incident) === lane;
}
