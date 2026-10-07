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
  count: 4,
};

test("confirmed identity with financial difference is review, never silently clean", () => {
  const result = reconcilePurchaseInvoice(app, bconnect);
  assert.equal(result.identity, "confirmed");
  assert.equal(result.status, "review");
  assert.equal(result.financial.difference, 4.203);
});

test("clean requires sufficient identity evidence and matching amount", () => {
  const result = reconcilePurchaseInvoice({ ...app, total_value: 411.483 }, bconnect);
  assert.equal(result.evidence_sufficiency.identity_sufficient, true);
  assert.equal(result.status, "clean");
});

test("same number and amount alone can never become clean", () => {
  const result = reconcilePurchaseInvoice(
    { system_invoice_number: "19527", total_value: 411.483 },
    { serial: 19527, invoice_value: 411.483 }
  );
  assert.equal(result.identity, "candidate");
  assert.equal(result.evidence_sufficiency.identity_sufficient, false);
  assert.equal(result.status, "review");
});

test("known supporting conflict blocks clean even when number and amount match", () => {
  const result = reconcilePurchaseInvoice(
    { ...app, total_value: 411.483, branch: "دواء الشامي" },
    bconnect
  );
  assert.equal(result.status, "review");
  assert.ok(result.evidence_sufficiency.supporting_mismatches.includes("branch"));
});

test("different program numbers are a hard identity conflict", () => {
  const result = reconcilePurchaseInvoice(app, { ...bconnect, serial: 99999 });
  assert.equal(result.identity, "conflict");
  assert.equal(result.status, "problem");
});

test("missing supplier may still confirm only when two other independent supports match", () => {
  const result = reconcilePurchaseInvoice(
    { ...app, supplier_name: null, total_value: 411.483 },
    { ...bconnect, supplier: null }
  );
  assert.equal(result.evidence_sufficiency.supporting_matches.length, 2);
  assert.equal(result.identity, "confirmed");
  assert.equal(result.status, "clean");
});

test("duplicate detection remains scoped by normalized branch and program number", () => {
  const duplicates = findDuplicateProgramNumbers([
    app,
    { ...app, id: "second" },
    { ...app, branch: "دواء الشامي" },
  ]);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].count, 2);
});
