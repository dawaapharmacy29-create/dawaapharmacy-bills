import { humanTransferUnit, transferUnitFamily } from './branchTransferPackagingIntelligence.js';

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 4) {
  return Number(number(value).toFixed(digits));
}

function sourceFormat(line = {}) {
  return text(line?.raw?.source_format || line?.source_format);
}

function unitKey(line = {}, side = 'sale') {
  const rawUnit = text(line?.unit);
  if (rawUnit) {
    const family = transferUnitFamily(rawUnit);
    return {
      key: family ? `family:${family}` : `unit:${rawUnit.toLowerCase()}`,
      family: family || null,
      label: humanTransferUnit(rawUnit),
      explicit: true,
      unknownPackaging: false,
    };
  }

  const unitlessBconnect = side === 'purchase' && sourceFormat(line) === 'bconnect_purchase_report';
  return {
    key: unitlessBconnect ? 'unknown:bconnect-purchase' : `unknown:${side}`,
    family: null,
    label: 'وحدة',
    explicit: false,
    unknownPackaging: unitlessBconnect,
  };
}

export function quantityComponents(lines = [], side = 'sale') {
  const grouped = new Map();
  (lines || []).forEach((line) => {
    const unit = unitKey(line, side);
    const current = grouped.get(unit.key) || { ...unit, qty: 0, lineCount: 0 };
    current.qty += number(line?.qty);
    current.lineCount += 1;
    grouped.set(unit.key, current);
  });

  return [...grouped.values()]
    .map((component) => ({ ...component, qty: round(component.qty, 4) }))
    .filter((component) => Math.abs(component.qty) > 1e-9);
}

export function buildQuantityPresentation(lines = [], side = 'sale', options = {}) {
  const components = quantityComponents(lines, side);
  const totalFallback = round(options.fallbackQty ?? 0, 4);

  if (!components.length) {
    if (Math.abs(totalFallback) <= 1e-9) {
      return {
        kind: 'none',
        primary: 'لا توجد حركة',
        secondary: '',
        label: 'لا توجد حركة',
        components: [],
        safeToSubtract: true,
        unitFamily: null,
        unknownPackaging: false,
      };
    }

    const unknownPackaging = side === 'purchase' && Boolean(options.unitlessBconnect);
    const primary = `${totalFallback} وحدة`;
    const secondary = unknownPackaging ? 'العبوة غير محددة' : 'الوحدة غير محددة';
    return {
      kind: 'unknown',
      primary,
      secondary,
      label: `${primary} · ${secondary}`,
      components: [{ qty: totalFallback, family: null, label: 'وحدة', explicit: false, unknownPackaging }],
      safeToSubtract: false,
      unitFamily: null,
      unknownPackaging,
    };
  }

  if (components.length > 1) {
    const primary = components.map((component) => `${component.qty} ${component.label}`).join(' + ');
    return {
      kind: 'mixed',
      primary,
      secondary: 'وحدات مختلفة — لا تُجمع كرقم واحد',
      label: primary,
      components,
      safeToSubtract: false,
      unitFamily: null,
      unknownPackaging: components.some((component) => component.unknownPackaging),
    };
  }

  const [component] = components;
  const primary = `${component.qty} ${component.label}`;
  const secondary = component.unknownPackaging ? 'العبوة غير محددة' : '';
  return {
    kind: component.unknownPackaging ? 'unknown' : 'single',
    primary,
    secondary,
    label: secondary ? `${primary} · ${secondary}` : primary,
    components,
    safeToSubtract: Boolean(component.family || component.explicit),
    unitFamily: component.family,
    unknownPackaging: component.unknownPackaging,
  };
}

export function buildRemainingPresentation({ sale, purchase, canonicalComparable = false, canonicalSaleQty = null, canonicalPurchaseQty = null } = {}) {
  if (canonicalComparable) {
    const value = round(Math.abs(number(canonicalSaleQty) - number(canonicalPurchaseQty)), 4);
    return {
      kind: 'canonical',
      primary: `${value} علبة`,
      secondary: 'بعد توحيد وحدات العبوة',
      value,
      unit: 'box',
      precise: true,
    };
  }

  if (sale?.kind === 'none' && purchase?.kind === 'single' && purchase.unitFamily) {
    return {
      kind: 'single-side',
      primary: purchase.primary,
      secondary: 'الحركة المقابلة غير موجودة',
      value: purchase.components?.[0]?.qty ?? null,
      unit: purchase.unitFamily,
      precise: true,
    };
  }

  if (purchase?.kind === 'none' && sale?.kind === 'single' && sale.unitFamily) {
    return {
      kind: 'single-side',
      primary: sale.primary,
      secondary: 'الحركة المقابلة غير موجودة',
      value: sale.components?.[0]?.qty ?? null,
      unit: sale.unitFamily,
      precise: true,
    };
  }

  const sameSingleFamily = sale?.kind === 'single' && purchase?.kind === 'single'
    && sale.unitFamily && sale.unitFamily === purchase.unitFamily;
  if (sameSingleFamily) {
    const value = round(Math.abs(number(sale.components?.[0]?.qty) - number(purchase.components?.[0]?.qty)), 4);
    const unitLabel = sale.components?.[0]?.label || 'وحدة';
    return {
      kind: 'direct',
      primary: `${value} ${unitLabel}`,
      secondary: 'فرق مباشر بنفس الوحدة',
      value,
      unit: sale.unitFamily,
      precise: true,
    };
  }

  return {
    kind: 'not-comparable',
    primary: 'غير قابل للحساب بدقة',
    secondary: 'الوحدات مختلفة أو غير مؤكدة',
    value: null,
    unit: null,
    precise: false,
  };
}
