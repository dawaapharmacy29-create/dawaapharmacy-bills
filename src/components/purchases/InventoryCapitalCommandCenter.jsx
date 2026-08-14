import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Boxes, Gauge, PackageSearch, RefreshCw, TrendingUp, WalletCards,
  ShieldAlert, CircleDollarSign, Clock3,
} from 'lucide-react';
import { smartPurchaseUnifiedApi as api } from '@/api/smartPurchaseUnifiedApi';

const BRANCHES = [
  ['all', 'كل الفروع'],
  ['دواء الشامي', 'دواء الشامي'],
  ['دواء شكري', 'دواء شكري'],
];
const money = (value) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(Number(value || 0));
const num = (value, digits = 1) => Number(value || 0).toFixed(digits);
const TABS = [
  ['cash_locked', 'فلوس محبوسة'],
  ['deadstock', 'رواكد'],
  ['slow_movers', 'بطيئة الحركة'],
  ['high_turnover', 'عالية الدوران'],
  ['stock_needed', 'مطلوب استوك'],
];

function SummaryCard({ icon: Icon, label, value, hint }) {
  return <div className="rounded-2xl border bg-white p-3 shadow-sm">
    <div className="flex items-start gap-2"><div className="rounded-xl bg-slate-50 p-2"><Icon className="h-4 w-4 text-teal-700" /></div><div className="min-w-0"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-lg font-black">{value}</div>{hint && <div className="mt-1 text-[11px] text-slate-400">{hint}</div>}</div></div>
  </div>;
}

function InventoryTable({ type, rows }) {
  if (!rows.length) return <div className="rounded-xl border border-dashed p-7 text-center text-slate-400">لا توجد بيانات في القائمة الحالية.</div>;
  const showNeed = type === 'stock_needed';
  const showTurn = type === 'high_turnover';
  const showLocked = type === 'cash_locked';
  return <div className="overflow-auto rounded-xl border bg-white"><table className="min-w-[980px] w-full text-sm"><thead className="bg-slate-50"><tr>
    <th className="p-2 text-right">الفرع</th><th className="p-2 text-right">الصنف</th><th className="p-2 text-right">الرصيد</th><th className="p-2 text-right">مبيعات 30</th><th className="p-2 text-right">تغطية</th>
    {showTurn && <th className="p-2 text-right">معدل يومي</th>}{showNeed && <><th className="p-2 text-right">كمية الشهر</th><th className="p-2 text-right">تكلفة الاستوك</th></>}{showLocked && <><th className="p-2 text-right">قيمة المخزون</th><th className="p-2 text-right">قيمة زائدة +45 يوم</th></>}
    {!showNeed && !showLocked && <th className="p-2 text-right">قيمة المخزون</th>}
  </tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.branch}-${row.product_code || row.product_name}-${index}`} className="border-t hover:bg-slate-50">
    <td className="p-2 text-xs">{row.branch}</td><td className="p-2"><div className="font-bold">{row.product_name}</div><div className="text-[11px] text-slate-400">{row.product_code || 'بدون كود'}</div></td>
    <td className="p-2">{num(row.current_stock, 2)}</td><td className="p-2">{num(row.sales_30, 2)}</td><td className="p-2">{row.coverage_days == null ? '—' : `${num(row.coverage_days)} يوم`}</td>
    {showTurn && <td className="p-2 font-bold">{num(row.usage_per_day, 2)}</td>}{showNeed && <><td className="p-2 font-black text-teal-800">{num(row.month_need_qty, 0)}</td><td className="p-2 font-bold">{money(row.month_need_cost)} ج</td></>}
    {showLocked && <><td className="p-2">{money(row.stock_value)} ج</td><td className="p-2 font-bold text-amber-700">{money(row.excess_value_45)} ج</td></>}
    {!showNeed && !showLocked && <td className="p-2">{money(row.stock_value)} ج</td>}
  </tr>)}</tbody></table></div>;
}

export default function InventoryCapitalCommandCenter() {
  const [branch, setBranch] = useState('all');
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('cash_locked');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(nextBranch = branch) {
    setLoading(true); setError('');
    try { setData(await api.inventoryCommandCenter(nextBranch)); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(branch); }, [branch]);

  const summary = useMemo(() => {
    const rows = data?.summary || [];
    return {
      stock: rows.reduce((s, x) => s + Number(x.total_stock_value || 0), 0),
      locked: rows.reduce((s, x) => s + Number(x.locked_over_45_value || 0), 0),
      dead: rows.reduce((s, x) => s + Number(x.deadstock_value || 0), 0),
      need: rows.reduce((s, x) => s + Number(x.month_need_cost || 0), 0),
      velocity: rows.reduce((s, x) => s + Number(x.daily_cost_velocity || 0), 0),
      cycleDays: rows.length ? rows.reduce((s, x) => s + Number(x.capital_cycle_days || 0), 0) / rows.filter((x) => x.capital_cycle_days != null).length : 0,
    };
  }, [data]);
  const activeRows = data?.[tab] || [];

  return <section className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 shadow-sm space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-black flex items-center gap-2"><CircleDollarSign className="w-6 h-6 text-teal-700" />مركز ذكاء المخزون ورأس المال</h2><p className="text-xs text-slate-500 mt-1">يرتب السيولة المحبوسة، الرواكد، سرعة الدوران، الاحتياج الشهري ومحاكاة الاستثمار من أحدث تحليل مخزون متاح.</p></div><div className="flex gap-2"><select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-lg border bg-white p-2 text-sm">{BRANCHES.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><button onClick={() => load()} disabled={loading} className="rounded-lg border bg-white px-3 py-2 text-sm flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />تحديث</button></div></div>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5" />{error}</div>}

    <div className="grid grid-cols-2 xl:grid-cols-6 gap-2">
      <SummaryCard icon={Boxes} label="قيمة المخزون المحلل" value={`${money(summary.stock)} ج`} />
      <SummaryCard icon={WalletCards} label="سيولة زائدة فوق 45 يوم" value={`${money(summary.locked)} ج`} />
      <SummaryCard icon={ShieldAlert} label="قيمة الرواكد" value={`${money(summary.dead)} ج`} />
      <SummaryCard icon={PackageSearch} label="تكلفة استوك 30 يوم الخام" value={`${money(summary.need)} ج`} hint="ليست توصية شراء كاملة للأصناف الغالية" />
      <SummaryCard icon={TrendingUp} label="سرعة خروج تكلفة/يوم" value={`${money(summary.velocity)} ج`} />
      <SummaryCard icon={Clock3} label="دورة رأس المال الحالية" value={summary.cycleDays ? `${num(summary.cycleDays)} يوم` : '—'} />
    </div>

    <div className="grid md:grid-cols-3 gap-2">{(data?.investment_scenarios || []).map((row) => <div key={row.investment} className="rounded-2xl border bg-white p-3"><div className="text-xs text-slate-500">لو استثمرنا {money(row.investment)} ج زيادة</div><div className="mt-1 font-black">متاح توزيعه الآن: {money(row.allocatable_value)} ج</div><div className="mt-1 text-sm">على {row.selected_items} صنف • دوران تقديري {row.estimated_days_to_cycle == null ? 'غير كافٍ للحساب' : `${num(row.estimated_days_to_cycle)} يوم`}</div></div>)}</div>

    <div className="rounded-2xl border bg-white p-3"><div className="flex flex-wrap gap-2">{TABS.map(([value,label]) => <button key={value} onClick={() => setTab(value)} className={`rounded-lg px-3 py-2 text-sm font-bold ${tab === value ? 'bg-slate-900 text-white' : 'border bg-white'}`}>{label} <span className="opacity-60">({(data?.[value] || []).length})</span></button>)}</div><div className="mt-3"><InventoryTable type={tab} rows={activeRows} /></div></div>

    <div className="grid md:grid-cols-3 gap-2">
      <div className={`rounded-xl border p-3 ${data?.readiness?.profitability_ready ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}><div className="font-bold text-sm">الربحية و GMROI</div><div className="text-xs mt-1">{data?.readiness?.profitability_ready ? 'جاهز' : data?.readiness?.profitability_reason || 'غير متاح بعد'}</div></div>
      <div className={`rounded-xl border p-3 ${data?.readiness?.expiry_ready ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}><div className="font-bold text-sm">Near Expiry Radar</div><div className="text-xs mt-1">{data?.readiness?.expiry_ready ? 'جاهز' : data?.readiness?.expiry_reason || 'غير متاح بعد'}</div></div>
      <div className={`rounded-xl border p-3 ${data?.readiness?.doctor_profit_list_ready ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50 border-blue-200'}`}><div className="font-bold text-sm">لستة الدكاترة الربحية</div><div className="text-xs mt-1">{data?.readiness?.doctor_profit_list_ready ? 'جاهزة' : data?.readiness?.doctor_profit_list_reason || 'تحتاج مصدر الربحية'}</div></div>
    </div>
    <div className="rounded-xl bg-slate-100 p-3 text-[11px] text-slate-600 flex gap-2"><Gauge className="w-4 h-4 shrink-0" />التغطية والاحتياج محسوبان من أحدث سجل لكل صنف. تقدير دوران الاستثمار تشغيلي على تكلفة الشراء وسرعة الاستهلاك، وليس ربحًا محاسبيًا.</div>
  </section>;
}
