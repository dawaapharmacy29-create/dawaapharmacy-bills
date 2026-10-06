import test from "node:test";
import assert from "node:assert/strict";
import { findDuplicateProgramNumbers, reconcilePurchaseInvoice } from "../src/lib/purchaseInvoiceReconciliation.js";

const app = {
  system_invoice_number: "19527",
  branch: "دواء شكري",
  supplier_name: "المتحدة المنصورة للتوزيع",
  invoice_date: "2026-10-06",
  total_value: 407.28,
};

const bconnect = {
  serial: 19527,
  branch: "الادارة فرع شكري",
  supplier: "المتحدة المنصورة للتوزيع",
  date: "2026-10-06 01:28:35",
  invoice_value: 411.483,
};

test("confirmed identity with a financial difference is review, never silently clean", () => {
  const result = reconcilePurchaseInvoice(app, bconnect);
  assert.equal(result.identity, "confirmed");
  assert.equal(result.status, "review");
  assert.equal(result.financial.difference, 4.203);
  assert.equal(result.financial.unexplained_difference, 4.203);
});

test("matching identity and amount is clean", () => {
  const result = reconcilePurchaseInvoice({ ...app, total_value: 411.483 }, bconnect);
  assert.equal(result.identity, "confirmed");
  assert.equal(result.status, "clean");
  assert.equal(result.financial.difference, 0);
});

test("different program numbers are a hard identity conflict", () => {
  const result = reconcilePurchaseInvoice(app, { ...bconnect, serial: 99999 });
  assert.equal(result.identity, "conflict");
  assert.equal(result.status, "problem");
});

test("missing supplier evidence does not auto-confirm identity", () => {
  const result = reconcilePurchaseInvoice({ ...app, supplier_name: null }, bconnect);
  assert.equal(result.identity, "review");
  assert.equal(result.status, "review");
});

test("duplicate detection is scoped by normalized branch and program number", () => {
  const duplicates = findDuplicateProgramNumbers([
    app,
    { ...app, id: "second" },
    { ...app, branch: "دواء الشامي" },
  ]);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].count, 2);
});
