import {
  canonicalPurchaseInvoice,
  invoiceIdentityEvidence,
} from "./purchaseInvoiceTruth.js";

export const RECONCILIATION_ENGINE_VERSION = "v2";

function known(value) {
  return value !== null && value !== undefined && value !== "";
}
function same(a, b) {
  return known(a) && known(b) && a === b;
}
function compare(a, b) {
  if (!known(a) || !known(b)) return "unknown";
  return a === b ? "match" : "mismatch";
}
function moneyDelta(a, b) {
  if (!known(a) || !known(b)) return null;
  return Math.round((Number(a) - Number(b)) * 1000) / 1000;
}

/**
 * Fail-closed B-Connect reconciliation.
 *
 * Identity and financial reconciliation are deliberately independent.
 * A green/clean verdict requires sufficient identity evidence AND an exact
 * financial comparison. Unknown evidence can never silently become a match.
 */
export function reconcilePurchaseInvoice(appInput, bconnectInput) {
  const app = canonicalPurchaseInvoice(appInput, "app");
  const bconnect = canonicalPurchaseInvoice(bconnectInput, "bconnect");

  const checks = {
    system_invoice_number: compare(app.system_invoice_number, bconnect.system_invoice_number),
    branch: compare(app.branch, bconnect.branch),
    supplier:
      same(app.supplier_id, bconnect.supplier_id) || same(app.supplier_name_key, bconnect.supplier_name_key)
        ? "match"
        : (!known(app.supplier_id) && !known(app.supplier_name_key)) ||
          (!known(bconnect.supplier_id) && !known(bconnect.supplier_name_key))
          ? "unknown"
          : "mismatch",
    invoice_date: compare(app.invoice_date, bconnect.invoice_date),
  };

  const hardConflict = checks.system_invoice_number === "mismatch";
  const supportingKnown = ["branch", "supplier", "invoice_date"].filter((key) => checks[key] !== "unknown");
  const supportingMatches = supportingKnown.filter((key) => checks[key] === "match");
  const supportingMismatches = supportingKnown.filter((key) => checks[key] === "mismatch");

  // Conservative v2 contract:
  // program number must match, no known supporting field may conflict,
  // and at least two independent supporting fields must be known and match.
  const identitySufficient =
    checks.system_invoice_number === "match" &&
    supportingMismatches.length === 0 &&
    supportingMatches.length >= 2;

  let identity = "insufficient";
  if (hardConflict) identity = "conflict";
  else if (identitySufficient) identity = "confirmed";
  else if (checks.system_invoice_number === "match") identity = "candidate";

  const totalDifference = moneyDelta(bconnect.total_value, app.total_value);
  const financialComparable = totalDifference !== null;
  const financialMatch = financialComparable && totalDifference === 0;

  let status = "review";
  const reasons = [];

  if (identity === "conflict") {
    status = "problem";
    reasons.push("رقم البرنامج متعارض؛ لا يجوز ربط السجلين تلقائيًا.");
  } else if (supportingMismatches.length > 0) {
    status = "review";
    reasons.push(`رقم البرنامج مرشح للمطابقة لكن يوجد تعارض في: ${supportingMismatches.join(", ")}.`);
  } else if (!identitySufficient) {
    status = "review";
    reasons.push("الأدلة المتاحة غير كافية لإصدار حكم سليم تلقائيًا.");
  } else if (!financialComparable) {
    status = "review";
    reasons.push("الهوية مؤكدة لكن القيمة المالية غير متاحة في أحد المصدرين.");
  } else if (!financialMatch) {
    status = "review";
    reasons.push(`الهوية مؤكدة لكن يوجد فرق مالي غير مفسر قدره ${Math.abs(totalDifference).toFixed(3)} ج.`);
  } else {
    status = "clean";
    reasons.push("الأدلة كافية لهوية الفاتورة والقيمة المالية متطابقة.");
  }

  return {
    engine_version: RECONCILIATION_ENGINE_VERSION,
    status,
    identity,
    evidence_sufficiency: {
      sufficient_for_clean: identitySufficient && financialComparable,
      identity_sufficient: identitySufficient,
      supporting_known: supportingKnown,
      supporting_matches: supportingMatches,
      supporting_mismatches: supportingMismatches,
    },
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
    // Branch scope is retained when known; unknown branch is never merged with a known branch.
    const key = `${invoice.branch ?? "UNKNOWN_BRANCH"}::${invoice.system_invoice_number}`;
    const rows = groups.get(key) ?? [];
    rows.push(invoice);
    groups.set(key, rows);
  }
  return [...groups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({ key, count: rows.length, invoices: rows }));
}
