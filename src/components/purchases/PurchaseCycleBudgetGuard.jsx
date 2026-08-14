import { useEffect, useState } from 'react';
import { AlertTriangle, ShieldCheck, Gauge, WalletCards, RefreshCw, Save } from 'lucide-react';
import { smartPurchaseUnifiedApi as api } from '@/api/smartPurchaseUnifiedApi';

const money = (value) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(Number(value || 0));
const statusMeta = {
  safe: { label: 'آمن', box: 'border-emerald-200 bg-emerald-50', badge: 'bg-emerald-100 text-emerald-800' },
  warning: { label: 'تحذير', box: 'border-amber-200 bg-amber-50', badge: 'bg-amber-100 text-amber-800' },
  critical: { label: 'خطر مرتفع', box: 'border-orange-300 bg-orange-50', badge: 'bg-orange-100 text-orange-800' },
  blocked: { label: 'تجاوز الميزانية', box: 'border-red-300 bg-red-50', badge: 'bg-red-100 text-red-800' },
};

function BranchGuardCard({ row, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [budget, setBudget] = useState(String(Math.round(Number(row.cycle_budget || 0))));
  const [reserve, setReserve] = useState(String(Number(row.reserve_percent || 20)));
  const [reserveDays, setReserveDays] = useState(String(Number(row.reserve_days || 8)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const meta = statusMeta[row.status] || statusMeta.safe;
  const forecastOver = Number(row.forecast_over_budget || 0);
  const pace = Number(row.pace_variance || 0);

  async function save() {
    setSaving(true); setError('');
    try {
      await api.setCycleBudget({ branch: row.branch, cycleBudget: Number(budget), reservePercent: Number(reserve), reserveDays: Number(reserveDays) });
      setEditing(false); await onSaved();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  return <div className={`rounded-2xl border p-4 ${meta.box}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2"><h3 className="font-black text-lg">{row.branch}</h3><span className={`rounded-full px-2 py-1 text-xs font-bold ${meta.badge}`}>{meta.label}</span></div><p className="text-xs text-slate-500 mt-1">الدورة {row.cycle_start} ← {row.cycle_end} • اليوم {row.cycle_day} من {row.cycle_days}</p></div>
      <button onClick={() => setEditing((v) => !v)} className="rounded-lg border bg-white px-3 py-2 text-xs font-bold">{editing ? 'إلغاء' : row.configured ? 'تعديل الميزانية' : 'اعتماد ميزانية الدورة'}</button>
    </div>

    {!row.configured && <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">الميزانية الحالية تقديرية من متوسط آخر دورتين. اعتمد رقمك الفعلي حتى يتحول الحارس من استرشادي إلى رقابة فعلية.</div>}
    {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>}

    {editing && <div className="mt-3 grid sm:grid-cols-4 gap-2 rounded-xl border bg-white p-3">
      <label className="text-xs font-bold">ميزانية الدورة<input value={budget} onChange={(e) => setBudget(e.target.value)} type="number" min="1" className="mt-1 w-full rounded-lg border p-2" /></label>
      <label className="text-xs font-bold">احتياطي آخر الدورة %<input value={reserve} onChange={(e) => setReserve(e.target.value)} type="number" min="0" max="80" className="mt-1 w-full rounded-lg border p-2" /></label>
      <label className="text-xs font-bold">أيام الاحتياطي<input value={reserveDays} onChange={(e) => setReserveDays(e.target.value)} type="number" min="1" max="20" className="mt-1 w-full rounded-lg border p-2" /></label>
      <button onClick={save} disabled={saving || Number(budget) <= 0} className="self-end rounded-lg bg-slate-900 text-white px-3 py-2 font-bold disabled:opacity-50 flex items-center justify-center gap-2"><Save className="w-4 h-4" />حفظ</button>
    </div>}

    <div className="mt-3 grid grid-cols-2 xl:grid-cols-4 gap-2">
      {[
        ['ميزانية الدورة', `${money(row.cycle_budget)} ج`],
        ['المصروف حتى الآن', `${money(row.current_spend)} ج`],
        ['التزامات مفتوحة', `${money(row.open_commitments)} ج`],
        ['المتبقي الحقيقي', `${money(row.remaining_budget)} ج`],
        ['احتياطي لازم نحافظ عليه', `${money(row.reserve_required)} ج`],
        ['متاح آمن الآن', `${money(row.safe_available_now)} ج`],
        ['أقصى طلبية آمنة اليوم', `${money(row.safe_order_today)} ج`],
        ['يكفي شراء بالمعدل الحالي', `${Number(row.days_of_purchasing_power || 0).toFixed(1)} يوم`],
      ].map(([label, value]) => <div key={label} className="rounded-xl border bg-white/90 p-3"><div className="text-[11px] text-slate-500">{label}</div><div className="mt-1 font-black">{value}</div></div>)}
    </div>

    <div className="mt-3 grid md:grid-cols-3 gap-2 text-sm">
      <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">المفروض نكون صرفنا حتى اليوم</div><div className="font-bold mt-1">{money(row.paced_limit_to_date)} ج</div><div className={`text-xs mt-1 ${pace > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{pace > 0 ? `أعلى من المسار بـ ${money(pace)} ج` : `أقل من المسار بـ ${money(Math.abs(pace))} ج`}</div></div>
      <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">توقع نهاية الدورة بالمعدل الحالي</div><div className="font-bold mt-1">{money(row.forecast_end_cycle)} ج</div><div className={`text-xs mt-1 ${forecastOver > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{forecastOver > 0 ? `متوقع تجاوز ${money(forecastOver)} ج` : 'داخل الميزانية المتوقعة'}</div></div>
      <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">حد الشراء اليومي المقترح</div><div className="font-bold mt-1">{money(row.suggested_daily_cap)} ج</div><div className="text-xs text-slate-500 mt-1">باقي {row.days_remaining} يوم في الدورة</div></div>
    </div>
  </div>;
}

export default function PurchaseCycleBudgetGuard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try { const result = await api.cycleBudgetGuard('all'); setRows(result?.branches || []); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black text-lg flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-teal-600" />حارس ميزانية دورة المشتريات</h2><p className="text-xs text-slate-500 mt-1">يراقب المصروف + الالتزامات + الاحتياطي، ويتوقع من دلوقتي هل هتتزنق قبل يوم 25.</p></div><button onClick={load} disabled={loading} className="rounded-lg border px-3 py-2 text-sm flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />تحديث</button></div>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5" />{error}</div>}
    {loading && !rows.length ? <div className="rounded-xl border border-dashed p-6 text-center text-slate-400">جاري حساب مسار الميزانية...</div> : <div className="grid xl:grid-cols-2 gap-3">{rows.map((row) => <BranchGuardCard key={row.branch} row={row} onSaved={load} />)}</div>}
    <div className="grid md:grid-cols-3 gap-2 text-xs text-slate-600"><div className="flex gap-2 rounded-xl bg-slate-50 p-3"><Gauge className="w-4 h-4 shrink-0" />المسار الزمني يقارن ما تم صرفه بما كان يجب صرفه في نفس يوم الدورة.</div><div className="flex gap-2 rounded-xl bg-slate-50 p-3"><WalletCards className="w-4 h-4 shrink-0" />الالتزامات المفتوحة تتحسب قبل ما تتحول لفاتورة حتى لا نظن إن فيه سيولة غير موجودة.</div><div className="flex gap-2 rounded-xl bg-slate-50 p-3"><ShieldCheck className="w-4 h-4 shrink-0" />الاحتياطي يقل تدريجيًا في آخر أيام الدورة بدل ما نستهلك الميزانية بدري.</div></div>
  </section>;
}
