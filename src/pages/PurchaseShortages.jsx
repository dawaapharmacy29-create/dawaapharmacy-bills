import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, PackageX, RefreshCw, Search } from 'lucide-react';
import { purchaseShortageApi } from '@/api/purchaseShortageApi';

const num = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function canContinueOrder(row) {
  if (!row?.last_order_id) return false;
  const status = String(row.last_order_status || '').trim().toLowerCase();
  return !['مغلقة', 'closed', 'ملغاة', 'cancelled', 'canceled'].includes(status);
}

function statusBadge(row) {
  if (row.current_status === 'unavailable') return ['غير متوفر', 'bg-red-100 text-red-800'];
  if (row.current_status === 'limited_supply') return ['توريد محدود', 'bg-amber-100 text-amber-800'];
  return ['تمت تغطيته لاحقًا', 'bg-emerald-100 text-emerald-800'];
}

export default function PurchaseShortages() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [branch, setBranch] = useState('all');
  const [filter, setFilter] = useState('open');
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setRows(await purchaseShortageApi.list() || []);
    } catch (err) {
      setError(err?.message || 'تعذر تحميل سجل النواقص.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const branches = useMemo(
    () => [...new Set(rows.map((row) => String(row.branch || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar')),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (branch !== 'all' && row.branch !== branch) return false;
      if (filter === 'open' && num(row.open_shortage_quantity) <= 0) return false;
      if (filter === 'recurring' && !row.is_recurring) return false;
      if (filter === 'limited' && !row.has_limited_supply) return false;
      if (filter === 'chronic' && !row.is_chronic) return false;
      if (q) {
        const hay = `${row.product_name || ''} ${row.product_code || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, branch, filter, search]);

  const summary = useMemo(() => ({
    open: rows.filter((row) => num(row.open_shortage_quantity) > 0).length,
    recurring: rows.filter((row) => row.is_recurring).length,
    limited: rows.filter((row) => row.has_limited_supply).length,
    chronic: rows.filter((row) => row.is_chronic).length,
  }), [rows]);

  return <div dir="rtl" className="space-y-5 p-3 md:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-amber-50 p-2.5"><PackageX className="h-6 w-6 text-amber-700" /></div>
        <div>
          <h1 className="text-2xl font-black text-slate-950">الأصناف الناقصة</h1>
          <p className="mt-1 text-sm text-slate-500">سجل مستمر للأصناف التي لا تتوفر أو يصل منها أقل من الكمية المطلوبة، مع تاريخ التكرار لكل فرع.</p>
        </div>
      </div>
      <button onClick={load} disabled={loading} className="flex items-center gap-2 rounded-lg border bg-white px-4 py-2 font-bold disabled:opacity-50">
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />تحديث
      </button>
    </header>

    {error && <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-red-700"><AlertTriangle className="h-5 w-5 shrink-0" />{error}</div>}

    <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {[
        ['نواقص مفتوحة', summary.open],
        ['نقص متكرر', summary.recurring],
        ['توريد محدود', summary.limited],
        ['نقص مزمن', summary.chronic],
      ].map(([label, value]) => <div key={label} className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="mt-2 text-2xl font-black text-slate-900">{value}</div>
      </div>)}
    </section>

    <section className="grid gap-3 rounded-2xl border bg-white p-4 shadow-sm md:grid-cols-4">
      <label className="text-sm font-bold">الفرع
        <select value={branch} onChange={(event) => setBranch(event.target.value)} className="mt-1 w-full rounded-lg border p-2 font-normal">
          <option value="all">كل الفروع</option>
          {branches.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <label className="text-sm font-bold">الحالة
        <select value={filter} onChange={(event) => setFilter(event.target.value)} className="mt-1 w-full rounded-lg border p-2 font-normal">
          <option value="open">النواقص المفتوحة</option>
          <option value="recurring">نقص متكرر</option>
          <option value="limited">توريد محدود</option>
          <option value="chronic">نقص مزمن</option>
          <option value="all">كل التاريخ</option>
        </select>
      </label>
      <label className="text-sm font-bold md:col-span-2">بحث
        <div className="relative mt-1">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="اسم الصنف أو الكود" className="w-full rounded-lg border py-2 pl-3 pr-9 font-normal" />
        </div>
      </label>
    </section>

    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="overflow-auto">
        <table className="min-w-[1180px] w-full text-sm">
          <thead className="bg-slate-50">
            <tr>{['الصنف','الفرع','الحالة','الناقص حاليًا','آخر طلب','آخر ما توفر','آخر ما استلم','مرات النقص','غير متوفر','توريد جزئي','تغطية التوفير','المتابعة'].map((head) => <th key={head} className="p-3 text-right">{head}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const [status, tone] = statusBadge(row);
              return <tr key={`${row.branch}-${row.product_key}`} className="border-t align-top">
                <td className="p-3 font-bold text-slate-900">{row.product_name}<div className="mt-1 text-xs font-normal text-slate-400">{row.product_code || 'بدون كود'}</div></td>
                <td className="p-3">{row.branch}</td>
                <td className="p-3"><div className="flex flex-wrap gap-1"><span className={`rounded-full px-2 py-1 text-xs font-bold ${tone}`}>{status}</span>{row.is_recurring && <span className="rounded-full bg-orange-100 px-2 py-1 text-xs font-bold text-orange-800">نقص متكرر</span>}{row.is_chronic && <span className="rounded-full bg-rose-100 px-2 py-1 text-xs font-bold text-rose-800">مزمن</span>}</div></td>
                <td className="p-3 text-lg font-black text-red-700">{num(row.open_shortage_quantity)}</td>
                <td className="p-3">{num(row.last_requested_quantity)}</td>
                <td className="p-3">{num(row.last_allocated_quantity)}</td>
                <td className="p-3">{num(row.last_received_quantity)}</td>
                <td className="p-3 font-bold">{num(row.shortage_occurrences)}</td>
                <td className="p-3">{num(row.unavailable_occurrences)}</td>
                <td className="p-3">{num(row.limited_supply_occurrences)}</td>
                <td className="p-3"><div className="font-bold">{num(row.supply_coverage_pct)}%</div><div className="text-xs text-slate-400">استلام فعلي {num(row.received_coverage_pct)}%</div></td>
                <td className="p-3">{num(row.open_shortage_quantity) > 0 ? (canContinueOrder(row) ? <Link to={`/smart-purchase-receiving?orderIds=${encodeURIComponent(row.last_order_id)}&selectedOrderId=${encodeURIComponent(row.last_order_id)}`} className="inline-flex rounded-lg bg-teal-700 px-3 py-2 text-xs font-black text-white">متابعة التوفير</Link> : <div className="space-y-1"><Link to="/purchase-center" className="inline-flex rounded-lg bg-amber-700 px-3 py-2 text-xs font-black text-white">متابعة في الطلبية القادمة</Link>{row.last_order_status ? <div className="text-[11px] text-slate-400">آخر طلبية: {row.last_order_status}</div> : null}</div>) : <span className="text-xs text-slate-400">للمراقبة التاريخية</span>}</td>
              </tr>;
            })}
            {!filtered.length && !loading && <tr><td colSpan={12} className="p-10 text-center text-slate-400">لا توجد أصناف مطابقة للفلاتر الحالية.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </div>;
}
