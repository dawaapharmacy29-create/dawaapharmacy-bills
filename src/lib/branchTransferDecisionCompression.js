function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function sideAvailable(item = {}, side) {
  const qty = Number(item?.[`${side}_qty`] || 0);
  const lines = item?.[`${side}_lines`] || [];
  return qty !== 0 || lines.length > 0;
}

function mixedUnits(item = {}) {
  return Boolean(item?.mixed_units_detected || item?.sale_quantity?.mixed_units || item?.purchase_quantity?.mixed_units);
}

function packagingTrusted(item = {}) {
  return ['high', 'confirmed'].includes(item?.packaging_profile?.confidence);
}

function confidenceLabel(score = 0) {
  const value = Number(score) || 0;
  if (value >= 90) return 'شديدة';
  if (value >= 80) return 'عالية';
  if (value >= 65) return 'متوسطة';
  return 'محدودة';
}

export function buildDecisionCompression(incident = {}, item = {}) {
  const sale = sideAvailable(item, 'sale');
  const purchase = sideAvailable(item, 'purchase');
  const triage = incident?.triage || {};
  const confidence = Number(triage.confidence || 0);
  const repeatCount = Number(triage.repeat_count || 1);
  const previousCount = Number(triage.previous_decision_count || 0);
  const historicalConsistent = Boolean(triage.previous_consistent);
  const risk = mixedUnits(item)
    ? 'وحدات مختلفة'
    : incident.kind === 'code_mismatch'
      ? 'هوية الصنف غير محسومة'
      : item?.packaging_profile_candidate && !packagingTrusted(item)
        ? 'علاقة العبوة غير مؤكدة'
        : !sale || !purchase
          ? 'طرف مقابل غير موجود'
          : item?.remaining_qty_display?.precise === false
            ? 'الفرق غير قابل للحساب بأمان'
            : 'لا توجد مخاطرة حسابية إضافية';

  let fact = 'الحركة تحتاج مراجعة';
  if (sale && purchase) fact = 'الحركة موجودة من الطرفين';
  else if (sale) fact = 'البيع موجود والشراء المقابل غير ظاهر';
  else if (purchase) fact = 'الشراء موجود والبيع المقابل غير ظاهر';

  const evidence = [];
  if (packagingTrusted(item) && item?.packaging_profile?.label) evidence.push(`عبوة موثوقة: ${item.packaging_profile.label}`);
  if (historicalConsistent && previousCount) evidence.push(`قرار تاريخي متسق في ${previousCount} مراجعة`);
  if (repeatCount > 1) evidence.push(`النمط ظاهر في ${repeatCount} حالات`);
  if (item?.residual_progress_status === 'partial') evidence.push('تم العثور على استكمال جزئي لاحق');
  if (item?.remaining_qty_display?.precise && item?.remaining_qty_display?.primary) evidence.push(`الفرق الصافي ${item.remaining_qty_display.primary}`);

  const impactCount = Math.max(1, Number(triage.impact_count || repeatCount || 1));
  const impact = impactCount > 1
    ? `القرار قد يساعد في ${impactCount} حالات من نفس النمط`
    : 'أثر القرار محصور في الحالة الحالية';

  return {
    fact,
    risk,
    evidence,
    impact,
    impact_count: impactCount,
    confidence,
    confidence_label: confidenceLabel(confidence),
    historically_consistent: historicalConsistent,
    has_both_sides: sale && purchase,
    can_fast_decide: Boolean(triage.quick && !mixedUnits(item)),
    one_line: clean(`${fact} · ${risk}${evidence[0] ? ` · ${evidence[0]}` : ''}`),
  };
}

export function sameDecisionPattern(a = {}, b = {}) {
  const aIdentity = clean(a?.triage?.identity);
  const bIdentity = clean(b?.triage?.identity);
  return Boolean(aIdentity && bIdentity && aIdentity === bIdentity);
}

export function decisionPatternPeers(incidents = [], selected = null) {
  if (!selected?.triage?.identity) return [];
  return incidents.filter((incident) => incident.id !== selected.id && sameDecisionPattern(incident, selected));
}
