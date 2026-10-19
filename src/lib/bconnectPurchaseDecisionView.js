import { classifyBConnectReviewRow } from './bconnectReviewDecisionPolicy.js';
import { normalizeBranch, normalizeMoney } from './purchaseInvoiceTruth.js';

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

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function nearlyEqual(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) < 0.005;
}

function returnExplanation({ difference, appReturn, sourceReturn }) {
  if (!Number.isFinite(difference) || difference === 0) return null;
  const app = Number.isFinite(appReturn) ? appReturn : 0;
  const source = Number.isFinite(sourceReturn) ? sourceReturn : 0;
  const returnDelta = Math.abs(app - source);
  if (returnDelta > 0 && nearlyEqual(Math.abs(difference), returnDelta)) {
    return {
      code: 'return_exact',
      confidence: 'high',
      label: `الفرق يساوي فرق المرتجع (${returnDelta.toFixed(2)} ج)`,
      safeToAutoAccept: false,
    };
  }
  return null;
}

function noteSignal(note) {
  const text = String(note || '').toLowerCase();
  if (!text) return null;
  if (/تجميع|مجمع|ضم|فاتورتين|فاتورتان|اكثر من فاتور|أكثر من فاتور/.test(text)) {
    return { code: 'consolidation_note', confidence: 'medium', label: 'الملاحظة تشير إلى تجميع فواتير' };
  }
  if (/مرتجع|اشعار|إشعار|رد مورد|خصم مورد/.test(text)) {
    return { code: 'return_note', confidence: 'medium', label: 'الملاحظة تشير إلى مرتجع/إشعار مورد' };
  }
  return { code: 'note_present', confidence: 'low', label: 'توجد ملاحظة قد تساعد في تفسير الفرق' };
}

function confidenceFor({ policy, identityConfirmed, financialMatch, toleratedDifference, fastAccept, dateMismatch, dayDifference, supplierMismatch, hasNote, hasReturn, returnIssue, absDifference, evidence }) {
  if (policy.code === 'duplicate' || policy.code === 'blocked' || (!identityConfirmed && policy.code !== 'missing')) {
    return { code: 'blocked', label: 'محظور', score: 0 };
  }
  if (returnIssue) return { code: 'medium', label: 'اختلاف مرتجع — يحتاج مراجعة', score: 65 };
  if (fastAccept) {
    let score = 100;
    if (dateMismatch && dayDifference !== null) score -= Math.min(Math.abs(dayDifference) * 3, 15);
    if (supplierMismatch) score -= 3;
    if (hasNote) score -= 12;
    if (hasReturn) score -= 12;
    if (score >= 95) return { code: 'very_high', label: 'ثقة عالية جدًا', score };
    if (score >= 85) return { code: 'high', label: 'ثقة عالية', score };
    return { code: 'medium', label: 'ثقة متوسطة', score };
  }
  if (toleratedDifference && !hasReturn && !hasNote && identityConfirmed) {
    return supplierMismatch || dateMismatch
      ? { code: 'medium', label: 'فرق مقبول؛ افحص البيانات', score: 80 }
      : { code: 'high', label: 'فرق مقبول ±5 ج', score: 90 };
  }
  if (absDifference !== null && absDifference > 0) {
    if (evidence?.confidence === 'high') return { code: 'high_explanation', label: 'تفسير قوي — يحتاج اعتمادك', score: 85 };
    if (evidence?.confidence === 'medium') return { code: 'medium', label: 'ثقة متوسطة', score: 65 };
    return { code: 'low', label: 'ثقة منخفضة', score: 35 };
  }
  if (identityConfirmed && financialMatch) return { code: 'high', label: 'ثقة عالية', score: 90 };
  return { code: 'low', label: 'ثقة منخفضة', score: 30 };
}

export function buildBConnectPurchaseDecision(row = {}) {
  const policy = classifyBConnectReviewRow(row);
  const difference = row?.financial?.difference == null ? null : Number(row.financial.difference);
  const absDifference = Number.isFinite(difference) ? Math.abs(difference) : null;
  const supplierMismatch = row?.checks?.supplier === 'mismatch';
  const dateMismatch = row?.checks?.invoice_date === 'mismatch';
  const dayDifference = dateMismatch ? dateDeltaDays(row?.bconnect?.date, row?.app?.invoice_date) : 0;
  const note = noteText(row);
  const hasNote = !!note;
  const returned = numeric(row?.app?.returned_value);
  const sourceReturn = numeric(row?.bconnect?.return_value);
  const hasReturn = (returned !== null && returned > 0) || (sourceReturn !== null && sourceReturn > 0);
  const returnIssue = row?.financial?.return_issue === true || row?.checks?.returned_value === 'mismatch';
  const returnDifference = row?.financial?.return_difference ?? null;
  const financialMatch = row?.financial?.comparable === true && row?.financial?.match === true;
  const toleratedDifference = row?.financial?.comparable === true &&
    row?.financial?.within_tolerance === true && absDifference !== null && absDifference > 0;
  const identityConfirmed = row?.identity === 'confirmed'
    && row?.checks?.branch === 'match'
    && row?.checks?.system_invoice_number === 'match';
  const toleranceAccepted = toleratedDifference && identityConfirmed &&
    !hasReturn && !hasNote && row?.status !== 'problem';

  const fastAccept = policy.code === 'proposed'
    && policy.selectable === true
    && identityConfirmed
    && row?.status === 'review'
    && financialMatch
    && !hasReturn
    && !returnIssue
    && (supplierMismatch || dateMismatch);

  const exactReturnExplanation = returnExplanation({ difference, appReturn: returned, sourceReturn });
  const noteEvidence = noteSignal(note);
  const evidence = exactReturnExplanation || noteEvidence;
  const confidence = confidenceFor({ policy, identityConfirmed, financialMatch, toleratedDifference, fastAccept, dateMismatch, dayDifference, supplierMismatch, hasNote, hasReturn, returnIssue, absDifference, evidence });

  const bulkEligible = fastAccept
    && confidence.code === 'very_high'
    && !hasNote
    && !hasReturn
    && (!dateMismatch || (dayDifference !== null && Math.abs(dayDifference) <= 3));

  let lane = 'investigate';
  let label = 'حقق';
  let instruction = 'راجع الأدلة قبل أي قرار';
  let tone = 'red';
  let nextAction = 'open_details';

  if (row?.status === 'clean') {
    lane = 'clean';
    label = toleratedDifference ? 'فرق مقبول' : 'سليم';
    instruction = toleratedDifference ? 'فرق مالي ضمن سماحية ±5 ج — لا تعديل على قيمة الفاتورة' : 'لا يحتاج أي إجراء';
    tone = 'green';
    nextAction = 'none';
  } else if (policy.code === 'missing') {
    lane = 'register';
    label = 'سجّل';
    instruction = 'الفاتورة ناقصة في التطبيق — افتحها جاهزة للتسجيل';
    tone = 'blue';
    nextAction = 'register';
  } else if (policy.code === 'duplicate' || policy.code === 'blocked' || row?.status === 'problem') {
    lane = 'investigate';
    label = 'حقق';
    instruction = policy.label || 'حالة تحتاج تحقيق يدوي';
    tone = 'red';
    nextAction = 'open_details';
  } else if (returnIssue) {
    lane = 'explain';
    label = 'راجع المرتجع';
    instruction = returnDifference !== null
      ? `مرتجع B-Connect والتطبيق مختلفان بفارق ${Math.abs(returnDifference).toFixed(2)} ج؛ راجع سطور الأصناف.`
      : 'يوجد مرتجع مثبت في المصدر وقيمته غير مؤكدة في التطبيق؛ راجع تفاصيله.';
    tone = 'amber';
    nextAction = 'open_details';
  } else if (absDifference !== null && absDifference > 0 && (!toleratedDifference || hasReturn || hasNote)) {
    lane = 'explain';
    label = exactReturnExplanation ? 'راجع المرتجع' : 'فسّر الفرق';
    instruction = exactReturnExplanation?.label
      || noteEvidence?.label
      || 'فرق مالي غير مفسر يحتاج نظرة';
    tone = exactReturnExplanation ? 'amber' : 'red';
    nextAction = 'open_details';
  } else if (fastAccept) {
    lane = 'approve';
    label = 'اعتمد';
    instruction = supplierMismatch && dateMismatch
      ? 'القيمة متطابقة؛ اختلاف مورد وتاريخ فقط'
      : supplierMismatch
        ? 'القيمة متطابقة؛ اختلاف المورد فقط'
        : 'القيمة متطابقة؛ اختلاف التاريخ فقط';
    tone = 'green';
    nextAction = 'accept_as_is';
  } else if (identityConfirmed && row?.status === 'review' && policy.code === 'proposed') {
    lane = 'correct';
    label = toleratedDifference ? 'راجع البيانات' : 'صحّح';
    instruction = toleratedDifference
      ? 'الفرق المالي مقبول ±5 ج؛ راجع اختلاف المورد أو التاريخ بشكل مستقل'
      : 'الهوية مؤكدة ويوجد اختلاف يحتاج تصحيحًا';
    tone = 'amber';
    nextAction = 'open_details';
  }

  return {
    lane,
    label,
    instruction,
    tone,
    nextAction,
    fastAccept,
    bulkEligible,
    policyCode: policy.code,
    selectable: policy.selectable === true,
    confidence,
    financialDifference: Number.isFinite(difference) ? difference : null,
    absoluteFinancialDifference: absDifference,
    toleratedDifference,
    toleranceAccepted,
    toleranceAmount: row?.financial?.tolerance_amount ?? 5,
    supplierMismatch,
    dateMismatch,
    dateDifferenceDays: dayDifference,
    note,
    hasNote,
    returnedValue: returned,
    sourceReturnValue: sourceReturn,
    hasReturn,
    returnIssue,
    returnDifference,
    evidence,
    evidenceConfidence: evidence?.confidence || null,
    exactReturnExplanation: exactReturnExplanation?.code === 'return_exact',
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

export function buildBConnectDecisionGroups(rows = []) {
  const groups = new Map();
  rows.forEach((row) => {
    const view = buildBConnectPurchaseDecision(row);
    if (!view.bulkEligible) return;
    const branch = normalizeBranch(row?.bconnect?.branch || row?.app?.branch) || 'غير معروف';
    const sourceSupplier = normalizeText(row?.bconnect?.supplier);
    const appSupplier = normalizeText(row?.app?.supplier_name);
    const dateDelta = view.dateMismatch && view.dateDifferenceDays !== null ? view.dateDifferenceDays : 0;
    const pattern = view.supplierMismatch && view.dateMismatch
      ? 'supplier_date'
      : view.supplierMismatch
        ? 'supplier'
        : 'date';
    const key = [branch, pattern, sourceSupplier, appSupplier, dateDelta].join('|');
    if (!groups.has(key)) {
      const description = pattern === 'supplier_date'
        ? `نفس ربط المورد + فرق تاريخ ${Math.abs(dateDelta)} يوم`
        : pattern === 'supplier'
          ? 'نفس ربط المورد والقيمة متطابقة'
          : `فرق تاريخ ${Math.abs(dateDelta)} يوم والقيمة متطابقة`;
      groups.set(key, { key, branch, pattern, description, rows: [], confidence: view.confidence });
    }
    groups.get(key).rows.push(row);
  });
  return [...groups.values()]
    .filter((group) => group.rows.length >= 2)
    .sort((a, b) => b.rows.length - a.rows.length || a.description.localeCompare(b.description, 'ar'));
}
