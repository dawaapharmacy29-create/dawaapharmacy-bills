const DIACRITICS = /[\u064B-\u065F\u0670]/g;
const EPSILON = 0.035;

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return text(value)
    .toLowerCase()
    .replace(DIACRITICS, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ـ/g, '')
    .replace(/[()\[\]{}.,،:;\/\\_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function nearlyEqual(a, b, absolute = 0.025, relative = EPSILON) {
  const left = Number(a || 0);
  const right = Number(b || 0);
  const tolerance = Math.max(absolute, Math.abs(right) * relative);
  return Math.abs(left - right) <= tolerance;
}

export function transferUnitFamily(value) {
  const unit = normalize(value);
  if (!unit) return null;
  if (/علب|علبه|box|pack/.test(unit)) return 'box';
  if (/شريط|شرائط|strip/.test(unit)) return 'strip';
  if (/زجاج|bottle/.test(unit)) return 'bottle';
  if (/انبوب|تيوب|tube/.test(unit)) return 'tube';
  if (/امبول|ampoule|amp\b/.test(unit)) return 'ampoule';
  if (/حقن|سرنج|syringe/.test(unit)) return 'syringe';
  if (/فيال|vial/.test(unit)) return 'vial';
  if (/كيس|sachet/.test(unit)) return 'sachet';
  if (/بخاخ|spray/.test(unit)) return 'spray';
  if (/لزق|patch/.test(unit)) return 'patch';
  if (/one unit|وحده|unit|piece|pcs?/.test(unit)) return 'unit';
  return 'other';
}

export function humanTransferUnit(value) {
  const family = transferUnitFamily(value);
  if (family === 'box') return 'علبة';
  if (family === 'strip') return 'شريط';
  if (family === 'bottle') return 'زجاجة';
  if (family === 'tube') return 'أنبوبة';
  if (family === 'ampoule') return 'أمبول';
  if (family === 'syringe') return 'حقنة';
  if (family === 'vial') return 'فيال';
  if (family === 'sachet') return 'كيس';
  if (family === 'spray') return 'بخاخ';
  if (family === 'patch') return 'لزقة';
  if (family === 'unit') return 'وحدة';
  return text(value) || 'وحدة';
}

function exactCode(item) {
  const codes = [...new Set([...(item?.sale_codes || []), ...(item?.purchase_codes || [])].map(text).filter(Boolean))];
  return codes.length === 1 ? codes[0] : null;
}

export function packagingRuleKey(value) {
  if (typeof value === 'string' || typeof value === 'number') return text(value);
  return exactCode(value) || '';
}

function uniqueFamilies(lines = []) {
  return [...new Set(lines.map((line) => transferUnitFamily(line?.unit)).filter(Boolean))];
}

function saleFamily(item) {
  const families = uniqueFamilies(item?.sale_lines || []);
  return families.length === 1 ? families[0] : null;
}

function purchaseUsesBconnectBoxEquivalent(item) {
  const lines = item?.purchase_lines || [];
  if (!lines.length) return false;
  const explicitFamilies = uniqueFamilies(lines);
  if (explicitFamilies.length) return explicitFamilies.length === 1 && explicitFamilies[0] === 'box';
  return lines.every((line) => text(line?.raw?.source_format || line?.source_format) === 'bconnect_purchase_report');
}

function integerRatio(value) {
  // A raw 1:1 number is ambiguous when the purchase export has no unit. Never
  // teach the system that one strip equals one box from that pattern alone.
  if (!Number.isFinite(value) || value < 2 || value > 12) return null;
  const nearest = Math.round(value);
  const tolerance = Math.max(0.08, nearest * 0.045);
  return Math.abs(value - nearest) <= tolerance ? nearest : null;
}

function evidenceForCase(item) {
  if (!item || !exactCode(item) || item.sale_qty <= 0 || item.purchase_qty <= 0) return null;
  if (saleFamily(item) !== 'strip' || !purchaseUsesBconnectBoxEquivalent(item)) return null;
  const ratio = Number(item.sale_qty) / Number(item.purchase_qty);
  const stripsPerBox = integerRatio(ratio);
  if (!stripsPerBox) return null;
  return {
    code: exactCode(item),
    strips_per_box: stripsPerBox,
    ratio: round(ratio, 4),
    case_id: item.id || null,
    sale_invoice: item.sale_invoices?.[0] || null,
    purchase_invoice: item.purchase_invoices?.[0] || null,
  };
}

export function buildPackagingProfiles(cases = []) {
  const evidence = cases.map(evidenceForCase).filter(Boolean);
  const byCode = new Map();
  evidence.forEach((entry) => {
    const bucket = byCode.get(entry.code) || [];
    bucket.push(entry);
    byCode.set(entry.code, bucket);
  });

  const profiles = {};
  byCode.forEach((entries, code) => {
    const counts = new Map();
    entries.forEach((entry) => counts.set(entry.strips_per_box, (counts.get(entry.strips_per_box) || 0) + 1));
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    if (!ranked.length) return;
    const [stripsPerBox, support] = ranked[0];
    const secondSupport = ranked[1]?.[1] || 0;
    const share = support / entries.length;
    const conflict = secondSupport === support || share < 0.6;
    if (conflict) {
      profiles[code] = {
        code,
        status: 'conflicted',
        confidence: 'low',
        source: 'observed',
        strips_per_box: null,
        evidence_count: entries.length,
        evidence: entries,
        alternatives: ranked.map(([value, count]) => ({ strips_per_box: value, count })),
      };
      return;
    }
    const confidence = support >= 2 && share >= 0.67 ? 'high' : 'medium';
    profiles[code] = {
      code,
      status: 'usable',
      confidence,
      source: 'observed',
      strips_per_box: stripsPerBox,
      evidence_count: entries.length,
      supporting_count: support,
      support_share: round(share, 3),
      evidence: entries,
      label: `1 علبة = ${stripsPerBox} ${stripsPerBox === 1 ? 'شريط' : 'شرائط'}`,
    };
  });
  return profiles;
}

function normalizeLearnedRule(rule, code) {
  const stripsPerBox = Number(rule?.strips_per_box);
  if (!rule?.active || !Number.isInteger(stripsPerBox) || stripsPerBox < 2 || stripsPerBox > 12) return null;
  return {
    ...rule,
    code,
    status: 'usable',
    confidence: 'confirmed',
    source: 'confirmed_rule',
    strips_per_box: stripsPerBox,
    supporting_count: Number(rule.approvals || 1),
    evidence_count: Number(rule.evidence_count || rule.approvals || 1),
    label: `1 علبة = ${stripsPerBox} شرائط`,
  };
}

function mergedProfiles(cases, learnedRules = {}) {
  const observed = buildPackagingProfiles(cases);
  const merged = { ...observed };
  Object.entries(learnedRules || {}).forEach(([code, rawRule]) => {
    const learned = normalizeLearnedRule(rawRule, code);
    if (!learned) return;
    // An explicit human-confirmed rule wins over noisy current-period ratios,
    // but the current evidence remains attached for audit.
    merged[code] = {
      ...(observed[code] || {}),
      ...learned,
      observed_profile: observed[code] || null,
    };
  });
  return merged;
}

function quantityUnitLabel(qty, unit) {
  const value = round(qty, 4);
  return `${value} ${humanTransferUnit(unit)}`;
}

export function caseQuantityLabels(item = {}) {
  const saleUnits = [...new Set((item.sale_lines || []).map((line) => text(line?.unit)).filter(Boolean))];
  const purchaseUnits = [...new Set((item.purchase_lines || []).map((line) => text(line?.unit)).filter(Boolean))];
  const saleLabel = saleUnits.length === 1
    ? quantityUnitLabel(item.sale_qty, saleUnits[0])
    : saleUnits.length > 1
      ? `${round(item.sale_qty, 4)} وحدات مختلطة (${saleUnits.map(humanTransferUnit).join(' + ')})`
      : `${round(item.sale_qty, 4)} وحدة بيع`;
  let purchaseLabel;
  if (purchaseUnits.length === 1) purchaseLabel = quantityUnitLabel(item.purchase_qty, purchaseUnits[0]);
  else if (purchaseUnits.length > 1) purchaseLabel = `${round(item.purchase_qty, 4)} وحدات مختلطة (${purchaseUnits.map(humanTransferUnit).join(' + ')})`;
  else if (purchaseUsesBconnectBoxEquivalent(item)) purchaseLabel = `${round(item.purchase_qty, 4)} علبة مكافئة`;
  else purchaseLabel = `${round(item.purchase_qty, 4)} وحدة شراء`;
  return { sale: saleLabel, purchase: purchaseLabel };
}

export function packagingRuleSuggestion(item) {
  const profile = item?.packaging_profile;
  if (!profile || profile.status !== 'usable' || !Number.isInteger(Number(profile.strips_per_box))) return null;
  const code = exactCode(item);
  if (!code) return null;
  return {
    code,
    strips_per_box: Number(profile.strips_per_box),
    label: `1 علبة = ${Number(profile.strips_per_box)} شرائط`,
    evidence_count: Number(profile.evidence_count || 1),
  };
}

export function learnPackagingRule(item, existingRules = {}, metadata = {}) {
  const suggestion = packagingRuleSuggestion(item);
  if (!suggestion) return existingRules;
  const key = packagingRuleKey(suggestion.code);
  const previous = existingRules[key];
  const now = new Date().toISOString();
  return {
    ...existingRules,
    [key]: {
      code: suggestion.code,
      strips_per_box: suggestion.strips_per_box,
      active: true,
      approvals: Number(previous?.approvals || 0) + 1,
      evidence_count: Math.max(Number(previous?.evidence_count || 0), suggestion.evidence_count),
      created_at: previous?.created_at || now,
      updated_at: now,
      approved_from_case: item?.id || null,
      approved_by: metadata.approved_by || null,
    },
  };
}

export function removePackagingRule(rules = {}, code) {
  const key = packagingRuleKey(code);
  if (!key || !rules[key]) return rules;
  const next = { ...rules };
  delete next[key];
  return next;
}

export function applyPackagingIntelligence(cases = [], learnedRules = {}) {
  const profiles = mergedProfiles(cases, learnedRules);
  return cases.map((item) => {
    const code = exactCode(item);
    const profile = code ? profiles[code] : null;
    const labels = caseQuantityLabels(item);
    const base = {
      ...item,
      sale_qty_label: labels.sale,
      purchase_qty_label: labels.purchase,
      packaging_profile: profile || null,
    };

    if (!profile || profile.status !== 'usable' || !profile.strips_per_box) return base;
    if (saleFamily(item) !== 'strip' || !purchaseUsesBconnectBoxEquivalent(item)) return base;
    if (item.sale_qty <= 0 || item.purchase_qty <= 0) return base;
    if (item.type === 'code_mismatch') return base;

    const expectedPurchase = Number(item.sale_qty) / Number(profile.strips_per_box);
    const normalizedMatch = nearlyEqual(item.purchase_qty, expectedPurchase);
    const normalizedSaleBoxes = round(expectedPurchase, 4);
    const evidencePhrase = profile.source === 'confirmed_rule'
      ? 'قاعدة عبوة سبق اعتمادها'
      : `${profile.supporting_count || profile.evidence_count} حركة بنفس الكود`;
    const packagingReason = `${profile.label} حسب ${evidencePhrase}. البيع ${labels.sale} = ${normalizedSaleBoxes} علبة مكافئة، والشراء ${labels.purchase}.`;
    const autoTrusted = profile.confidence === 'high' || profile.confidence === 'confirmed';

    if (autoTrusted) {
      if (normalizedMatch) {
        return {
          ...base,
          original_type: item.original_type || item.type,
          type: 'matched',
          severity: 0,
          matched_by_packaging_profile: true,
          packaging_rule_source: profile.source,
          packaging_normalized_sale_boxes: normalizedSaleBoxes,
          expected_purchase_qty: round(expectedPurchase, 4),
          packaging_reason: packagingReason,
          next_action: 'مطابق بعد توحيد الشريط والعلبة على ملف العبوة الموثوق.',
        };
      }
      return {
        ...base,
        original_type: item.original_type || item.type,
        type: 'quantity_mismatch',
        severity: Math.max(Number(item.severity || 0), 70),
        packaging_normalized_mismatch: true,
        packaging_rule_source: profile.source,
        packaging_normalized_sale_boxes: normalizedSaleBoxes,
        expected_purchase_qty: round(expectedPurchase, 4),
        packaging_reason: packagingReason,
        next_action: `راجع فرق الكمية بعد توحيد الوحدة: ${packagingReason}`,
      };
    }

    if (normalizedMatch && item.type !== 'matched') {
      return {
        ...base,
        original_type: item.original_type || item.type,
        type: 'unit_conversion_review',
        severity: 35,
        packaging_profile_candidate: true,
        packaging_normalized_sale_boxes: normalizedSaleBoxes,
        expected_purchase_qty: round(expectedPurchase, 4),
        packaging_reason: packagingReason,
        next_action: `${packagingReason} أكّد علاقة العبوة مرة واحدة قبل الإغلاق التلقائي.`,
      };
    }

    return base;
  });
}
