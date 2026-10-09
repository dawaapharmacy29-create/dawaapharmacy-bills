/** Pure decision eligibility: never treat an ambiguous match as an executable correction. */
export function classifyBConnectReviewRow(row = {}) {
  if (row.status === 'clean') return { code: 'verified', label: 'مطابق', selectable: false, priority: 4 };
  if (row.identity === 'missing') return { code: 'missing', label: 'فاتورة ناقصة — يلزم تسجيل منفصل', selectable: false, priority: 1 };
  if (['duplicate_app', 'duplicate_bconnect'].includes(row.identity)) return { code: 'duplicate', label: 'تكرار — تحقيق يدوي', selectable: false, priority: 0 };
  if (['unverified', 'unauthorized_or_incomplete', 'conflict', 'insufficient', 'candidate'].includes(row.identity) || row.identity !== 'confirmed')
    return { code: 'blocked', label: 'الأدلة غير كافية — ممنوع الاعتماد', selectable: false, priority: 0 };
  // Only review-status, identity-confirmed discrepancies may enter the decision queue.
  // A problem verdict must never be overridden by a seemingly matching identity.
  if (row.status !== 'review') return { code: 'blocked', label: 'حالة الفاتورة لا تسمح بقرار تعديل', selectable: false, priority: 0 };
  const checks = row.checks || {};
  const differences = [];
  if (row.financial?.difference != null && row.financial.difference !== 0) differences.push('قيمة الفاتورة');
  if (checks.supplier === 'mismatch') differences.push('المورد');
  if (checks.invoice_date === 'mismatch') differences.push('التاريخ');
  if (!differences.length) return { code: 'investigate', label: 'مراجعة الأدلة', selectable: false, priority: 2 };
  return { code: 'proposed', label: 'اختلاف يحتاج قرارًا: ' + differences.join('، '), selectable: true, priority: 2, differences };
}
