function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalized(value) {
  return text(value)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ـ/g, '');
}

function caseNames(item = {}) {
  return [
    item.product_name,
    item.sale_product_name,
    item.purchase_product_name,
    ...(item.sale_lines || []).map((line) => line?.product_name),
    ...(item.purchase_lines || []).map((line) => line?.product_name),
  ].map(normalized).filter(Boolean);
}

function hasExplicitPackagingCount(name) {
  return /(\d{1,2})\s*(?:strip|strips|شريط|شرائط|box|boxes|علبه|علب)\b/i.test(name)
    || /(?:strip|strips|شريط|شرائط|box|boxes|علبه|علب)\s*(\d{1,2})\b/i.test(name);
}

function hasDosageFormCount(name) {
  return /(\d{1,4})\s*(?:tab(?:let)?s?|cap(?:sule)?s?|قرص|اقراص|كبسول(?:ه|ات)?)/i.test(name);
}

export function unsafeDosageCountConversion(item = {}) {
  const evidence = item.unit_conversion_evidence;
  if (evidence?.kind !== 'pack_count') return null;
  const names = caseNames(item);
  if (!names.length) return null;
  const dosageCountEvidence = names.some(hasDosageFormCount);
  const explicitPackagingEvidence = names.some(hasExplicitPackagingCount);
  if (!dosageCountEvidence || explicitPackagingEvidence) return null;
  return {
    blocked_kind: evidence.kind,
    blocked_pack_count: evidence.pack_count ?? null,
    reason: 'عدد الأقراص/الكبسولات في اسم الصنف يصف محتوى العبوة، وليس عدد الشرائط. لا يُستخدم وحده كمعامل تحويل كمية.',
  };
}

export function enforceUnitEvidenceSafety(cases = []) {
  return cases.map((item) => {
    const blocked = unsafeDosageCountConversion(item);
    if (!blocked) return item;
    return {
      ...item,
      original_type: item.original_type || item.type,
      type: item.type === 'unit_conversion_review' ? 'quantity_mismatch' : item.type,
      severity: item.type === 'unit_conversion_review' ? Math.max(85, Number(item.severity || 0)) : item.severity,
      unit_conversion_evidence: null,
      unsafe_unit_conversion_blocked: true,
      unsafe_unit_conversion_evidence: blocked,
      next_action: item.type === 'unit_conversion_review'
        ? `${blocked.reason} تعامل مع الفرق كفرق كمية إلى أن توجد وحدة صريحة أو Packaging Profile موثوق.`
        : item.next_action,
    };
  });
}
