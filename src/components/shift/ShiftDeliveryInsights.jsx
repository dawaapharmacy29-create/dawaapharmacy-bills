import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, BarChart3, Clock3, Landmark, Receipt, TrendingDown, TrendingUp, Wallet } from "lucide-react";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const SHIFT_TYPES = ["صباحي", "مسائي", "ليلي"];
const money = (value) => Number(value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const dateDaysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

function normalizeExpenses(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function StatCard({ label, value, icon: Icon, hint, tone = "slate" }) {
  const tones = {
    slate: "border-slate-200 bg-white text-slate-800",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    red: "border-red-200 bg-red-50 text-red-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium opacity-75">{label}</p>
        <Icon className="h-4 w-4 opacity-70" />
      </div>
      <p className="text-xl font-bold">{value}</p>
      {hint && <p className="mt-1 text-xs opacity-70">{hint}</p>}
    </div>
  );
}

export default function ShiftDeliveryInsights({ deliveries = [] }) {
  const [branch, setBranch] = useState("all");
  const [range, setRange] = useState("14d");
  const [customFrom, setCustomFrom] = useState(dateDaysAgo(13));
  const [customTo, setCustomTo] = useState(today());

  const dates = useMemo(() => {
    if (range === "today") return { from: today(), to: today() };
    if (range === "month") return { from: `${today().slice(0, 7)}-01`, to: today() };
    if (range === "custom") return { from: customFrom, to: customTo };
    return { from: dateDaysAgo(13), to: today() };
  }, [range, customFrom, customTo]);

  const filtered = useMemo(() => deliveries.filter((row) => {
    if (!row?.shift_date) return false;
    if (row.shift_date < dates.from || row.shift_date > dates.to) return false;
    if (branch !== "all" && row.branch !== branch) return false;
    return true;
  }), [deliveries, dates, branch]);

  const summary = useMemo(() => {
    const totalSales = filtered.reduce((sum, row) => sum + Number(row.total_sales || 0), 0);
    const totalExpenses = filtered.reduce((sum, row) => sum + Number(row.total_expenses || 0), 0);
    const totalNet = filtered.reduce((sum, row) => sum + Number(row.net_amount || 0), 0);
    const expenseRate = totalSales > 0 ? (totalExpenses / totalSales) * 100 : 0;
    const unreviewed = filtered.filter((row) => !["approved", "مراجع", "معتمد"].includes(String(row.treasury_status || "").toLowerCase())).length;
    const confirmed = filtered.filter((row) => ["مؤكد", "confirmed", "approved"].includes(String(row.status || "").toLowerCase())).length;
    return { totalSales, totalExpenses, totalNet, expenseRate, unreviewed, confirmed };
  }, [filtered]);

  const byShift = useMemo(() => SHIFT_TYPES.map((type) => {
    const rows = filtered.filter((row) => row.shift_type === type);
    const sales = rows.reduce((sum, row) => sum + Number(row.total_sales || 0), 0);
    const expenses = rows.reduce((sum, row) => sum + Number(row.total_expenses || 0), 0);
    return {
      type,
      count: rows.length,
      sales,
      expenses,
      net: rows.reduce((sum, row) => sum + Number(row.net_amount || 0), 0),
      expenseRate: sales > 0 ? (expenses / sales) * 100 : 0,
    };
  }), [filtered]);

  const byBranch = useMemo(() => BRANCHES.map((name) => {
    const rows = filtered.filter((row) => row.branch === name);
    const sales = rows.reduce((sum, row) => sum + Number(row.total_sales || 0), 0);
    const expenses = rows.reduce((sum, row) => sum + Number(row.total_expenses || 0), 0);
    return { name, count: rows.length, sales, expenses, net: rows.reduce((sum, row) => sum + Number(row.net_amount || 0), 0) };
  }), [filtered]);

  const expenseItems = useMemo(() => {
    const totals = new Map();
    filtered.forEach((delivery) => {
      normalizeExpenses(delivery.expenses).forEach((item) => {
        const label = String(item?.name || item?.description || item?.item || item?.category || "مصروف غير مصنف").trim();
        const amount = Number(item?.amount || item?.value || 0);
        totals.set(label, (totals.get(label) || 0) + amount);
      });
    });
    return [...totals.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 8);
  }, [filtered]);

  const anomalies = useMemo(() => filtered.map((row) => {
    const sales = Number(row.total_sales || 0);
    const expenses = Number(row.total_expenses || 0);
    const expenseRate = sales > 0 ? (expenses / sales) * 100 : 0;
    const reasons = [];
    if (expenseRate >= 25) reasons.push(`المصروفات ${expenseRate.toFixed(1)}% من المبيعات`);
    if (expenses >= 5000) reasons.push(`مصروفات مرتفعة ${money(expenses)} ج`);
    if (Number(row.net_amount || 0) < 0) reasons.push("صافي الشيفت بالسالب");
    if (!row.submitted_by) reasons.push("اسم مُسلّم الشيفت غير مسجل");
    if (!["approved", "مراجع", "معتمد"].includes(String(row.treasury_status || "").toLowerCase())) reasons.push("لم تتم مراجعة الخزنة");
    return reasons.length ? { ...row, reasons, expenseRate } : null;
  }).filter(Boolean).sort((a, b) => b.expenseRate - a.expenseRate).slice(0, 12), [filtered]);

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-800">التحليل التشغيلي للشيفتات</h2>
          <p className="text-xs text-gray-500">قراءة تحليلية فقط بدون تعديل أي بيانات</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[{ key: "today", label: "اليوم" }, { key: "14d", label: "آخر 14 يوم" }, { key: "month", label: "الشهر" }, { key: "custom", label: "مخصص" }].map((item) => (
            <button key={item.key} type="button" onClick={() => setRange(item.key)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${range === item.key ? "border-indigo-600 bg-indigo-600 text-white" : "bg-white text-gray-600"}`}>{item.label}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3">
        <span className="text-xs font-semibold text-gray-500">الفرع:</span>
        {[{ value: "all", label: "كل الفروع" }, ...BRANCHES.map((name) => ({ value: name, label: name }))].map((item) => (
          <button key={item.value} type="button" onClick={() => setBranch(item.value)} className={`rounded-lg px-3 py-1.5 text-xs ${branch === item.value ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-600"}`}>{item.label}</button>
        ))}
        {range === "custom" && <>
          <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="rounded-lg border px-2 py-1.5 text-xs" />
          <span className="text-xs text-gray-400">إلى</span>
          <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="rounded-lg border px-2 py-1.5 text-xs" />
        </>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="عدد الشيفتات" value={filtered.length} icon={Clock3} hint={`${dates.from} ← ${dates.to}`} />
        <StatCard label="إجمالي المبيعات" value={`${money(summary.totalSales)} ج`} icon={TrendingUp} tone="green" />
        <StatCard label="إجمالي المصروفات" value={`${money(summary.totalExpenses)} ج`} icon={TrendingDown} tone={summary.expenseRate >= 20 ? "red" : "amber"} />
        <StatCard label="صافي التسليم" value={`${money(summary.totalNet)} ج`} icon={Wallet} tone="blue" />
        <StatCard label="نسبة المصروفات" value={`${summary.expenseRate.toFixed(1)}%`} icon={BarChart3} tone={summary.expenseRate >= 20 ? "red" : "slate"} />
        <StatCard label="غير مراجع بالخزنة" value={summary.unreviewed} icon={Landmark} tone={summary.unreviewed > 0 ? "amber" : "green"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-4">
          <h3 className="mb-3 font-bold text-gray-800">مقارنة الشيفتات</h3>
          <div className="space-y-2">
            {byShift.map((row) => <div key={row.type} className="grid grid-cols-5 items-center gap-2 rounded-lg bg-gray-50 p-3 text-xs">
              <span className="font-bold text-gray-700">{row.type}</span><span>{row.count} شيفت</span><span>{money(row.sales)} ج</span><span>{money(row.expenses)} ج</span><span className={row.expenseRate >= 20 ? "font-bold text-red-600" : "font-semibold text-green-600"}>{row.expenseRate.toFixed(1)}%</span>
            </div>)}
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <h3 className="mb-3 font-bold text-gray-800">مقارنة الفروع</h3>
          <div className="space-y-2">
            {byBranch.map((row) => <div key={row.name} className="rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between"><span className="font-bold text-gray-700">{row.name}</span><span className="text-xs text-gray-500">{row.count} شيفت</span></div>
              <div className="grid grid-cols-3 gap-2 text-xs"><span>مبيعات: <b>{money(row.sales)}</b></span><span>مصروفات: <b>{money(row.expenses)}</b></span><span>صافي: <b>{money(row.net)}</b></span></div>
            </div>)}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-4">
          <div className="mb-3 flex items-center justify-between"><h3 className="font-bold text-gray-800">أعلى بنود المصروفات</h3><Receipt className="h-4 w-4 text-gray-400" /></div>
          {expenseItems.length ? <div className="space-y-2">{expenseItems.map((item, index) => <div key={`${item.name}-${index}`} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs"><span className="truncate text-gray-700">{item.name}</span><b className="text-red-600">{money(item.amount)} ج</b></div>)}</div> : <p className="text-sm text-gray-400">لا توجد بنود مصروفات مفصلة في الفترة.</p>}
        </div>

        <div className="rounded-xl border bg-white p-4">
          <div className="mb-3 flex items-center justify-between"><h3 className="font-bold text-gray-800">حالات تحتاج مراجعة</h3><AlertTriangle className="h-4 w-4 text-amber-500" /></div>
          {anomalies.length ? <div className="max-h-80 space-y-2 overflow-y-auto">{anomalies.map((row) => <div key={row.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs">
            <div className="mb-1 flex items-center justify-between gap-2"><b>{row.branch} — {row.shift_type}</b><span>{row.shift_date}</span></div>
            <p className="text-gray-600">{row.reasons.join(" • ")}</p>
          </div>)}</div> : <p className="text-sm text-green-600">لا توجد حالات غير طبيعية في الفترة المحددة.</p>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border bg-slate-50 p-3">
        <Link to="/treasury-operations" className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-teal-700 shadow-sm"><Landmark className="h-4 w-4" /> مراجعة الخزنة <ArrowLeft className="h-3 w-3" /></Link>
        <Link to="/expenses" className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-blue-700 shadow-sm"><Receipt className="h-4 w-4" /> المصروفات <ArrowLeft className="h-3 w-3" /></Link>
        <Link to="/branch-performance" className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-indigo-700 shadow-sm"><BarChart3 className="h-4 w-4" /> مقارنة الفروع <ArrowLeft className="h-3 w-3" /></Link>
      </div>
    </div>
  );
}
