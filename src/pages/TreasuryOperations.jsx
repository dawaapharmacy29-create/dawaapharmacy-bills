import { useEffect, useMemo, useState } from 'react';
import { treasuryApi } from '@/api/treasuryApi';
import { treasuryOperationsApi } from '@/api/operationsReviewApi';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, Send, RotateCcw, XCircle, History } from 'lucide-react';

const today = () => new Date().toISOString().slice(0, 10);
const money = (value) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(value || 0));
const ACCOUNT_LABELS = { cash: 'النقدي', instapay: 'إنستا باي', vodafone_cash: 'فودافون كاش', accounts_custody: 'عهدة الحسابات' };
const ACTION_LABELS = { insert: 'إنشاء', update: 'تعديل', status_change: 'تغيير حالة' };

export default function TreasuryOperations() {
  const [treasuries, setTreasuries] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [closures, setClosures] = useState([]);
  const [auditRows, setAuditRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [cancelReasons, setCancelReasons] = useState({});
  const [reopenReasons, setReopenReasons] = useState({});
  const [form, setForm] = useState({ treasury_id: '', closing_date: today(), actual_balance: '', counted_by_name: '', notes: '' });

  async function refresh() {
    setLoading(true); setError('');
    try {
      const [dashboard, alertRows, closureRows, audit] = await Promise.all([
        treasuryApi.dashboard(), treasuryApi.alerts(), treasuryApi.closures(), treasuryOperationsApi.auditFeed(60),
      ]);
      setTreasuries(dashboard?.treasuries || []);
      setTransfers(dashboard?.transfers || []);
      setAlerts(alertRows || []);
      setClosures(closureRows || []);
      setAuditRows(audit || []);
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

  async function run(action, success) {
    setLoading(true); setError(''); setMessage('');
    try { await action(); setMessage(success); await refresh(); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  const closeDay = () => run(async () => {
    const result = await treasuryApi.closeDay({ ...form, actual_balance: Number(form.actual_balance) });
    setMessage(`تم الإقفال. الرصيد النظامي ${money(result?.system_balance)} ج، والفرق ${money(result?.difference)} ج.`);
    setForm((current) => ({ ...current, actual_balance: '', counted_by_name: '', notes: '' }));
  }, 'تم إقفال الخزنة واعتماد فرق الجرد.');

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">رقابة الخزنة والإقفال اليومي</h1><p className="text-sm text-slate-500 mt-1">إقفال يومي، تحويلات وعهد، وتنبيهات مالية قابلة للحل والمتابعة.</p></div>
        <button onClick={refresh} disabled={loading} className="rounded-lg border bg-white px-4 py-2 flex gap-2"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />تحديث</button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5" />{error}</div>}
      {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-700 flex gap-2"><CheckCircle2 className="w-5 h-5" />{message}</div>}

      <div className="grid md:grid-cols-5 gap-3">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4"><div className="text-sm text-red-700">حرج</div><div className="text-3xl font-bold text-red-800 mt-1">{groupedAlerts.critical.length}</div></div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="text-sm text-amber-700">تحذير</div><div className="text-3xl font-bold text-amber-800 mt-1">{groupedAlerts.warning.length}</div></div>
        <div className="rounded-xl border bg-white p-4"><div className="text-sm text-slate-500">تحويلات معلقة</div><div className="text-3xl font-bold mt-1">{transfers.filter((x) => ['pending','transferred_to_accounts'].includes(x.status)).length}</div></div>
        <div className="rounded-xl border bg-white p-4"><div className="text-sm text-slate-500">إقفالات مسجلة</div><div className="text-3xl font-bold mt-1">{closures.length}</div></div>
        <div className="rounded-xl border bg-white p-4"><div className="text-sm text-slate-500">عمليات مدققة</div><div className="text-3xl font-bold mt-1">{auditRows.length}</div></div>
      </div>

      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="font-bold flex gap-2"><ShieldCheck className="w-5 h-5 text-blue-700" />إقفال يومي</h2>
        <div className="mt-3 grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <label className="text-sm">الخزنة<select value={form.treasury_id} onChange={(e) => setForm({ ...form, treasury_id: e.target.value, actual_balance: '' })} className="mt-1 w-full rounded-lg border p-2"><option value="">اختر الخزنة</option>{treasuries.map((x) => <option key={x.id} value={x.id}>{x.branch} — {x.account_name || ACCOUNT_LABELS[x.account_type] || x.account_type}</option>)}</select></label>
          <label className="text-sm">تاريخ الإقفال<input type="date" value={form.closing_date} onChange={(e) => setForm({ ...form, closing_date: e.target.value })} className="mt-1 w-full rounded-lg border p-2" /></label>
          <label className="text-sm">الرصيد الحالي<input readOnly value={selected ? money(selected.balance) : ''} className="mt-1 w-full rounded-lg border bg-slate-100 p-2" /></label>
          <label className="text-sm">الرصيد الفعلي<input type="number" value={form.actual_balance} onChange={(e) => setForm({ ...form, actual_balance: e.target.value })} className="mt-1 w-full rounded-lg border p-2" /></label>
          <label className="text-sm">من قام بالعد<input value={form.counted_by_name} onChange={(e) => setForm({ ...form, counted_by_name: e.target.value })} className="mt-1 w-full rounded-lg border p-2" /></label>
          <label className="text-sm">ملاحظات<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 w-full rounded-lg border p-2" /></label>
        </div>
        <button onClick={closeDay} disabled={loading || !form.treasury_id || form.actual_balance === ''} className="mt-3 rounded-lg bg-blue-700 text-white px-4 py-2 font-bold disabled:opacity-40">إقفال واعتماد اليوم</button>
      </section>

      <section className="rounded-2xl border bg-white shadow-sm overflow-auto">
        <div className="p-4 font-bold">التحويلات والعهد</div>
        <table className="min-w-[1200px] w-full text-sm"><thead className="bg-slate-50"><tr>{['التاريخ','الفرع','النوع','القيمة','الحالة','المنشئ','الإجراء','سبب الإلغاء'].map((h)=><th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody>
          {transfers.map((x) => <tr key={x.id} className="border-t"><td className="p-3">{x.transaction_date}</td><td className="p-3">{x.branch}</td><td className="p-3">{ACCOUNT_LABELS[x.transfer_type] || x.transfer_type}</td><td className="p-3 font-bold">{money(x.amount)} ج</td><td className="p-3">{x.status}</td><td className="p-3">{x.created_by_name || '—'}</td><td className="p-3"><div className="flex flex-wrap gap-2">{x.status==='pending'&&<button onClick={()=>run(()=>treasuryApi.handoverTransfer(x.id),'تم تسليم التحويل للحسابات.')} className="rounded bg-violet-600 text-white px-3 py-1.5 flex gap-1"><Send className="w-4 h-4"/>تسليم</button>}{x.status==='transferred_to_accounts'&&<button onClick={()=>run(()=>treasuryApi.postTransfer(x.id,'accounts_custody'),'تم الترحيل النهائي للعهدة.')} className="rounded bg-emerald-600 text-white px-3 py-1.5">ترحيل نهائي</button>}{!['posted_to_treasury','cancelled'].includes(x.status)&&<><input value={cancelReasons[x.id]||''} onChange={(e)=>setCancelReasons({...cancelReasons,[x.id]:e.target.value})} placeholder="سبب الإلغاء" className="rounded border px-2 py-1"/><button disabled={!cancelReasons[x.id]?.trim()} onClick={()=>run(()=>treasuryApi.cancelTransfer(x.id,cancelReasons[x.id]),'تم إلغاء التحويل بسبب مسجل.')} className="rounded border border-red-300 text-red-700 px-3 py-1.5 disabled:opacity-40"><XCircle className="w-4 h-4"/></button></>}</div></td><td className="p-3">{x.cancellation_reason || '—'}</td></tr>)}
        </tbody></table>
      </section>

      <section className="rounded-2xl border bg-white shadow-sm overflow-auto">
        <div className="p-4 font-bold">التنبيهات التشغيلية</div>
        <table className="min-w-[1000px] w-full text-sm"><thead className="bg-slate-50"><tr>{['الخطورة','النوع','الفرع','التاريخ','التفاصيل','الإجراء'].map((h)=><th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody>
          {alerts.map((x, i) => <tr key={`${x.alert_type}-${x.reference_id || i}`} className="border-t"><td className="p-3">{x.severity}</td><td className="p-3">{x.alert_type}</td><td className="p-3">{x.branch || '—'}</td><td className="p-3">{x.alert_date || '—'}</td><td className="p-3">{x.message || x.details || '—'}</td><td className="p-3"><button onClick={()=>run(()=>treasuryApi.resolveAlert(x.alert_type,x.reference_id,'resolved','تمت المراجعة من مركز الرقابة'),'تم حل التنبيه وإخفاؤه من القائمة.')} className="rounded bg-slate-800 text-white px-3 py-1.5">تم الحل</button></td></tr>)}
          {!alerts.length && <tr><td colSpan="6" className="p-8 text-center text-slate-500">لا توجد تنبيهات حاليًا.</td></tr>}
        </tbody></table>
      </section>

      <section className="rounded-2xl border bg-white shadow-sm overflow-auto">
        <div className="p-4 font-bold">سجل الإقفالات اليومية</div>
        <table className="min-w-[1100px] w-full text-sm"><thead className="bg-slate-50"><tr>{['التاريخ','الفرع','الخزنة','النظامي','الفعلي','الفرق','الحالة','إعادة فتح'].map((h)=><th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody>
          {closures.map((x)=><tr key={x.id} className="border-t"><td className="p-3">{x.closing_date}</td><td className="p-3">{x.branch}</td><td className="p-3">{ACCOUNT_LABELS[x.account_type] || x.account_type}</td><td className="p-3">{money(x.system_balance)} ج</td><td className="p-3">{money(x.actual_balance)} ج</td><td className="p-3 font-bold">{money(x.difference)} ج</td><td className="p-3">{x.status}</td><td className="p-3">{x.status==='closed'&&<div className="flex gap-2"><input value={reopenReasons[x.id]||''} onChange={(e)=>setReopenReasons({...reopenReasons,[x.id]:e.target.value})} placeholder="سبب إعادة الفتح" className="rounded border px-2 py-1"/><button disabled={!reopenReasons[x.id]?.trim()} onClick={()=>run(()=>treasuryApi.reopenDay({treasury_id:x.treasury_id,closing_date:x.closing_date,reason:reopenReasons[x.id]}),'تمت إعادة فتح اليوم بسبب مسجل.')} className="rounded border px-3 py-1.5 disabled:opacity-40"><RotateCcw className="w-4 h-4"/></button></div>}</td></tr>)}
        </tbody></table>
      </section>

      <section className="rounded-2xl border bg-white shadow-sm overflow-auto">
        <div className="p-4 font-bold flex items-center gap-2"><History className="w-5 h-5"/>سجل التدقيق المالي</div>
        <table className="min-w-[1100px] w-full text-sm"><thead className="bg-slate-50"><tr>{['الوقت','الفرع','الكيان','الإجراء','المستخدم','الحالة القديمة','الحالة الجديدة'].map((h)=><th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody>
          {auditRows.map((x)=><tr key={x.id} className="border-t"><td className="p-3">{x.created_at ? new Date(x.created_at).toLocaleString('ar-EG') : '—'}</td><td className="p-3">{x.branch || '—'}</td><td className="p-3">{x.entity_type}</td><td className="p-3">{ACTION_LABELS[x.action] || x.action}</td><td className="p-3">{x.actor_name || 'النظام'}</td><td className="p-3">{x.old_data?.status || '—'}</td><td className="p-3">{x.new_data?.status || '—'}</td></tr>)}
          {!auditRows.length && <tr><td colSpan="7" className="p-8 text-center text-slate-500">لا توجد عمليات جديدة في سجل التدقيق بعد.</td></tr>}
        </tbody></table>
      </section>
    </div>
  );
}