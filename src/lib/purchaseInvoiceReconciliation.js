import {
  canonicalPurchaseInvoice,
  invoiceIdentityEvidence,
  normalizeArabicText,
} from "./purchaseInvoiceTruth.js";

export const RECONCILIATION_ENGINE_VERSION = "v1";

function same(a, b) {
  return a !== null && a !== undefined && b !== null && b !== undefined && a === b;
}

function moneyDelta(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  // Compare at the source precision currently observed in B-Connect (1/1000 EGP).
  return Math.round((Number(a) - Number(b)) * 1000) / 1000;
}

export function reconcilePurchaseInvoice(appInput, bconnectInput) {
  const app = canonicalPurchaseInvoice(appInput, "app");
  const bconnect = canonicalPurchaseInvoice(bconnectInput, "bconnect");

  const checks = {
    system_invoice_number: same(app.system_invoice_number, bconnect.system_invoice_number),
    branch: same(app.branch, bconnect.branch),
    supplier:
      same(app.supplier_id, bconnect.supplier_id) ||
      same(app.supplier_name_key, bconnect.supplier_name_key),
    invoice_date: same(app.invoice_date, bconnect.invoice_date),
  };

  const identitySignals = Object.values(checks).filter(Boolean).length;
  const numberConflict =
    app.system_invoice_number &&
    bconnect.system_invoice_number &&
    app.system_invoice_number !== bconnect.system_invoice_number;

  let identity = "review";
  if (!numberConflict && checks.system_invoice_number && checks.branch && checks.invoice_date && checks.supplier) {
    identity = "confirmed";
  } else if (numberConflict) {
    identity = "conflict";
  }

  const totalDifference = moneyDelta(bconnect.total_value, app.total_value);
  const financialComparable = totalDifference !== null;
  const financialMatch = financialComparable && totalDifference === 0;

  let status = "review";
  const reasons = [];

  if (identity === "conflict") {
    status = "problem";
    reasons.push("رقم البرنامج مختلف؛ لا يجوز ربط الفاتورتين تلقائيًا.");
  } else if (identity !== "confirmed") {
    status = "review";
    reasons.push("هوية الفاتورة غير مكتملة بما يكفي للتأكيد التلقائي.");
  } else if (!financialComparable) {
    status = "review";
    reasons.push("قيمة الفاتورة غير متاحة في أحد المصدرين.");
  } else if (!financialMatch) {
    status = "review";
    reasons.push(`هوية الفاتورة مؤكدة لكن يوجد فرق مالي غير مفسر قدره ${Math.abs(totalDifference).toFixed(3)} ج.`);
  } else {
    status = "clean";
    reasons.push("هوية الفاتورة مؤكدة والقيمة متطابقة.");
  }

  return {
    engine_version: RECONCILIATION_ENGINE_VERSION,
    status,
    identity,
    identity_signals: identitySignals,
    checks,
    financial: {
      comparable: financialComparable,
      match: financialMatch,
      difference: totalDifference,
      explained_difference: 0,
      unexplained_difference: totalDifference,
    },
    reasons,
    evidence: {
      app: invoiceIdentityEvidence(app),
      bconnect: invoiceIdentityEvidence(bconnect),
    },
  };
}

export function findDuplicateProgramNumbers(invoices = []) {
  const groups = new Map();
  for (const raw of invoices) {
    const invoice = canonicalPurchaseInvoice(raw);
    if (!invoice.system_invoice_number) continue;
    const key = `${invoice.branch ?? "?"}::${invoice.system_invoice_number}`;
    const rows = groups.get(key) ?? [];
    rows.push(invoice);
    groups.set(key, rows);
  }
  return [...groups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({ key, count: rows.length, invoices: rows }));
}
