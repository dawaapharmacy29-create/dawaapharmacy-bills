import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowRightLeft, Boxes, CheckCircle2, ChevronDown,
  CircleDollarSign, PackagePlus, RefreshCw, ShieldCheck, ShoppingCart, Siren,
  Sparkles, TrendingDown, WalletCards,
} from 'lucide-react';
import { smartPurchaseUnifiedApi as api } from '@/api/smartPurchaseUnifiedApi';

const BRANCHES = ['دواء الشامي', 'دواء شكري'];
const money = (value) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(Number(value || 0));
const n = (value) => Number(value || 0);

function jump(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function readinessScore(row, inventory, clearance) {
  let score = 100;
  if (row.status === 'blocked') score -= 55;
  else if (row.status === 'critical') score -= 35;
  else if (row.status === 'warning') score -= 18;
  if (n(row.forecast_over_budget) > 0) score -= Math.min(25, Math.round((n(row.forecast_over_budget) / Math.max(n(row.cycle_budget), 1)) * 100));
  if (n(row.pace_variance) > 0) score -= Math.min(12, Math.round((n(row.pace_variance) / Math.max(n(row.cycle_budget), 1)) * 100));
  const commitmentRatio = n(row.open_commitments) / Math.max(n(row.cycle_budget), 1);
  if (commitmentRatio > 0.25) score -= 12;
  else if (commitmentRatio > 0.1) score -= 6;
  const urgentClearance = (clearance?.plan || []).filter((x) => x.branch === row.branch && ['expired_quarantine','urgent_clearance'].includes(x.action_code)).length;
  if (urgentClearance) score -= Math.min(8, urgentClearance * 2);
  const dead = (inventory?.deadstock || []).filter((x) => x.branch === row.branch).length;
  if (dead >= 10) score -= 5;
  return Math.max(0, Math.min(100, score));
}

function scoreMeta(score) {
  if (score >= 80) return { label: 'جاهزية قوية', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
  if (score >= 60) return { label: 'جاهزية متوسطة', cls: 'bg-amber-100 text-amber-800 border-amber-200' };
  if (score >= 40) return { label: 'حذر', cls: 'bg-orange-100 text-orange-800 border-orange-200' };
  return { label: 'ضغط مرتفع', cls: 'bg-red-100 text-red-800 border-red-200' };
}

function branchDecision(row) {
  const safeToday = n(row.safe_order_today);
  const commitments = n(row.open_commitments);
  const forecastOver = n(row.forecast_over_budget);
  if (row.status === 'blocked' || safeToday <= 0) {
    return {
      tone: 'red',
      title: 'أوقف الشراء غير الضروري اليوم',
      body: commitments > 0
        ? `راجع الالتزامات المفتوحة أولًا (${money(commitments)} ج) قبل إنشاء طلبية جديدة.`
        : 'لا توجد مساحة شراء آمنة حاليًا بعد الاحتياطي ومسار الدورة.',
    };
  }
  if (row.status === 'critical' || forecastOver > 0) {
    return {
      tone: 'orange',
      title: `شراء ضروري فقط — حتى ${money(safeToday)} ج`,
      body: forecastOver > 0 ? `المعدل الحالي يتوقع تجاوز الميزانية بحوالي ${money(forecastOver)} ج.` : 'الفرع قريب من حد الأمان؛ ركّز على النواقص وعالية الحركة فقط.',
    };
  }
  if (row.status === 'warning') {
    return { tone: 'amber', title: `مسموح بحذر حتى ${money(safeToday)} ج اليوم`, body: 'حافظ على الاحتياطي وراجع الأصناف البطيئة قبل اعتماد الطلبية.' };
  }
  return { tone: 'emerald', title: `مسموح شراء حتى ${money(safeToday)} ج اليوم`, body: 'الوضع داخل المسار الآمن الحالي مع الحفاظ على احتياطي نهاية الدورة.' };
}

const toneClass = {
  red: 'border-red-200 bg-red-50', orange: 'border-orange-200 bg-orange-50', amber: 'border-amber-200 bg-amber-50', emerald: 'border-emerald-200 bg-emerald-50',
};

function MiniMetric({ label, value, strong = false }) {
  return <div className="rounded-xl border bg-white/90 p-3"><div className="text-[11px] text-slate-500">{label}</div><div className={`mt-1 ${strong ? 'text-lg font-black' : 'font-bold'}`}>{value}</div></div>;
}

function BranchExecutiveCard({ row, inventory, clearance }) {
  const [testAmount, setTestAmount] = useState('');
  const decision = branchDecision(row);
  const score = readinessScore(row, inventory, clearance);
  const sm = scoreMeta(score);
  const branch = row.branch;
  const stockNeeded = (inventory?.stock_needed || []).filter((x) => x.branch === branch);
  const dead = (inventory?.deadstock || []).filter((x) => x.branch === branch);
  const cashLocked = (inventory?.cash_locked || []).filter((x) => x.branch === branch);
  const clearanceRows = (clearance?.plan || []).filter((x) => x.branch === branch && n(x.units_to_act) > 0);
  const transferRows = clearanceRows.filter((x) => n(x.suggested_transfer_units) > 0);
  const capitalRisk = clearanceRows.reduce((sum, x) => sum + n(x.capital_at_risk), 0);
  const test = Math.max(0, n(testAmount));
  const afterSafe = n(row.safe_available_now) - test;
  const overDaily = Math.max(0, test - n(row.safe_order_today));
  const overCycleSafe = Math.max(0, -afterSafe);

  return <article className={`rounded-3xl border p-4 shadow-sm ${toneClass[decision.tone]}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-xl font-black">{branch}</h3><span className={`rounded-full border px-2.5 py-1 text-xs font-black ${sm.cls}`}>{score}/100 • {sm.label}</span>{!row.configured && <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">الميزانية تقديرية</span>}</div>
        <div className="mt-3 text-lg font-black">{decision.title}</div>
        <p className="mt-1 text-sm text-slate-600">{decision.body}</p>
      </div>
      <div className="rounded-2xl border bg-white p-3 text-center min-w-[130px]"><div className="text-[11px] text-slate-500">أقصى شراء اليوم</div><div className="mt-1 text-2xl font-black">{money(row.safe_order_today)} ج</div></div>
    </div>

    <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-2">
      <MiniMetric label="مصروف فعلي" value={`${money(row.current_spend)} ج`} />
      <MiniMetric label="التزامات لم تتحول لفواتير" value={`${money(row.open_commitments)} ج`} />
      <MiniMetric label="المتاح لباقي الدورة بعد الاحتياطي" value={`${money(row.safe_available_now)} ج`} strong />
      <MiniMetric label="توقع نهاية الدورة" value={`${money(row.forecast_end_cycle)} ج`} />
    </div>

    <div className="mt-3 grid grid-cols-2 lg:grid-cols-5 gap-2">
      <button onClick={() => jump('purchase-stock-intelligence')} className="rounded-xl border bg-white p-3 text-right hover:bg-slate-50"><PackagePlus className="h-4 w-4 text-teal-700"/><div className="mt-1 text-xs text-slate-500">مطلوب استوك</div><div className="font-black">{stockNeeded.length} صنف</div></button>
      <button onClick={() => jump('purchase-stock-intelligence')} className="rounded-xl border bg-white p-3 text-right hover:bg-slate-50"><TrendingDown className="h-4 w-4 text-amber-700"/><div className="mt-1 text-xs text-slate-500">رواكد</div><div className="font-black">{dead.length} صنف</div></button>
      <button onClick={() => jump('purchase-stock-intelligence')} className="rounded-xl border bg-white p-3 text-right hover:bg-slate-50"><WalletCards className="h-4 w-4 text-orange-700"/><div className="mt-1 text-xs text-slate-500">فلوس محبوسة</div><div className="font-black">{cashLocked.length} صنف</div></button>
      <button onClick={() => jump('purchase-clearance')} className="rounded-xl border bg-white p-3 text-right hover:bg-slate-50"><Siren className="h-4 w-4 text-red-700"/><div className="mt-1 text-xs text-slate-500">تصريف مطلوب</div><div className="font-black">{clearanceRows.length} Batch</div></button>
      <button onClick={() => jump('purchase-clearance')} className="rounded-xl border bg-white p-3 text-right hover:bg-slate-50"><ArrowRightLeft className="h-4 w-4 text-blue-700"/><div className="mt-1 text-xs text-slate-500">تحويلات مقترحة</div><div className="font-black">{transferRows.length} حالة</div></button>
    </div>

    {capitalRisk > 0 && <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-200 bg-white p-3 text-sm"><AlertTriangle className="h-4 w-4 text-red-600"/><b>رأس مال في أصناف محتاجة تدخل:</b> {money(capitalRisk)} ج</div>}

    <details className="mt-3 rounded-xl border bg-white/90 p-3">
      <summary className="cursor-pointer list-none font-bold flex items-center justify-between"><span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-700"/>اختبر طلبية قبل اعتمادها</span><ChevronDown className="h-4 w-4"/></summary>
      <div className="mt-3 grid md:grid-cols-[1fr_auto] gap-2 items-end"><label className="text-xs font-bold">قيمة الطلبية التي تفكر فيها<input value={testAmount} onChange={(e) => setTestAmount(e.target.value)} type="number" min="0" placeholder="مثال: 100000" className="mt-1 w-full rounded-lg border p-2 text-base"/></label><div className={`rounded-xl border px-4 py-3 text-sm font-bold ${!test ? 'bg-slate-50' : overDaily > 0 || overCycleSafe > 0 ? 'bg-red-50 border-red-200 text-red-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>{!test ? 'اكتب قيمة لاختبار أثرها' : overCycleSafe > 0 ? `غير آمنة: تتجاوز المتاح لباقي الدورة بـ ${money(overCycleSafe)} ج` : overDaily > 0 ? `أعلى من الحد اليومي المقترح بـ ${money(overDaily)} ج` : `آمنة حسابيًا اليوم — يتبقى ${money(Math.max(afterSafe,0))} ج من المساحة الآمنة`}</div></div>
      <p className="mt-2 text-[11px] text-slate-500">الاختبار لا يعتمد أو ينشئ أي طلبية؛ هو Stress Test للميزانية فقط، ولا يغني عن مراجعة الأصناف والكميات.</p>
    </details>
  </article>;
}

export default function PurchaseExecutiveDecisionCenter() {
  const [data, setData] = useState({ guard: null, inventory: null, clearance: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const [guard, inventory, clearance] = await Promise.all([
        api.cycleBudgetGuard('all'), api.inventoryCommandCenter('all'), api.smartClearanceEngine('all'),
      ]);
      setData({ guard, inventory, clearance });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => BRANCHES.map((branch) => (data.guard?.branches || []).find((x) => x.branch === branch)).filter(Boolean), [data.guard]);
  const totalSafeToday = rows.reduce((sum, x) => sum + n(x.safe_order_today), 0);
  const totalCommitments = rows.reduce((sum, x) => sum + n(x.open_commitments), 0);
  const totalRisk = (data.clearance?.plan || []).reduce((sum, x) => sum + (n(x.units_to_act) > 0 ? n(x.capital_at_risk) : 0), 0);
  const needCount = (data.inventory?.stock_needed || []).length;

  return <section className="rounded-3xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-4 shadow-sm space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><CircleDollarSign className="h-6 w-6 text-teal-700"/><h1 className="text-2xl font-black">قرار المشتريات اليوم</h1></div><p className="mt-1 text-sm text-slate-500">ابدأ من القرار التنفيذي، ثم افتح التحليلات فقط عند الحاجة.</p></div><button onClick={load} disabled={loading} className="rounded-xl border bg-white px-3 py-2 text-sm font-bold flex items-center gap-2"><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/>تحديث القرار</button></div>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="h-5 w-5"/>{error}</div>}
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
      <MiniMetric label="إجمالي أقصى شراء مقترح اليوم" value={`${money(totalSafeToday)} ج`} strong />
      <MiniMetric label="التزامات مفتوحة" value={`${money(totalCommitments)} ج`} />
      <MiniMetric label="أصناف محتاجة استوك" value={`${needCount} صنف`} />
      <MiniMetric label="رأس مال محتاج تدخل/تصريف" value={`${money(totalRisk)} ج`} />
    </div>
    {loading && !rows.length ? <div className="rounded-2xl border border-dashed p-8 text-center text-slate-400">جاري تجميع قرار اليوم من الميزانية والمخزون والصلاحية...</div> : <div className="grid xl:grid-cols-2 gap-3">{rows.map((row) => <BranchExecutiveCard key={row.branch} row={row} inventory={data.inventory} clearance={data.clearance}/>)}</div>}
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0"/>درجة الجاهزية استرشادية لتسهيل القراءة؛ القرار المالي الأساسي يظل مبنيًا على ميزانية الدورة والمصروف والالتزامات والاحتياطي، بينما قوائم المخزون والصلاحية تحدد أين نشتري أو نخفض.</div>
  </section>;
}
