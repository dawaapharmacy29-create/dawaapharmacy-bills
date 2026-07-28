import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44, performanceApi } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, BarChart3, ShoppingCart, TrendingDown, TrendingUp } from "lucide-react";
import { getInvoiceNetAmount } from "@/lib/purchaseCalculations";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;
const shiftDate = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); };
const presets = { today: { from: today, to: today }, fourteen: { from: shiftDate(13), to: today }, month: { from: monthStart, to: today } };
const money = (v) => Number(v || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });

async function loadInvoices(from, to) {
  const pageSize = 200;
  const first = await performanceApi.invoices({ branch: "all", date_from: from, date_to: to, page: 1, page_size: pageSize, sort_by: "invoice_date", sort_direction: "desc" });
  const rows = [...(first?.rows || [])];
  for (let page = 2; page <= Number(first?.total_pages || 1); page += 1) {
    const result = await performanceApi.invoices({ branch: "all", date_from: from, date_to: to, page, page_size: pageSize, sort_by: "invoice_date", sort_direction: "desc" });
    rows.push(...(result?.rows || []));
  }
  return rows;
}

export default function SalesPurchasesReport() {
  const [period, setPeriod] = useState("fourteen");
  const [branch, setBranch] = useState("all");
  const [custom, setCustom] = useState(presets.fourteen);
  const range = period === "custom" ? custom : presets[period];

  const { data: invoices = [], isLoading: loadingInvoices } = useQuery({ queryKey: ["sales-purchases-invoices", range.from, range.to], queryFn: () => loadInvoices(range.from, range.to), staleTime: 30000, refetchOnWindowFocus: true });
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: () => base44.entities.Supplier.list(), staleTime: 60000 });
  const { data: deliveries = [], isLoading: loadingSales } = useQuery({ queryKey: ["sales-purchases-shifts", range.from, range.to], queryFn: () => base44.entities.ShiftDelivery.list("-shift_date", 3000), staleTime: 30000, refetchOnWindowFocus: true });

  const branchRows = useMemo(() => BRANCHES.map((name) => {
    const inv = invoices.filter((x) => x.branch === name);
    const shifts = deliveries.filter((x) => x.branch === name && x.shift_date >= range.from && x.shift_date <= range.to);
    const purchases = inv.reduce((sum, x) => sum + getInvoiceNetAmount(x, suppliers), 0);
    const sales = shifts.reduce((sum, x) => sum + Number(x.total_sales || 0), 0);
    const ratio = sales > 0 ? (purchases / sales) * 100 : 0;
    const status = sales <= 0 ? "missing" : ratio > 80 ? "danger" : ratio > 65 ? "warning" : "good";
    return { name, purchases, sales, ratio, status, invoices: inv.length, shifts: shifts.length };
  }), [deliveries, invoices, range.from, range.to, suppliers]);

  const visible = branch === "all" ? branchRows : branchRows.filter((x) => x.name === branch);
  const totals = visible.reduce((a, x) => ({ purchases: a.purchases + x.purchases, sales: a.sales + x.sales, invoices: a.invoices + x.invoices, shifts: a.shifts + x.shifts }), { purchases: 0, sales: 0, invoices: 0, shifts: 0 });
  const totalRatio = totals.sales > 0 ? totals.purchases / totals.sales * 100 : 0;

  return <div dir="rtl" className="space-y-5 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-gray-800">المبيعات مقابل المشتريات</h1><p className="text-sm text-gray-500">مقارنة صافي المشتريات بمبيعات تسليمات الشيفت لكل فرع</p></div>
      <div className="flex flex-wrap gap-2">{[["today","اليوم"],["fourteen","آخر 14 يوم"],["month","الشهر الحالي"],["custom","فترة مخصصة"]].map(([key,label]) => <Button key={key} size="sm" variant={period === key ? "default" : "outline"} onClick={() => setPeriod(key)}>{label}</Button>)}</div>
    </div>
    {period === "custom" && <Card className="grid gap-3 p-4 md:grid-cols-2"><Input type="date" value={custom.from} onChange={(e) => setCustom((v) => ({ ...v, from: e.target.value }))}/><Input type="date" value={custom.to} onChange={(e) => setCustom((v) => ({ ...v, to: e.target.value }))}/></Card>}
    <div className="flex flex-wrap gap-2">{[["all","كل الفروع"], ...BRANCHES.map((b) => [b,b])].map(([key,label]) => <Button key={key} size="sm" variant={branch === key ? "default" : "outline"} onClick={() => setBranch(key)}>{label}</Button>)}</div>

    <div className="grid gap-4 md:grid-cols-4">
      <Card className="p-4"><ShoppingCart className="mb-2 h-5 w-5 text-blue-600"/><p className="text-xs text-gray-500">صافي المشتريات</p><p className="text-xl font-bold">{money(totals.purchases)} ج</p></Card>
      <Card className="p-4"><TrendingUp className="mb-2 h-5 w-5 text-green-600"/><p className="text-xs text-gray-500">المبيعات المسجلة</p><p className="text-xl font-bold">{money(totals.sales)} ج</p></Card>
      <Card className="p-4"><BarChart3 className="mb-2 h-5 w-5 text-purple-600"/><p className="text-xs text-gray-500">نسبة الشراء للمبيعات</p><p className={`text-xl font-bold ${totalRatio > 80 ? "text-red-600" : totalRatio > 65 ? "text-amber-600" : "text-green-600"}`}>{totalRatio.toFixed(1)}%</p></Card>
      <Card className="p-4"><TrendingDown className="mb-2 h-5 w-5 text-slate-600"/><p className="text-xs text-gray-500">الفواتير / الشيفتات</p><p className="text-xl font-bold">{totals.invoices} / {totals.shifts}</p></Card>
    </div>

    {(loadingInvoices || loadingSales) ? <Card className="p-8 text-center text-gray-500">جاري تحميل المقارنة...</Card> : <div className="grid gap-4 md:grid-cols-2">{visible.map((row) => <Card key={row.name} className="space-y-4 p-5">
      <div className="flex items-center justify-between"><h2 className="font-bold text-gray-800">{row.name}</h2><span className={`rounded-full px-2 py-1 text-xs font-bold ${row.status === "danger" ? "bg-red-100 text-red-700" : row.status === "warning" ? "bg-amber-100 text-amber-700" : row.status === "missing" ? "bg-gray-100 text-gray-600" : "bg-green-100 text-green-700"}`}>{row.status === "danger" ? "شراء مرتفع" : row.status === "warning" ? "يحتاج متابعة" : row.status === "missing" ? "المبيعات غير مكتملة" : "معدل جيد"}</span></div>
      <div className="grid grid-cols-2 gap-3 text-sm"><div className="rounded-lg bg-blue-50 p-3"><p className="text-gray-500">المشتريات</p><p className="font-bold text-blue-700">{money(row.purchases)} ج</p></div><div className="rounded-lg bg-green-50 p-3"><p className="text-gray-500">المبيعات</p><p className="font-bold text-green-700">{money(row.sales)} ج</p></div></div>
      <div><div className="mb-1 flex justify-between text-xs"><span>نسبة الشراء للمبيعات</span><span className="font-bold">{row.ratio.toFixed(1)}%</span></div><div className="h-3 overflow-hidden rounded-full bg-gray-100"><div className={`h-full ${row.ratio > 80 ? "bg-red-500" : row.ratio > 65 ? "bg-amber-500" : "bg-green-500"}`} style={{ width: `${Math.min(row.ratio,100)}%` }}/></div></div>
      {row.ratio > 65 && <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle className="h-4 w-4 shrink-0"/><span>{row.ratio > 80 ? "المشتريات مرتفعة جدًا مقارنة بالمبيعات وتحتاج مراجعة فورية." : "المشتريات تقترب من الحد المرتفع مقارنة بالمبيعات."}</span></div>}
    </Card>)}</div>}
    <Card className="p-4 text-xs text-gray-500">مصدر المبيعات هو إجمالي المبيعات المسجل في تسليمات الشيفت، ومصدر المشتريات هو صافي فواتير الشراء بعد المرتجعات والاستبعادات والتحويلات الداخلية.</Card>
  </div>;
}
