import * as XLSX from "xlsx";

export const BCONNECT_PARSER_VERSION = "v2";

const HEADER_ALIASES = {
  user: ["المستخدم"],
  net: ["الصافى", "الصافي"],
  tax: ["ض.إضافة", "ض.اضافة"],
  expenses: ["مصاريف"],
  discount_percent: ["خصم %"],
  discount_value: ["خصم قيمة"],
  return_value: ["ق.المرتجع"],
  invoice_value: ["ق.الفاتورة"],
  count: ["العدد"],
  serial: ["مسلسل"],
  date: ["التاريخ"],
};

const REQUIRED = ["invoice_value", "serial", "date"];

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function headerKey(value) {
  const v = text(value);
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(v)) return key;
  }
  return null;
}

function detectHeader(row) {
  const map = {};
  row.forEach((cell, index) => {
    const key = headerKey(cell);
    if (key) map[key] = index;
  });
  return REQUIRED.every((key) => Number.isInteger(map[key])) ? map : null;
}

function isPaymentLabel(value) {
  const v = text(value);
  return v === "آجل" || v === "اجل" || v === "نقدى" || v === "نقدي";
}

function normalizePayment(value) {
  const v = text(value);
  if (v === "اجل") return "آجل";
  if (v === "نقدي") return "نقدى";
  return v || null;
}

function parseExcelDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const pad = (n) => String(n).padStart(2, "0");
      return `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)} ${pad(parsed.H)}:${pad(parsed.M)}:${pad(parsed.S)}`;
    }
  }
  return text(value) || null;
}

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function looksLikeInvoice(row, map) {
  const serial = row[map.serial];
  const value = row[map.invoice_value];
  return text(serial) !== "" && number(serial) !== null && number(value) !== null;
}

export function parseBConnectRows(rows) {
  const invoices = [];
  const warnings = [];
  const invalidInvoiceRows = [];
  let supplier = null;
  let branch = null;
  let payment_type = null;
  let header = null;
  let headerCount = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    const detected = detectHeader(row);
    if (detected) {
      header = detected;
      headerCount += 1;
      continue;
    }

    const nonEmpty = row.map(text).filter(Boolean);
    if (!nonEmpty.length) continue;

    // A numeric invoice serial identifies a candidate even if its amount is corrupt.
    // Never silently discard it as a supplier/subtotal row.
    if (header && text(row[header.serial]) && number(row[header.serial]) !== null && !looksLikeInvoice(row, header)) {
      invalidInvoiceRows.push(i + 1);
      continue;
    }

    // Supplier/branch/payment labels occur outside invoice tables in the B-Connect report.
    if (!header || !looksLikeInvoice(row, header)) {
      // Supplier groups are structural rows: <supplier name> | موردين.
      // Resolve and stop on this row BEFORE branch detection: a supplier may itself
      // contain a branch-looking phrase such as "دواء الشامي".
      const supplierTypeIndex = nonEmpty.findIndex((v) => v === "موردين");
      if (supplierTypeIndex > 0) {
        supplier = nonEmpty[supplierTypeIndex - 1];
        continue;
      }

      const payment = nonEmpty.find(isPaymentLabel);
      if (payment) payment_type = normalizePayment(payment);

      // Only explicit branch/report labels are accepted as branch evidence.
      const branchCandidate = nonEmpty.find((v) => /فرع\s*شكري|فرع\s*الشامي/.test(v));
      if (branchCandidate) branch = branchCandidate;

      // Retain the legacy one-cell supplier form only when it cannot be confused
      // with payment, totals, report captions, or an explicit branch row.
      if (
        nonEmpty.length === 1 &&
        !isPaymentLabel(nonEmpty[0]) &&
        !branchCandidate &&
        !/تم الإسترجاع|تم الاسترجاع|الإجمالي|الاجمالي|إجمـــالى/.test(nonEmpty[0])
      ) {
        supplier = nonEmpty[0];
      }
      continue;
    }

    invoices.push({
      row_number: i + 1,
      supplier,
      branch,
      payment_type,
      user: text(row[header.user]) || null,
      net: number(row[header.net]),
      tax: number(row[header.tax]),
      expenses: number(row[header.expenses]),
      discount_percent: number(row[header.discount_percent]),
      discount_value: number(row[header.discount_value]),
      return_value: number(row[header.return_value]),
      invoice_value: number(row[header.invoice_value]),
      count: number(row[header.count]),
      serial: text(row[header.serial]) || null,
      date: parseExcelDate(row[header.date]),
    });
  }

  if (invalidInvoiceRows.length) warnings.push(`صفوف فواتير ذات قيم غير صالحة: ${invalidInvoiceRows.join("، ")}. لا يمكن اعتماد الملف قبل تصحيحها.`);
  if (!headerCount) warnings.push("لم يتم العثور على رأس جدول فواتير B-Connect المعتمد.");
  if (!invoices.length) warnings.push("لم يتم العثور على أي صف فاتورة صالح.");

  return {
    valid: headerCount > 0 && invoices.length > 0 && invalidInvoiceRows.length === 0,
    invoices,
    warnings,
    meta: { parser_version: BCONNECT_PARSER_VERSION, header_sections: headerCount, invoice_count: invoices.length, invalid_invoice_rows: invalidInvoiceRows },
  };
}

export function parseBConnectWorkbook(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { valid: false, invoices: [], warnings: ["الملف لا يحتوي على أي Sheet."], meta: {} };
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const result = parseBConnectRows(rows);
  return { ...result, meta: { ...result.meta, sheet_name: sheetName } };
}
