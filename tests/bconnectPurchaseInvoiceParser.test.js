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
