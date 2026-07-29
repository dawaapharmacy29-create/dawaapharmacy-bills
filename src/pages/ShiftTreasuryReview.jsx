import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { treasuryApi } from '@/api/treasuryApi';
import { AlertTriangle, ArrowRight, Banknote, CheckCircle2, ChevronDown, ChevronUp, CreditCard, Landmark, Loader2, RefreshCw, RotateCcw, ShieldCheck, Wallet } from 'lucide-react';

const money = (value) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(value || 0));
const numberValue = (value) => Number(value || 0);

function parseShift(shift) {
  const entries = Array.isArray(shift.expenses) ? shift.expenses : [];
  const findAmount = (type, category) => numberValue(entries.find((entry) => entry.entry_type === type && entry.category === category)?.amount);
  const expenseItems = entries.filter((entry) => !entry.entry_type || entry.entry_type === 'expense');
  const cashSales = findAmount('collection', 'نقدي');
  const cardSales = findAmount('collection', 'فيزا');
  const transferSales = findAmount('collection', 'تحويل');
  const openingCash = findAmount('cash_control', 'رصيد افتتاحي');
  const expectedCash = findAmount('cash_control', 'نقدية متوقعة');
  const actualCash = findAmount('cash_control', 'نقدية فعلية');
  const recordedDifference = entries.find((entry) => entry.entry_type === 'cash_control' && entry.category === 'فرق الخزنة');
  const cashDifference = recordedDifference ? numberValue(recordedDifference.amount) : 0;
  const hasDetailedCollections = entries.some((entry) => entry.entry_type === 'collection');
  return { expenseItems, cashSales, cardSales, transferSales, openingCash, expectedCash, actualCash, cashDifference, hasDetailedCollections };
}

function Metric({ label, value, className = 'text-slate-900' }) {
  return <div className="rounded-xl border bg-white p-3 text-center"><p className="text-[11px] text-slate-500">{label}</p><p className={`mt-1 text-lg font-bold ${className}`}>{value}</p></div>;
}

export default function ShiftTreasuryReview() {
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('shift');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState(focusId || '');
  const [returnReasons, setReturnReasons] = useState({});
  const [differenceAcknowledged, setDifferenceAcknowledged] = useState({});
  const [branch, setBranch] = useState('all');
  const [shiftType, setShiftType] = useState('all');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const dashboard = await treasuryApi.dashboard();
      setRows(Array.isArray(dashboard?.pending_shifts) ? dashboard.pending_shifts : []);
    } catch (loadError) {
      setError(loadError.message || 'تعذر تحميل الشيفتات المعلقة.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (!focusId || !rows.length) return;
    setExpanded(focusId);
    window.setTimeout(() => document.getElementById(`shift-review-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }, [focusId, rows]);

  async function run(action, success) {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
      await refresh();
    } catch (actionError) {
      setError(actionError.message || 'تعذر تنفيذ الإجراء.');
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => rows.filter((shift) => {
    if (branch !== 'all' && shift.branch !== branch) return false;
    if (shiftType !== 'all' && shift.shift_type !== shiftType) return false;
    return true;
  }), [rows, branch, shiftType]);

  const summary = useMemo(() => {
    let differences = 0;
    let amount = 0;
    filtered.forEach((shift) => {
      const details = parseShift(shift);
      if (Math.abs(details.cashDifference) > 0.009) differences += 1;
      amount += numberValue(shift.total_sales);
    });
    return { count: filtered.length, differences, amount };
  }, [filtered]);

  return <div dir="rtl" className="space-y-5 p-4 md:p-6">
    <header className="rounded-2xl border bg-gradient-to-l from-amber-50 via-white to-teal-50 p-4 shadow-sm md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-amber-700"/><h1 className="text-2xl font-bold text-slate-900">مراجعة واعتماد تسليمات الشيفت</h1></div><p className="mt-1 text-sm text-slate-600">راجع طرق التحصيل والمصروفات والنقدية الفعلية قبل ترحيل أي مبلغ إلى الخزنة.</p></div>
        <div className="flex gap-2"><Link to="/shift-delivery" className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-slate-700"><ArrowRight className="h-4 w-4"/>تسليم الشيفتات</Link><button onClick={refresh} disabled={loading} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-semibold">{loading ? <Loader2 className="h-4 w-4 animate-spin"/> : <RefreshCw className="h-4 w-4"/>}تحديث</button></div>
      </div>
    </header>

    {error && <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="h-5 w-5 shrink-0"/>{error}</div>}
    {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</div>}

    <div className="grid grid-cols-3 gap-3"><Metric label="بانتظار المراجعة" value={summary.count}/><Metric label="بها فرق نقدية" value={summary.differences} className={summary.differences ? 'text-red-600' : 'text-emerald-700'}/><Metric label="إجمالي المبيعات" value={`${money(summary.amount)} ج`} className="text-blue-700"/></div>

    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-2">
        <select value={branch} onChange={(event) => setBranch(event.target.value)} className="rounded-lg border p-2 text-sm"><option value="all">كل الفروع</option><option>دواء الشامي</option><option>دواء شكري</option></select>
        <select value={shiftType} onChange={(event) => setShiftType(event.target.value)} className="rounded-lg border p-2 text-sm"><option value="all">كل الشيفتات</option><option>صباحي</option><option>مسائي</option><option>ليلي</option></select>
      </div>
    </section>

    <div className="space-y-4">
      {filtered.map((shift) => {
        const details = parseShift(shift);
        const isOpen = expanded === shift.id;
        const hasDifference = Math.abs(details.cashDifference) > 0.009;
        const canApprove = !hasDifference || differenceAcknowledged[shift.id];
        return <article id={`shift-review-${shift.id}`} key={shift.id} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${focusId === shift.id ? 'ring-2 ring-amber-400' : ''}`}>
          <button type="button" onClick={() => setExpanded(isOpen ? '' : shift.id)} className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-right">
            <div><div className="flex flex-wrap items-center gap-2"><span className="font-bold text-slate-900">{shift.branch} — شيفت {shift.shift_type}</span><span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-800">انتظار اعتماد</span>{hasDifference && <span className="rounded-full bg-red-100 px-2 py-1 text-[11px] font-bold text-red-700">فرق {money(details.cashDifference)} ج</span>}</div><p className="mt-1 text-xs text-slate-500">{shift.shift_date} • المسؤول: {shift.submitted_by || '—'}</p></div>
            <div className="flex items-center gap-4"><div className="text-left"><p className="text-[11px] text-slate-400">إجمالي المبيعات</p><p className="font-bold text-blue-700">{money(shift.total_sales)} ج</p></div>{isOpen ? <ChevronUp className="h-5 w-5"/> : <ChevronDown className="h-5 w-5"/>}</div>
          </button>

          {isOpen && <div className="space-y-4 border-t bg-slate-50/60 p-4">
            {details.hasDetailedCollections ? <div className="grid grid-cols-2 gap-2 md:grid-cols-4"><Metric label="نقدي" value={`${money(details.cashSales)} ج`} className="text-emerald-700"/><Metric label="فيزا" value={`${money(details.cardSales)} ج`} className="text-blue-700"/><Metric label="تحويلات ومحافظ" value={`${money(details.transferSales)} ج`} className="text-violet-700"/><Metric label="المصروفات" value={`${money(shift.total_expenses)} ج`} className="text-red-600"/></div> : <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">هذا تسليم قديم لا يحتوي على فصل طرق التحصيل. راجع الإجمالي والملاحظات قبل الاعتماد.</div>}

            {details.hasDetailedCollections && <div className="grid grid-cols-2 gap-2 md:grid-cols-4"><Metric label="رصيد البداية" value={`${money(details.openingCash)} ج`}/><Metric label="النقدية المتوقعة" value={`${money(details.expectedCash)} ج`} className="text-indigo-700"/><Metric label="النقدية الفعلية" value={`${money(details.actualCash)} ج`} className="text-teal-700"/><Metric label="فرق الخزنة" value={`${money(details.cashDifference)} ج`} className={hasDifference ? 'text-red-600' : 'text-emerald-700'}/></div>}

            {!!details.expenseItems.length && <div className="overflow-hidden rounded-xl border bg-white"><div className="border-b px-3 py-2 text-sm font-bold">تفاصيل المصروفات</div><div className="divide-y">{details.expenseItems.map((entry, index) => <div key={`${entry.category}-${index}`} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-sm"><div><p className="font-semibold">{entry.category || 'أخرى'}</p><p className="text-xs text-slate-500">{entry.description || 'بدون بيان'}</p></div><p className="font-bold text-red-600">{money(entry.amount)} ج</p></div>)}</div></div>}

            {shift.notes && <div className="rounded-xl border bg-white p-3"><p className="text-xs font-bold text-slate-500">ملاحظات التسليم</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{shift.notes}</p></div>}
            {shift.treasury_review_note && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">سبب الإرجاع السابق: {shift.treasury_review_note}</div>}

            {hasDifference && <label className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><input type="checkbox" checked={!!differenceAcknowledged[shift.id]} onChange={(event) => setDifferenceAcknowledged({ ...differenceAcknowledged, [shift.id]: event.target.checked })} className="mt-1"/><span><strong>يوجد فرق نقدية.</strong> أؤكد أنني راجعت سبب العجز أو الزيادة، وأتحمل اعتماد الترحيل بهذه القيمة.</span></label>}

            <div className="flex flex-wrap gap-2 border-t pt-4"><button disabled={loading || !canApprove} onClick={() => run(() => treasuryApi.approveShift(shift.id), 'تم اعتماد الشيفت وترحيل مبالغ التحصيل إلى الخزنة.')} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"><CheckCircle2 className="h-4 w-4"/>اعتماد وترحيل</button><input value={returnReasons[shift.id] || ''} onChange={(event) => setReturnReasons({ ...returnReasons, [shift.id]: event.target.value })} placeholder="اكتب سبب الإرجاع بالتحديد" className="min-w-[240px] flex-1 rounded-lg border bg-white px-3 py-2 text-sm"/><button disabled={loading || (returnReasons[shift.id] || '').trim().length < 3} onClick={() => run(() => treasuryApi.returnShift(shift.id, returnReasons[shift.id]), 'تم إرجاع الشيفت للتصحيح دون ترحيل أي مبلغ.')} className="flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-40"><RotateCcw className="h-4 w-4"/>إرجاع للتصحيح</button></div>
          </div>}
        </article>;
      })}
      {!filtered.length && !loading && <div className="rounded-2xl border bg-white py-16 text-center text-sm text-slate-500"><Wallet className="mx-auto mb-2 h-8 w-8 text-slate-300"/>لا توجد شيفتات معلقة مطابقة للفلاتر.</div>}
    </div>
  </div>;
}
