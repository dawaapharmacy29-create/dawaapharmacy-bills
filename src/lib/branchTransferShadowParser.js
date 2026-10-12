import * as XLSX from 'xlsx';

const HEADER_ALIASES = {
  product_name: ['الصنف', 'اسم الصنف', 'اسم المنتج', 'المنتج', 'item', 'item name', 'product', 'product name'],
  code: ['الكود', 'كود', 'كود الصنف', 'كود المنتج', 'باركود', 'barcode', 'code', 'item code', 'product code'],
  qty: ['الكمية', 'كميه', 'العدد', 'عدد', 'qty', 'quantity', 'count'],
  invoice: ['رقم الفاتورة', 'رقم الفاتوره', 'الفاتورة', 'الفاتوره', 'مسلسل', 'serial', 'invoice', 'invoice number'],
  date: ['التاريخ', 'تاريخ', 'date', 'datetime'],
  user: ['المستخدم', 'الدكتور', 'الموظف', 'اسم المستخدم', 'user', 'doctor', 'employee'],
  branch: ['الفرع', 'المخزن', 'الموقع', 'branch', 'warehouse', 'location'],
  counterparty: ['العميل', 'المورد', 'الفرع المقابل', 'customer', 'supplier', 'counterparty'],
};

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeHeader(value) {
  return text(value)
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ـ/g, '')
    .replace(/[.،,:;\/\\_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NORMALIZED_ALIASES = Object.fromEntries(
  Object.entries(HEADER_ALIASES).map(([key, aliases]) => [key, aliases.map(normalizeHeader)]),
);

function detectHeader(row) {
  const map = {};
  row.forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    if (!normalized) return;
    Object.entries(NORMALIZED_ALIASES).some(([key, aliases]) => {
      if (aliases.includes(normalized)) {
        map[key] = index;
        return true;
      }
      return false;
    });
  });
  if (!Number.isInteger(map.product_name) || !Number.isInteger(map.qty)) return null;
  return map;
}

function cell(row, map, key) {
  return Number.isInteger(map[key]) ? row[map[key]] : null;
}

function rowHasContent(row) {
  return row.some((value) => text(value));
}

export function parseTransferRows(rows, defaults = {}) {
  let header = null;
  let headerRow = -1;
  const items = [];
  const warnings = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = Array.isArray(rows[index]) ? rows[index] : [];
    if (!rowHasContent(row)) continue;
    if (!header) {
      const detected = detectHeader(row);
      if (detected) {
        header = detected;
        headerRow = index;
      }
      continue;
    }

    const productName = text(cell(row, header, 'product_name'));
    const qtyRaw = cell(row, header, 'qty');
    const qty = Number(String(qtyRaw ?? '').replace(/,/g, '').trim());
    if (!productName && !Number.isFinite(qty)) continue;
    if (!productName || !Number.isFinite(qty) || qty === 0) {
      warnings.push(`تم تجاهل الصف ${index + 1}: اسم الصنف أو الكمية غير صالح.`);
      continue;
    }

    items.push({
      row_number: index + 1,
      product_name: productName,
      code: text(cell(row, header, 'code')),
      qty,
      invoice: text(cell(row, header, 'invoice')),
      date: cell(row, header, 'date') || defaults.date || '',
      user: text(cell(row, header, 'user')),
      branch: text(cell(row, header, 'branch')) || defaults.branch || '',
      counterparty: text(cell(row, header, 'counterparty')) || defaults.counterparty || '',
    });
  }

  if (!header) warnings.push('لم يتم العثور على رأس جدول يحتوي على اسم الصنف والكمية.');
  if (header && !items.length) warnings.push('تم العثور على الجدول لكن لا توجد أصناف صالحة للمطابقة.');

  return {
    valid: Boolean(header && items.length),
    items,
    warnings,
    meta: {
      header_row: headerRow >= 0 ? headerRow + 1 : null,
      item_count: items.length,
      detected_fields: header ? Object.keys(header) : [],
    },
  };
}

export function parseTransferWorkbook(arrayBuffer, defaults = {}) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const populatedSheets = workbook.SheetNames.filter((name) => {
    const sheet = workbook.Sheets[name];
    return sheet && Object.keys(sheet).some((key) => !key.startsWith('!') && sheet[key]?.v != null && text(sheet[key].v));
  });
  if (!populatedSheets.length) return { valid: false, items: [], warnings: ['الملف لا يحتوي على بيانات.'], meta: {} };
  if (populatedSheets.length > 1) {
    return {
      valid: false,
      items: [],
      warnings: [`الملف يحتوي على أكثر من Sheet بها بيانات: ${populatedSheets.join('، ')}. استخدم ملفًا بورقة واحدة في النسخة التجريبية.`],
      meta: { populated_sheets: populatedSheets },
    };
  }
  const sheetName = populatedSheets[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
  const result = parseTransferRows(rows, defaults);
  return { ...result, meta: { ...result.meta, sheet_name: sheetName } };
}
