import { classifyBConnectReviewRow } from './bconnectReviewDecisionPolicy.js';
import { normalizeMoney } from './purchaseInvoiceTruth.js';

const dateOnly = (value) => String(value || '').slice(0, 10);

function dateDeltaDays(left, right) {
  const a = Date.parse(`${dateOnly(left)}T00:00:00Z`);
  const b = Date.parse(`${dateOnly(right)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86400000);
}

function noteText(row) {
  return String(row?.app_note || row?.app?.notes || '').replace(/\s+/g, ' ').trim();
}

function numeric(value) {
  const normalized = normalizeMoney(value);
  return normalized === null ? null : Number(normalized);
}

export function buildBConnectPurchaseDecision(row = {}) {
  const policy = classifyBConnectReviewRow(row);
  const difference = row?.financial?.difference == null ? null : Number(row.financial.difference);
  const absDifference = Number.isFinite(difference) ? Math.abs(difference) : null;
  const supplierMismatch = row?.checks?.supplier === 'mismatch';
  const dateMismatch = row?.checks?.invoice_date === 'mismatch';
  const dayDifference = dateMismatch ? dateDeltaDays(row?.bconnect?.date, row?.app?.invoice_date) : 0;
  const note = noteText(row);
  const returned = numeric(row?.app?.returned_value);
  const sourceReturn = numeric(row?.bconnect?.return_value);
  const hasReturn = (returned !== null && returned > 0) || (sourceReturn !== null && sourceReturn > 0);
  const financialMatch = row?.financial?.comparable === true && row?.financial?.match === true;
  const identityConfirmed = row?.identity === 'confirmed' && row?.checks?.branch === 'match' && row?.checks?.system_invoice_number === 'match';
  const fastAccept = identityConfirmed && row?.status === 'review' && financialMatch && (supplierMismatch || dateMismatch);

  let lane = 'investigate';
  let label = 'تحقيق يدوي';
  let instruction = 'راجع الأدلة قبل أي قرار';
  let tone = 'red';

  if (row?.status === 'clean') {
    lane = 'clean'; label = 'سليم'; instruction = 'لا يحتاج أي إجراء'; tone = 'green';
  } else if (policy.code === 'missing') {
    lane = 'register'; label = 'سجّل'; instruction = 'الفاتورة ناقصة في التطبيق'; tone = 'blue';
  } else if (policy.code === 'duplicate' || policy.code === 'blocked' || row?.status === 'problem') {
    lane = 'investigate'; label = 'حقق'; instruction = policy.label || 'حالة تحتاج تحقيق يدوي'; tone = 'red';
  } else if (absDifference !== null && absDifference > 0) {
    lane = 'explain'; label = 'فسّر الفرق'; instruction = note || hasReturn ? 'يوجد دليل محتمل يفسّر الفرق المالي' : 'فرق مالي غير مفسر يحتاج نظرة'; tone = 'red';
  } else if (fastAccept) {
    lane = 'approve'; label = 'اعتمد'; instruction = supplierMismatch && dateMismatch ? 'القيمة متطابقة؛ اختلاف مورد وتاريخ فقط' : supplierMismatch ? 'القيمة متطابقة؛ اختلاف المورد فقط' : 'القيمة متطابقة؛ اختلاف التاريخ فقط'; tone = 'green';
  } else if (identityConfirmed && row?.status === 'review') {
    lane = 'correct'; label = 'صحّح'; instruction = 'الهوية مؤكدة ويوجد اختلاف يحتاج تصحيحًا'; tone = 'amber';
  }

  return {
    lane,
    label,
    instruction,
    tone,
    fastAccept,
    financialDifference: Number.isFinite(difference) ? difference : null,
    absoluteFinancialDifference: absDifference,
    supplierMismatch,
    dateMismatch,
    dateDifferenceDays: dayDifference,
    note,
    hasNote: !!note,
    returnedValue: returned,
    sourceReturnValue: sourceReturn,
    hasReturn,
    bconnectTotal: numeric(row?.bconnect?.invoice_value),
    appTotal: numeric(row?.app?.total_value),
  };
}

export function countBConnectDecisionLanes(rows = []) {
  return rows.reduce((acc, row) => {
    const lane = buildBConnectPurchaseDecision(row).lane;
    acc[lane] = (acc[lane] || 0) + 1;
    return acc;
  }, { approve: 0, correct: 0, explain: 0, register: 0, investigate: 0, clean: 0 });
}
