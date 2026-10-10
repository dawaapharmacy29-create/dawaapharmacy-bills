import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalPurchaseInvoice,
  normalizeBranch,
  normalizeDate,
  normalizeInvoiceNumber,
  normalizeMoney,
} from "../src/lib/purchaseInvoiceTruth.js";

test("normalizes branch aliases without inventing a new branch", () => {
  assert.equal(normalizeBranch("الادارة فرع شكري"), "دواء شكري");
  assert.equal(normalizeBranch("دواء الشامي"), "دواء الشامي");
  assert.equal(normalizeBranch("مخزن رئيسي"), "مخزن رئيسي");
});

test("preserves B-Connect 3-decimal money precision", () => {
  assert.equal(normalizeMoney("411.483"), 411.483);
  assert.equal(normalizeMoney("6,206.383"), 6206.383);
});

test("normalizes invoice identifiers exported by spreadsheets", () => {
  assert.equal(normalizeInvoiceNumber(19527), "19527");
  assert.equal(normalizeInvoiceNumber("19527.0"), "19527");
});

test("normalizes ISO and day-first dates", () => {
  assert.equal(normalizeDate("2026-10-06 01:28:35"), "2026-10-06");
  assert.equal(normalizeDate("06/10/2026"), "2026-10-06");
});

test("builds the same canonical identity fields from Base44-like and B-Connect-like inputs", () => {
  const base44 = canonicalPurchaseInvoice({
    id: "b44-1",
    system_invoice_number: "19527",
    branch: "دواء شكري",
    supplier_name: "المتحدة المنصورة للتوزيع",
    invoice_date: "2026-10-06",
    total_value: 411.483,
  }, "base44");

  const bconnect = canonicalPurchaseInvoice({
    serial: 19527,
    branch: "الادارة فرع شكري",
    supplier: "المتحدة المنصورة للتوزيع",
    date: "2026-10-06 01:28:35",
    invoice_value: "411.483",
  }, "bconnect");

  assert.equal(base44.system_invoice_number, bconnect.system_invoice_number);
  assert.equal(base44.branch, bconnect.branch);
  assert.equal(base44.supplier_name_key, bconnect.supplier_name_key);
  assert.equal(base44.invoice_date, bconnect.invoice_date);
  assert.equal(base44.total_value, bconnect.total_value);
});
