import test from "node:test";
import assert from "node:assert/strict";
import { findDuplicateProgramNumbers, reconcilePurchaseInvoice } from "../src/lib/purchaseInvoiceReconciliation.js";

const app={system_invoice_number:"19527",branch:"دواء شكري",supplier_name:"المتحدة المنصورة للتوزيع",invoice_date:"2026-10-03",total_value:407.28};
const bc={serial:19527,branch:"الادارة فرع شكري",supplier:"المتحدة المنصورة للتوزيع",date:"2026-10-06 01:28:35",invoice_value:411.483};

test("real 19527 stays review with exact 4.203 difference",()=>{const r=reconcilePurchaseInvoice(app,bc);assert.equal(r.identity,"confirmed");assert.equal(r.status,"review");assert.equal(r.financial.difference,4.203);});
test("supplier/date drift requires review even when number, branch and amount match",()=>{const r=reconcilePurchaseInvoice({...app,total_value:411.483,supplier_name:"مورد آخر"},bc);assert.equal(r.status,"review");assert.equal(r.checks.supplier,"mismatch");assert.equal(r.checks.invoice_date,"mismatch");});
test("same number and amount without branch never becomes green",()=>{const r=reconcilePurchaseInvoice({system_invoice_number:"19527",total_value:411.483},{serial:19527,invoice_value:411.483});assert.equal(r.status,"review");assert.equal(r.identity,"candidate");});
test("branch mismatch is a hard problem",()=>{const r=reconcilePurchaseInvoice({...app,branch:"دواء الشامي",total_value:411.483},bc);assert.equal(r.status,"problem");});
test("different program number is a hard conflict",()=>{const r=reconcilePurchaseInvoice(app,{...bc,serial:99999});assert.equal(r.status,"problem");assert.equal(r.identity,"conflict");});
test("same invoice number across branches is allowed",()=>{const d=findDuplicateProgramNumbers([app,{...app,id:"b",branch:"دواء الشامي"}]);assert.equal(d.length,0);});
test("duplicate detection is scoped to the same branch",()=>{const d=findDuplicateProgramNumbers([app,{...app,id:"b",branch:"دواء شكري"}]);assert.equal(d.length,1);assert.equal(d[0].branch,"دواء شكري");assert.equal(d[0].number,"19527");assert.equal(d[0].key,"دواء شكري::19527");assert.equal(d[0].count,2);});
test("integer-like Excel numbers normalize within the branch",()=>{const d=findDuplicateProgramNumbers([{system_invoice_number:"19527.0",branch:"دواء شكري"},{system_invoice_number:19527,branch:"شكري"}]);assert.equal(d.length,1);assert.equal(d[0].number,"19527");});

test("invalid monetary input cannot produce a clean verdict",()=>{
  for(const invalid of ["NaN","Infinity","-Infinity","not-a-number"]){
    const result=reconcilePurchaseInvoice({...app,total_value:invalid},{...bc,invoice_value:411.483});
    assert.equal(result.status,"review");
    assert.equal(result.financial.comparable,false);
    assert.equal(result.financial.difference,null);
  }
});
test("missing financial evidence never becomes zero or clean",()=>{
  const result=reconcilePurchaseInvoice({...app,total_value:null},{...bc,invoice_value:0});
  assert.equal(result.status,"review");
  assert.equal(result.financial.difference,null);
});

test("whitespace-only amounts remain missing rather than zero",()=>{
  const result=reconcilePurchaseInvoice({...app,total_value:"   "},{...bc,invoice_value:0});
  assert.equal(result.status,"review");
  assert.equal(result.financial.comparable,false);
  assert.equal(result.financial.difference,null);
});

test("sub-milliunit differences cannot be rounded into a clean verdict",()=>{
  const result=reconcilePurchaseInvoice({...app,total_value:100},{...bc,invoice_value:100.0004});
  assert.equal(result.status,"review");
  assert.equal(result.financial.comparable,true);
  assert.ok(result.financial.difference>0);
  assert.ok(result.reasons.some(reason=>reason.includes("0.0004")));
});

test("identical monetary values remain clean after precision fix",()=>{
  const result=reconcilePurchaseInvoice({...app,total_value:100.0004,invoice_date:"2026-10-06"},{...bc,invoice_value:100.0004});
  assert.equal(result.status,"clean");
  assert.equal(result.financial.difference,0);
});

test("all verified fields equal can be clean",()=>{const r=reconcilePurchaseInvoice({...app,total_value:411.483,invoice_date:"2026-10-06"},bc);assert.equal(r.status,"clean");});


test("±5 EGP tolerance is inclusive, directional and never changes the financial truth", () => {
  const source = { ...bc, date: "2026-10-06", invoice_value: 100 };
  const base = { ...app, invoice_date: "2026-10-06", total_value: 100 };
  for (const [delta, status, accepted] of [
    [0, "clean", true], [0.0004, "clean", true],
    [4.999, "clean", true], [5, "clean", true],
    [-5, "clean", true], [-4.999, "clean", true],
    [5.001, "review", false], [-5.001, "review", false],
    [23.9, "review", false],
  ]) {
    const result = reconcilePurchaseInvoice({ ...base, total_value: 100 - delta }, source);
    assert.equal(result.status, status, "difference " + delta);
    assert.equal(result.financial.within_tolerance, accepted, "difference " + delta);
    assert.equal(result.financial.match, delta === 0, "exact match difference " + delta);
    assert.ok(Math.abs(result.financial.difference - delta) < 0.000001);
    assert.equal(result.financial.tolerance_amount, 5);
  }
});

test("a tolerated difference never hides supplier, date, branch or source-note problems", () => {
  const source = { ...bc, date: "2026-10-06", invoice_value: 100 };
  const base = { ...app, invoice_date: "2026-10-06", total_value: 95 };
  const supplier = reconcilePurchaseInvoice({ ...base, supplier_name: "غير المورد" }, source);
  assert.equal(supplier.status, "review");
  assert.equal(supplier.financial.within_tolerance, true);
  assert.equal(supplier.checks.supplier, "mismatch");

  const date = reconcilePurchaseInvoice({ ...base, invoice_date: "2026-10-04" }, source);
  assert.equal(date.status, "review");
  assert.equal(date.checks.invoice_date, "mismatch");

  const branch = reconcilePurchaseInvoice({ ...base, branch: "دواء الشامي" }, source);
  assert.equal(branch.status, "problem");

  const note = reconcilePurchaseInvoice({ ...base, notes: "فاتورة مجمعة" }, source);
  assert.equal(note.status, "review");
  assert.equal(note.financial.needs_manual_review, true);

  const returned = reconcilePurchaseInvoice({ ...base, returned_value: 3 }, source);
  assert.equal(returned.status, "review");
  assert.equal(returned.financial.needs_manual_review, true);
});

test("missing, corrupt and unverified amounts never qualify for tolerated clean status", () => {
  const source = { ...bc, date: "2026-10-06", invoice_value: 100 };
  for (const total of [undefined, null, "", "junk", "Infinity"]) {
    const result = reconcilePurchaseInvoice({ ...app, total_value: total }, source);
    assert.equal(result.status, "review");
    assert.equal(result.financial.within_tolerance, false);
  }
});
