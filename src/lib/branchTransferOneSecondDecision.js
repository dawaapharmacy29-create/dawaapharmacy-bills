function firstCase(incident) {
  return incident?.cases?.[0] || {};
}

function branchLabel(value = '') {
  const text = String(value || '').toLowerCase();
  if (text.includes('شامي') || text.includes('shamy') || text.includes('shami')) return 'الشامي';
  if (text.includes('شكري') || text.includes('العزم') || text.includes('shokry') || text.includes('shoukry') || text.includes('shukry') || text.includes('abu al azm') || text.includes('abo el azm')) return 'شكري';
  return value || 'الفرع';
}

export function buildOneSecondDecision(incident) {
  const item = firstCase(incident);
  const plan = incident?.action_plan || {};
  const lane = incident?.operational_lane || plan?.lane || 'human';
  const from = branchLabel(incident?.from);
  const to = branchLabel(incident?.to);

  if (lane === 'waiting') {
    return {
      mode: 'wait',
      eyebrow: 'لا يحتاج قرار الآن',
      title: 'استنى اكتمال الدليل',
      reason: 'المصدر أو التغطية الحالية غير كافية للحكم بأمان.',
      primary_label: 'التالي',
      secondary_label: 'ليه؟',
      can_resolve: false,
      can_dismiss: false,
    };
  }

  if (item?.packaging_profile_candidate && item?.packaging_profile?.label) {
    return {
      mode: 'learn',
      eyebrow: 'علّم النظام مرة واحدة',
      title: `أكد ${item.packaging_profile.label}`,
      reason: 'الفرق الظاهر غالبًا ناتج عن طريقة تسجيل العبوة.',
      primary_label: `اعتماد ${item.packaging_profile.label}`,
      secondary_label: 'ليه؟',
      can_resolve: true,
      can_dismiss: true,
    };
  }

  if (item?.type === 'unit_conversion_review' || incident?.kind === 'unit_conversion') {
    return {
      mode: 'learn',
      eyebrow: 'علّم النظام مرة واحدة',
      title: 'أكد علاقة الوحدة',
      reason: 'لازم علاقة العبوة تتثبت قبل مقارنة الكميات.',
      primary_label: 'اعتماد التحويل',
      secondary_label: 'ليه؟',
      can_resolve: true,
      can_dismiss: true,
    };
  }

  if (item?.mixed_units_detected || item?.packaging_conflict || incident?.kind === 'code_mismatch') {
    return {
      mode: 'review',
      eyebrow: 'يحتاج عينك',
      title: incident?.kind === 'code_mismatch' ? 'احسم هوية الصنف' : 'راجع الوحدة قبل القرار',
      reason: incident?.kind === 'code_mismatch' ? 'الكود مختلف، لذلك الدمج التلقائي غير آمن.' : 'الوحدات أو العبوة غير متوافقة بما يكفي للحسم التلقائي.',
      primary_label: 'فتح الدليل',
      secondary_label: 'التالي',
      can_resolve: false,
      can_dismiss: true,
    };
  }

  if (incident?.side === 'sale') {
    return {
      mode: 'act',
      eyebrow: 'قرار سريع',
      title: `راجع شراء ${to}`,
      reason: `بيع ${from} موجود والطرف المقابل غير ظاهر في الدليل الحالي.`,
      primary_label: 'تمت المراجعة',
      secondary_label: 'ليه؟',
      can_resolve: true,
      can_dismiss: true,
    };
  }

  if (incident?.side === 'purchase') {
    return {
      mode: 'act',
      eyebrow: 'قرار سريع',
      title: `راجع بيع ${from}`,
      reason: `شراء ${to} موجود والطرف المقابل غير ظاهر في الدليل الحالي.`,
      primary_label: 'تمت المراجعة',
      secondary_label: 'ليه؟',
      can_resolve: true,
      can_dismiss: true,
    };
  }

  if (incident?.kind === 'quantity_mismatch') {
    return {
      mode: 'act',
      eyebrow: 'قرار سريع',
      title: 'راجع الفرق الصافي',
      reason: item?.remaining_qty_display?.precise ? `المتبقي ${item.remaining_qty_display.primary}.` : 'الفرق موجود لكن الوحدة تحتاج مراجعة قبل اعتماد رقم نهائي.',
      primary_label: 'تمت المراجعة',
      secondary_label: 'ليه؟',
      can_resolve: true,
      can_dismiss: true,
    };
  }

  return {
    mode: 'review',
    eyebrow: 'مراجعة',
    title: plan?.next_step || 'راجع الحالة',
    reason: plan?.why_now || 'فيه اختلاف يحتاج تأكيد بشري.',
    primary_label: 'فتح الدليل',
    secondary_label: 'التالي',
    can_resolve: false,
    can_dismiss: true,
  };
}

export function oneSecondDecisionTone(mode) {
  if (mode === 'act') return 'teal';
  if (mode === 'learn') return 'violet';
  if (mode === 'wait') return 'slate';
  return 'amber';
}
