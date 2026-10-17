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
  // We intentionally learn only meaningful pack conversions (2..12 strips/box).
  // A raw 1:1 number is ambiguous when the purchase export has no unit and must
  // never teach the system that one strip equals one box.
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

export function applyPackagingIntelligence(cases = []) {
  const profiles = buildPackagingProfiles(cases);
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
    const packagingReason = `${profile.label} حسب ${profile.supporting_count || profile.evidence_count} حركة بنفس الكود. البيع ${labels.sale} = ${normalizedSaleBoxes} علبة مكافئة، والشراء ${labels.purchase}.`;

    if (profile.confidence === 'high') {
      if (normalizedMatch) {
        return {
          ...base,
          original_type: item.original_type || item.type,
          type: 'matched',
          severity: 0,
          matched_by_packaging_profile: true,
          packaging_normalized_sale_boxes: normalizedSaleBoxes,
          expected_purchase_qty: round(expectedPurchase, 4),
          packaging_reason: packagingReason,
          next_action: 'مطابق بعد توحيد الشريط والعلبة على ملف العبوة المتعلم من الحركات السابقة.',
        };
      }
      return {
        ...base,
        original_type: item.original_type || item.type,
        type: 'quantity_mismatch',
        severity: Math.max(Number(item.severity || 0), 70),
        packaging_normalized_mismatch: true,
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
