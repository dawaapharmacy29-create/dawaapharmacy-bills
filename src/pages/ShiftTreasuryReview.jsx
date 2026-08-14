import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { treasuryApi } from '@/api/treasuryApi';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, CircleDollarSign, Database, FileWarning, Landmark, Loader2, RefreshCw, RotateCcw, ShieldCheck, Wallet } from 'lucide-react';

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
    entries,
    expenseItems,
    legacyNonCashItems,
    legacyExpenseItems,
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
  return <div className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-2"><div><p className="text-[11px] text-slate-500">{label}</p><p className={`mt-1 text-xl font-bold ${className}`}>{value}</p>{hint && <p className="mt-1 text-[10px] text-slate-400">{hint}</p>}</div>{Icon && <div className="rounded-xl bg-slate-50 p-2"><Icon className="h-4 w-4 text-slate-500" /></div>}</div></div>;
}

function QualityBadge({ shift }) {
  const details = parseShift(shift);
  if (details.dataQuality === 'complete' && !hasGap(shift.sales_reconciliation_gap) && !hasGap(shift.cash_reconciliation_gap)) return <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-700">بيانات حديثة مكتملة</span>;
  if (details.dataQuality === 'legacy') return <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-800">بيانات تاريخية</span>;
  return <span className="rounded-full bg-red-100 px-2 py-1 text-[11px] font-bold text-red-700">يحتاج مراجعة بيانات</span>;
}

function ItemsBox({ title, items, total, tone = 'red' }) {
  if (!items?.length) return null;
  const textClass = tone === 'violet' ? 'text-violet-700' : 'text-red-600';
  return <div className="overflow-hidden rounded-xl border bg-white"><div className="flex items-center justify-between border-b px-3 py-2 text-sm font-bold"><span>{title}</span><span className={textClass}>{money(total)} ج</span></div><div className="divide-y">{items.map((entry, index) => <div key={`${entry.category}-${index}`} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-sm"><div><p className="font-semibold">{entry.category || 'أخرى'}</p><p className="text-xs text-slate-500">{entry.description || 'بدون بيان'}</p></div><p className={`font-bold ${textClass}`}>{money(entry.amount)} ج</p></div>)}</div></div>;
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
  const [qualityAcknowledged, setQualityAcknowledged] = useState({});
  const [branch, setBranch] = useState('all');
  const [shiftType, setShiftType] = useState('all');

  async function refresh() {
    setLoading(true); setError('');
    try { const data = await treasuryApi.pendingShifts({ branch, shiftType, limit: 5000 }); setRows(Array.isArray(data) ? data : []); }
    catch (loadError) { setError(loadError.message || 'تعذر تحميل الشيفتات المعلقة.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, [branch, shiftType]);
  useEffect(() => { if (!focusId || !rows.length) return; setExpanded(focusId); window.setTimeout(() => document.getElementById(`shift-review-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); }, [focusId, rows]);

  async function run(action, success) {
    setLoading(true); setError(''); setMessage('');
    try { await action(); setMessage(success); await refresh(); }
    catch (actionError) { setError(actionError.message || 'تعذر تنفيذ الإجراء.'); }
    finally { setLoading(false); }
  }

  const summary = useMemo(() => {
    let differences = 0, complete = 0, legacy = 0, dataIssues = 0, sales = 0, nonCash = 0, trueExpenses = 0, handover = 0;
    rows.forEach((shift) => {
      const d = parseShift(shift);
      if (Math.abs(d.cashDifference) > 0.009) differences += 1;
      if (d.dataQuality === 'complete' && !hasGap(shift.sales_reconciliation_gap) && !hasGap(shift.cash_reconciliation_gap)) complete += 1;
      else if (d.dataQuality === 'legacy') legacy += 1;
      else dataIssues += 1;
      sales += numberValue(shift.total_sales);
      nonCash += d.dataQuality === 'legacy' ? d.legacyNonCash : d.cardSales + d.transferSales;
      trueExpenses += d.dataQuality === 'legacy' ? d.legacyTrueExpenses : numberValue(shift.total_expenses);
      handover += d.cashToHandover;
    });
    return { count: rows.length, differences, complete, legacy, dataIssues, sales, nonCash, trueExpenses, handover };
  }, [rows]);

  return <div dir="rtl" className="space-y-5 p-4 md:p-6">
    <header className="rounded-2xl border bg-gradient-to-l from-amber-50 via-white to-teal-50 p-4 shadow-sm md:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-amber-700"/><h1 className="text-2xl font-bold text-slate-900">مراجعة واعتماد تسليمات الشيفت</h1></div><p className="mt-1 text-sm text-slate-600">عرض مالي مصحح: نفصل وسائل الدفع غير النقدية عن المصروفات الحقيقية، ونوضح جودة كل سجل قبل الاعتماد.</p></div><div className="flex gap-2"><Link to="/shift-delivery" className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-slate-700"><ArrowRight className="h-4 w-4"/>تسليم الشيفتات</Link><button onClick={refresh} disabled={loading} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-semibold">{loading ? <Loader2 className="h-4 w-4 animate-spin"/> : <RefreshCw className="h-4 w-4"/>}تحديث</button></div></div></header>

    {error && <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="h-5 w-5 shrink-0"/>{error}</div>}
    {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</div>}

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8"><Metric label="بانتظار المراجعة" value={summary.count} icon={ShieldCheck}/><Metric label="بيانات حديثة مكتملة" value={summary.complete} className="text-emerald-700" icon={Database}/><Metric label="سجلات تاريخية" value={summary.legacy} className={summary.legacy ? 'text-amber-700' : 'text-emerald-700'} icon={FileWarning}/><Metric label="مشاكل تطابق" value={summary.dataIssues} className={summary.dataIssues ? 'text-red-600' : 'text-emerald-700'} icon={AlertTriangle}/><Metric label="إجمالي المبيعات" value={`${money(summary.sales)} ج`} className="text-blue-700" icon={CircleDollarSign}/><Metric label="مدفوعات غير نقدية" value={`${money(summary.nonCash)} ج`} className="text-violet-700" icon={Landmark}/><Metric label="مصروفات حقيقية" value={`${money(summary.trueExpenses)} ج`} className="text-red-600" icon={Wallet}/><Metric label="متوقع تسليمه نقدًا" value={`${money(summary.handover)} ج`} className="text-emerald-700" icon={Landmark}/></div>

    <section className="rounded-2xl border bg-white p-4 shadow-sm"><div className="grid gap-3 md:grid-cols-2"><label className="space-y-1"><span className="text-xs font-semibold text-slate-500">الفرع</span><select value={branch} onChange={(e) => setBranch(e.target.value)} className="w-full rounded-lg border p-2 text-sm"><option value="all">كل الفروع</option><option>دواء الشامي</option><option>دواء شكري</option></select></label><label className="space-y-1"><span className="text-xs font-semibold text-slate-500">الشيفت</span><select value={shiftType} onChange={(e) => setShiftType(e.target.value)} className="w-full rounded-lg border p-2 text-sm"><option value="all">كل الشيفتات</option><option>صباحي</option><option>مسائي</option><option>ليلي</option></select></label></div></section>

    <div className="space-y-3">{rows.map((shift) => {
      const d = parseShift(shift); const isOpen = expanded === shift.id; const hasDifference = Math.abs(d.cashDifference) > 0.009; const hasDataIssue = d.dataQuality !== 'complete' || hasGap(shift.sales_reconciliation_gap) || hasGap(shift.cash_reconciliation_gap); const canApprove = (!hasDifference || differenceAcknowledged[shift.id]) && (!hasDataIssue || qualityAcknowledged[shift.id]);
      return <article id={`shift-review-${shift.id}`} key={shift.id} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${focusId === shift.id ? 'ring-2 ring-amber-400' : ''}`}>
        <button type="button" onClick={() => setExpanded(isOpen ? '' : shift.id)} className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-right"><div className="min-w-[280px]"><div className="flex flex-wrap items-center gap-2"><span className="font-bold text-slate-900">{shift.branch} — شيفت {shift.shift_type}</span><span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-800">انتظار اعتماد</span><QualityBadge shift={shift}/>{hasDifference && <span className="rounded-full bg-red-100 px-2 py-1 text-[11px] font-bold text-red-700">فرق {money(d.cashDifference)} ج</span>}</div><p className="mt-1 text-xs text-slate-500">{shift.shift_date} • المسؤول: {shift.submitted_by || 'غير محدد'} • آخر مزامنة: {shift.imported_at ? new Date(shift.imported_at).toLocaleString('ar-EG') : 'غير مسجلة'}</p></div><div className="flex items-center gap-5"><div className="text-left"><p className="text-[11px] text-slate-400">المبيعات / المتوقع تسليمه نقدًا</p><p className="font-bold text-blue-700">{money(shift.total_sales)} ج <span className="text-slate-300">/</span> <span className="text-emerald-700">{money(d.cashToHandover)} ج</span></p></div>{isOpen ? <ChevronUp className="h-5 w-5"/> : <ChevronDown className="h-5 w-5"/>}</div></button>

        {isOpen && <div className="space-y-4 border-t bg-slate-50/60 p-4">
          {d.dataQuality === 'complete' ? <><div className="grid grid-cols-2 gap-2 md:grid-cols-4"><Metric label="نقدي" value={`${money(d.cashSales)} ج`} className="text-emerald-700"/><Metric label="فيزا" value={`${money(d.cardSales)} ج`} className="text-blue-700"/><Metric label="تحويلات ومحافظ" value={`${money(d.transferSales)} ج`} className="text-violet-700"/><Metric label="المصروفات" value={`${money(shift.total_expenses)} ج`} className="text-red-600"/></div><div className="grid grid-cols-2 gap-2 md:grid-cols-4"><Metric label="رصيد البداية" value={`${money(d.openingCash)} ج`}/><Metric label="النقدية المتوقعة" value={`${money(d.expectedCash)} ج`} className="text-indigo-700"/><Metric label="النقدية الفعلية" value={`${money(d.actualCash)} ج`} className="text-teal-700"/><Metric label="فرق الخزنة" value={`${money(d.cashDifference)} ج`} className={hasDifference ? 'text-red-600' : 'text-emerald-700'}/></div></> : <><div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><strong>سجل تاريخي من النظام القديم.</strong> البنود مثل فودافون كاش/انستا/فيزا/تحويل داخلي كانت محفوظة قديمًا داخل حقل المصروفات رغم أنها وسائل دفع غير نقدية. الصفحة تفصلها الآن في العرض والحساب بدون تعديل البيانات الأصلية أو اختراع أرقام.</div><div className="grid grid-cols-2 gap-2 md:grid-cols-4"><Metric label="إجمالي المبيعات" value={`${money(shift.total_sales)} ج`} className="text-blue-700"/><Metric label="مدفوعات غير نقدية" value={`${money(d.legacyNonCash)} ج`} className="text-violet-700"/><Metric label="مصروفات فعلية/أخرى" value={`${money(d.legacyTrueExpenses)} ج`} className="text-red-600"/><Metric label="المتوقع تسليمه نقدًا" value={`${money(d.cashToHandover)} ج`} className="text-emerald-700"/></div></>}

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
