import test from "node:test";
import assert from "node:assert/strict";
import { parseBConnectRows } from "../src/lib/bconnectPurchaseInvoiceParser.js";

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
  assert.equal(result.invoices[1].branch, "الادارة فرع شكري");
  assert.equal(result.invoices[2].supplier, "دواء الشامي");
  assert.equal(result.invoices[2].branch, "الادارة فرع شكري");
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
  assert.equal(result.meta.parser_version, "v2");
  assert.equal(result.invoices.length, 11);
  assert.equal(new Set(result.invoices.map((row) => row.serial)).size, 11);
  assert.ok(result.invoices.every((row) => row.branch === "الادارة فرع شكري"));
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
  assert.equal(result.invoices[0].branch, "الادارة فرع شكري");
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
  assert.equal(result.invoices[0].branch, "الادارة فرع شكري");
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
