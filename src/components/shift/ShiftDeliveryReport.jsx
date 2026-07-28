import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, FileText, ArrowUpDown } from "lucide-react";
import ExpenseCategoryBreakdown from "./ExpenseCategoryBreakdown";
import DateRangeFilter from "./DateRangeFilter";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const SHIFT_TYPES = ["صباحي", "مسائي", "ليلي"];
const fmt = (n) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 0 });
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
function presetRange(period) { const now = new Date(); if (period === "day") return { from: iso(now), to: iso(now) }; if (period === "week") { const start = new Date(now); start.setDate(start.getDate() - ((start.getDay()+1)%7)); return { from: iso(start), to: iso(now) }; } return { from: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`, to: iso(now) }; }

export default function ShiftDeliveryReport({ deliveries }) {
  const [period, setPeriod] = useState("month");
  const [filterBranch, setFilterBranch] = useState("الكل");
  const [filterShift, setFilterShift] = useState("الكل");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortAsc, setSortAsc] = useState(false);
  const range = period === "custom" ? { from: fromDate, to: toDate } : presetRange(period);

  const filtered = useMemo(() => deliveries
    .filter((d) => filterBranch === "الكل" || d.branch === filterBranch)
    .filter((d) => filterShift === "الكل" || d.shift_type === filterShift)
    .filter((d) => d.shift_date && (!range.from || d.shift_date >= range.from) && (!range.to || d.shift_date <= range.to))
    .sort((a,b) => sortAsc ? String(a.shift_date).localeCompare(String(b.shift_date)) : String(b.shift_date).localeCompare(String(a.shift_date))), [deliveries, filterBranch, filterShift, range.from, range.to, sortAsc]);

  const totals = useMemo(() => ({ sales: filtered.reduce((s,d)=>s+Number(d.total_sales||0),0), expenses: filtered.reduce((s,d)=>s+Number(d.total_expenses||0),0), net: filtered.reduce((s,d)=>s+Number(d.net_amount||0),0), count: filtered.length }), [filtered]);

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const rows = filtered.map((d) => ({ "التاريخ":d.shift_date||"", "الفرع":d.branch||"", "نوع الشيفت":d.shift_type||"", "الموظف":d.submitted_by||"", "إجمالي المبيعات":Number(d.total_sales||0), "إجمالي المصروفات":Number(d.total_expenses||0), "الصافي":Number(d.net_amount||0), "حالة الخزنة":d.treasury_status||d.status||"", "ملاحظات":d.notes||"" }));
    const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "تسليمات الشيفت"); XLSX.writeFile(wb, `تقرير_تسليمات_${range.from || "من"}_${range.to || "إلى"}.xlsx`);
  };
  const exportPdf = () => window.print();

  return <div className="space-y-5" dir="rtl">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-gray-900">تقرير التسليمات الشامل</h2><p className="mt-1 text-sm text-gray-500">تقرير تفصيلي قابل للتصفية والتصدير لكل الفروع والشيفتات</p></div><div className="flex flex-wrap gap-2"><Button onClick={exportExcel} variant="outline" className="gap-2 border-emerald-200 text-emerald-700"><Download className="h-4 w-4" />تصدير Excel</Button><Button onClick={exportPdf} variant="outline" className="gap-2 border-red-200 text-red-700"><FileText className="h-4 w-4" />طباعة / PDF</Button></div></div>

    <Card className="p-4"><div className="flex flex-wrap items-end gap-3">
      <label className="space-y-1"><span className="block text-xs text-gray-500">الفترة</span><select value={period} onChange={(e)=>setPeriod(e.target.value)} className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="day">يومي</option><option value="week">أسبوعي</option><option value="month">شهري</option><option value="custom">فترة مخصصة</option></select></label>
      {period === "custom" && <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToDateChange={setToDate} />}
      <label className="space-y-1"><span className="block text-xs text-gray-500">الفرع</span><select value={filterBranch} onChange={(e)=>setFilterBranch(e.target.value)} className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="الكل">كل الفروع</option>{BRANCHES.map((b)=><option key={b}>{b}</option>)}</select></label>
      <label className="space-y-1"><span className="block text-xs text-gray-500">نوع الشيفت</span><select value={filterShift} onChange={(e)=>setFilterShift(e.target.value)} className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="الكل">كل الأنواع</option>{SHIFT_TYPES.map((s)=><option key={s}>{s}</option>)}</select></label>
      <Button variant="outline" onClick={()=>setSortAsc((v)=>!v)} className="gap-2"><ArrowUpDown className="h-4 w-4" />{sortAsc ? "الأقدم أولًا" : "الأحدث أولًا"}</Button>
    </div></Card>

    <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Card className="p-4 text-center"><p className="text-xs text-gray-500">عدد التسليمات</p><p className="mt-2 text-2xl font-bold">{totals.count}</p></Card><Card className="p-4 text-center"><p className="text-xs text-gray-500">إجمالي المبيعات</p><p className="mt-2 text-2xl font-bold text-blue-700">{fmt(totals.sales)} ج.م</p></Card><Card className="p-4 text-center"><p className="text-xs text-gray-500">إجمالي المصروفات</p><p className="mt-2 text-2xl font-bold text-red-600">{fmt(totals.expenses)} ج.م</p></Card><Card className="p-4 text-center"><p className="text-xs text-gray-500">الصافي</p><p className="mt-2 text-2xl font-bold text-emerald-600">{fmt(totals.net)} ج.م</p></Card></div>

    <ExpenseCategoryBreakdown deliveries={filtered} title="تفصيل المصروفات حسب البند" />

    <Card className="overflow-hidden"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>الفرع</TableHead><TableHead>الشيفت</TableHead><TableHead>الموظف</TableHead><TableHead>المبيعات</TableHead><TableHead>المصروفات</TableHead><TableHead>الصافي</TableHead><TableHead>حالة الخزنة</TableHead><TableHead>ملاحظات</TableHead></TableRow></TableHeader><TableBody>{filtered.length === 0 ? <TableRow><TableCell colSpan={9} className="py-10 text-center text-gray-400">لا توجد بيانات في الفترة المختارة</TableCell></TableRow> : filtered.map((d)=><TableRow key={d.id}><TableCell>{d.shift_date||"—"}</TableCell><TableCell>{d.branch||"—"}</TableCell><TableCell>{d.shift_type||"—"}</TableCell><TableCell>{d.submitted_by||"—"}</TableCell><TableCell className="font-medium text-blue-700">{fmt(d.total_sales)}</TableCell><TableCell className="font-medium text-red-600">{fmt(d.total_expenses)}</TableCell><TableCell className="font-bold text-emerald-600">{fmt(d.net_amount)}</TableCell><TableCell>{d.treasury_status||d.status||"—"}</TableCell><TableCell className="max-w-[240px] truncate">{d.notes||"—"}</TableCell></TableRow>)}</TableBody></Table></div></Card>
  </div>;
}