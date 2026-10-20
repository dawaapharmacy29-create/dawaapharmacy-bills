import { normalizeBranch, normalizeInvoiceNumber } from './purchaseInvoiceTruth.js';

/** POST transport is not necessarily an idempotent write. */
const RETRYABLE_APP_DATA_ACTIONS = new Set(['list', 'get', 'filter']);

export function mayRetryAppDataAction(action) {
  return RETRYABLE_APP_DATA_ACTIONS.has(String(action || '').trim());
}

export function validatePurchaseInvoiceCreateEvidence(invoices, checks) {
  const batch = Array.isArray(invoices) ? invoices : [invoices];
  if (!batch.length) throw new Error('قائمة الفواتير فارغة.');

  const wanted = new Map();
  for (const invoice of batch) {
    const number = normalizeInvoiceNumber(invoice?.system_invoice_number);
    const branch = normalizeBranch(invoice?.branch);
    if (!number || !branch) throw new Error('لا يمكن إنشاء الفاتورة بدون رقم برنامج وفرع واضحين.');
    const key = JSON.stringify([number, branch]);
    if (wanted.has(key)) throw new Error('طلب الإنشاء نفسه يحتوي فاتورتين بنفس رقم البرنامج والفرع؛ أوقف الاستيراد وراجع الملفات.');
    wanted.set(key, { number, branch });
  }

  if (!Array.isArray(checks)) throw new Error('تعذر التأكد من خلو قاعدة البيانات من تكرار الفاتورة؛ لم يتم الحفظ.');
  for (const target of wanted.values()) {
    const match = checks.find((entry) => normalizeInvoiceNumber(entry?.number) === target.number);
    if (!match || !Number.isSafeInteger(Number(match.record_count)) || Number(match.record_count) < 0 || !Array.isArray(match.rows)) {
      throw new Error('التحقق من هوية الفاتورة غير مكتمل؛ لم يتم الحفظ.');
    }
    if (match.rows.some((row) => normalizeInvoiceNumber(row?.system_invoice_number) === target.number &&
      normalizeBranch(row?.branch) === target.branch)) {
      throw new Error('رقم الفاتورة ' + target.number + ' مسجل بالفعل في ' + target.branch + '؛ إنشاء نسخة جديدة ممنوع.');
    }
    // RPC returns a global count, but caller might be denied other-branch row details.
    // Do not claim that we proved absence of a collision when the count is higher.
    if (Number(match.record_count) > match.rows.length) {
      throw new Error('رقم الفاتورة ' + target.number + ' موجود في بيانات غير ظاهرة لصلاحية المستخدم؛ مطلوب فحص مدير قبل التسجيل.');
    }
  }
  return true;
}
