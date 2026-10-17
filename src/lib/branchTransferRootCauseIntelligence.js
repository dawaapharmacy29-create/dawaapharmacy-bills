function firstCase(incident) {
  return incident?.cases?.[0] || {};
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function unique(values = []) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function branchKey(incident) {
  const raw = clean(incident?.review_queue || incident?.branch_queue || incident?.to || incident?.from).toLowerCase();
  if (/شامي|shamy/.test(raw)) return 'shamy';
  if (/شكري|العزم|shokry/.test(raw)) return 'shokry';
  return 'shared';
}

function incidentDay(incident) {
  const values = (incident?.cases || []).flatMap((item) => [
    ...(item.sale_lines || []).map((line) => Number(line.timestamp_ms || line.timestamp || 0)),
    ...(item.purchase_lines || []).map((line) => Number(line.timestamp_ms || line.timestamp || 0)),
  ]).filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return '';
  const date = new Date(Math.max(...values));
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function rootCauseType(incident) {
  const item = firstCase(incident);
  if (item?.mixed_units_detected || item?.unsafe_unit_conversion_blocked) return 'mixed_units';
  if (item?.packaging_conflict || item?.packaging_profile?.status === 'conflict') return 'packaging_conflict';
  if (item?.packaging_profile_candidate || item?.type === 'unit_conversion_review' || incident?.kind === 'unit_conversion') return 'packaging_learning';
  if (incident?.kind === 'code_mismatch' || item?.type === 'code_mismatch' || item?.product_identity_conflict) return 'identity_conflict';
  if (incident?.operational_lane === 'waiting') return 'evidence_gap';
  if (incident?.kind === 'quantity_mismatch') return 'quantity_mismatch';
  if (incident?.side === 'sale' || /sale_missing/.test(incident?.kind || '')) return 'purchase_missing';
  if (incident?.side === 'purchase' || /purchase_missing/.test(incident?.kind || '')) return 'sale_missing';
  if (/missing/.test(incident?.kind || '')) return 'counterpart_missing';
  return 'other';
}

const META = {
  mixed_units: {
    title: 'تسجيل وحدات غير موحد',
    severity: 100,
    explanation: 'نفس الحركة تظهر بوحدات مختلفة لا يمكن جمعها أو طرحها بأمان.',
    action: 'وحّد قاعدة تسجيل الوحدة أو اعتمد تحويلًا موثوقًا للصنف قبل إغلاق الحالات.',
    stop: 'لا تحوّل أو تجمع أي كمية لو علاقة العبوة غير مؤكدة.',
  },
  packaging_conflict: {
    title: 'تعارض في علاقة العبوة',
    severity: 98,
    explanation: 'الدليل الحالي على عدد الشرائط/العلبة متعارض مع قاعدة أو تاريخ آخر.',
    action: 'راجع العبوة الفعلية والكود ثم حدّث القاعدة بعد تأكيد بشري واحد موثق.',
    stop: 'ممنوع تعميم قاعدة قديمة على عبوة جديدة أو كود مختلف.',
  },
  packaging_learning: {
    title: 'نمط عبوة يحتاج تعليم النظام',
    severity: 78,
    explanation: 'الحالات تبدو ناتجة عن اختلاف شريط/علبة ويمكن تحويلها لمعرفة قابلة لإعادة الاستخدام.',
    action: 'اعتمد علاقة العبوة عندما يكون الدليل متكررًا ومتسقًا ثم أعد تقييم الحالات المشابهة.',
    stop: 'لا تعتمد من مشاهدة واحدة أو من اسم يحتوي عدد أقراص فقط.',
  },
  identity_conflict: {
    title: 'اختلاف هوية أو كود الصنف',
    severity: 96,
    explanation: 'الاسم قريب لكن الكود أو هوية العبوة لا تسمح بالدمج التلقائي.',
    action: 'احسم هل الأكواد لنفس SKU أم لعبوتين مختلفتين قبل أي مطابقة.',
    stop: 'لا تدمج لمجرد تشابه الاسم.',
  },
  evidence_gap: {
    title: 'الدليل أو التغطية غير مكتملة',
    severity: 35,
    explanation: 'الحالة ظهرت قبل اكتمال الطرف المقابل أو ضمن ثقة غير كافية للحسم.',
    action: 'استكمل المصدر أو انتظر أفق الدليل بدل استهلاك وقت قرار بشري الآن.',
    stop: 'لا تعتبر الغياب خطأ تشغيليًا قبل اكتمال التغطية.',
  },
  quantity_mismatch: {
    title: 'فرق كمية صافي متكرر',
    severity: 82,
    explanation: 'الطرفان موجودان لكن الصافي بعد التجميع/المرتجعات غير متوازن.',
    action: 'راجع تسلسل الفواتير والمرتجعات ثم ابحث عن نمط تسجيل أو حركة ناقصة مشتركة.',
    stop: 'لا تستخدم الفرق الخام إذا كانت الوحدات غير موحدة.',
  },
  purchase_missing: {
    title: 'بيع بلا شراء مقابل',
    severity: 72,
    explanation: 'حركة البيع موجودة بينما الشراء المقابل غير ظاهر ضمن التغطية الحالية.',
    action: 'راجع مصدر الشراء والوقت والفرع؛ لو النمط متكرر افحص تأخير أو فقد تسجيل الشراء.',
    stop: 'لا تصنفها كخطأ موظف إذا ملف الشراء أو اليوم غير مكتمل.',
  },
  sale_missing: {
    title: 'شراء بلا بيع مقابل',
    severity: 72,
    explanation: 'حركة الشراء موجودة بينما البيع المقابل غير ظاهر ضمن التغطية الحالية.',
    action: 'راجع مصدر البيع والوقت والفرع؛ لو النمط متكرر افحص تأخير أو فقد تسجيل البيع.',
    stop: 'لا تصنفها كخطأ موظف إذا ملف البيع أو اليوم غير مكتمل.',
  },
  counterpart_missing: {
    title: 'طرف مقابل ناقص',
    severity: 68,
    explanation: 'أحد طرفي رحلة التحويل غير موجود بوضوح.',
    action: 'حدد أي مصدر ناقص أولًا ثم راجع الحالات كمجموعة بدل كل حالة منفصلة.',
    stop: 'افصل نقص المصدر عن نقص الحركة الفعلي.',
  },
  other: {
    title: 'نمط يحتاج تفسير',
    severity: 55,
    explanation: 'الحالات لا تقع في سبب جذري مؤكد حتى الآن.',
    action: 'راجع أمثلة قليلة ممثلة قبل إنشاء قاعدة أو قرار عام.',
    stop: 'لا تعمم قرارًا من عينة صغيرة غير متجانسة.',
  },
};

function clusterKey(incident) {
  const type = rootCauseType(incident);
  const branch = branchKey(incident);
  return `${type}::${branch}`;
}

function incidentProducts(incident) {
  return unique([
    ...(incident?.product_names || []),
    ...(incident?.cases || []).map((item) => item?.product_name),
  ]);
}

function incidentCodes(incident) {
  return unique([
    ...(incident?.product_codes || []),
    ...(incident?.cases || []).flatMap((item) => [
      ...(item?.sale_codes || []),
      ...(item?.purchase_codes || []),
    ]),
  ]);
}

export function buildRootCauseIntelligence(incidents = []) {
  const groups = new Map();

  (incidents || []).forEach((incident) => {
    const key = clusterKey(incident);
    const type = rootCauseType(incident);
    const meta = META[type] || META.other;
    const branch = branchKey(incident);
    const confidence = Number(incident?.triage?.confidence || 0);
    const day = incidentDay(incident);
    const current = groups.get(key) || {
      key,
      type,
      branch,
      title: meta.title,
      severity: meta.severity,
      explanation: meta.explanation,
      recommended_action: meta.action,
      stop_condition: meta.stop,
      incidents: [],
      incident_ids: [],
      products: [],
      codes: [],
      days: [],
      confidence_values: [],
      lanes: [],
    };

    current.incidents.push(incident);
    current.incident_ids.push(incident?.id);
    current.products.push(...incidentProducts(incident));
    current.codes.push(...incidentCodes(incident));
    if (day) current.days.push(day);
    if (Number.isFinite(confidence)) current.confidence_values.push(confidence);
    if (incident?.operational_lane) current.lanes.push(incident.operational_lane);
    groups.set(key, current);
  });

  const clusters = [...groups.values()].map((cluster) => {
    const products = unique(cluster.products);
    const codes = unique(cluster.codes);
    const days = unique(cluster.days).sort();
    const avgConfidence = cluster.confidence_values.length
      ? Math.round(cluster.confidence_values.reduce((sum, value) => sum + value, 0) / cluster.confidence_values.length)
      : 0;
    const count = cluster.incidents.length;
    const systematic = count >= 3 && (products.length >= 2 || days.length >= 2);
    const attentionScore = Math.round(cluster.severity * Math.log2(count + 1) + (systematic ? 30 : 0) + avgConfidence * 0.2);
    const dominantLane = unique(cluster.lanes).length === 1 ? cluster.lanes[0] : 'mixed';

    return {
      ...cluster,
      products,
      codes,
      days,
      count,
      avg_confidence: avgConfidence,
      systematic,
      attention_score: attentionScore,
      dominant_lane: dominantLane,
      scope_label: `${count} حالة · ${products.length} صنف · ${days.length || 1} يوم`,
      insight: systematic
        ? `النمط متكرر عبر ${products.length} صنف و${days.length || 1} يوم؛ الأفضل معالجة السبب قبل الاستمرار حالة بحالة.`
        : count > 1
          ? `النمط ظهر ${count} مرات؛ راجع عينتين ممثلتين قبل تعميم السبب.`
          : 'حالة منفردة؛ تعامل معها كدليل لا كقاعدة عامة.',
    };
  }).sort((a, b) => b.attention_score - a.attention_score || b.count - a.count);

  const summary = clusters.reduce((acc, cluster) => {
    acc.total_clusters += 1;
    acc.total_incidents += cluster.count;
    if (cluster.systematic) acc.systematic += 1;
    if (cluster.type === 'evidence_gap') acc.waiting += cluster.count;
    if (cluster.severity >= 90) acc.high_risk += cluster.count;
    return acc;
  }, { total_clusters: 0, total_incidents: 0, systematic: 0, waiting: 0, high_risk: 0 });

  return { clusters, summary };
}

export function rootCauseClusterForIncident(rootCause, incident) {
  if (!rootCause || !incident) return null;
  const key = clusterKey(incident);
  return rootCause.clusters?.find((cluster) => cluster.key === key) || null;
}

export function incidentsForRootCause(cluster) {
  return cluster?.incidents || [];
}
