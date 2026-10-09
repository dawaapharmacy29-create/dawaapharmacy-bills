/**
 * Read-only preparation for B-Connect purchase invoice entry.
 * This module never writes invoices or guesses supplier identities.
 */
export function prepareBConnectInvoiceDraft(source = {}, supplier = null) {
  const serial = String(source.serial ?? '').trim().replace(/\.0+$/, '');
  const supplierName = String(source.supplier ?? '').trim();
  const total = source.invoice_value == null || String(source.invoice_value).trim() === '' ? NaN : Number(source.invoice_value);
  const returned = source.return_value == null || source.return_value === '' ? 0 : Number(source.return_value);
  const issues = [];
  if (!/^\d+$/.test(serial)) issues.push('رقم مسلسل B-Connect غير صالح');
  if (!supplierName) issues.push('اسم المورد غير موجود');
  if (!supplier?.id || supplier?.name !== supplierName) issues.push('يجب تأكيد المورد من سجل الموردين');
  if (!Number.isFinite(total) || total < 0) issues.push('إجمالي الفاتورة غير صالح');
  if (!Number.isFinite(returned) || returned < 0 || returned > total) issues.push('قيمة المرتجع غير صالحة');
  const dateRaw = String(source.date ?? '').trim();
  const iso = dateRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dmy = dateRaw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  const date = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : '';
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  if (!dateValid) issues.push('تاريخ الفاتورة غير صالح');
  const branch = String(source.branch ?? '');
  if (!branch.includes('شكري') && !branch.includes('الشامي')) issues.push('الفرع يحتاج تأكيد');
  const payment = source.payment_type === 'نقدى' || source.payment_type === 'نقدي' ? 'كاش' : source.payment_type;
  if (!['كاش', 'آجل'].includes(payment)) issues.push('طريقة الدفع تحتاج تأكيد');
  return {
    ready_for_review: issues.length === 0,
    issues,
    source: { system: 'B-Connect', serial, user: source.user ?? null, row_number: source.row_number ?? null },
    invoice: {
      system_invoice_number: serial,
      supplier_name: supplierName,
      supplier_id: supplier?.id ?? null,
      branch: branch.includes('شكري') ? 'دواء شكري' : branch.includes('الشامي') ? 'دواء الشامي' : null,
      invoice_date: date,
      total_value: Number.isFinite(total) ? total : null,
      returned_value: Number.isFinite(returned) ? returned : null,
      net_value: Number.isFinite(total) && Number.isFinite(returned) ? total - returned : null,
      payment_type: payment ?? null,
      status: 'انتظار المراجعة',
    },
  };
}
