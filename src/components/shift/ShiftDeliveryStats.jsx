import { useMemo, useState } from "react";
import { Calendar, TrendingDown, TrendingUp, BarChart3, Clock, Wallet, Sun, Moon, Sunrise } from "lucide-react";
import ExpenseCategoryBreakdown from "./ExpenseCategoryBreakdown";
import DateRangeFilter from "./DateRangeFilter";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const SHIFT_TYPES = ["صباحي", "مسائي", "ليلي"];
const fmt = (n) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 0 });
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const addDays = (value, days) => { const d = new Date(`${value}T12:00:00`); d.setDate(d.getDate()+days); return iso(d); };
const today = () => iso(new Date());

function presetRange(period) {
  const now = new Date();
  if (period === "day") return { from: iso(now), to: iso(now) };
  if (period === "week") { const start = new Date(now); const day = start.getDay(); const diff = (day + 1) % 7; start.setDate(start.getDate() - diff); return { from: iso(start), to: iso(now) }; }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: iso(start), to: iso(now) };
}

function totals(rows) {
  const sum = (key) => rows.reduce((s, d) => s + Number(d?.[key] || 0), 0);
  return { sales: sum("total_sales"), expenses: sum("total_expenses"), net: sum("net_amount"), count: rows.length };
}

function Trend({ current, previous, inverse = false }) {
  if (!previous) return <span className="text-xs text-gray-400">لا توجد فترة سابقة</span>;
  const percent = ((current - previous) / Math.abs(previous)) * 100;
  const good = inverse ? percent <= 0 : percent >= 0;
  return <span className={`text-xs font-semibold ${good ? "text-emerald-600" : "text-red-600"}`}>{percent >= 0 ? "+" : ""}{percent.toFixed(1)}% عن السابقة</span>;
}

export default function ShiftDeliveryStats({ deliveries }) {
  const [branch, setBranch] = useState("الكل");
  const [period, setPeriod] = useState("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const range = period === "custom" ? { from: customFrom, to: customTo } : presetRange(period);

  const { filtered, previous } = useMemo(() => {
    const source = deliveries.filter((d) => branch === "الكل" || d.branch === branch);
    const rows = source.filter((d) => d.shift_date && (!range.from || d.shift_date >= range.from) && (!range.to || d.shift_date <= range.to));
    if (!range.from || !range.to) return { filtered: rows, previous: [] };
    const days = Math.max(1, Math.round((new Date(`${range.to}T12:00:00`) - new Date(`${range.from}T12:00:00`)) / 86400000) + 1);
    const prevTo = addDays(range.from, -1);
    const prevFrom = addDays(prevTo, -(days - 1));
    const prev = source.filter((d) => d.shift_date && d.shift_date >= prevFrom && d.shift_date <= prevTo);
    return { filtered: rows, previous: prev };
  }, [deliveries, branch, range.from, range.to]);

  const currentTotals = useMemo(() => totals(filtered), [filtered]);
  const previousTotals = useMemo(() => totals(previous), [previous]);
  const avgShift = currentTotals.count ? currentTotals.sales / currentTotals.count : 0;
  const previousAvg = previousTotals.count ? previousTotals.sales / previousTotals.count : 0;

  const shiftCards = useMemo(() => SHIFT_TYPES.map((type) => {
    const rows = filtered.filter((d) => d.shift_type === type);
    const t = totals(rows);
    return { type, ...t, avg: t.count ? t.sales / t.count : 0 };
  }), [filtered]);

  const cards = [
    { label: "إجمالي المبيعات", value: currentTotals.sales, previous: previousTotals.sales, icon: TrendingUp, tone: "green" },
    { label: "إجمالي المصروفات", value: currentTotals.expenses, previous: previousTotals.expenses, icon: TrendingDown, tone: "red", inverse: true },
    { label: "صافي التسليم", value: currentTotals.net, previous: previousTotals.net, icon: Wallet, tone: "blue" },
    { label: "عدد الشيفتات", value: currentTotals.count, previous: previousTotals.count, icon: Clock, tone: "indigo", count: true },
    { label: "متوسط مبيعات الشيفت", value: avgShift, previous: previousAvg, icon: BarChart3, tone: "amber" },
  ];
  const tones = { green:"bg-emerald-50 text-emerald-700", red:"bg-red-50 text-red-700", blue:"bg-blue-50 text-blue-700", indigo:"bg-indigo-50 text-indigo-700", amber:"bg-amber-50 text-amber-700" };
  const shiftIcons = { صباحي: Sunrise, مسائي: Sun, ليلي: Moon };

  return <div className="space-y-6" dir="rtl">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-bold text-gray-900">إحصائيات التسليمات</h2><p className="mt-1 text-sm text-gray-500">تحليل الفترة الحالية ومقارنتها تلقائيًا بالفترة السابقة المماثلة</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={period} onChange={(e) => setPeriod(e.target.value)} className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="day">يومي</option><option value="week">أسبوعي</option><option value="month">شهري</option><option value="custom">فترة مخصصة</option></select>
        <select value={branch} onChange={(e) => setBranch(e.target.value)} className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="الكل">كل الفروع</option>{BRANCHES.map((b)=><option key={b}>{b}</option>)}</select>
        {period === "custom" && <DateRangeFilter fromDate={customFrom} toDate={customTo} onFromChange={setCustomFrom} onToDateChange={setCustomTo} />}
      </div>
    </div>

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">{cards.map((card) => <div key={card.label} className={`rounded-2xl border p-5 ${tones[card.tone]}`}><div className="mb-3 flex items-center justify-between"><p className="text-sm font-semibold">{card.label}</p><card.icon className="h-5 w-5" /></div><p className="text-3xl font-bold">{fmt(card.value)}{!card.count && <span className="mr-1 text-xs font-normal">ج.م</span>}</p><div className="mt-2"><Trend current={card.value} previous={card.previous} inverse={card.inverse} /></div></div>)}</div>

    <div className="grid gap-4 md:grid-cols-3">{shiftCards.map((row) => { const Icon = shiftIcons[row.type] || Calendar; return <div key={row.type} className="rounded-2xl border bg-white p-5 shadow-sm"><div className="mb-4 flex items-center gap-3"><div className="rounded-xl bg-indigo-50 p-3"><Icon className="h-5 w-5 text-indigo-600" /></div><div><h3 className="font-bold text-gray-900">الشيفت {row.type}</h3><p className="text-xs text-gray-500">{row.count} تسليم</p></div></div><div className="space-y-2 text-sm"><div className="flex justify-between"><span className="text-gray-500">المبيعات</span><strong>{fmt(row.sales)} ج.م</strong></div><div className="flex justify-between"><span className="text-gray-500">المصروفات</span><strong className="text-red-600">{fmt(row.expenses)} ج.م</strong></div><div className="flex justify-between border-t pt-2"><span className="text-gray-500">الصافي</span><strong className="text-emerald-600">{fmt(row.net)} ج.م</strong></div><div className="flex justify-between"><span className="text-gray-500">متوسط الشيفت</span><strong>{fmt(row.avg)} ج.م</strong></div></div></div>; })}</div>

    <ExpenseCategoryBreakdown deliveries={filtered} title="تحليل المصروفات حسب البند" />
    <div className="rounded-xl border bg-gray-50 p-3 text-xs text-gray-500">الفترة الحالية: {range.from || "—"} إلى {range.to || today()} — المقارنة تتم مع نفس عدد الأيام السابقة مباشرة.</div>
  </div>;
}