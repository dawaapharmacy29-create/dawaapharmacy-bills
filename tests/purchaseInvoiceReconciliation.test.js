import test from "node:test";
import assert from "node:assert/strict";
import { findDuplicateProgramNumbers, reconcilePurchaseInvoice } from "../src/lib/purchaseInvoiceReconciliation.js";

const app={system_invoice_number:"19527",branch:"دواء شكري",supplier_name:"المتحدة المنصورة للتوزيع",invoice_date:"2026-10-03",total_value:407.28};
const bc={serial:19527,branch:"الادارة فرع شكري",supplier:"المتحدة المنصورة للتوزيع",date:"2026-10-06 01:28:35",invoice_value:411.483};

test("real 19527 stays review with exact 4.203 difference",()=>{const r=reconcilePurchaseInvoice(app,bc);assert.equal(r.identity,"confirmed");assert.equal(r.status,"review");assert.equal(r.financial.difference,4.203);});
test("supplier/date drift cannot block a proven exact match",()=>{const r=reconcilePurchaseInvoice({...app,total_value:411.483,supplier_name:"المتحده"},bc);assert.equal(r.status,"clean");assert.equal(r.checks.invoice_date,"mismatch");});
test("same number and amount without branch never becomes green",()=>{const r=reconcilePurchaseInvoice({system_invoice_number:"19527",total_value:411.483},{serial:19527,invoice_value:411.483});assert.equal(r.status,"review");assert.equal(r.identity,"candidate");});
test("branch mismatch is a hard problem",()=>{const r=reconcilePurchaseInvoice({...app,branch:"دواء الشامي",total_value:411.483},bc);assert.equal(r.status,"problem");});
test("different program number is a hard conflict",()=>{const r=reconcilePurchaseInvoice(app,{...bc,serial:99999});assert.equal(r.status,"problem");assert.equal(r.identity,"conflict");});
test("duplicate detection is global across branches",()=>{const d=findDuplicateProgramNumbers([app,{...app,id:"b",branch:"دواء الشامي"}]);assert.equal(d.length,1);assert.equal(d[0].key,"19527");assert.equal(d[0].count,2);});
test("integer-like Excel numbers normalize into one global identity",()=>{const d=findDuplicateProgramNumbers([{system_invoice_number:"19527.0",branch:"دواء شكري"},{system_invoice_number:19527,branch:"دواء الشامي"}]);assert.equal(d.length,1);});

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
  const result=reconcilePurchaseInvoice({...app,total_value:100.0004},{...bc,invoice_value:100.0004});
  assert.equal(result.status,"clean");
  assert.equal(result.financial.difference,0);
});
