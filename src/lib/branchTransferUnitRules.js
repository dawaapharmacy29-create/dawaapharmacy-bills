const DIACRITICS = /[\u064B-\u065F\u0670]/g;

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

function humanUnit(value, fallback) {
  const unit = text(value) || fallback;
  if (/^one unit$/i.test(unit) || /^unit$/i.test(unit) || /^وحدة بيع$/i.test(unit)) return 'وحدة';
  return unit;
}

function exactCode(item) {
  const codes = [...new Set([...(item?.sale_codes || []), ...(item?.purchase_codes || [])].map(text).filter(Boolean))];
  return codes.length === 1 ? codes[0] : null;
}

function unitFamily(value) {
  const unit = normalize(value);
  if (!unit) return null;
  if (/علب|box|pack/.test(unit)) return 'box';
  if (/شريط|strip/.test(unit)) return 'strip';
  if (/سرنج|syringe/.test(unit)) return 'syringe';
  if (/امبول|ampoule|amp\b/.test(unit)) return 'ampoule';
  if (/فيال|vial/.test(unit)) return 'vial';
  if (/كيس|sachet/.test(unit)) return 'sachet';
  if (/قطعه|piece|pcs?/.test(unit)) return 'piece';
  return null;
}

function implicitUnitConversionEvidence(item) {
  if (!item || item.type !== 'quantity_mismatch' || !exactCode(item) || item.sale_qty <= 0 || item.purchase_qty <= 0) return null;
  const saleUnit = item.sale_units?.[0];
  const purchaseUnit = item.purchase_units?.[0];
  const saleFamily = unitFamily(saleUnit);
  const purchaseFamily = unitFamily(purchaseUnit);
  if (!saleFamily || !purchaseFamily || saleFamily === purchaseFamily) return null;
  const hasBoxSide = saleFamily === 'box' || purchaseFamily === 'box';
  if (!hasBoxSide) return null;
  const ratio = Math.max(item.sale_qty, item.purchase_qty) / Math.min(item.sale_qty, item.purchase_qty);
  const roundedRatio = Math.round(ratio);
  if (roundedRatio < 2 || roundedRatio > 12 || Math.abs(ratio - roundedRatio) > Math.max(0.06, roundedRatio * 0.03)) return null;
  return {
    kind: 'explicit_unit_ratio',
    ratio: round(ratio, 3),
    sale_unit: saleUnit,
    purchase_unit: purchaseUnit,
    reason: `الوحدات مختلفة بوضوح (${saleUnit || 'وحدة بيع'} مقابل ${purchaseUnit || 'وحدة شراء'}) والنسبة ${round(ratio, 3)}:1؛ ده أقرب لتحويل عبوة من فرق كمية حقيقي.`,
  };
}

function packagingOwnsDecision(item) {
  if (!item) return false;
  if (item.matched_by_packaging_profile) return true;
  if (item.packaging_normalized_mismatch) return true;
  if (item.packaging_profile_candidate) return true;
  if (item.packaging_profile?.status === 'conflicted') return true;
  return item.packaging_profile?.status === 'usable' && Boolean(item.packaging_profile?.strips_per_box);
}

export function unitRuleKey(item) {
  const product = normalize(item?.product_name);
  const from = text(item?.from || 'unknown');
  const to = text(item?.to || 'unknown');
  return `${from}::${to}::${product}`;
}

export function suggestUnitRule(item) {
  if (!item || item.sale_qty <= 0 || item.purchase_qty <= 0) return null;
  const purchasePerSale = item.purchase_qty / item.sale_qty;
  if (!Number.isFinite(purchasePerSale) || purchasePerSale <= 0) return null;
  const saleUnit = item.sale_units?.[0] || 'وحدة بيع';
  const purchaseUnit = item.purchase_units?.[0] || 'علبة';
  return {
    key: unitRuleKey(item),
    product_name: item.product_name,
    from: item.from,
    to: item.to,
    sale_unit: saleUnit,
    purchase_unit: purchaseUnit,
    purchase_per_sale: round(purchasePerSale, 6),
    relative_tolerance: 0.035,
    absolute_tolerance: 0.02,
    active: true,
  };
}

export function unitRuleLabel(rule) {
  if (!rule) return '';
  const ratio = round(rule.purchase_per_sale, 3);
  return `1 ${rule.sale_unit || 'وحدة بيع'} = ${ratio} ${rule.purchase_unit || 'علبة'}`;
}

export function humanUnitRuleLabel(rule) {
  if (!rule) return '';
  const ratio = Number(rule.purchase_per_sale);
  if (!Number.isFinite(ratio) || ratio <= 0) return '';
  const saleUnit = humanUnit(rule.sale_unit, 'وحدة');
  const purchaseUnit = humanUnit(rule.purchase_unit, 'علبة');
  if (ratio < 1) {
    return `1 ${purchaseUnit} = ${round(1 / ratio, 2)} ${saleUnit}`;
  }
  return `1 ${saleUnit} = ${round(ratio, 2)} ${purchaseUnit}`;
}

export function caseMatchesUnitRule(item, rule) {
  if (!item || !rule?.active || item.sale_qty <= 0 || item.purchase_qty <= 0) return false;
  if (unitRuleKey(item) !== rule.key) return false;
  const expectedPurchase = item.sale_qty * Number(rule.purchase_per_sale);
  if (!Number.isFinite(expectedPurchase)) return false;
  const absoluteTolerance = Number.isFinite(Number(rule.absolute_tolerance)) ? Number(rule.absolute_tolerance) : 0.02;
  const relativeTolerance = Number.isFinite(Number(rule.relative_tolerance)) ? Number(rule.relative_tolerance) : 0.035;
  const tolerance = Math.max(absoluteTolerance, Math.abs(expectedPurchase) * relativeTolerance);
  return Math.abs(item.purchase_qty - expectedPurchase) <= tolerance;
}

export function applyLearnedUnitRules(cases = [], rules = {}) {
  return cases.map((item) => {
    if (!item.sale_qty || !item.purchase_qty) return item;
    // Packaging intelligence is more specific than the legacy generic unit rule.
    // Once we know (or are actively reviewing) strips-per-box for an exact code,
    // never let an older direction/name rule turn that case green by accident.
    if (packagingOwnsDecision(item)) return item;
    const rule = rules[unitRuleKey(item)];
    if (caseMatchesUnitRule(item, rule)) {
      return {
        ...item,
        original_type: item.type,
        type: 'matched',
        severity: 0,
        matched_by_unit_rule: true,
        unit_rule_key: rule.key,
        unit_rule_label: unitRuleLabel(rule),
        expected_purchase_qty: round(item.sale_qty * Number(rule.purchase_per_sale), 4),
        next_action: 'مطابق بعد تطبيق قاعدة تحويل وحدة سبق اعتمادها.',
      };
    }
    const implicit = implicitUnitConversionEvidence(item);
    if (!implicit) return item;
    return {
      ...item,
      original_type: item.type,
      type: 'unit_conversion_review',
      severity: 45,
      implicit_unit_conversion: true,
      implicit_unit_conversion_evidence: implicit,
      unit_conversion_evidence: item.unit_conversion_evidence || implicit,
      next_action: `${implicit.reason} أكّد معامل التحويل مرة واحدة قبل اعتباره فرق كمية.`,
    };
  });
}

export function learnUnitRule(item, existingRules = {}, metadata = {}) {
  const suggestion = suggestUnitRule(item);
  if (!suggestion) return existingRules;
  const now = new Date().toISOString();
  const previous = existingRules[suggestion.key];
  return {
    ...existingRules,
    [suggestion.key]: {
      ...suggestion,
      created_at: previous?.created_at || now,
      updated_at: now,
      approved_from_case: item.id || null,
      approved_by: metadata.approved_by || null,
      approvals: Number(previous?.approvals || 0) + 1,
    },
  };
}

export function removeUnitRule(rules = {}, key) {
  if (!key || !rules[key]) return rules;
  const next = { ...rules };
  delete next[key];
  return next;
}
