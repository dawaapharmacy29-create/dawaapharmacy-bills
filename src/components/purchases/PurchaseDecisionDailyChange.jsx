import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CalendarDays, Minus, RefreshCw } from 'lucide-react';
import { smartPurchaseUnifiedApi as api } from '@/api/smartPurchaseUnifiedApi';

const money = (v) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(Math.abs(Number(v || 0)));
const count = (v) => Math.abs(Number(v || 0));

function Delta({ label, value, moneyValue = false, positiveGood = false }) {
  const n = Number(value || 0);
  const improved = positiveGood ? n > 0 : n < 0;
  const worsened = positiveGood ? n < 0 : n > 0;
  const Icon = n > 0 ? ArrowUpRight : n < 0 ? ArrowDownRight : Minus;
  const cls = improved ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : worsened ? 'text-red-700 bg-red-50 border-red-200' : 'text-slate-600 bg-slate-50 border-slate-200';
  const display = moneyValue ? `${money(n)} ج` : count(n);
  return <div className={`rounded-xl border p-2.5 ${cls}`}><div className="flex items-center gap-1 text-[11px]"><Icon className="h-3.5 w-3.5" />{label}</div><div className="mt-1 font-black">{n > 0 ? '+' : n < 0 ? '-' : ''}{display}</div></div>;
}

export default function PurchaseDecisionDailyChange() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try { setData(await api.decisionDailyChange('all')); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><div className="flex items-center gap-2 font-black"><CalendarDays className="h-5 w-5 text-teal-700" />إيه اللي اتغيّر من آخر يوم مسجل؟</div><p className="mt-1 text-xs text-slate-500">مقارنة تشغيلية يومية تلقائية بدل ما تفتكر الأرقام بنفسك.</p></div>
      <button onClick={load} disabled={loading} className="rounded-lg border px-3 py-2 text-xs font-bold flex items-center gap-2"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />تحديث</button>
    </div>
    {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="mt-3 grid xl:grid-cols-2 gap-3">
      {(data?.branches || []).map((row) => <div key={row.branch} className="rounded-2xl border bg-slate-50/60 p-3">
        <div className="flex items-center justify-between gap-2"><div className="font-black">{row.branch}</div><div className="text-[11px] text-slate-500">{row.previous_date ? `مقارنة بـ ${row.previous_date}` : 'أول Snapshot — المقارنة هتظهر من اليوم التالي'}</div></div>
        {!row.delta ? <div className="mt-3 rounded-xl border border-dashed bg-white p-4 text-center text-xs text-slate-500">تم حفظ خط أساس اليوم. من التحديث القادم في يوم لاحق هتشوف الفرق تلقائيًا.</div> : <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          <Delta label="أقصى شراء اليوم" value={row.delta.safe_order_today} moneyValue positiveGood />
          <Delta label="المصروف" value={row.delta.current_spend} moneyValue />
          <Delta label="الالتزامات" value={row.delta.open_commitments} moneyValue />
          <Delta label="المتاح بعد الاحتياطي" value={row.delta.safe_available_now} moneyValue positiveGood />
          <Delta label="مطلوب استوك" value={row.delta.stock_needed_count} />
          <Delta label="رواكد" value={row.delta.deadstock_count} />
          <Delta label="تصريف مطلوب" value={row.delta.clearance_count} />
          <Delta label="رأس مال معرض" value={row.delta.capital_at_risk} moneyValue />
        </div>}
      </div>)}
    </div>
  </section>;
}
