import * as XLSX from "xlsx";

export const BCONNECT_PARSER_VERSION = "v3";

const HEADER_ALIASES = {
  user: ["المستخدم", "مستخدم"],
  net: ["الصافى", "الصافي", "صافى الفاتورة", "صافي الفاتورة"],
  tax: ["ض.إضافة", "ض.اضافة"],
  expenses: ["مصاريف"],
  discount_percent: ["خصم %", "ن.خصم"],
  discount_value: ["خصم قيمة", "ق.الخصم"],
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

function normalizeLocationName(value) {
  return text(value)
    .replace(/[أإآ]/g, "ا")
    .replace(/[ة]/g, "ه")
    .replace(/[ـ]/g, "")
    .replace(/[.،,:;\\/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferBranchFromBConnectLocation(value) {
  const normalized = normalizeLocationName(value);
  if (!normalized) return null;

  // Internal warehouse names used by the two pharmacy branches.
  if (/مخزن\s+(?:د|دكتور)?\s*وائل(?:\s|$)/u.test(normalized)) return "دواء شكري";
  if (/مخزن\s+(?:د|دكتور)?\s*معاذ(?:\s|$)/u.test(normalized)) return "دواء الشامي";

  // Real B-Connect exports also use these branch/warehouse captions.
  if (/(?:الاداره\s+)?فرع\s*شكري(?:\s|$)/u.test(normalized)) return "دواء شكري";
  if (/(?:الفرعيه\s+الشامي|فرع\s*الشامي)(?:\s|$)/u.test(normalized)) return "دواء الشامي";

  return null;
}

// Kept for compatibility with callers/tests from parser v2. A supplier name by
// itself is not branch evidence; this only succeeds when the supplied text is
// actually one of our explicit warehouse/location labels.
export function inferBranchFromBConnectSupplier(value) {
  return inferBranchFromBConnectLocation(value);
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
    const parsed = (XLSX.SSF ?? XLSX.default?.SSF)?.parse_date_code?.(value);
    if (parsed) {
      const pad = (n) => String(n).padStart(2, "0");
      const day = `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`;
      // Whole-day Excel serials do not prove a recorded clock time.
      // Do not turn an absent time into an invented 12:00 AM.
      if (Math.abs(value - Math.round(value)) < 1e-9) return day;
      return `${day} ${pad(parsed.H)}:${pad(parsed.M)}:${pad(parsed.S)}`;
    }
  }
  const raw = text(value);
  if (!raw) return null;
  // B-Connect exports dates as YYYY-MM-DD or DD/MM/YYYY (optionally with time).
  // Reject arbitrary text: it is not evidence of a dated invoice.
  const match = raw.match(new RegExp('^([0-9]{4})[-/]([0-9]{1,2})[-/]([0-9]{1,2})(?:[ T]([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?)?$'))
    || raw.match(new RegExp('^([0-9]{1,2})[-/]([0-9]{1,2})[-/]([0-9]{4})(?:[ T]([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?)?$'));
  if (!match) return null;
  const yearFirst = match[1].length === 4;
  const year = Number(yearFirst ? match[1] : match[3]);
  const month = Number(match[2]);
  const day = Number(yearFirst ? match[3] : match[1]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  return raw;
}

function number(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function looksLikeInvoice(row, map) {
  const serial = row[map.serial];
  const value = row[map.invoice_value];
  return text(serial) !== "" && number(serial) !== null && number(value) !== null && parseExcelDate(row[map.date]) !== null;
}


// Detailed exports put invoice values 12 columns to the right of repeated
// label headers, followed by item details and a closing invoice subtotal.
function isDetailedInvoiceHeader(row) {
  const map = detectHeader(row);
  return !!map && text(row[0]) === "ملاحظات" &&
    ["إسم المورد", "اسم المورد"].includes(text(row[8])) &&
    ["ك.المورد", "كود المورد"].includes(text(row[9])) &&
    text(row[37]) === "الإسم" && text(row[38]) === "الكود";
}

function isDetailedInvoiceSubtotal(row) {
  return /^ال[اإ]جمال[يى]$/u.test(text(row[6])) &&
    text(row[8]) === "عدد الأصناف" && text(row[10]) === "رقم فاتورة المورد";
}

// The item block is positional in B-Connect's detailed export. The labels
// at X:Y on its repeated header describe the *item* values in columns A:P,
// not extra invoice header fields. Retain each source row as read-only proof.
function readDetailedInvoiceItem(row, rowNumber) {
  const purchasedQuantity = number(row[11]);
  const returnedQuantity = number(row[9]);
  const returnTotal = number(row[16]);
  return {
    row_number: rowNumber,
    name: text(row[14]) || null,
    code: text(row[15]) || null,
    purchased_quantity: purchasedQuantity,
    bonus_quantity: number(row[10]),
    returned_quantity: returnedQuantity,
    net_quantity: purchasedQuantity === null || returnedQuantity === null
      ? null : Number((purchasedQuantity - returnedQuantity).toPrecision(12)),
    purchase_unit_price: number(row[5]),
    purchase_total: number(row[4]),
    return_unit_price: number(row[8]),
    return_total: returnTotal,
    source_item_reference: text(row[13]) || null,
    expiration: row[12] == null || row[12] === '' ? null : parseExcelDate(row[12]),
  };
}

function parseDetailedBConnectRows(rows) {
  const invoices = [];
  const invalidInvoiceRows = [];
  const unrecognizedRows = [];
  let branch = null;
  let payment_type = null;
  let active = null;
  let headerCount = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    const cells = row.map(text).filter(Boolean);
    if (!cells.length) continue;
    // Read branch/payment ONLY from report section rows. Supplier names and
    // medicine names can contain a branch caption and must not mutate scope.
    const isHeader = isDetailedInvoiceHeader(row);
    const structuralRow = !active && !isHeader && !isDetailedInvoiceSubtotal(row);
    const inferredBranch = structuralRow ? cells.map(inferBranchFromBConnectLocation).find(Boolean) : null;
    if (inferredBranch) branch = inferredBranch;
    const payment = structuralRow ? cells.find(isPaymentLabel) : null;
    if (payment) payment_type = normalizePayment(payment);

    if (isHeader) {
      headerCount += 1;
      if (active) invalidInvoiceRows.push(active.row_number);
      const labels = detectHeader(row);
      const field = (key) => Number.isInteger(labels[key]) ? row[labels[key] + 12] : null;
      const supplier = text(row[20]) || null;
      const rawSerial = text(field("serial"));
      const invoiceValue = number(field("invoice_value"));
      const invoiceDate = parseExcelDate(field("date"));
      const valid = /^[0-9]+$/u.test(rawSerial) && Number.isSafeInteger(Number(rawSerial)) &&
        Number(rawSerial) > 0 && invoiceValue !== null && invoiceDate !== null && !!supplier && !!branch;
      if (!valid) invalidInvoiceRows.push(i + 1);
      const invoice = valid ? {
        row_number: i + 1, supplier, branch, payment_type,
        user: text(field("user")) || null,
        net: number(field("net")), tax: number(field("tax")),
        expenses: number(field("expenses")),
        discount_percent: number(field("discount_percent")),
        discount_value: number(field("discount_value")),
        return_value: null,
        invoice_value: invoiceValue, count: null,
        serial: rawSerial, date: invoiceDate,
      } : null;
      active = { row_number: i + 1, serial: rawSerial, invoice, itemLines: 0, items: [] };
      continue;
    }

    if (isDetailedInvoiceSubtotal(row)) {
      if (!active) {
        unrecognizedRows.push(i + 1);
        continue;
      }
      // Column J is the SUPPLIER'S invoice number; the program serial lives
      // in column X of the preceding header. They must not be compared.
      const supplierInvoiceNumber = text(row[9]) || null;
      const itemCount = number(row[7]);
      if (itemCount === null || !Number.isSafeInteger(itemCount) ||
          itemCount < 0 || itemCount !== active.itemLines) {
        invalidInvoiceRows.push(i + 1);
      } else if (active.invoice) {
        active.invoice.supplier_invoice_number = supplierInvoiceNumber;
        active.invoice.count = itemCount;
        active.invoice.items = active.items;
        active.invoice.returned_items_count = active.items.filter((item) => (item.returned_quantity || 0) > 0).length;
        // Keep the source's financial columns, not a reconstructed estimate.
        // The returned total is the sum of explicit per-item return totals.
        active.invoice.return_value = Number(active.items.reduce(
          (sum, item) => sum + (item.return_total || 0), 0
        ).toPrecision(12));
        const detailTotal = number(row[3]);
        active.invoice.detail_total = detailTotal;
        active.invoice.detail_total_difference = detailTotal === null ? null :
          Number((detailTotal - active.invoice.invoice_value).toFixed(3));
        invoices.push(active.invoice);
      }
      active = null;
      continue;
    }

    if (active) {
      if (!text(row[14]) || !text(row[15])) {
        unrecognizedRows.push(i + 1);
      } else {
        const item = readDetailedInvoiceItem(row, i + 1);
        active.itemLines += 1;
        active.items.push(item);
        // A nonzero returned quantity without a returned monetary value is
        // incomplete financial evidence: don't silently count it as zero.
        if (((item.returned_quantity || 0) > 0 &&
              (item.return_total === null || item.return_total < 0 ||
               item.purchased_quantity === null)) ||
            ((item.return_total || 0) > 0 && !(item.returned_quantity > 0))) {
          invalidInvoiceRows.push(i + 1);
        }
      }
      continue;
    }

    if (inferredBranch || payment ||
        cells.some((cell) => /^(?:تم ال[اإ]سترجاع حسب:|Page -|Copyright|وقت الطباعة)/u.test(cell)) ||
        cells.some((cell) => /^(?:صافى الفواتير|صافي الفواتير|قيمة الفواتير|قيمة الربح|الإجم|الاجم)/u.test(cell))) continue;
    unrecognizedRows.push(i + 1);
  }

  if (active) invalidInvoiceRows.push(active.row_number);
  const invalid = [...new Set(invalidInvoiceRows)];
  const warnings = [];
  if (invalid.length) warnings.push("صفوف فواتير تفصيلية غير صالحة أو غير مكتملة: " + invalid.join("، ") + ". يجب مراجعتها قبل المطابقة.");
  if (unrecognizedRows.length) warnings.push("صفوف غير معروفة في تقرير الفواتير التفصيلي: " + unrecognizedRows.join("، ") + ".");
  if (!invoices.length) warnings.push("لم يتم العثور على فواتير تفصيلية مكتملة.");
  return {
    valid: headerCount > 0 && invoices.length === headerCount && !invalid.length && !unrecognizedRows.length,
    invoices, warnings,
    meta: {
      parser_version: "v4-detailed", report_format: "invoice-with-item-details",
      header_sections: headerCount, invoice_count: invoices.length,
      item_line_count: invoices.reduce((sum, invoice) => sum + (invoice.items?.length || 0), 0),
      returned_item_line_count: invoices.reduce((sum, invoice) => sum + (invoice.returned_items_count || 0), 0),
      return_value_total: Number(invoices.reduce((sum, invoice) => sum + (invoice.return_value || 0), 0).toPrecision(12)),
      invalid_invoice_rows: invalid, unrecognized_rows: unrecognizedRows,
    },
  };
}

export function parseBConnectRows(rows) {
  if (rows.some((row) => Array.isArray(row) && isDetailedInvoiceHeader(row))) return parseDetailedBConnectRows(rows);
  const invoices = [];
  const warnings = [];
  const invalidInvoiceRows = [];
  let supplier = null;
  let branch = null;
  let payment_type = null;
  let header = null;
  let headerCount = 0;
  const unrecognizedRows = [];

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

    // B-Connect subtotal/grand-total rows reuse numeric invoice columns. Their
    // explicit total label must take precedence over invoice-candidate checks.
    // Check the report's invoice-value column, not arbitrary supplier names.
    if (header && /^(?:إجم[اأإـ]*ل[يى]|ال[اإ]جمال[يى])\s*:/u.test(text(row[header.invoice_value]))) continue;

    // B-Connect print footer carries numeric timestamps in unrelated columns.
    if (nonEmpty.some((v) => /^(?:ملحوظة:|Page -|Copyright B-Connect|وقت الطباعة)/u.test(v))) continue;

    // A numeric invoice serial identifies a candidate even if its amount is corrupt.
    // Never silently discard it as a supplier/subtotal row.
    const hasSerial = header && text(row[header.serial]) !== "";
    const hasAmountAndDate = header && text(row[header.invoice_value]) !== "" && text(row[header.date]) !== "";
    if (header && (hasSerial || hasAmountAndDate) && !looksLikeInvoice(row, header)) {
      invalidInvoiceRows.push(i + 1);
      continue;
    }

    // Supplier/branch/payment labels occur outside invoice tables in the B-Connect report.
    if (!header || !looksLikeInvoice(row, header)) {
      // Branch evidence can appear in the report caption itself ("المخزن ...")
      // or in the warehouse/payment row immediately before the table. Normalize
      // all known real export labels to the application's canonical branch names.
      const inferredLocationBranch = nonEmpty
        .map((value) => inferBranchFromBConnectLocation(value))
        .find(Boolean);
      if (inferredLocationBranch) branch = inferredLocationBranch;

      // Supplier groups are structural rows: <supplier name> | موردين.
      // Resolve and stop on this row BEFORE any legacy single-cell supplier logic:
      // a supplier may itself contain a branch-looking phrase such as "دواء الشامي".
      const supplierTypeIndex = nonEmpty.findIndex((v) => v === "موردين");
      if (supplierTypeIndex > 0) {
        supplier = nonEmpty[supplierTypeIndex - 1];
        continue;
      }

      const payment = nonEmpty.find(isPaymentLabel);
      if (payment) payment_type = normalizePayment(payment);

      // Retain the legacy one-cell supplier form only when it cannot be confused
      // with payment, totals, report captions, or an explicit warehouse/location row.
      if (
        nonEmpty.length === 1 &&
        !isPaymentLabel(nonEmpty[0]) &&
        !inferredLocationBranch &&
        !/تم الإسترجاع|تم الاسترجاع|الإجمالي|الاجمالي|إجمـــالى/.test(nonEmpty[0])
      ) {
        supplier = nonEmpty[0];
      }
      // A populated row inside an invoice table that is neither a known
      // structural label nor a valid invoice must not disappear silently.
      if (header && !payment && !inferredLocationBranch && nonEmpty.length > 1) {
        unrecognizedRows.push(i + 1);
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

  if (unrecognizedRows.length) warnings.push(`صفوف غير معروفة داخل التقرير: ${unrecognizedRows.join("، ")}. راجع بنية الملف قبل الاعتماد.`);
  if (invalidInvoiceRows.length) warnings.push(`صفوف فواتير ذات قيم غير صالحة: ${invalidInvoiceRows.join("، ")}. لا يمكن اعتماد الملف قبل تصحيحها.`);
  if (!headerCount) warnings.push("لم يتم العثور على رأس جدول فواتير B-Connect المعتمد.");
  if (!invoices.length) warnings.push("لم يتم العثور على أي صف فاتورة صالح.");

  return {
    valid: headerCount > 0 && invoices.length > 0 && invalidInvoiceRows.length === 0 && unrecognizedRows.length === 0,
    invoices,
    warnings,
    meta: { parser_version: BCONNECT_PARSER_VERSION, header_sections: headerCount, invoice_count: invoices.length, invalid_invoice_rows: invalidInvoiceRows, unrecognized_rows: unrecognizedRows },
  };
}

export function parseBConnectWorkbook(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { valid: false, invoices: [], warnings: ["الملف لا يحتوي على أي Sheet."], meta: {} };
  // Never silently ignore additional populated worksheets: they may contain invoices.
  const extraSheets = workbook.SheetNames.slice(1).filter((name) => {
    const cells = workbook.Sheets[name];
    return cells && Object.keys(cells).some((key) => !key.startsWith("!") && cells[key]?.v != null && String(cells[key].v).trim() !== "");
  });
  if (extraSheets.length) {
    return {
      valid: false, invoices: [],
      warnings: [`الملف يحتوي على Sheets إضافية بها بيانات: ${extraSheets.join("، ")}. لا يمكن تجاهلها أثناء المطابقة؛ صدّر تقريرًا بورقة واحدة أو راجع الأوراق أولًا.`],
      meta: { sheet_name: sheetName, additional_populated_sheets: extraSheets },
    };
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const result = parseBConnectRows(rows);
  return { ...result, meta: { ...result.meta, sheet_name: sheetName } };
}
