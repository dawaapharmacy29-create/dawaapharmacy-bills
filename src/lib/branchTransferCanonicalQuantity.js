import { humanTransferUnit, transferUnitFamily } from './branchTransferPackagingIntelligence.js';
import { buildQuantityPresentation, buildRemainingPresentation } from './branchTransferQuantityPresentation.js';

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function unique(values = []) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function lineUnits(lines = []) {
  return unique(lines.map((line) => line?.unit));
}

function singleFamily(lines = []) {
  const families = [...new Set(lineUnits(lines).map(transferUnitFamily).filter(Boolean))];
  return families.length === 1 ? families[0] : null;
}

function isUnitlessBconnectPurchase(item = {}) {
  const lines = item.purchase_lines || [];
  if (!lines.length || lineUnits(lines).length) return false;
  return lines.every((line) => text(line?.raw?.source_format || line?.source_format) === 'bconnect_purchase_report');
}

function trustedProfile(profile) {
  return Boolean(
    profile
    && profile.status === 'usable'
    && Number.isInteger(Number(profile.strips_per_box))
    && ['high', 'confirmed'].includes(profile.confidence),
  );
}

function candidateProfile(profile) {
  return Boolean(
    profile
    && profile.status === 'usable'
    && Number.isInteger(Number(profile.strips_per_box)),
  );
}

function confidenceLabel(profile) {
  if (!profile) return 'unknown';
  if (profile.confidence === 'confirmed') return 'confirmed';
  if (profile.confidence === 'high') return 'high';
  if (profile.confidence === 'medium') return 'probable';
  return 'observed';
}

function sourceLabel(profile) {
  if (!profile) return null;
  if (profile.source === 'confirmed_rule') return 'manual_confirmed_rule';
  if (profile.source === 'product_name_and_observed') return 'repeated_history+explicit_pack_signature';
  if (profile.source === 'product_name_explicit') return 'explicit_pack_signature';
  if (profile.source === 'observed') return 'repeated_historical_evidence';
  if (profile.source === 'rule_drift_candidate') return 'packaging_rule_drift';
  return profile.source || 'packaging_profile';
}

function rawUnitLabel(lines = [], side = 'sale') {
  const units = lineUnits(lines);
  if (units.length === 1) return humanTransferUnit(units[0]);
  if (units.length > 1) return `وحدات مختلطة (${units.map(humanTransferUnit).join(' + ')})`;
  return side === 'sale' ? 'وحدة بيع غير محددة' : 'وحدة شراء غير محددة';
}

function rawQuantity(qty, lines, side) {
  const units = lineUnits(lines);
  return {
    raw_qty: Number(qty || 0),
    raw_unit: units.length === 1 ? transferUnitFamily(units[0]) : null,
    raw_unit_label: rawUnitLabel(lines, side),
  };
}

function canonicalSale(item, profile) {
  const raw = rawQuantity(item.sale_qty, item.sale_lines, 'sale');
  const family = singleFamily(item.sale_lines);
  const packSize = Number(profile?.strips_per_box);

  if (family === 'box') {
    return {
      ...raw,
      canonical_qty: Number(item.sale_qty || 0),
      canonical_unit: 'box',
      conversion_factor: 1,
      conversion_source: 'explicit_sale_unit',
      conversion_confidence: 'confirmed',
    };
  }

  if (family === 'strip' && candidateProfile(profile)) {
    return {
      ...raw,
      canonical_qty: round(Number(item.sale_qty || 0) / packSize, 4),
      canonical_unit: 'box',
      conversion_factor: round(1 / packSize, 6),
      conversion_source: sourceLabel(profile),
      conversion_confidence: confidenceLabel(profile),
    };
  }

  return {
    ...raw,
    canonical_qty: Number(item.sale_qty || 0),
    canonical_unit: family || null,
    conversion_factor: 1,
    conversion_source: family ? 'explicit_sale_unit_no_pack_conversion' : null,
    conversion_confidence: family ? 'confirmed' : 'unknown',
  };
}

function canonicalPurchase(item, profile) {
  const raw = rawQuantity(item.purchase_qty, item.purchase_lines, 'purchase');
  const family = singleFamily(item.purchase_lines);

  if (family === 'box') {
    return {
      ...raw,
      canonical_qty: Number(item.purchase_qty || 0),
      canonical_unit: 'box',
      conversion_factor: 1,
      conversion_source: 'explicit_purchase_unit',
      conversion_confidence: 'confirmed',
    };
  }

  if (isUnitlessBconnectPurchase(item) && trustedProfile(profile)) {
    return {
      ...raw,
      canonical_qty: Number(item.purchase_qty || 0),
      canonical_unit: 'box',
      conversion_factor: 1,
      conversion_source: `${sourceLabel(profile)}+bconnect_recording_behavior`,
      conversion_confidence: confidenceLabel(profile),
    };
  }

  return {
    ...raw,
    canonical_qty: Number(item.purchase_qty || 0),
    canonical_unit: family || null,
    conversion_factor: 1,
    conversion_source: family ? 'explicit_purchase_unit_no_pack_conversion' : null,
    conversion_confidence: family ? 'confirmed' : 'unknown',
  };
}

function salePresentation(item, profile) {
  const base = buildQuantityPresentation(item.sale_lines || [], 'sale', { fallbackQty: item.sale_qty });
  if (base.kind === 'none' || base.kind === 'mixed') return base;
  const family = singleFamily(item.sale_lines);
  const packSize = Number(profile?.strips_per_box);
  if (family === 'strip' && candidateProfile(profile)) {
    const canonical = round(Number(item.sale_qty || 0) / packSize, 2);
    const trusted = trustedProfile(profile);
    const secondary = `${trusted ? '=' : '≈'} ${canonical} علبة${trusted ? '' : ' · تقدير يحتاج تأكيد'}`;
    return { ...base, secondary, label: `${base.primary} ${secondary}`, packagingInterpretation: trusted ? 'trusted' : 'candidate' };
  }
  return base;
}

function purchasePresentation(item, profile) {
  const base = buildQuantityPresentation(item.purchase_lines || [], 'purchase', {
    fallbackQty: item.purchase_qty,
    unitlessBconnect: isUnitlessBconnectPurchase(item),
  });
  if (base.kind === 'none' || base.kind === 'mixed') return base;
  if (isUnitlessBconnectPurchase(item) && trustedProfile(profile)) {
    const primary = `${round(item.purchase_qty || 0, 4)} علبة`;
    return { ...base, kind: 'single', primary, secondary: '', label: primary, unitFamily: 'box', safeToSubtract: true, packagingInterpretation: 'trusted' };
  }
  return base;
}

function recordingBehavior(item = {}) {
  return {
    sale: {
      unit_family: singleFamily(item.sale_lines),
      unit_explicit: lineUnits(item.sale_lines).length === 1,
      source_formats: unique((item.sale_lines || []).map((line) => line?.raw?.source_format || line?.source_format)),
    },
    purchase: {
      unit_family: singleFamily(item.purchase_lines),
      unit_explicit: lineUnits(item.purchase_lines).length === 1,
      unitless_bconnect: isUnitlessBconnectPurchase(item),
      source_formats: unique((item.purchase_lines || []).map((line) => line?.raw?.source_format || line?.source_format)),
    },
  };
}

export function applyCanonicalQuantity(cases = []) {
  return cases.map((item) => {
    const profile = item.packaging_profile || null;
    const sale = canonicalSale(item, profile);
    const purchase = canonicalPurchase(item, profile);
    const saleDisplay = salePresentation(item, profile);
    const purchaseDisplay = purchasePresentation(item, profile);
    const mixedUnits = saleDisplay.kind === 'mixed' || purchaseDisplay.kind === 'mixed';
    const canonicalComparable = !mixedUnits && sale.canonical_unit === 'box' && purchase.canonical_unit === 'box';
    const canonicalSaleQty = canonicalComparable ? sale.canonical_qty : null;
    const canonicalPurchaseQty = canonicalComparable ? purchase.canonical_qty : null;
    const remainingDisplay = buildRemainingPresentation({
      sale: saleDisplay,
      purchase: purchaseDisplay,
      canonicalComparable,
      canonicalSaleQty,
      canonicalPurchaseQty,
    });

    return {
      ...item,
      sale_quantity: sale,
      purchase_quantity: purchase,
      sale_qty_display: saleDisplay,
      purchase_qty_display: purchaseDisplay,
      remaining_qty_display: remainingDisplay,
      mixed_units_detected: mixedUnits,
      quantity_comparison_safe: remainingDisplay.precise,
      canonical_quantity_comparable: canonicalComparable,
      canonical_sale_qty: canonicalSaleQty,
      canonical_purchase_qty: canonicalPurchaseQty,
      packaging_conflict: profile?.status === 'conflicted' || Boolean(item.packaging_rule_drift),
      branch_recording_behavior: recordingBehavior(item),
      sale_qty_label: saleDisplay.label,
      purchase_qty_label: purchaseDisplay.label,
    };
  });
}
