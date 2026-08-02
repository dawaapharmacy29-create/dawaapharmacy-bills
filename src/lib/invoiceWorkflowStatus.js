export const WORKFLOW_STATUSES = ['draft', 'submitted', 'reviewed', 'returned', 'approved'];

/**
 * المصدر الموحد لحالة فاتورة الشراء داخل التطبيق.
 * الحالات الجديدة لها الأولوية. الحالات القديمة غير القياسية لا تختفي من الإحصائيات:
 * - pending_review + انتظار المراجعة => submitted
 * - pending_review + يتم الحفظ/أي حالة أخرى => approved (فاتورة قديمة منقولة)
 */
export function getCanonicalWorkflowStatus(invoice = {}) {
  const workflow = String(invoice.workflow_status || '').trim();
  const legacy = String(invoice.status || '').trim();

  if (WORKFLOW_STATUSES.includes(workflow)) return workflow;
  if (workflow === 'pending_review') {
    return legacy === 'انتظار المراجعة' ? 'submitted' : 'approved';
  }
  if (legacy === 'انتظار المراجعة') return 'submitted';
  if (legacy === 'مسودة') return 'draft';
  if (legacy === 'مرتجعة للتصحيح') return 'returned';
  if (legacy === 'تمت المراجعة') return 'reviewed';
  return 'approved';
}

export function isPendingInvoiceReview(invoice = {}) {
  return getCanonicalWorkflowStatus(invoice) === 'submitted';
}

export function countCanonicalInvoiceStatuses(invoices = []) {
  const counts = { all: invoices.length, draft: 0, submitted: 0, reviewed: 0, returned: 0, approved: 0 };
  invoices.forEach((invoice) => {
    const status = getCanonicalWorkflowStatus(invoice);
    counts[status] = (counts[status] || 0) + 1;
  });
  return counts;
}
