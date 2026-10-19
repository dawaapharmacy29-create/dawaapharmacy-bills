import test from "node:test";
import assert from "node:assert/strict";
import { parseBConnectRows, parseBConnectWorkbook } from "../src/lib/bconnectPurchaseInvoiceParser.js";
import * as XLSX from "xlsx";

test("parses hierarchical B-Connect invoice sections without treating subtotals as invoices", () => {
  const rows = [
    ["تم الإسترجاع حسب: تاريخ الإنشاء"],
    ["المتحدة المنصورة للتوزيع","موردين"],
    ["الادارة فرع شكري", "آجل"],
    ["المستخدم","الصافى","ض.إضافة","مصاريف","خصم %","خصم قيمة","ق.المرتجع","ق.الفاتورة","العدد","مسلسل","التاريخ"],
    ["د وائل",842.72,0,0,0,0,0,842.72,3,19526,"2026-10-06 01:23:40"],
    ["د وائل",411.483,0,0,0,0,0,411.483,4,19527,"2026-10-06 01:28:35"],
    [null,1254.203],
    ["دواء الشامي","موردين"],
    ["آجل"],
    ["المستخدم","الصافى","ض.إضافة","مصاريف","خصم %","خصم قيمة","ق.المرتجع","ق.الفاتورة","العدد","مسلسل","التاريخ"],
    ["د محمد شبل",157.25,0,0,0,0,0,157.25,1,19519,"2026-10-06 00:00:45"],
  ];
  const result = parseBConnectRows(rows);
  assert.equal(result.valid, true);
  assert.equal(result.invoices.length, 3);
  assert.equal(result.invoices[1].serial, "19527");
  assert.equal(result.invoices[1].invoice_value, 411.483);
  assert.equal(result.invoices[1].supplier, "المتحدة المنصورة للتوزيع");
  assert.equal(result.invoices[1].branch, "دواء شكري");
  assert.equal(result.invoices[2].supplier, "دواء الشامي");
  assert.equal(result.invoices[2].branch, "دواء شكري");
});

test("fails closed when required invoice headers are absent", () => {
  const result = parseBConnectRows([["مورد"], ["قيمة", "تاريخ"]]);
  assert.equal(result.valid, false);
  assert.equal(result.invoices.length, 0);
  assert.ok(result.warnings.length > 0);
});


test("golden report shape keeps all 11 invoices under Shokry and preserves exact financial total", () => {
  const H = ["المستخدم","الصافى","ض.إضافة","مصاريف","خصم %","خصم قيمة","ق.المرتجع","ق.الفاتورة","العدد","مسلسل","التاريخ"];
  const invoice = (user, value, count, serial, time) => [user,value,0,0,0,0,0,value,count,serial,`2026-10-06 ${time}`];
  const rows = [
    ["تم الإسترجاع حسب: تاريخ الإنشاء"],
    ["المتحدة المنصورة للتوزيع","موردين"], ["الادارة فرع شكري","آجل"], H,
    invoice("د وائل",842.72,3,19526,"01:23:40"), invoice("د وائل",411.483,4,19527,"01:28:35"), [null,1254.203],
    ["دواء الشامي","موردين"], ["الادارة فرع شكري","آجل"], H,
    invoice("د محمد شبل",157.25,1,19519,"00:00:45"), invoice("د عمر",144.5,1,19522,"00:26:25"),
    invoice("د عمر",136,1,19525,"00:51:57"), invoice("د محمد شبل",864,1,19528,"02:57:33"),
    invoice("د محمد شبل",122.43,1,19529,"05:51:26"), [null,1424.18],
    ["صيدليات","موردين"], ["الادارة فرع شكري","نقدى"], H, invoice("د محمد شبل",24,1,19520,"00:10:31"), [null,24],
    ["فارما اوفر سيز","موردين"], ["الادارة فرع شكري","آجل"], H, invoice("د وائل",484,1,19523,"00:31:14"), [null,484],
    ["مخزن الحياه","موردين"], ["الادارة فرع شكري","آجل"], H,
    invoice("د محمد شبل",300,1,19521,"00:13:08"), invoice("د عمر",2720,1,19524,"00:44:30"), [null,3020],
    [null,6206.383],
  ];
  const result = parseBConnectRows(rows);
  assert.equal(result.valid, true);
  assert.equal(result.meta.parser_version, "v3");
  assert.equal(result.invoices.length, 11);
  assert.equal(new Set(result.invoices.map((row) => row.serial)).size, 11);
  assert.ok(result.invoices.every((row) => row.branch === "دواء شكري"));
  assert.equal(result.invoices.find((row) => row.serial === "19519").supplier, "دواء الشامي");
  assert.equal(Math.round(result.invoices.reduce((sum, row) => sum + row.invoice_value, 0) * 1000) / 1000, 6206.383);
});

test("supplier names that look like branches never overwrite branch context", () => {
  const rows = [
    ["الادارة فرع شكري","آجل"],
    ["دواء الشامي","موردين"],
    ["المستخدم","الصافى","ض.إضافة","مصاريف","خصم %","خصم قيمة","ق.المرتجع","ق.الفاتورة","العدد","مسلسل","التاريخ"],
    ["د عمر",136,0,0,0,0,0,136,1,19525,"2026-10-06 00:51:57"],
  ];
  const result = parseBConnectRows(rows);
  assert.equal(result.invoices[0].supplier, "دواء الشامي");
  assert.equal(result.invoices[0].branch, "دواء شكري");
});

test("corrupt invoice amount blocks the whole report rather than disappearing", () => {
  const rows = [
    ["الادارة فرع شكري", "آجل"],
    ["المستخدم","ق.الفاتورة","مسلسل","التاريخ"],
    ["د وائل", 100, 19526, "2026-10-06"],
    ["د وائل", "not-a-number", 19527, "2026-10-06"],
  ];
  const result = parseBConnectRows(rows);
  assert.equal(result.valid, false);
  assert.equal(result.invoices.length, 1);
  assert.deepEqual(result.meta.invalid_invoice_rows, [4]);
  assert.ok(result.warnings.some((warning) => warning.includes("4")));
});

test("missing or invalid invoice serial blocks the report without treating subtotals as invoices", () => {
  const rows = [
    ["المستخدم","ق.الفاتورة","مسلسل","التاريخ"],
    ["د وائل",100,19526,"2026-10-06"],
    ["د وائل",200,null,"2026-10-06"],
    ["د وائل",300,"not-a-serial","2026-10-06"],
    [null,600,null,null],
  ];
  const result=parseBConnectRows(rows);
  assert.equal(result.valid,false);
  assert.equal(result.invoices.length,1);
  assert.deepEqual(result.meta.invalid_invoice_rows,[3,4]);
});

test("whitespace-only amount is invalid, never a zero-valued invoice", () => {
  const rows=[
    ["المستخدم","ق.الفاتورة","مسلسل","التاريخ"],
    ["د وائل","   ",19526,"2026-10-06"],
  ];
  const result=parseBConnectRows(rows);
  assert.equal(result.valid,false);
  assert.deepEqual(result.meta.invalid_invoice_rows,[2]);
});


test("real B-Connect subtotal rows with numeric serial-position totals are not corrupt invoices", () => {
  const H = ["المستخدم","الصافى","ض.إضافة","مصاريف","خصم %","خصم قيمة","ق.المرتجع","ق.الفاتورة","العدد","مسلسل","التاريخ"];
  const subtotal = (amount, label) => [amount,0,0,0,0,amount,label,"إجمـــالى:",amount,"إجمالى المورد النهائى"];
  const rows = [H,
    ["د وائل",842.72,0,0,0,0,0,842.72,3,19526,"2026-10-06"],
    subtotal(1254.203,"المتحدة المنصورة للتوزيع"),
    subtotal(1424.18,"دواء الشامي"),
    subtotal(24,"صيدليات"),
    subtotal(484,"فارما اوفر سيز"),
    subtotal(3020,"مخزن الحياه"),
    [6206.383,0,0,0,0,6206.383,11,"الإجمالى :",6206.383,"الإجمالى النهائى"],
  ];
  const result = parseBConnectRows(rows);
  assert.equal(result.valid, true);
  assert.deepEqual(result.meta.invalid_invoice_rows, []);
  assert.equal(result.invoices.length, 1);
  assert.equal(result.invoices[0].serial, "19526");
});


test("invoice with a valid serial and amount but missing date fails closed", () => {
  const rows = [
    ["المستخدم", "ق.الفاتورة", "مسلسل", "التاريخ"],
    ["د وائل", 842.72, 19526, "2026-10-06"],
    ["د وائل", 411.483, 19527, null],
  ];
  const result = parseBConnectRows(rows);
  assert.equal(result.valid, false);
  assert.equal(result.invoices.length, 1);
  assert.deepEqual(result.meta.invalid_invoice_rows, [3]);
});

test("real report payment, branch, supplier and print footer rows are never invoices", () => {
  const H = ["المستخدم","الصافى","ض.إضافة","مصاريف","خصم %","خصم قيمة","ق.المرتجع","ق.الفاتورة","العدد","مسلسل","التاريخ"];
  const rows = [
    ["تم الإسترجاع حسب: تاريخ الإنشاء , المخزن الادارة فرع شكري"],
    ["المتحدة المنصورة للتوزيع", "موردين"],
    ["الادارة فرع شكري", "آجل"], H,
    ["د وائل",842.72,0,0,0,0,0,842.72,3,19526,"2026-10-06"],
    [1254.203,0,0,0,0,1254.203,"آجل","إجمـــالى:"],
    [1254.203,0,0,0,0,1254.203,"الادارة فرع شكري","إجمـــالى:"],
    [1254.203,0,0,0,0,1254.203,"المتحدة المنصورة للتوزيع","إجمـــالى:",1254.203,"إجمالى المورد النهائى"],
    ["ملحوظة: تم أسترجاع مرتجع الفواتير فقط","E-pharmacy Plus","-","Page -1 of 1","Copyright B-Connect",46301,0.324386574,"وقت الطباعة"],
  ];
  const result = parseBConnectRows(rows);
  assert.equal(result.valid, true);
  assert.equal(result.invoices.length, 1);
  assert.deepEqual(result.meta.invalid_invoice_rows, []);
  assert.equal(result.invoices[0].supplier, "المتحدة المنصورة للتوزيع");
  assert.equal(result.invoices[0].branch, "دواء شكري");
});


test("invoice date must be a real calendar date, not arbitrary nonempty text", () => {
  const H = ["المستخدم", "ق.الفاتورة", "مسلسل", "التاريخ"];
  const rows = [H,
    ["د وائل", 100, 19526, "2026-10-06 01:23:40"],
    ["د وائل", 100, 19527, "تاريخ غير صالح"],
    ["د وائل", 100, 19528, "2026-02-30"],
    ["د وائل", 100, 19529, "2026-10-06 25:00:00"],
  ];
  const result = parseBConnectRows(rows);
  assert.equal(result.valid, false);
  assert.equal(result.invoices.length, 1);
  assert.deepEqual(result.meta.invalid_invoice_rows, [3,4,5]);
});

test("accepts day-first B-Connect dates with valid times", () => {
  const rows = [
    ["المستخدم", "ق.الفاتورة", "مسلسل", "التاريخ"],
    ["د وائل", 100, 19526, "06/10/2026 01:23:40"],
  ];
  const result = parseBConnectRows(rows);
  assert.equal(result.valid, true);
  assert.equal(result.invoices[0].date, "06/10/2026 01:23:40");
});


test("populated additional Excel worksheets cannot be silently ignored", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["المستخدم", "ق.الفاتورة", "مسلسل", "التاريخ"],
    ["د وائل", 100, 19526, "2026-10-06"],
  ]), "فواتير");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["فاتورة إضافية", 19527]]), "فواتير أخرى");
  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const result = parseBConnectWorkbook(buffer);
  assert.equal(result.valid, false);
  assert.equal(result.invoices.length, 0);
  assert.deepEqual(result.meta.additional_populated_sheets, ["فواتير أخرى"]);
});

test("blank additional worksheets do not prevent a complete invoice report", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["المستخدم", "ق.الفاتورة", "مسلسل", "التاريخ"],
    ["د وائل", 100, 19526, "2026-10-06"],
  ]), "فواتير");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "فارغ");
  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const result = parseBConnectWorkbook(buffer);
  assert.equal(result.valid, true);
  assert.equal(result.invoices.length, 1);
});

test("real B-Connect layout with Excel serial dates, repeated headers and three subtotal tiers", () => {
  const H = ["المستخدم","الصافى","ض.إضافة","مصاريف","خصم %","خصم قيمة","ق.المرتجع","ق.الفاتورة","العدد","مسلسل","التاريخ"];
  const rows = [
    ["تم الإسترجاع حسب: تاريخ الإنشاء , المخزن الادارة فرع شكري"],
    ["المتحدة المنصورة للتوزيع","موردين"],["الادارة فرع شكري","آجل"],H,
    ["د وائل",842.72,0,0,0,0,0,842.72,3,19526,46301.0581018519],
    ["د وائل",411.483,0,0,0,0,0,411.483,4,19527,46301.0615162037],
    [1254.203,0,0,0,0,1254.203,"آجل","إجمـــالى:"],
    [1254.203,0,0,0,0,1254.203,"الادارة فرع شكري","إجمـــالى:"],
    [1254.203,0,0,0,0,1254.203,"المتحدة المنصورة للتوزيع","إجمـــالى:",1254.203,"إجمالى المورد النهائى"],
    ["دواء الشامي","موردين"],["الادارة فرع شكري","آجل"],H,
    ["د محمد شبل",157.25,0,0,0,0,0,157.25,1,19519,46301.0005208333],
    ["د عمر",144.5,0,0,0,0,0,144.5,1,19522,46301.0183449074],
    ["د عمر",136,0,0,0,0,0,136,1,19525,46301.0360763889],
    ["د محمد شبل",864,0,0,0,0,0,864,1,19528,46301.1232986111],
    ["د محمد شبل",122.43,0,0,0,0,0,122.43,1,19529,46301.2440509259],
    [1424.18,0,0,0,0,1424.18,"آجل","إجمـــالى:"],
    [1424.18,0,0,0,0,1424.18,"الادارة فرع شكري","إجمـــالى:"],
    [1424.18,0,0,0,0,1424.18,"دواء الشامي","إجمـــالى:",1424.18,"إجمالى المورد النهائى"],
    ["صيدليات","موردين"],["الادارة فرع شكري","نقدى"],H,
    ["د محمد شبل",24,0,0,0,0,0,24,1,19520,46301.0073032407],
    [24,0,0,0,0,24,"نقدى","إجمـــالى:"],
    [24,0,0,0,0,24,"الادارة فرع شكري","إجمـــالى:"],
    [24,0,0,0,0,24,"صيدليات","إجمـــالى:",24,"إجمالى المورد النهائى"],
    ["فارما اوفر سيز","موردين"],["الادارة فرع شكري","آجل"],H,
    ["د وائل",484,0,0,0,0,0,484,1,19523,46301.0216898148],
    [484,0,0,0,0,484,"آجل","إجمـــالى:"],
    [484,0,0,0,0,484,"الادارة فرع شكري","إجمـــالى:"],
    [484,0,0,0,0,484,"فارما اوفر سيز","إجمـــالى:",484,"إجمالى المورد النهائى"],
    ["مخزن الحياه","موردين"],["الادارة فرع شكري","آجل"],H,
    ["د محمد شبل",300,0,0,0,0,0,300,1,19521,46301.0091203704],
    ["د عمر",2720,0,0,0,0,0,2720,1,19524,46301.0309027778],
    [3020,0,0,0,0,3020,"آجل","إجمـــالى:"],
    [3020,0,0,0,0,3020,"الادارة فرع شكري","إجمـــالى:"],
    [3020,0,0,0,0,3020,"مخزن الحياه","إجمـــالى:",3020,"إجمالى المورد النهائى"],
    [6206.383,0,0,0,0,6206.383,"موردين","إجمـــالى:"],
    [6206.383,0,0,0,0,6206.383,11,"الإجمالى :",6206.383,"الإجمالى النهائى"],
    ["ملحوظة: تم أسترجاع مرتجع الفواتير فقط","E-pharmacy Plus","-","Page -1 of 1","Copyright B-Connect",46301,0.324386574,"وقت الطباعة"],
  ];
  const parsed = parseBConnectRows(rows);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.meta.header_sections, 5);
  assert.deepEqual(parsed.meta.invalid_invoice_rows, []);
  assert.equal(parsed.invoices.length, 11);
  assert.equal(new Set(parsed.invoices.map(x => x.serial)).size, 11);
  assert.equal(Math.round(parsed.invoices.reduce((sum,x) => sum + x.invoice_value, 0)*1000)/1000,6206.383);
  assert.equal(parsed.invoices.find(x => x.serial === "19527").date?.slice(0,10),"2026-10-06");
  assert.equal(parsed.invoices.find(x => x.serial === "19520").payment_type,"نقدى");
  assert.ok(parsed.invoices.every(x => x.branch === "دواء شكري" && x.supplier));
});


function makeDetailedHeader({ serial, supplier = "مورد تجريبي", date = 46304.5, amount = 120, user = "د اختبار" } = {}) {
  return [
    "ملاحظات", "مستخدم", "صافى الفاتورة", "ض.إضافة", "مصاريف", "ن.خصم",
    "ق.الخصم", "ق.الفاتورة", "إسم المورد", "ك.المورد", "التاريخ", "مسلسل",
    "16", user, amount, 0, 0, 0, 0, amount, supplier, "300", date, serial,
    "ن.الربح", "الربح", "خ.إضافى", "س.البيع", "إج.س.شراء",
    "س.شراء", "إج.ض.مبيعات", "ض.مبيعات", "سعر المرتجع",
    "كمية المرتجع", "بونص", "كمية", "ت.صلاحية", "الإسم", "الكود",
  ];
}
function makeDetailedItem(code = "12345") {
  const row = Array(39).fill(null);
  row[14] = "صنف اختباري";
  row[15] = code;
  return row;
}
function makeDetailedSubtotal(serial, count = 1, amount = 120) {
  return [20, 6, 100, amount, 0, 0, "الإجمالى", count,
    "عدد الأصناف", String(serial), "رقم فاتورة المورد",
    "*********************************************************************************"];
}

test("parses the detailed B-Connect purchase export as invoices, never as line items", () => {
  const rows = [
    ["تم الإسترجاع حسب: تاريخ الإنشاء , المخزن الفرعية الشامي"],
    ["الفرعية الشامي", "موردين"],
    ["آجل"],
    makeDetailedHeader({ serial: 11101 }),
    makeDetailedItem("47723"),
    makeDetailedSubtotal(11101),
    makeDetailedHeader({ serial: 11102, supplier: "مورد ثان", amount: 222 }),
    makeDetailedItem("66807"), makeDetailedItem("80458"),
    makeDetailedSubtotal(84025, 2, 222),
    [82000, "قيمة الربح", 150000, "صافى الفواتير"],
    ["نقدى"],
    makeDetailedHeader({ serial: 11103, amount: 50 }),
    makeDetailedItem("80458"),
    makeDetailedSubtotal(11103, 1, 50),
    ["Page -1 of 1", "ePlus", 46314, "-", 0.304, "وقت الطباعة ", "Copyright © B-Connect 2011"],
  ];
  const result = parseBConnectRows(rows);
  assert.equal(result.valid, true, result.warnings.join(" "));
  assert.equal(result.meta.report_format, "invoice-with-item-details");
  assert.equal(result.meta.header_sections, 3);
  assert.deepEqual(result.invoices.map(({ serial }) => serial), ["11101", "11102", "11103"]);
  assert.ok(result.invoices.every((invoice) => invoice.branch === "دواء الشامي"));
  assert.equal(result.invoices[1].invoice_value, 222);
  assert.equal(result.invoices[1].supplier, "مورد ثان");
  assert.equal(result.invoices[1].user, "د اختبار");
  assert.equal(result.invoices[1].net, 222);
  assert.equal(result.invoices[1].count, 2);
  assert.equal(result.invoices[1].supplier_invoice_number, "84025");
  assert.equal(result.invoices[0].payment_type, "آجل");
  assert.equal(result.invoices[2].payment_type, "نقدى");
});

test("fails closed on missing detailed invoice serial but accepts separate supplier invoice numbers", () => {
  const rows = [
    ["الفرعية الشامي", "موردين"],
    makeDetailedHeader({ serial: null }), makeDetailedItem(), makeDetailedSubtotal(11101),
    makeDetailedHeader({ serial: 11102 }), makeDetailedItem(), makeDetailedSubtotal(99999),
  ];
  const result = parseBConnectRows(rows);
  assert.equal(result.valid, false);
  assert.deepEqual(result.meta.invalid_invoice_rows, [2]);
  assert.equal(result.invoices.length, 1);
  assert.equal(result.invoices[0].serial, "11102");
  assert.equal(result.invoices[0].supplier_invoice_number, "99999");
});

test("fails closed on missing item code or incomplete detailed invoice section", () => {
  const rows = [
    ["الفرعية الشامي", "موردين"],
    makeDetailedHeader({ serial: 11102 }),
    ["صف غير معروف"],
  ];
  const result = parseBConnectRows(rows);
  assert.equal(result.valid, false);
  assert.deepEqual(result.meta.unrecognized_rows, [3]);
  assert.deepEqual(result.meta.invalid_invoice_rows, [2]);
});

test("reads detailed invoice blocks directly from a real-layout workbook", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["الفرعية الشامي", "موردين"],
    makeDetailedHeader({ serial: 11101, amount: 240 }),
    makeDetailedItem(), makeDetailedSubtotal(11101, 1, 240),
  ]), "Sheet1");
  const result = parseBConnectWorkbook(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
  assert.equal(result.valid, true, result.warnings.join(" "));
  assert.equal(result.invoices.length, 1);
  assert.equal(result.invoices[0].invoice_value, 240);
});


test("detailed subtotal with missing items blocks approval instead of silently accepting a partial invoice", () => {
  const result = parseBConnectRows([
    ["الفرعية الشامي", "موردين"],
    makeDetailedHeader({ serial: 11101 }), makeDetailedItem(), makeDetailedSubtotal(11101, 2),
  ]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.meta.invalid_invoice_rows, [4]);
});

test("real-world header/subtotal amount disagreements remain visible for manual review", () => {
  const result = parseBConnectRows([
    ["الفرعية الشامي", "موردين"],
    makeDetailedHeader({ serial: 11155, amount: 147.18 }), makeDetailedItem(),
    makeDetailedItem("73104"), makeDetailedSubtotal(11155, 2, 183.72),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.invoices[0].detail_total, 183.72);
  assert.ok(Math.abs(result.invoices[0].detail_total_difference - 36.54) < 0.001);
});

test("accepts a symbolic supplier invoice reference separately from B-Connect's internal serial", () => {
  const result = parseBConnectRows([
    ["الفرعية الشامي", "موردين"],
    makeDetailedHeader({ serial: 11123 }), makeDetailedItem(), makeDetailedSubtotal("+"),
  ]);
  assert.equal(result.valid, true, result.warnings.join(" "));
  assert.equal(result.invoices[0].serial, "11123");
  assert.equal(result.invoices[0].supplier_invoice_number, "+");
});

test("detailed supplier/location-looking name cannot overwrite the report branch", () => {
  const result = parseBConnectRows([
    ["الفرعية الشامي", "موردين"],
    makeDetailedHeader({ serial: 11200, supplier: "مخزن د وائل" }),
    makeDetailedItem(), makeDetailedSubtotal(11200),
  ]);
  assert.equal(result.valid, true, result.warnings.join(" "));
  assert.equal(result.invoices[0].supplier, "مخزن د وائل");
  assert.equal(result.invoices[0].branch, "دواء الشامي");
});


function detailedReturnItem({ name, code, purchased, returned, unitCost, returnUnitPrice, returnTotal, bonus = 0 }) {
  const row = Array(39).fill(null);
  row[4] = Number((purchased * unitCost).toPrecision(12));
  row[5] = unitCost;
  row[8] = returnUnitPrice;
  row[9] = returned;
  row[10] = bonus;
  row[11] = purchased;
  row[14] = name;
  row[15] = code;
  row[16] = returnTotal;
  return row;
}

test("detailed B-Connect invoice 11102 links purchased quantities and 126 EGP return to the correct products", () => {
  const rows = [
    ["الفرعية الشامي", "موردين"], ["آجل"],
    makeDetailedHeader({ serial: 11102, amount: 222 }),
    detailedReturnItem({ name: "Zinctron  30 capsules", code: "66807", purchased: 1, returned: 1, unitCost: 126, returnUnitPrice: 126, returnTotal: 126 }),
    detailedReturnItem({ name: "OSMOPEEL CREAM", code: "80458", purchased: 1, returned: 0, unitCost: 96, returnUnitPrice: 96, returnTotal: 0 }),
    makeDetailedSubtotal(11102, 2, 222),
  ];
  const result = parseBConnectRows(rows);
  assert.equal(result.valid, true, result.warnings.join(" "));
  const invoice = result.invoices[0];
  assert.equal(invoice.serial, "11102");
  assert.equal(invoice.items.length, 2);
  assert.deepEqual(invoice.items.map((item) => item.code), ["66807", "80458"]);
  assert.deepEqual(invoice.items.map((item) => item.purchased_quantity), [1, 1]);
  assert.deepEqual(invoice.items.map((item) => item.returned_quantity), [1, 0]);
  assert.deepEqual(invoice.items.map((item) => item.net_quantity), [0, 1]);
  assert.equal(invoice.items[0].purchase_total, 126);
  assert.equal(invoice.items[0].return_total, 126);
  assert.equal(invoice.return_value, 126);
  assert.equal(invoice.returned_items_count, 1);
  assert.equal(result.meta.item_line_count, 2);
  assert.equal(result.meta.returned_item_line_count, 1);
  assert.equal(result.meta.return_value_total, 126);
});

test("invoice 11515 preserves fractional net quantity when 14 of 15 purchased units were returned", () => {
  const result = parseBConnectRows([
    ["الفرعية الشامي", "موردين"],
    makeDetailedHeader({ serial: 11515, amount: 1912.5 }),
    detailedReturnItem({ name: "GINCOSTAZEN 30 CAP", code: "54602", purchased: 15, returned: 14, unitCost: 127.5, returnUnitPrice: 127.5, returnTotal: 1785 }),
    makeDetailedSubtotal(11515, 1, 1912.5),
  ]);
  assert.equal(result.valid, true, result.warnings.join(" "));
  assert.equal(result.invoices[0].return_value, 1785);
  assert.equal(result.invoices[0].items[0].net_quantity, 1);
});

test("non-integer pack quantities remain precise (0.4 pack is not a whole pack)", () => {
  const result = parseBConnectRows([
    ["الفرعية الشامي", "موردين"],
    makeDetailedHeader({ serial: 11101, amount: 24 }),
    detailedReturnItem({ name: "INDERAL 10 MG 50TAB", code: "47723", purchased: 0.4, returned: 0, unitCost: 60, returnUnitPrice: 60, returnTotal: 0 }),
    makeDetailedSubtotal(11101, 1, 24),
  ]);
  assert.equal(result.valid, true, result.warnings.join(" "));
  assert.equal(result.invoices[0].items[0].purchased_quantity, 0.4);
  assert.equal(result.invoices[0].items[0].net_quantity, 0.4);
  assert.equal(result.invoices[0].return_value, 0);
});

test("return quantities without financial return evidence must be rejected rather than silently treated as zero", () => {
  const result = parseBConnectRows([
    ["الفرعية الشامي", "موردين"],
    makeDetailedHeader({ serial: 11222, amount: 126 }),
    detailedReturnItem({ name: "Zinctron", code: "66807", purchased: 1, returned: 1, unitCost: 126, returnUnitPrice: 126, returnTotal: null }),
    makeDetailedSubtotal(11222, 1, 126),
  ]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.meta.invalid_invoice_rows, [3]);
});

test("flat B-Connect invoices remain compatible and do not invent item details", () => {
  const result = parseBConnectRows([
    ["الادارة فرع شكري", "آجل"],
    ["المستخدم", "الصافى", "ض.إضافة", "مصاريف", "خصم %", "خصم قيمة", "ق.المرتجع", "ق.الفاتورة", "العدد", "مسلسل", "التاريخ"],
    ["د عمر", 100, 0, 0, 0, 0, 0, 100, 1, 19526, "2026-10-06 01:23:40"],
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.invoices.length, 1);
  assert.equal(result.invoices[0].items, undefined);
});
