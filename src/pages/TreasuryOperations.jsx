import { useEffect, useMemo, useState } from 'react';
import { treasuryApi } from '@/api/treasuryApi';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';

const today = () => new Date().toISOString().slice(0, 10);
const money = (value) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(value || 0));

export default function TreasuryOperations() {
  const [treasuries, setTreasuries] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ treasury_id: '', closing_date: today(), actual_balance: '', counted_by_name: '', notes: '' });

  async function refresh() {
    setLoading(true); setError('');
    try {
      const [dashboard, alertRows] = await Promise.all([treasuryApi.dashboard(), treasuryApi.alerts()]);
      setTreasuries(dashboard?.treasuries || []);
      setAlerts(alertRows || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, []);

  const selected = useMemo(() => treasuries.find((x) => x.id === form.treasury_id), [treasuries, form.treasury_id]);
  const groupedAlerts = useMemo(() => ({
    critical: alerts.filter((x) => x.severity === 'critical'),
    warning: alerts.filter((x) => x.severity === 'warning'),
    info: alerts.filter((x) => !['critical', 'warning'].includes(x.severity)),
  }), [alerts]);

  async function closeDay() {
    setLoading(true); setError(''); setMessage('');
    try {
      const result = await treasuryApi.closeDay({ ...form, actual_balance: Number(form.actual_balance) });
      setMessage(`تم إقفال اليوم. الرصيد النظامي ${money(result?.system_balance)} ج، والفرق ${money(result?.difference)} ج.`);
      setForm((current) => ({ ...current, actual_balance: '', counted_by_name: '', notes: '' }));
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">رقابة الخزنة والإقفال اليومي</h1><p className="text-sm text-slate-500 mt-1">متابعة التحويلات المعلقة، فروق الجرد، وإقفال كل خزنة يوميًا.</p></div>
        <button onClick={refresh} disabled={loading} className="rounded-lg border bg-white px-4 py-2 flex gap-2"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />تحديث</button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5" />{error}</div>}
      {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-700 flex gap-2"><CheckCircle2 className="w-5 h-5" />{message}</div>}

      <div className="grid md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4"><div className="text-sm text-red-700">حرج</div><div className="text-3xl font-bold text-red-800 mt-1">{groupedAlerts.critical.length}</div></div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="text-sm text-amber-700">تحذير</div><div className="text-3xl font-bold text-amber-800 mt-1">{groupedAlerts.warning.length}</div></div>
        <div className="rounded-xl border bg-white p-4"><div className="text-sm text-slate-500">إجمالي التنبيهات</div><div className="text-3xl font-bold mt-1">{alerts.length}</div></div>
      </div>

      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="font-bold flex gap-2"><ShieldCheck className="w-5 h-5 text-blue-700" />إقفال يومي</h2>
        <div className="mt-3 grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <label className="text-sm">الخزنة<select value={form.treasury_id} onChange={(e) => setForm({ ...form, treasury_id: e.target.value, actual_balance: '' })} className="mt-1 w-full rounded-lg border p-2"><option value="">اختر الخزنة</option>{treasuries.map((x) => <option key={x.id} value={x.id}>{x.branch} — {x.account_name || x.account_type}</option>)}</select></label>
          <label className="text-sm">تاريخ الإقفال<input type="date" value={form.closing_date} onChange={(e) => setForm({ ...form, closing_date: e.target.value })} className="mt-1 w-full rounded-lg border p-2" /></label>
          <label className="text-sm">الرصيد الحالي<input readOnly value={selected ? money(selected.balance) : ''} className="mt-1 w-full rounded-lg border bg-slate-100 p-2" /></label>
          <label className="text-sm">الرصيد الفعلي<input type="number" value={form.actual_balance} onChange={(e) => setForm({ ...form, actual_balance: e.target.value })} className="mt-1 w-full rounded-lg border p-2" /></label>
          <label className="text-sm">من قام بالعد<input value={form.counted_by_name} onChange={(e) => setForm({ ...form, counted_by_name: e.target.value })} className="mt-1 w-full rounded-lg border p-2" /></label>
          <label className="text-sm">ملاحظات<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 w-full rounded-lg border p-2" /></label>
        </div>
        <button onClick={closeDay} disabled={loading || !form.treasury_id || form.actual_balance === ''} className="mt-3 rounded-lg bg-blue-700 text-white px-4 py-2 font-bold disabled:opacity-40">إقفال واعتماد اليوم</button>
      </section>

      <section className="rounded-2xl border bg-white shadow-sm overflow-auto">
        <div className="p-4 font-bold">التنبيهات التشغيلية</div>
        <table className="min-w-[900px] w-full text-sm"><thead className="bg-slate-50"><tr>{['الخطورة','النوع','الفرع','الخزنة','التاريخ','التفاصيل'].map((h)=><th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody>
          {alerts.map((x, i) => <tr key={`${x.alert_type}-${x.reference_id || i}`} className="border-t"><td className="p-3">{x.severity}</td><td className="p-3">{x.alert_type}</td><td className="p-3">{x.branch || '—'}</td><td className="p-3">{x.account_type || '—'}</td><td className="p-3">{x.alert_date || '—'}</td><td className="p-3">{x.message || x.details || '—'}</td></tr>)}
          {!alerts.length && <tr><td colSpan="6" className="p-8 text-center text-slate-500">لا توجد تنبيهات حاليًا.</td></tr>}
        </tbody></table>
      </section>
    </div>
  );
}