import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { treasuryApi } from '@/api/treasuryApi';
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, CircleDollarSign, CreditCard, Database, FileWarning, Landmark, Loader2, RefreshCw, RotateCcw, ShieldCheck, Smartphone, TrendingDown, TrendingUp, Wallet } from 'lucide-react';

const money = (value) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(value || 0));
const numberValue = (value) => Number(value || 0);
const hasGap = (value) => value !== null && value !== undefined && Math.abs(Number(value || 0)) > 0.01;
const LEGACY_NON_CASH = new Set(['انستا', 'انستاباي', 'instapay', 'فودافون كاش', 'vodafone cash', 'تحويل داخلي', 'فيزا', 'visa']);

function parseShift(shift) {
  const entries = Array.isArray(shift.expenses) ? shift.expenses : [];
  const legacyItems = entries.filter((entry) => !entry.entry_type);
  const expenseItems = entries.filter((entry) => entry.entry_type === 'expense');
  const legacyNonCashItems = legacyItems.filter((entry) => LEGACY_NON_CASH.has(String(entry.category || '').trim().toLowerCase()));
  const legacyExpenseItems = legacyItems.filter((entry) => !LEGACY_NON_CASH.has(String(entry.category || '').trim().toLowerCase()));
  const fromEntry = (type, category) => numberValue(entries.find((entry) => entry.entry_type === type && entry.category === category)?.amount);
  return {
    expenseItems, legacyNonCashItems, legacyExpenseItems,
    cashSales: shift.cash_sales ?? fromEntry('collection', 'نقدي'),
    cardSales: shift.card_sales ?? fromEntry('collection', 'فيزا'),
    transferSales: shift.transfer_sales ?? fromEntry('collection', 'تحويل'),
    openingCash: shift.opening_cash ?? fromEntry('cash_control', 'رصيد افتتاحي'),
    expectedCash: shift.expected_cash ?? fromEntry('cash_control', 'نقدية متوقعة'),
    actualCash: shift.actual_cash ?? fromEntry('cash_control', 'نقدية فعلية'),
    cashDifference: shift.cash_difference ?? fromEntry('cash_control', 'فرق الخزنة'),
    dataQuality: shift.data_quality || (entries.some((entry) => entry.entry_type === 'collection') ? 'complete' : 'legacy'),
    legacyNonCash: numberValue(shift.legacy_non_cash),
    legacyTrueExpenses: numberValue(shift.legacy_true_expenses),
    cashToHandover: numberValue(shift.derived_cash_to_handover ?? shift.net_amount),
  };
}

function Metric({ label, value, hint, className = 'text-slate-900', icon: Icon }) {
  return <div className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-2"><div><p className="text-[11px] text-slate-500">{label}</p><p className={`mt-1 text-xl font-black ${className}`}>{value}</p>{hint && <p className="mt-1 text-[10px] text-slate-400">{hint}</p>}</div>{Icon && <div className="rounded-xl bg-slate-50 p-2"><Icon className="h-4 w-4 text-slate-500" /></div>}</div></div>;
}

function QualityBadge({ shift }) {
  const d = parseShift(shift);
  if (d.dataQuality === 'complete' && !hasGap(shift.sales_reconciliation_gap) && !hasGap(shift.cash_reconciliation_gap)) return <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-700">بيانات حديثة مكتملة</span>;
  if (d.dataQuality === 'legacy') return <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-800">بيانات تاريخية</span>;
  return <span className="rounded-full bg-red-100 px-2 py-1 text-[11px] font-bold text-red-700">يحتاج مراجعة بيانات</span>;
}

function ItemsBox({ title, items, total, tone = 'red' }) {
  if (!items?.length) return null;
  const textClass = tone === 'violet' ? 'text-violet-700' : 'text-red-600';
  return <div className="overflow-hidden rounded-xl border bg-white"><div className="flex items-center justify-between border-b px-3 py-2 text-sm font-bold"><span>{title}</span><span className={textClass}>{money(total)} ج</span></div><div className="divide-y">{items.map((entry, index) => <div key={`${entry.category}-${index}`} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-sm"><div><p className="font-semibold">{entry.category || 'أخرى'}</p><p className="text-xs text-slate-500">{entry.description || 'بدون بيان'}</p></div><p className={`font-bold ${textClass}`}>{money(entry.amount)} ج</p></div>)}</div></div>;
}

function pctChange(current, previous) {
  const a = numberValue(current), b = numberValue(previous);
  if (!b) return a ? 100 : 0;
  return ((a - b) / b) * 100;
}

function ChangeBadge({ current, previous }) {
  const value = pctChange(current, previous);
  const positive = value >= 0;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${positive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{positive ? <TrendingUp className="h-3 w-3"/> : <TrendingDown className="h-3 w-3"/>}{Math.abs(value).toFixed(1)}%</span>;
}

function IntelligencePanel({ data, days, setDays, autoRefresh, setAutoRefresh, lastUpdated }) {
  if (!data) return null;
  const k = data.kpis || {}, today = data.today || {}, yesterday = data.yesterday || {};
  const daily = Array.isArray(data.daily) ? data.daily : [];
  const branches = Array.isArray(data.branches) ? data.branches : [];
  const shifts = Array.isArray(data.shifts) ? data.shifts : [];
  const maxDaily = Math.max(1, ...daily.map((item) => numberValue(item.sales)));
  return <section className="space-y-4 rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-cyan-50 p-4 shadow-sm md:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><Activity className="h-5 w-5 text-cyan-700"/><h2 className="text-lg font-black text-slate-900">ذكاء المبيعات والتحصيل</h2></div><p className="mt-1 text-xs text-slate-500">متابعة مستمرة للمبيعات وصافي التسليم وInstapay وفودافون كاش ووسائل الدفع حسب الفرع والشيفت.</p></div><div className="flex flex-wrap items-center gap-2"><select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border bg-white px-3 py-2 text-xs font-bold"><option value={7}>آخر 7 أيام</option><option value={14}>آخر 14 يوم</option><option value={30}>آخر 30 يوم</option><option value={60}>آخر 60 يوم</option></select><label className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-xs font-bold"><input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)}/> تحديث تلقائي كل دقيقة</label><span className="text-[10px] text-slate-400">آخر تحديث: {lastUpdated ? lastUpdated.toLocaleTimeString('ar-EG') : '—'}</span></div></div>

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8"><Metric label="إجمالي المبيعات" value={`${money(k.total_sales)} ج`} className="text-blue-700" icon={CircleDollarSign}/><Metric label="صافي التسليم المحسوب" value={`${money(k.calculated_net)} ج`} className="text-emerald-700" hint={`${numberValue(k.calculated_net_share_pct).toFixed(1)}% من المبيعات`} icon={Wallet}/><Metric label="Instapay" value={`${money(k.instapay)} ج`} className="text-indigo-700" icon={Smartphone}/><Metric label="Vodafone Cash" value={`${money(k.vodafone_cash)} ج`} className="text-red-600" icon={Smartphone}/><Metric label="Visa" value={`${money(k.visa)} ج`} className="text-blue-600" icon={CreditCard}/><Metric label="تحويل داخلي" value={`${money(k.internal_transfer)} ج`} className="text-violet-700" icon={Landmark}/><Metric label="نسبة غير النقدي" value={`${numberValue(k.non_cash_share_pct).toFixed(1)}%`} className="text-violet-700" hint={`${money(k.non_cash_total)} ج`} icon={Activity}/><Metric label="متوسط مبيعات الشيفت" value={`${money(k.avg_sales_per_shift)} ج`} className="text-slate-800" icon={TrendingUp}/></div>

    <div className="grid gap-3 lg:grid-cols-3"><div className="rounded-2xl border bg-white p-4"><div className="flex items-center justify-between"><h3 className="font-black text-slate-900">نبض اليوم</h3><ChangeBadge current={today.sales} previous={yesterday.sales}/></div><div className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><p className="text-xs text-slate-500">مبيعات اليوم</p><p className="font-black text-blue-700">{money(today.sales)} ج</p></div><div><p className="text-xs text-slate-500">صافي اليوم</p><p className="font-black text-emerald-700">{money(today.calculated_net)} ج</p></div><div><p className="text-xs text-slate-500">Instapay</p><p className="font-black text-indigo-700">{money(today.instapay)} ج</p></div><div><p className="text-xs text-slate-500">Vodafone Cash</p><p className="font-black text-red-600">{money(today.vodafone_cash)} ج</p></div></div></div>
      <div className="rounded-2xl border bg-white p-4 lg:col-span-2"><div className="flex items-center justify-between"><h3 className="font-black text-slate-900">اتجاه المبيعات اليومي</h3><span className="text-[11px] text-slate-400">آخر {days} يوم</span></div><div className="mt-3 space-y-2">{daily.slice(-14).map((item) => <div key={item.shift_date} className="grid grid-cols-[76px_1fr_100px] items-center gap-2 text-xs"><span className="text-slate-500">{item.shift_date}</span><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.max(2, numberValue(item.sales) / maxDaily * 100)}%` }}/></div><span className="text-left font-bold text-slate-700">{money(item.sales)} ج</span></div>)}</div></div></div>

    <div className="grid gap-3 lg:grid-cols-2"><div className="rounded-2xl border bg-white p-4"><h3 className="font-black text-slate-900">مقارنة الفروع</h3><div className="mt-3 space-y-2">{branches.map((item) => <div key={item.branch} className="rounded-xl border bg-slate-50 p-3"><div className="flex items-center justify-between"><span className="font-bold">{item.branch || 'غير محدد'}</span><span className="font-black text-blue-700">{money(item.sales)} ج</span></div><div className="mt-2 grid grid-cols-4 gap-2 text-[11px]"><span>صافي<br/><b className="text-emerald-700">{money(item.calculated_net)}</b></span><span>انستا<br/><b className="text-indigo-700">{money(item.instapay)}</b></span><span>فودافون<br/><b className="text-red-600">{money(item.vodafone_cash)}</b></span><span>شيفتات<br/><b>{item.shift_count}</b></span></div></div>)}</div></div>
      <div className="rounded-2xl border bg-white p-4"><h3 className="font-black text-slate-900">مقارنة الشيفتات</h3><div className="mt-3 space-y-2">{shifts.map((item) => <div key={item.shift_type} className="rounded-xl border p-3"><div className="flex items-center justify-between"><span className="font-bold">{item.shift_type || 'غير محدد'}</span><span className="font-black text-blue-700">{money(item.sales)} ج</span></div><div className="mt-2 flex items-center justify-between text-[11px] text-slate-500"><span>الصافي {money(item.calculated_net)} ج</span><span>غير نقدي {money(item.non_cash_total)} ج</span><span>{item.shift_count} شيفت</span></div></div>)}</div></div></div>

    {(numberValue(k.net_gap_shifts) > 0 || numberValue(k.high_non_cash_shifts) > 0) && <div className="grid gap-2 md:grid-cols-2">{numberValue(k.net_gap_shifts) > 0 && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><b>{k.net_gap_shifts} شيفت</b> فيه فرق بين الصافي المسجل والصافي المحسوب ويحتاج مراجعة.</div>}{numberValue(k.high_non_cash_shifts) > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><b>{k.high_non_cash_shifts} شيفت</b> نسبة الدفع غير النقدي فيه أعلى من 70% — راجعه للتأكد من التصنيف.</div>}</div>}
  </section>;
}

export default function ShiftTreasuryReview() {
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('shift');
  const [rows, setRows] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState(focusId || '');
  const [returnReasons, setReturnReasons] = useState({});
  const [differenceAcknowledged, setDifferenceAcknowledged] = useState({});
  const [qualityAcknowledged, setQualityAcknowledged] = useState({});
  const [branch, setBranch] = useState('all');
  const [shiftType, setShiftType] = useState('all');
  const [days, setDays] = useState(14);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  async function refresh() {
    setLoading(true); setError('');
    try {
      const [pending, intelligence] = await Promise.all([
        treasuryApi.pendingShifts({ branch, shiftType, limit: 5000 }),
        treasuryApi.shiftSalesIntelligence({ branch, shiftType, days }),
      ]);
      setRows(Array.isArray(pending) ? pending : []);
      setAnalytics(intelligence || null);
      setLastUpdated(new Date());
    } catch (loadError) { setError(loadError.message || 'تعذر تحميل بيانات المبيعات والشيفتات.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, [branch, shiftType, days]);
  useEffect(() => { if (!autoRefresh) return undefined; const timer = window.setInterval(() => void refresh(), 60000); return () => window.clearInterval(timer); }, [autoRefresh, branch, shiftType, days]);
  useEffect(() => { if (!focusId || !rows.length) return; setExpanded(focusId); window.setTimeout(() => document.getElementById(`shift-review-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); }, [focusId, rows]);

  async function run(action, success) {
    setLoading(true); setError(''); setMessage('');
    try { await action(); setMessage(success); await refresh(); }
    catch (actionError) { setError(actionError.message || 'تعذر تنفيذ الإجراء.'); }
    finally { setLoading(false); }
  }

  const summary = useMemo(() => {
    let differences = 0, complete = 0, legacy = 0, dataIssues = 0, sales = 0, nonCash = 0, trueExpenses = 0, handover = 0;
    rows.forEach((shift) => { const d = parseShift(shift); if (Math.abs(d.cashDifference) > 0.009) differences += 1; if (d.dataQuality === 'complete' && !hasGap(shift.sales_reconciliation_gap) && !hasGap(shift.cash_reconciliation_gap)) complete += 1; else if (d.dataQuality === 'legacy') legacy += 1; else dataIssues += 1; sales += numberValue(shift.total_sales); nonCash += d.dataQuality === 'legacy' ? d.legacyNonCash : d.cardSales + d.transferSales; trueExpenses += d.dataQuality === 'legacy' ? d.legacyTrueExpenses : numberValue(shift.total_expenses); handover += d.cashToHandover; });
    return { count: rows.length, differences, complete, legacy, dataIssues, sales, nonCash, trueExpenses, handover };
  }, [rows]);

  return <div dir="rtl" className="space-y-5 p-4 md:p-6">
    <header className="rounded-2xl border bg-gradient-to-l from-amber-50 via-white to-teal-50 p-4 shadow-sm md:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-amber-700"/><h1 className="text-2xl font-black text-slate-900">مراجعة واعتماد تسليمات الشيفت</h1></div><p className="mt-1 text-sm text-slate-600">مركز متابعة مالي لحظي: مبيعات، صافي، Instapay، Vodafone Cash، Visa، الفروع والشيفتات مع تنبيهات ذكية.</p></div><div className="flex gap-2"><Link to="/shift-delivery" className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-slate-700"><ArrowRight className="h-4 w-4"/>تسليم الشيفتات</Link><button onClick={refresh} disabled={loading} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-semibold">{loading ? <Loader2 className="h-4 w-4 animate-spin"/> : <RefreshCw className="h-4 w-4"/>}تحديث</button></div></div></header>

    {error && <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="h-5 w-5 shrink-0"/>{error}</div>}
    {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</div>}

    <IntelligencePanel data={analytics} days={days} setDays={setDays} autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh} lastUpdated={lastUpdated}/>

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8"><Metric label="بانتظار المراجعة" value={summary.count} icon={ShieldCheck}/><Metric label="بيانات حديثة مكتملة" value={summary.complete} className="text-emerald-700" icon={Database}/><Metric label="سجلات تاريخية" value={summary.legacy} className={summary.legacy ? 'text-amber-700' : 'text-emerald-700'} icon={FileWarning}/><Metric label="مشاكل تطابق" value={summary.dataIssues} className={summary.dataIssues ? 'text-red-600' : 'text-emerald-700'} icon={AlertTriangle}/><Metric label="مبيعات المعلّق" value={`${money(summary.sales)} ج`} className="text-blue-700" icon={CircleDollarSign}/><Metric label="غير نقدي بالمعلّق" value={`${money(summary.nonCash)} ج`} className="text-violet-700" icon={Landmark}/><Metric label="مصروفات حقيقية" value={`${money(summary.trueExpenses)} ج`} className="text-red-600" icon={Wallet}/><Metric label="متوقع تسليمه نقدًا" value={`${money(summary.handover)} ج`} className="text-emerald-700" icon={Landmark}/></div>

    <section className="rounded-2xl border bg-white p-4 shadow-sm"><div className="grid gap-3 md:grid-cols-2"><label className="space-y-1"><span className="text-xs font-semibold text-slate-500">الفرع</span><select value={branch} onChange={(e) => setBranch(e.target.value)} className="w-full rounded-lg border p-2 text-sm"><option value="all">كل الفروع</option><option>دواء الشامي</option><option>دواء شكري</option></select></label><label className="space-y-1"><span className="text-xs font-semibold text-slate-500">الشيفت</span><select value={shiftType} onChange={(e) => setShiftType(e.target.value)} className="w-full rounded-lg border p-2 text-sm"><option value="all">كل الشيفتات</option><option>صباحي</option><option>مسائي</option><option>ليلي</option></select></label></div></section>

    <div className="space-y-3">{rows.map((shift) => {
      const d = parseShift(shift); const isOpen = expanded === shift.id; const hasDifference = Math.abs(d.cashDifference) > 0.009; const hasDataIssue = d.dataQuality !== 'complete' || hasGap(shift.sales_reconciliation_gap) || hasGap(shift.cash_reconciliation_gap); const canApprove = (!hasDifference || differenceAcknowledged[shift.id]) && (!hasDataIssue || qualityAcknowledged[shift.id]);
      return <article id={`shift-review-${shift.id}`} key={shift.id} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${focusId === shift.id ? 'ring-2 ring-amber-400' : ''}`}>
        <button type="button" onClick={() => setExpanded(isOpen ? '' : shift.id)} className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-right"><div className="min-w-[280px]"><div className="flex flex-wrap items-center gap-2"><span className="font-bold text-slate-900">{shift.branch} — شيفت {shift.shift_type}</span><span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-800">انتظار اعتماد</span><QualityBadge shift={shift}/>{hasDifference && <span className="rounded-full bg-red-100 px-2 py-1 text-[11px] font-bold text-red-700">فرق {money(d.cashDifference)} ج</span>}</div><p className="mt-1 text-xs text-slate-500">{shift.shift_date} • المسؤول: {shift.submitted_by || 'غير محدد'} • آخر مزامنة: {shift.imported_at ? new Date(shift.imported_at).toLocaleString('ar-EG') : 'غير مسجلة'}</p></div><div className="flex items-center gap-5"><div className="text-left"><p className="text-[11px] text-slate-400">المبيعات / المتوقع تسليمه نقدًا</p><p className="font-bold text-blue-700">{money(shift.total_sales)} ج <span className="text-slate-300">/</span> <span className="text-emerald-700">{money(d.cashToHandover)} ج</span></p></div>{isOpen ? <ChevronUp className="h-5 w-5"/> : <ChevronDown className="h-5 w-5"/>}</div></button>
        {isOpen && <div className="space-y-4 border-t bg-slate-50/60 p-4">
          {d.dataQuality === 'complete' ? <><div className="grid grid-cols-2 gap-2 md:grid-cols-4"><Metric label="نقدي" value={`${money(d.cashSales)} ج`} className="text-emerald-700"/><Metric label="فيزا" value={`${money(d.cardSales)} ج`} className="text-blue-700"/><Metric label="تحويلات ومحافظ" value={`${money(d.transferSales)} ج`} className="text-violet-700"/><Metric label="المصروفات" value={`${money(shift.total_expenses)} ج`} className="text-red-600"/></div><div className="grid grid-cols-2 gap-2 md:grid-cols-4"><Metric label="رصيد البداية" value={`${money(d.openingCash)} ج`}/><Metric label="النقدية المتوقعة" value={`${money(d.expectedCash)} ج`} className="text-indigo-700"/><Metric label="النقدية الفعلية" value={`${money(d.actualCash)} ج`} className="text-teal-700"/><Metric label="فرق الخزنة" value={`${money(d.cashDifference)} ج`} className={hasDifference ? 'text-red-600' : 'text-emerald-700'}/></div></> : <><div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><strong>سجل تاريخي من النظام القديم.</strong> فودافون كاش/انستا/فيزا/تحويل داخلي كانت محفوظة داخل حقل المصروفات رغم أنها وسائل دفع غير نقدية. العرض الحالي يفصلها بدون تغيير الأصل.</div><div className="grid grid-cols-2 gap-2 md:grid-cols-4"><Metric label="إجمالي المبيعات" value={`${money(shift.total_sales)} ج`} className="text-blue-700"/><Metric label="مدفوعات غير نقدية" value={`${money(d.legacyNonCash)} ج`} className="text-violet-700"/><Metric label="مصروفات فعلية/أخرى" value={`${money(d.legacyTrueExpenses)} ج`} className="text-red-600"/><Metric label="المتوقع تسليمه نقدًا" value={`${money(d.cashToHandover)} ج`} className="text-emerald-700"/></div></>}
          {(hasGap(shift.sales_reconciliation_gap) || hasGap(shift.cash_reconciliation_gap)) && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><p className="font-bold">عدم تطابق يحتاج مراجعة</p>{hasGap(shift.sales_reconciliation_gap) && <p className="mt-1">فرق إجمالي المبيعات عن مجموع طرق التحصيل: {money(shift.sales_reconciliation_gap)} ج</p>}{hasGap(shift.cash_reconciliation_gap) && <p className="mt-1">فرق حساب النقدية عن فرق الخزنة المسجل: {money(shift.cash_reconciliation_gap)} ج</p>}</div>}
          {d.dataQuality === 'legacy' ? <div className="grid gap-3 lg:grid-cols-2"><ItemsBox title="وسائل دفع غير نقدية (وليست مصروفات)" items={d.legacyNonCashItems} total={d.legacyNonCash} tone="violet"/><ItemsBox title="مصروفات/بنود أخرى فعلية" items={d.legacyExpenseItems} total={d.legacyTrueExpenses}/></div> : <ItemsBox title="تفاصيل المصروفات" items={d.expenseItems} total={shift.total_expenses}/>} 
          {shift.notes && <div className="rounded-xl border bg-white p-3"><p className="text-xs font-bold text-slate-500">ملاحظات التسليم</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{shift.notes}</p></div>}
          {shift.treasury_review_note && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">سبب الإرجاع السابق: {shift.treasury_review_note}</div>}
          {hasDataIssue && <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><input type="checkbox" checked={!!qualityAcknowledged[shift.id]} onChange={(e) => setQualityAcknowledged({ ...qualityAcknowledged, [shift.id]: e.target.checked })} className="mt-1"/><span><strong>تأكيد المراجعة:</strong> راجعت السجل التاريخي والبنود المصنفة، وأوافق على الاعتماد بالقيم الأصلية المسجلة فقط.</span></label>}
          {hasDifference && <label className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><input type="checkbox" checked={!!differenceAcknowledged[shift.id]} onChange={(e) => setDifferenceAcknowledged({ ...differenceAcknowledged, [shift.id]: e.target.checked })} className="mt-1"/><span><strong>يوجد فرق نقدية.</strong> أؤكد أنني راجعت سبب العجز أو الزيادة.</span></label>}
          <div className="flex flex-wrap gap-2 border-t pt-4"><button disabled={loading || !canApprove} onClick={() => run(() => treasuryApi.approveShift(shift.id), 'تم اعتماد الشيفت وترحيله إلى الخزنة.')} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"><CheckCircle2 className="h-4 w-4"/>اعتماد وترحيل</button><input value={returnReasons[shift.id] || ''} onChange={(e) => setReturnReasons({ ...returnReasons, [shift.id]: e.target.value })} placeholder="اكتب سبب الإرجاع بالتحديد" className="min-w-[240px] flex-1 rounded-lg border bg-white px-3 py-2 text-sm"/><button disabled={loading || (returnReasons[shift.id] || '').trim().length < 3} onClick={() => run(() => treasuryApi.returnShift(shift.id, returnReasons[shift.id]), 'تم إرجاع الشيفت للتصحيح دون ترحيل أي مبلغ.')} className="flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-40"><RotateCcw className="h-4 w-4"/>إرجاع للتصحيح</button></div>
        </div>}
      </article>;
    })}{!rows.length && !loading && <div className="rounded-2xl border bg-white py-16 text-center text-sm text-slate-500"><Wallet className="mx-auto mb-2 h-8 w-8 text-slate-300"/>لا توجد شيفتات معلقة مطابقة للفلاتر.</div>}</div>
  </div>;
}
