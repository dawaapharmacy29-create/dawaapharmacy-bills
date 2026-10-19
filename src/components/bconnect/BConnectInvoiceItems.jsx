import { useEffect, useMemo, useState } from 'react';
import { PackageSearch, RotateCcw } from 'lucide-react';

const amount = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n)
    ? n.toLocaleString('ar-EG', { maximumFractionDigits: 3 })
    : '—';
};

function Metric({ label, value, className = '' }) {
  return <div className={'rounded-xl border border-slate-200 bg-white px-3 py-2 ' + className}>
    <div className="text-[11px] font-bold text-slate-500">{label}</div>
    <div className="mt-1 text-sm font-black text-slate-900">{value}</div>
  </div>;
}

/**
 * Read-only item evidence from the currently uploaded Excel files.
 * Does not write item records or imply that details are stored in the app DB.
 */
export default function BConnectInvoiceItems({ invoice }) {
  const source = invoice?.bconnect || {};
  const items = Array.isArray(source.items) ? source.items : null;
  const [mode, setMode] = useState('all');
  useEffect(() => { setMode('all'); }, [invoice?.number, source.source_file]);
  const returnedItems = useMemo(() => (items || []).filter(
    (item) => Number(item.returned_quantity || 0) > 0
  ), [items]);
  const visibleItems = mode === 'returns' ? returnedItems : (items || []);
  const gross = Number(source.invoice_value);
  const net = Number(source.net);
  const returned = Number(source.return_value);
  const otherAdjustment = [source.invoice_value, source.net, source.return_value].every(
    (v) => v !== null && v !== undefined && Number.isFinite(Number(v))
  ) ? Number((gross - net - returned).toFixed(3)) : null;

  return <section dir="rtl" className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/40">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <PackageSearch className="h-5 w-5 text-teal-700" />
        <div>
          <h3 className="text-sm font-black text-slate-900">أصناف الفاتورة والمرتجعات</h3>
          <p className="text-[11px] text-slate-500">تفاصيل مقروءة من ملف B-Connect المرفوع — عرض فقط</p>
        </div>
      </div>
      {items && <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs font-bold">
        <button type="button" onClick={() => setMode('all')} className={'rounded-md px-3 py-1.5 ' + (mode === 'all' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-white')}>كل الأصناف ({items.length})</button>
        <button type="button" onClick={() => setMode('returns')} className={'rounded-md px-3 py-1.5 ' + (mode === 'returns' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-white')}>المرتجعات ({returnedItems.length})</button>
      </div>}
    </div>
    {!items ? <div className="px-4 py-6 text-sm text-slate-600">
      الملف ده بيعرض إجماليات الفواتير فقط، ومفيهوش سطور الأصناف التفصيلية. ارفع تقرير B-Connect التفصيلي لعرض الأصناف والكميات والمرتجعات.
    </div> : <>
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
        <Metric label="عدد سطور الأصناف" value={amount(items.length)} />
        <Metric label="سطور بها مرتجع" value={amount(returnedItems.length)} />
        <Metric label="قيمة المرتجعات" value={amount(source.return_value) + ' ج'} className={returnedItems.length ? 'border-rose-200' : ''} />
        <Metric label="صافي الفاتورة في الملف" value={amount(source.net) + ' ج'} />
      </div>
      {(source.supplier_invoice_number || source.source_file) && <div className="flex flex-wrap gap-x-5 gap-y-1 px-4 pb-3 text-[11px] text-slate-600">
        {source.supplier_invoice_number && <span>رقم فاتورة المورد: <strong className="font-mono">{source.supplier_invoice_number}</strong></span>}
        {source.source_file && <span>المصدر: <strong>{source.source_file}</strong></span>}
      </div>}
      {otherAdjustment !== null && Math.abs(otherAdjustment) > 0.02 && <div className="mx-3 mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
        يوجد فرق آخر بين الإجمالي والصافي بعد طرح المرتجعات: {amount(otherAdjustment)} ج. قد يكون خصمًا أو تسوية؛ لا يُعتبر مرتجعًا بدون دليل من السطور.
      </div>}
      {mode === 'returns' && !visibleItems.length ? <div className="px-4 pb-5 pt-1 text-sm font-bold text-slate-500">لا توجد كميات مرتجعة في تفاصيل الفاتورة.</div> : <div className="overflow-x-auto border-t border-slate-200">
        <table className="min-w-[930px] w-full text-right text-xs">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="min-w-[220px] px-3 py-2.5">الصنف / الكود</th>
              <th className="px-3 py-2.5">كمية الشراء</th>
              <th className="px-3 py-2.5">البونص</th>
              <th className="px-3 py-2.5">كمية المرتجع</th>
              <th className="px-3 py-2.5">صافي الكمية</th>
              <th className="px-3 py-2.5">سعر الشراء</th>
              <th className="px-3 py-2.5">إجمالي الشراء</th>
              <th className="px-3 py-2.5">سعر المرتجع</th>
              <th className="px-3 py-2.5">قيمة المرتجع</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {visibleItems.map((item) => <tr key={item.row_number} className={Number(item.returned_quantity || 0) > 0 ? 'bg-rose-50/50' : ''}>
              <td className="px-3 py-2.5"><div className="font-black text-slate-800">{item.name || 'بدون اسم'}</div><div className="mt-0.5 font-mono text-[11px] text-slate-500">{item.code || 'بدون كود'}</div></td>
              <td className="px-3 py-2.5 font-bold">{amount(item.purchased_quantity)}</td>
              <td className="px-3 py-2.5">{amount(item.bonus_quantity)}</td>
              <td className="px-3 py-2.5 font-black text-rose-700">{amount(item.returned_quantity)}</td>
              <td className="px-3 py-2.5 font-bold text-teal-800">{amount(item.net_quantity)}</td>
              <td className="px-3 py-2.5">{amount(item.purchase_unit_price)}</td>
              <td className="px-3 py-2.5">{amount(item.purchase_total)}</td>
              <td className="px-3 py-2.5">{amount(item.return_unit_price)}</td>
              <td className="px-3 py-2.5 font-bold text-rose-700">{amount(item.return_total)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>}
      {returnedItems.length > 0 && <div className="flex items-start gap-2 border-t border-rose-100 bg-rose-50 px-4 py-2.5 text-[11px] font-bold text-rose-800">
        <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" />
        الكمية الصافية للصنف = كمية الشراء − كمية المرتجع. قيمة المرتجع تُقرأ من عمود المرتجع في الملف، ولا نعيد حسابها بسعر الشراء.
      </div>}
    </>}
  </section>;
}
