function clean(value) {
  return String(value ?? '').trim();
}

function numberOrZero(value, label, rowNo) {
  if (value == null || value === '') return 0;
  const normalized = typeof value === 'string' ? value.replace(/,/g, '').trim() : value;
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`قيمة ${label} غير صالحة في الصف ${rowNo}.`);
  }
  return number;
}

function monthKey(value) {
  const match = clean(value).match(/^(20\d{2})[\/-](0?[1-9]|1[0-2])$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number(match[2]);
}

function previousMonthKey(key) {
  const year = Math.floor(key / 100);
  const month = key % 100;
  return month === 1 ? (year - 1) * 100 + 12 : year * 100 + (month - 1);
}

export function normalizeMovementWorkbookRows(rows, fileName = '') {
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error('ملف حركة المبيعات فارغ أو غير صالح.');
  }

  const headers = rows[0].map(clean);
  const codeIndex = headers.findIndex((h) => ['الكود', 'كود الصنف'].includes(h));
  const nameIndex = headers.findIndex((h) => ['الإسم', 'الاسم', 'إسم الصنف', 'اسم الصنف'].includes(h));
  const months = headers
    .map((header, index) => ({ header, index, key: monthKey(header) }))
    .filter((item) => item.key != null)
    .sort((a, b) => b.key - a.key)
    .slice(0, 3);

  if (codeIndex < 0 || nameIndex < 0 || months.length < 3) {
    throw new Error('الملف لازم يحتوي على الكود والاسم وثلاثة أعمدة شهرية متتالية.');
  }

  if (months[1].key !== previousMonthKey(months[0].key) || months[2].key !== previousMonthKey(months[1].key)) {
    throw new Error('أعمدة حركة المبيعات لازم تكون أحدث 3 شهور متتالية.');
  }

  const seen = new Set();
  const output = [];

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const rowNo = index + 1;
    const productCode = clean(row[codeIndex]).replace(/\.0+$/, '');
    const productName = clean(row[nameIndex]);

    // Ignore truly blank/report footer rows, but never silently drop a malformed product row.
    const joinedRow = row.map(clean).join(' ');
    if (!productCode && !productName && (!joinedRow || /عدد الأصناف|page\s*-?\d+|وقت الطباعة|copyright/i.test(joinedRow))) continue;
    if (/عدد الأصناف|page\s*-?\d+|وقت الطباعة|copyright/i.test(joinedRow) && !productCode) continue;
    if (!productCode) throw new Error(`كود الصنف مفقود في الصف ${rowNo}.`);
    if (!productName) throw new Error(`اسم الصنف مفقود في الصف ${rowNo}.`);

    if (seen.has(productCode)) {
      throw new Error(`الكود ${productCode} مكرر داخل ملف الحركة.`);
    }
    seen.add(productCode);

    const m0 = numberOrZero(row[months[0].index], months[0].header, rowNo);
    const m1 = numberOrZero(row[months[1].index], months[1].header, rowNo);
    const m2 = numberOrZero(row[months[2].index], months[2].header, rowNo);

    output.push({
      row_no: output.length + 1,
      product_code: productCode,
      product_name: productName,
      sales_30: m0,
      sales_60: m0 + m1,
      sales_90: m0 + m1 + m2,
    });
  }

  if (output.length === 0) throw new Error('لم يتم العثور على أصناف حركة صالحة داخل الملف.');

  return {
    file_name: fileName,
    months: months.map((item) => item.header),
    rows: output,
    totals: output.reduce((sum, row) => ({
      sales_30: sum.sales_30 + row.sales_30,
      sales_60: sum.sales_60 + row.sales_60,
      sales_90: sum.sales_90 + row.sales_90,
    }), { sales_30: 0, sales_60: 0, sales_90: 0 }),
  };
}
