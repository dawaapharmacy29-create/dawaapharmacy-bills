const normalizeText = (value) =>
  String(value ?? '').trim().toLowerCase().replace(/[\s_\-]+/g, ' ');

const normalizeDigits = (value) =>
  String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));

function parseStockNumber(value) {
  if (typeof value === 'number') {
    return { value: Number.isFinite(value) ? value : 0, invalid: !Number.isFinite(value) };
  }
  const text = normalizeDigits(value).trim();
  if (!text || text === '-' || text === '—') return { value: 0, invalid: false };
  const normalized = text.replace(/[٬,]/g, '').replace(/٫/g, '.').replace(/\s+/g, '');
  const parsed = Number(normalized);
  return { value: Number.isFinite(parsed) ? parsed : 0, invalid: !Number.isFinite(parsed) };
}

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

  const rowsOut = [];
  const shamy = [];
  const shokry = [];
  const seen = new Set();
  const quality = {
    negative_shamy: 0,
    negative_shokry: 0,
    fractional_shamy: 0,
    fractional_shokry: 0,
    zero_shamy: 0,
    zero_shokry: 0,
    invalid_shamy: 0,
    invalid_shokry: 0,
    invalid_identity_rows: 0,
    ignored_blank_rows: 0,
  };
  const invalidRows = [];

  rows.forEach((row, index) => {
    const productCode = String(row[map.code] ?? '').trim().replace(/\.0+$/, '');
    const productName = String(row[map.name] ?? '').trim();
    const meaningful = [map.code, map.name, map.unit, map.company, map.shamy, map.shokry]
      .filter(Boolean)
      .some((header) => String(row[header] ?? '').trim() !== '');

    if (!meaningful) {
      quality.ignored_blank_rows += 1;
      return;
    }
    if (!productCode || !productName) {
      quality.invalid_identity_rows += 1;
      invalidRows.push(`صف ${index + 2}: كود أو اسم الصنف ناقص`);
      return;
    }

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

    const shamyParsed = parseStockNumber(row[map.shamy]);
    const shokryParsed = parseStockNumber(row[map.shokry]);
    if (shamyParsed.invalid) {
      quality.invalid_shamy += 1;
      invalidRows.push(`صف ${index + 2}: رصيد الشامي غير رقمي`);
    }
    if (shokryParsed.invalid) {
      quality.invalid_shokry += 1;
      invalidRows.push(`صف ${index + 2}: رصيد شكري غير رقمي`);
    }
    if (shamyParsed.invalid || shokryParsed.invalid) return;

    const rawShamyStock = shamyParsed.value;
    const rawShokryStock = shokryParsed.value;
    if (rawShamyStock < 0) quality.negative_shamy += 1;
    if (rawShokryStock < 0) quality.negative_shokry += 1;
    if (rawShamyStock > 0 && !Number.isInteger(rawShamyStock)) quality.fractional_shamy += 1;
    if (rawShokryStock > 0 && !Number.isInteger(rawShokryStock)) quality.fractional_shokry += 1;
    if (rawShamyStock === 0) quality.zero_shamy += 1;
    if (rawShokryStock === 0) quality.zero_shokry += 1;
    const shamyStock = Math.max(0, rawShamyStock);
    const shokryStock = Math.max(0, rawShokryStock);
    rowsOut.push({
      ...common,
      shamy_stock: shamyStock,
      shokry_stock: shokryStock,
      shamy_stock_negative: rawShamyStock < 0,
      shokry_stock_negative: rawShokryStock < 0,
    });
    shamy.push({ ...common, current_stock: shamyStock });
    shokry.push({ ...common, current_stock: shokryStock });
  });

  if (invalidRows.length > 0) {
    const sample = invalidRows.slice(0, 5).join(' • ');
    const more = invalidRows.length > 5 ? ` • +${invalidRows.length - 5} حالات أخرى` : '';
    throw new Error(`تم إيقاف الملف لأن به صفوفًا غير صالحة: ${sample}${more}`);
  }

  if (!shamy.length || !shokry.length) {
    throw new Error('ملف الرصيد لم يحتوِ على أصناف صالحة للتحليل.');
  }

  return {
    file_name: fileName,
    source_rows_count: rows.length,
    map,
    rows: rowsOut,
    shamy,
    shokry,
    rows_count: rowsOut.length,
    inventory_rows: shamy.filter((row) => row.inventory_eligible).length,
    quality,
  };
}


export async function runBoundedChunkPool(
  chunks = [],
  worker,
  { concurrency = 2, onComplete = null } = {}
) {
  if (!Array.isArray(chunks) || chunks.length === 0) return [];
  if (typeof worker !== 'function') throw new Error('Chunk worker is required.');

  const limit = Math.max(1, Math.min(chunks.length, Math.floor(Number(concurrency) || 1)));
  const results = new Array(chunks.length);
  let nextIndex = 0;
  let completed = 0;
  let stopped = false;

  async function runner() {
    while (!stopped) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= chunks.length) return;

      try {
        const result = await worker(chunks[index], index);
        results[index] = result;
        completed += 1;
        if (typeof onComplete === 'function') {
          onComplete({
            completed,
            total: chunks.length,
            index,
            result,
          });
        }
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runner()));
  return results;
}
