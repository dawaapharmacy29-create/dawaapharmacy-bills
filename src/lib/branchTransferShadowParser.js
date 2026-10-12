import * as XLSX from 'xlsx';

const HEADER_ALIASES = {
  product_name: ['الصنف', 'صنف', 'اسم الصنف', 'اسم المنتج', 'المنتج', 'الإسم', 'الاسم', 'item', 'item name', 'product', 'product name'],
  code: ['الكود', 'كود', 'كود الصنف', 'كود المنتج', 'ك.صنف', 'باركود', 'barcode', 'code', 'item code', 'product code'],
  counterparty_code: ['كود العميل', 'كود المورد', 'ك.العميل', 'ك.المورد', 'customer code', 'supplier code', 'counterparty code'],
  qty: ['الكمية', 'كميه', 'العدد', 'عدد', 'qty', 'quantity', 'count'],
  unit: ['الوحدة', 'وحدة', 'unit'],
  invoice: ['رقم الفاتورة', 'رقم الفاتوره', 'الفاتورة', 'الفاتوره', 'فاتورة', 'مسلسل', 'serial', 'invoice', 'invoice number'],
  date: ['التاريخ', 'تاريخ', 'date', 'datetime'],
  user: ['المستخدم', 'الدكتور', 'الموظف', 'اسم المستخدم', 'user', 'doctor', 'employee'],
  branch: ['الفرع', 'المخزن', 'الموقع', 'branch', 'warehouse', 'location'],
  counterparty: ['العميل', 'عميل', 'المورد', 'مورد', 'الفرع المقابل', 'customer', 'supplier', 'counterparty'],
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

  // Daily B-Connect sales exports use a bare "كود" for the customer code
  // and a later "ك.صنف" for the product code. Keep both identities separate.
  if (Number.isInteger(map.counterparty)) {
    const bareCodeIndex = row.findIndex((value) => normalizeHeader(value) === normalizeHeader('كود'));
    const productCodeIndex = row.findIndex((value) => {
      const normalized = normalizeHeader(value);
      return [
        'ك.صنف', 'كود الصنف', 'كود المنتج', 'باركود',
        'item code', 'product code', 'barcode',
      ].map(normalizeHeader).includes(normalized);
    });
    if (bareCodeIndex >= 0 && productCodeIndex >= 0 && bareCodeIndex !== productCodeIndex) {
      map.counterparty_code = bareCodeIndex;
      map.code = productCodeIndex;
    }
  }

  if (!Number.isInteger(map.product_name) || !Number.isInteger(map.qty)) return null;
  return map;
}

function cell(row, map, key) {
  return Number.isInteger(map[key]) ? row[map[key]] : null;
}

function rowHasContent(row) {
  return row.some((value) => text(value));
}

function number(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function isPurchaseInvoiceHeader(row) {
  return normalizeHeader(row?.[0]) === normalizeHeader('ملاحظات')
    && normalizeHeader(row?.[1]) === normalizeHeader('مستخدم')
    && row?.[23] != null;
}

function isPurchaseInvoiceTotal(row) {
  return normalizeHeader(row?.[6]) === normalizeHeader('الإجمالى');
}

function looksLikePurchaseDetail(row) {
  return Boolean(text(row?.[14]) && text(row?.[15]) && number(row?.[11]) !== null);
}

function parseBConnectPurchaseRows(rows, defaults = {}) {
  const items = [];
  const warnings = [];
  let current = null;
  let invoiceCount = 0;

  rows.forEach((row, index) => {
    if (!Array.isArray(row) || !rowHasContent(row)) return;
    if (isPurchaseInvoiceHeader(row)) {
      current = {
        user: text(row[13]),
        supplier: text(row[20]),
        supplier_code: text(row[21]),
        date: row[22] || defaults.date || '',
        invoice: text(row[23]),
      };
      invoiceCount += 1;
      return;
    }
    if (current && isPurchaseInvoiceTotal(row)) {
      current = null;
      return;
    }
    if (!current || !looksLikePurchaseDetail(row)) return;

    const qty = number(row[11]);
    if (!qty || qty <= 0) {
      warnings.push(`تم تجاهل صف مشتريات ${index + 1}: الكمية غير صالحة.`);
      return;
    }

    items.push({
      row_number: index + 1,
      product_name: text(row[14]),
      code: text(row[15]),
      qty,
      unit: '',
      invoice: current.invoice,
      date: current.date,
      user: current.user,
      branch: defaults.branch || '',
      counterparty: defaults.counterparty || current.supplier || '',
      counterparty_code: text(defaults.counterparty_code) || current.supplier_code || '',
      purchase_total: number(row[17]),
      retail_total: number(row[18]),
      expiration_raw: row[13] || null,
      source_format: 'bconnect_purchase_report',
    });
  });

  if (!invoiceCount) return null;
  if (!items.length) warnings.push('تم العثور على فواتير مشتريات لكن لم يتم استخراج أصناف صالحة منها.');
  return {
    valid: Boolean(items.length),
    items,
    warnings,
    meta: { source_format: 'bconnect_purchase_report', invoice_count: invoiceCount, item_count: items.length },
  };
}

function parseFlatRows(rows, defaults = {}) {
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
    const qty = number(cell(row, header, 'qty'));
    if (!productName && qty === null) continue;
    if (!productName || qty === null || qty === 0) {
      warnings.push(`تم تجاهل الصف ${index + 1}: اسم الصنف أو الكمية غير صالح.`);
      continue;
    }

    items.push({
      row_number: index + 1,
      product_name: productName,
      code: text(cell(row, header, 'code')),
      qty,
      unit: text(cell(row, header, 'unit')),
      invoice: text(cell(row, header, 'invoice')),
      date: cell(row, header, 'date') || defaults.date || '',
      user: text(cell(row, header, 'user')),
      branch: defaults.branch || text(cell(row, header, 'branch')) || '',
      counterparty: defaults.counterparty || text(cell(row, header, 'counterparty')) || '',
      counterparty_code: text(defaults.counterparty_code) || text(cell(row, header, 'counterparty_code')) || '',
      source_format: 'flat_transfer_rows',
    });
  }

  if (!header) warnings.push('لم يتم العثور على رأس جدول يحتوي على اسم الصنف والكمية.');
  if (header && !items.length) warnings.push('تم العثور على الجدول لكن لا توجد أصناف صالحة للمطابقة.');

  return {
    valid: Boolean(header && items.length),
    items,
    warnings,
    meta: {
      source_format: 'flat_transfer_rows',
      header_row: headerRow >= 0 ? headerRow + 1 : null,
      item_count: items.length,
      detected_fields: header ? Object.keys(header) : [],
    },
  };
}

export function parseTransferRows(rows, defaults = {}) {
  const purchase = parseBConnectPurchaseRows(rows, defaults);
  if (purchase) return purchase;
  return parseFlatRows(rows, defaults);
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
