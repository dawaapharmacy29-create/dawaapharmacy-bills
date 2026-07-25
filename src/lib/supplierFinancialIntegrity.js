export const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

export function buildLinkedPaymentsByInvoice(payments = []) {
  return payments.reduce((map, payment) => {
    if (!payment.invoice_id) return map;
    map[payment.invoice_id] = roundMoney((map[payment.invoice_id] || 0) + Number(payment.amount || 0));
    return map;
  }, {});
}

export function getEffectiveInvoicePaid(invoice, linkedPaymentsByInvoice = {}) {
  const linked = roundMoney(linkedPaymentsByInvoice[invoice.id] || 0);
  // دعم البيانات القديمة: عند عدم وجود سجلات دفعات مرتبطة نستخدم paid_value القديم فقط.
  return linked > 0 ? linked : roundMoney(invoice.paid_value || 0);
}

export function getInvoiceRemaining(invoice, linkedPaymentsByInvoice = {}) {
  const net = roundMoney(Number(invoice.total_value || 0) - Number(invoice.returned_value || 0));
  return roundMoney(Math.max(0, net - getEffectiveInvoicePaid(invoice, linkedPaymentsByInvoice)));
}

export function validateInvoicePayment({ invoice, amount, linkedPaymentsByInvoice = {} }) {
  const numericAmount = roundMoney(amount);
  const remaining = getInvoiceRemaining(invoice, linkedPaymentsByInvoice);
  if (numericAmount <= 0) return 'قيمة الدفعة يجب أن تكون أكبر من صفر.';
  if (numericAmount > remaining) return `قيمة الدفعة أكبر من المتبقي على الفاتورة (${remaining}).`;
  return '';
}

export function scopedGeneralPayments(payments = [], supplierName, branch) {
  // لا نوزع الدفعات القديمة غير محددة الفرع تلقائياً حتى لا تُحتسب مرتين.
  return payments.filter((payment) =>
    payment.supplier_name === supplierName && !payment.invoice_id && payment.branch === branch
  );
}
