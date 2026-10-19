import { CalendarDays, Clock3, FileText, Store, UserRound, UserRoundPen } from 'lucide-react';
import { describeBConnectInvoiceTimestamp } from '@/lib/bconnectInvoiceTimestamp';
import { normalizeBranch } from '@/lib/purchaseInvoiceTruth';

function Detail({ icon: Icon, title, children, strong = false }) {
  return <div className="min-w-0 rounded-lg bg-slate-50/80 p-3">
    <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
      <Icon className="h-3.5 w-3.5 shrink-0" />{title}
    </div>
    <div className={'mt-1 break-words ' + (strong ? 'text-sm font-black text-slate-900' : 'text-xs font-bold text-slate-800')}>
      {children}
    </div>
  </div>;
}

/** Header evidence comes from the Excel invoice record, not browser time. */
export default function BConnectInvoiceIdentity({ invoice, compact = false }) {
  const source = invoice?.bconnect || {};
  const app = invoice?.app || {};
  const stamp = describeBConnectInvoiceTimestamp(source.date);
  const supplier = String(source.supplier || '').trim();
  const appSupplier = String(app.supplier_name || '').trim();
  const sourceUser = String(source.user || '').trim();
  const appUser = String(app.entered_by_name || app.entered_by || '').trim();

  return <section dir="rtl" className="rounded-xl border border-slate-200 bg-white p-3" aria-label="بيانات الفاتورة من B-Connect">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-xs font-black text-slate-700">بيانات الفاتورة من B-Connect</h3>
      <span className="text-[10px] font-bold text-slate-400">كما وردت في الملف المرفوع</span>
    </div>
    <div className={'grid grid-cols-2 gap-2 ' + (compact ? 'lg:grid-cols-4' : 'md:grid-cols-4')}>
      <div className="col-span-2">
        <Detail icon={Store} title="اسم المورد في B-Connect" strong>{supplier || 'غير مسجل في الملف'}</Detail>
      </div>
      <Detail icon={CalendarDays} title="تاريخ الفاتورة">{stamp.date}</Detail>
      <Detail icon={Clock3} title="وقت الفاتورة">{stamp.time}</Detail>
      <Detail icon={Store} title="الفرع">{normalizeBranch(source.branch || app.branch) || 'غير محدد'}</Detail>
      <Detail icon={UserRoundPen} title="مدخل الفاتورة في B-Connect">{sourceUser || 'غير مسجل'}</Detail>
      {source.supplier_invoice_number && <Detail icon={FileText} title="رقم فاتورة المورد">{source.supplier_invoice_number}</Detail>}
      {!compact && <Detail icon={UserRound} title="مدخل الفاتورة في التطبيق">{app.id ? appUser || 'غير مسجل' : 'الفاتورة غير موجودة بالتطبيق'}</Detail>}
    </div>
    {app.id && appSupplier && appSupplier !== supplier && <div className="mt-2 text-xs font-semibold text-amber-800">
      اسم المورد في التطبيق: <strong>{appSupplier}</strong> — راجع هل الاسمين لنفس المورد.
    </div>}
    {!stamp.hasTime && <p className="mt-2 text-[11px] text-slate-500">
      لم يُسجّل وقت صريح للفاتورة في البيانات المقروءة؛ لن نعرض توقيتًا تقديريًا.
    </p>}
  </section>;
}
