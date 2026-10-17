function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isStrongObservedProfile(profile) {
  if (!profile || profile.status !== 'usable') return false;
  if (!['high', 'confirmed'].includes(profile.confidence)) return false;
  return Number.isInteger(number(profile.strips_per_box));
}

export function packagingRuleDrift(item = {}) {
  const profile = item.packaging_profile;
  if (!profile || profile.source !== 'confirmed_rule') return null;
  const current = profile.observed_profile;
  if (!isStrongObservedProfile(current)) return null;
  const learnedCount = number(profile.strips_per_box);
  const currentCount = number(current.strips_per_box);
  if (!Number.isInteger(learnedCount) || !Number.isInteger(currentCount) || learnedCount === currentCount) return null;
  return {
    learned_strips_per_box: learnedCount,
    current_strips_per_box: currentCount,
    current_source: current.source || 'observed',
    current_evidence_count: Number(current.supporting_count || current.evidence_count || 0),
    current_profile: current,
    reason: `قاعدة العبوة المحفوظة تقول 1 علبة = ${learnedCount} شرائط، لكن الدليل الحالي القوي لنفس الكود يشير إلى ${currentCount} شرائط. لن يتم الإغلاق التلقائي قبل مراجعة تغير العبوة أو الكود.`,
  };
}

export function enforcePackagingProfileConsistency(cases = []) {
  return cases.map((item) => {
    const drift = packagingRuleDrift(item);
    if (!drift) return item;
    const current = drift.current_profile;
    return {
      ...item,
      original_type: item.original_type || item.type,
      type: 'unit_conversion_review',
      severity: Math.max(55, Number(item.severity || 0)),
      matched_by_packaging_profile: false,
      packaging_normalized_mismatch: false,
      packaging_profile_candidate: true,
      packaging_rule_drift: true,
      packaging_rule_drift_evidence: drift,
      packaging_profile: {
        ...current,
        status: 'usable',
        confidence: current.confidence || 'high',
        source: 'rule_drift_candidate',
        previous_confirmed_rule: item.packaging_profile,
        label: current.label || `1 علبة = ${drift.current_strips_per_box} شرائط`,
      },
      packaging_reason: drift.reason,
      next_action: `${drift.reason} إذا العبوة الجديدة صحيحة، اعتمد العلاقة الجديدة مرة واحدة لتحديث القاعدة.`,
    };
  });
}
