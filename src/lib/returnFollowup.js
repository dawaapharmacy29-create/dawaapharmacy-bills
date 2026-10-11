const RETURN_NOTE_KEYWORDS = [
  'اشعار',
  'مرتجع',
  'ارجاع',
  'راجع',
  'رجع',
  'خطا',
  'غلط',
  'تالف',
  'تلف',
  'صلاحية',
  'تاريخ',
  'اكسباير',
  'منتهي',
  'لم يصل',
  'ناقص',
  'رفض',
];

export function normalizeReturnText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function hasReturnFollowupSignal(invoice) {
  const returned = Number(invoice?.returned_value || 0);
  if (Number.isFinite(returned) && returned > 0) return true;
  const note = normalizeReturnText(invoice?.notes);
  return !!note && RETURN_NOTE_KEYWORDS.some((keyword) => note.includes(normalizeReturnText(keyword)));
}

export function returnMatchesInvoice(ret, invoice) {
  const invoiceNumber = String(invoice?.system_invoice_number || invoice?.invoice_number || '').trim();
  const returnInvoiceNumber = String(ret?.invoice_number || '').trim();
  if (!invoiceNumber || !returnInvoiceNumber || invoiceNumber !== returnInvoiceNumber) return false;
  const invoiceBranch = normalizeReturnText(invoice?.branch);
  const returnBranch = normalizeReturnText(ret?.branch_name);
  if (invoiceBranch && returnBranch && invoiceBranch !== returnBranch) return false;
  return true;
}

export function summarizeReturnItems(ret) {
  const items = Array.isArray(ret?.items) ? ret.items : [];
  return items
    .filter((item) => item?.product_name)
    .map((item) => `${item.product_name}${item.quantity ? ` × ${item.quantity}` : ''}${item.item_reason ? ` — ${item.item_reason}` : ''}`)
    .join(' | ');
}

export function buildReturnFollowupCandidates(invoices = [], returns = []) {
  return invoices
    .filter(hasReturnFollowupSignal)
    .map((invoice) => {
      const matchingReturns = returns.filter((ret) => returnMatchesInvoice(ret, invoice));
      const completed = matchingReturns.some((ret) => ret?.status === 'Returned');
      const activeReturn = matchingReturns.find((ret) => ret?.status !== 'Returned') || matchingReturns[0] || null;
      const total = Number(invoice?.total_value || 0);
      const returned = Number(invoice?.returned_value || 0);
      const net = Number.isFinite(total) && Number.isFinite(returned) ? total - returned : null;
      return {
        invoice,
        matchingReturns,
        activeReturn,
        completed,
        total,
        returned,
        net,
      };
    })
    .filter((row) => !row.completed)
    .sort((a, b) => String(b.invoice?.invoice_date || b.invoice?.created_date || '').localeCompare(String(a.invoice?.invoice_date || a.invoice?.created_date || '')));
}
