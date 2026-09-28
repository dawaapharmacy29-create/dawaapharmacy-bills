const normalizeText = (value) =>
  String(value ?? '').trim().toLowerCase().replace(/[\s_\-]+/g, ' ');

const toNumber = (value) => {
  const parsed = Number(String(value ?? '').replace(/[,٪%جنيه]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const ALIASES = {
  code: ['الكود', 'كود الصنف'],
  name: ['إسم الصنف', 'اسم الصنف'],
  unit: ['الوحدة'],
  company: ['الشركة'],
  shamy: ['الفرعية الشامي'],
  shokry: ['الادارة فرع شكري', 'الإدارة فرع شكري'],
};

function exactHeader(headers, aliases) {
  return headers.find((header) => aliases.some((alias) => normalizeText(header) === normalizeText(alias))) || '';
}

export function detectDualBranchStockColumns(headers = []) {
  const map = Object.fromEntries(
    Object.entries(ALIASES).map(([key, aliases]) => [key, exactHeader(headers, aliases)])
  );
  return map.code && map.name && map.shamy && map.shokry ? map : null;
}

function inventoryEligible(name) {
  const value = normalizeText(name);
  return Boolean(value) && !['توصيل', 'delivery', 'رسوم', 'service'].some((token) => value.includes(token));
}

export function normalizeDualBranchStockRows(rows = [], fileName = '') {
  const headers = Object.keys(rows[0] || {});
  const map = detectDualBranchStockColumns(headers);
  if (!map) {
    throw new Error('ملف الرصيد لازم يحتوي على الكود، اسم الصنف، رصيد الشامي، ورصيد شكري.');
  }

  const shamy = [];
  const shokry = [];
  const seen = new Set();

  rows.forEach((row, index) => {
    const productCode = String(row[map.code] ?? '').trim().replace(/\.0+$/, '');
    const productName = String(row[map.name] ?? '').trim();
    if (!productCode || !productName) return;

    const dedupeKey = productCode;
    if (seen.has(dedupeKey)) {
      throw new Error(`يوجد كود صنف مكرر داخل ملف الرصيد: ${productCode}`);
    }
    seen.add(dedupeKey);

    const common = {
      row_number: index + 2,
      product_code: productCode,
      product_name: productName,
      stock_unit: map.unit ? String(row[map.unit] ?? '').trim() : '',
      company_name: map.company ? String(row[map.company] ?? '').trim() : '',
      inventory_eligible: inventoryEligible(productName),
      snapshot_mode: 'stock_only',
      stock_source: fileName || 'dual-branch-stock-master',
    };

    shamy.push({ ...common, current_stock: Math.max(0, toNumber(row[map.shamy])) });
    shokry.push({ ...common, current_stock: Math.max(0, toNumber(row[map.shokry])) });
  });

  if (!shamy.length || !shokry.length) {
    throw new Error('ملف الرصيد لم يحتوِ على أصناف صالحة للتحليل.');
  }

  return {
    file_name: fileName,
    map,
    shamy,
    shokry,
    rows_count: shamy.length,
    inventory_rows: shamy.filter((row) => row.inventory_eligible).length,
  };
}
