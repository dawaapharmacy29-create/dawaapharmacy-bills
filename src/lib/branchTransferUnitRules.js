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
  const ratio = Number(rule.purchase_per_sale);
  if (!Number.isFinite(ratio) || ratio <= 0) return '';
  const saleUnit = humanUnit(rule.sale_unit, 'وحدة');
  const purchaseUnit = humanUnit(rule.purchase_unit, 'علبة');
  if (ratio < 1) {
    const salePerPurchase = round(1 / ratio, 2);
    return `1 ${purchaseUnit} = ${salePerPurchase} ${saleUnit}`;
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
    const rule = rules[unitRuleKey(item)];
    if (!caseMatchesUnitRule(item, rule)) return item;
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
