import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, FileText, PackageSearch, RotateCcw, Search } from 'lucide-react';

const amount = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString('ar-EG', { maximumFractionDigits: 3 })
    : '—';
};
const qty = (value) => amount(value);
const returned = (item) => Number(item?.returned_quantity || 0) > 0;

function Quantity({ label, value, emphasis = '' }) {
  return <div className="min-w-0">
    <div className="text-[10px] font-bold text-slate-500">{label}</div>
    <div className={'mt-0.5 text-sm font-black tabular-nums ' + (emphasis || 'text-slate-800')}>{qty(value)}</div>
  </div>;
}

function SourceItem({ item }) {
  const hasReturn = returned(item);
  const unusualReturn = item.purchased_quantity !== null && item.returned_quantity !== null &&
    Number(item.returned_quantity) > Number(item.purchased_quantity);

  return <details className={'group rounded-xl border bg-white transition ' +
    (hasReturn ? 'border-rose-200' : 'border-slate-200')}>
    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-3 marker:hidden [&::-webkit-details-marker]:hidden">
      <div className="min-w-[150px] flex-[1_1_180px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="break-words text-xs font-black text-slate-900">{item.name || 'صنف بدون اسم'}</span>
          {hasReturn && <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-black text-rose-700">مرتجع</span>}
          {unusualReturn && <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-black text-amber-800">راجع الكمية</span>}
        </div>
        <div className="mt-1 font-mono text-[11px] text-slate-500">{item.code || 'بدون كود'}</div>
      </div>
      <div className="grid min-w-[200px] flex-[1_1_220px] grid-cols-3 gap-2">
        <Quantity label="شراء" value={item.purchased_quantity} />
        <Quantity label="مرتجع" value={item.returned_quantity} emphasis={hasReturn ? 'text-rose-700' : ''} />
        <Quantity label="صافي" value={item.net_quantity} emphasis="text-teal-700" />
      </div>
      <div className="flex min-w-[108px] items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold text-slate-500">قيمة المرتجع</div>
          <div className={'mt-0.5 text-xs font-black ' + (hasReturn ? 'text-rose-700' : 'text-slate-700')}>{amount(item.return_total)} ج</div>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
      </div>
    </summary>
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 bg-slate-50/70 px-3 py-3 text-xs sm:grid-cols-4">
      <Quantity label="سعر الشراء" value={item.purchase_unit_price} />
      <Quantity label="إجمالي الشراء" value={item.purchase_total} />
      <Quantity label="سعر المرتجع" value={item.return_unit_price} />
      <Quantity label="بونص" value={item.bonus_quantity} />
      {item.source_item_reference && <div className="col-span-2 text-[11px] text-slate-500">مرجع الصنف بالمصدر: {item.source_item_reference}</div>}
      {item.expiration && <div className="col-span-2 text-[11px] text-slate-500">تاريخ الصلاحية: {String(item.expiration).slice(0, 10)}</div>}
    </div>
  </details>;
}

/**
 * Source evidence lives only inside the current review session.
 * Read-only — no product ledger writes or automatic supplier returns.
 */
export default function BConnectInvoiceItems({ invoice }) {
  const source = invoice?.bconnect || {};
  const items = Array.isArray(source.items) ? source.items : null;
  const [mode, setMode] = useState('all');
  const [search, setSearch] = useState('');
  useEffect(() => {
    setMode((source.items || []).some(returned) ? 'returns' : 'all');
    setSearch('');
  }, [invoice?.number, source.source_file, source.branch]);

  const returnItems = useMemo(() => (items || []).filter(returned), [items]);
  const searched = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const base = mode === 'returns' ? returnItems : (items || []);
    const list = needle ? base.filter((item) =>
      [item.name, item.code].some((field) => String(field || '').toLowerCase().includes(needle))
    ) : base;
    return [...list].sort((a, b) => Number(returned(b)) - Number(returned(a)));
  }, [items, returnItems, mode, search]);

  const adjustmentsKnown = [source.invoice_value, source.net, source.return_value].every(
    (v) => v !== null && v !== undefined && Number.isFinite(Number(v))
  );
  const otherAdjustments = adjustmentsKnown
    ? Number((Number(source.invoice_value) - Number(source.net) - Number(source.return_value)).toFixed(3))
    : null;

  return <section dir="rtl" className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <PackageSearch className="h-5 w-5 shrink-0 text-teal-700" />
        <div>
          <h3 className="text-sm font-black text-slate-900">أصناف الفاتورة</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">الكميات والمرتجعات من ملف B-Connect المرفوع، للعرض والمراجعة فقط</p>
        </div>
      </div>
      {returnItems.length > 0 && <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-black text-rose-700">
        <RotateCcw className="ml-1 inline h-3 w-3" />{returnItems.length} سطر مرتجع
      </span>}
    </div>
    {!items ? <div className="flex items-start gap-2 px-4 py-5 text-xs text-slate-600">
      <FileText className="h-5 w-5 shrink-0 text-slate-400" />
      هذا التقرير يحتوي على إجماليات الفواتير فقط. للحصول على تفاصيل الأصناف ارفع تقرير B-Connect التفصيلي.
    </div> : <>
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
        {[
          ['عدد الأصناف', amount(items.length)],
          ['سطور بها مرتجع', amount(returnItems.length)],
          ['قيمة المرتجعات', amount(source.return_value) + ' ج'],
          ['الصافي في المصدر', amount(source.net) + ' ج'],
        ].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-2.5">
          <div className="text-[10px] font-bold text-slate-500">{label}</div>
          <div className="mt-1 text-sm font-black text-slate-800">{value}</div>
        </div>)}
      </div>
      {(source.supplier_invoice_number || source.source_file) && <div className="flex flex-wrap gap-2 px-4 pb-3 text-[11px] text-slate-500">
        {source.supplier_invoice_number && <span>رقم فاتورة المورد: <strong className="text-slate-700">{source.supplier_invoice_number}</strong></span>}
        {source.source_file && <span className="max-w-full truncate">الملف: {source.source_file}</span>}
      </div>}
      {otherAdjustments !== null && Math.abs(otherAdjustments) > 0.02 && <div className="mx-3 mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
        يوجد فرق إضافي {amount(otherAdjustments)} ج بين إجمالي الفاتورة وصافيها بعد المرتجع. قد يكون خصمًا أو تسوية؛ لا تعتبره مرتجعًا بدون دليل.
      </div>}
      <div className="flex flex-wrap gap-2 border-t border-slate-100 px-3 py-3">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-xs font-black">
          <button type="button" onClick={() => setMode('all')} className={'rounded-md px-3 py-1.5 transition ' + (mode === 'all' ? 'bg-white text-teal-800 shadow-sm' : 'text-slate-500')}>الكل ({items.length})</button>
          <button type="button" onClick={() => setMode('returns')} className={'rounded-md px-3 py-1.5 transition ' + (mode === 'returns' ? 'bg-white text-teal-800 shadow-sm' : 'text-slate-500')}>المرتجعات ({returnItems.length})</button>
        </div>
        <label className="relative min-w-[170px] flex-1">
          <Search className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="اسم الصنف أو الكود" className="h-9 w-full rounded-lg border border-slate-200 bg-white pr-8 pl-2 text-xs outline-none focus:border-teal-400" />
        </label>
      </div>
      <div className="space-y-2 px-3 pb-3">
        {searched.map((item) => <SourceItem key={item.row_number} item={item} />)}
        {!searched.length && <div className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500">
          {search ? 'لا توجد أصناف مطابقة للبحث.' : mode === 'returns' ? 'لا يوجد مرتجع في سطور هذه الفاتورة.' : 'لا توجد أصناف في هذه الفاتورة.'}
        </div>}
      </div>
      {returnItems.length > 0 && <p className="border-t border-rose-100 bg-rose-50/70 px-4 py-2.5 text-[11px] text-rose-800">
        صافي كمية كل صنف = المشتريات − المرتجعات. لا يتم إنشاء حركة مرتجع أو تعديل المخزون من شاشة المراجعة.
      </p>}
    </>}
  </section>;
}
