import {
  canonicalPurchaseInvoice,
  invoiceIdentityEvidence,
} from "./purchaseInvoiceTruth.js";

export const RECONCILIATION_ENGINE_VERSION = "v8";
// Business acceptance window, in Egyptian pounds. Exact amount matching
// remains distinct from an accepted small entry discrepancy.
export const BCONNECT_ACCEPTABLE_DIFFERENCE_EGP = 5;

function known(value) { return value !== null && value !== undefined && value !== ""; }
function same(a,b) { return known(a) && known(b) && a === b; }
function compare(a,b) { if (!known(a)||!known(b)) return "unknown"; return a===b?"match":"mismatch"; }
function moneyDelta(a,b) {
  if (!known(a)||!known(b)) return null;
  const left=Number(a), right=Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  const delta=left-right;
  return Number.isFinite(delta) ? Number(delta.toPrecision(10)) : null;
}
function reviewNote(value) {
  return String(value ?? "").replace(/\s+/g," ").trim();
}

export function reconcilePurchaseInvoice(appInput,bconnectInput) {
  const app=canonicalPurchaseInvoice(appInput,"app");
  const bconnect=canonicalPurchaseInvoice(bconnectInput,"bconnect");
  const appNote=reviewNote(appInput?.notes);
  const checks={
    system_invoice_number:compare(app.system_invoice_number,bconnect.system_invoice_number),
    branch:compare(app.branch,bconnect.branch),
    supplier:same(app.supplier_id,bconnect.supplier_id)||same(app.supplier_name_key,bconnect.supplier_name_key)
      ?"match":((!known(app.supplier_id)&&!known(app.supplier_name_key))||(!known(bconnect.supplier_id)&&!known(bconnect.supplier_name_key))?"unknown":"mismatch"),
    invoice_date:compare(app.invoice_date,bconnect.invoice_date),
  };
  const identitySufficient=checks.system_invoice_number==="match"&&checks.branch==="match";
  let identity="insufficient";
  if(checks.system_invoice_number==="mismatch") identity="conflict";
  else if(identitySufficient) identity="confirmed";
  else if(checks.system_invoice_number==="match") identity="candidate";

  const totalDifference=moneyDelta(bconnect.total_value,app.total_value);
  const financialComparable=totalDifference!==null;
  const financialMatch=financialComparable&&totalDifference===0;
  const withinTolerance=financialComparable&&Math.abs(totalDifference)<=BCONNECT_ACCEPTABLE_DIFFERENCE_EGP;
  const hasReturn=(app.returned_value !== null && app.returned_value !== 0)
    || (bconnect.returned_value !== null && bconnect.returned_value !== 0);
  // Never quietly waive a difference linked to returns or an existing review
  // note. These still need a human explanation, even inside the ±5 EGP band.
  const toleranceNeedsReview=withinTolerance && !financialMatch && (hasReturn || !!appNote);
  let status="review"; const reasons=[];
  if(identity==="conflict"){status="problem";reasons.push("رقم البرنامج متعارض؛ لا يجوز ربط السجلين تلقائيًا.");}
  else if(checks.branch==="mismatch"){status="problem";reasons.push("رقم البرنامج موجود لكن الفرع مختلف؛ لا يجوز اعتماد المطابقة تلقائيًا.");}
  else if(!identitySufficient){reasons.push("الأدلة المتاحة غير كافية لإصدار حكم سليم تلقائيًا.");}
  else if(!financialComparable){reasons.push("الهوية مؤكدة لكن القيمة المالية غير متاحة في أحد المصدرين.");}
  else if(!withinTolerance){
    reasons.push(`الهوية مؤكدة لكن يوجد فرق مالي غير مفسر قدره ${Math.abs(totalDifference).toString()} ج (يتجاوز سماحية ±${BCONNECT_ACCEPTABLE_DIFFERENCE_EGP} ج).`);
  } else if(toleranceNeedsReview){
    reasons.push(`الفرق المالي ${Math.abs(totalDifference).toString()} ج داخل سماحية ±${BCONNECT_ACCEPTABLE_DIFFERENCE_EGP} ج، لكن توجد ملاحظات أو مرتجعات تستوجب مراجعة مستقلة.`);
  } else if(checks.supplier==="mismatch" || checks.invoice_date==="mismatch") {
    status="review";
    reasons.push(financialMatch
      ? "رقم الفاتورة والفرع والقيمة متطابقة، لكن توجد اختلافات في بيانات المصدر تحتاج مراجعة."
      : `الفرق المالي ${Math.abs(totalDifference).toString()} ج مقبول ضمن ±${BCONNECT_ACCEPTABLE_DIFFERENCE_EGP} ج، لكن اختلاف المورد أو التاريخ يحتاج مراجعة.`);
    if(checks.supplier==="mismatch") reasons.push("اسم المورد مختلف بين B-Connect والتطبيق.");
    if(checks.invoice_date==="mismatch") reasons.push("تاريخ الفاتورة مختلف بين B-Connect والتطبيق.");
  } else {
    status="clean";
    reasons.push(financialMatch
      ? "رقم الفاتورة والفرع والقيمة المالية متطابقة، ولا توجد اختلافات مؤكدة في المورد أو التاريخ."
      : `فرق مالي مقبول ${Math.abs(totalDifference).toString()} ج ضمن سماحية ±${BCONNECT_ACCEPTABLE_DIFFERENCE_EGP} ج؛ القيم الأصلية محفوظة دون تعديل.`);
    if(checks.supplier==="unknown") reasons.push("لم يتم التحقق من اسم المورد في المصدرين.");
    if(checks.invoice_date==="unknown") reasons.push("لم يتم التحقق من التاريخ في المصدرين.");
  }
  if(appNote) reasons.push(`ملاحظة التطبيق: ${appNote}`);
  return {engine_version:RECONCILIATION_ENGINE_VERSION,status,identity,
    evidence_sufficiency:{sufficient_for_clean:identitySufficient&&financialComparable,identity_sufficient:identitySufficient},
    checks,financial:{comparable:financialComparable,match:financialMatch,within_tolerance:withinTolerance,tolerance_amount:BCONNECT_ACCEPTABLE_DIFFERENCE_EGP,needs_manual_review:toleranceNeedsReview,difference:totalDifference,explained_difference:0,unexplained_difference:totalDifference},
    reasons,app_note:appNote||null,evidence:{app:invoiceIdentityEvidence(app),bconnect:invoiceIdentityEvidence(bconnect)}};
}

export function findDuplicateProgramNumbers(invoices=[]) {
  const groups=new Map();
  for(const raw of invoices){
    const invoice=canonicalPurchaseInvoice(raw);
    if(!invoice.system_invoice_number || !invoice.branch) continue;
    const key=`${invoice.branch}::${invoice.system_invoice_number}`;
    const rows=groups.get(key)||[]; rows.push(invoice); groups.set(key,rows);
  }
  return [...groups.entries()].filter(([,rows])=>rows.length>1).map(([key,rows])=>({
    key,
    branch: rows[0]?.branch || null,
    number: rows[0]?.system_invoice_number || null,
    count:rows.length,
    invoices:rows,
  }));
}
