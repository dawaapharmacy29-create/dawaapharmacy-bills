import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { base44, performanceApi } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  ClipboardList,
  FileText,
  Landmark,
  Receipt,
  RotateCcw,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { getInvoiceNetAmount, isInvoiceExcluded } from "@/lib/purchaseCalculations";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const today = new Date().toISOString().slice(0, 10);

function offsetDate(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function monthStart() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

const PRESETS = {
  today: { label: "اليوم", from: today, to: today },
  fourteen: { label: "آخر 14 يوم", from: offsetDate(13), to: today },
  month: { label: "الشهر الحالي", from: monthStart(), to: today },
};

function money(value) {
  return Number(value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });
}

function recordDate(row, fields) {
  for (const field of fields) {
    const value = row?.[field];
    if (value) return String(value).slice(0, 10);
  }
  return "";
}

function inRange(row, from, to, fields) {
  const date = recordDate(row, fields);
  return Boolean(date && date >= from && date <= to);
}

function branchMatches(row, branch, fields = ["branch", "branch_name"]) {
  return fields.some((field) => row?.[field] === branch);
}

function Stat({ icon: Icon, label, value, detail, tone = "teal", to }) {
  const tones = {
    teal: "bg-teal-50 text-teal-700",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    purple: "bg-purple-50 text-purple-700",
    emerald: "bg-emerald-50 text-emerald-700",
  };
  const body = (
    <Card className="h-full p-4 transition hover:border-teal-200 hover:shadow-sm">
      <div className="flex items-start gap-3">
        <div className={`rounded-xl p-2.5 ${tones[tone] || tones.teal}`}><Icon className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-500">{label}</p>
          <p className="mt-1 text-xl font-bold text-slate-800">{value}</p>
          {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
        </div>
        {to && <ArrowLeft className="mt-1 h-4 w-4 text-slate-300" />}
      </div>
    </Card>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

export default function BranchPerformanceCenter() {
  const [preset, setPreset] = useState("fourteen");
  const [custom, setCustom] = useState({ from: PRESETS.fourteen.from, to: PRESETS.fourteen.to });
  const activeDates = preset === "custom" ? custom : PRESETS[preset];
  const from = activeDates.from;
  const to = activeDates.to;

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery({
    queryKey: ["branch-performance-invoices", from, to],
    queryFn: async () => {
      const pageSize = 200;
      const first = await performanceApi.invoices({ branch: "all", date_from: from, date_to: to, page: 1, page_size: pageSize, sort_by: "invoice_date", sort_direction: "desc" });
      const rows = [...(first?.rows || [])];
      const totalPages = Number(first?.total_pages || 1);
      for (let page = 2; page <= totalPages; page += 1) {
        const result = await performanceApi.invoices({ branch: "all", date_from: from, date_to: to, page, page_size: pageSize, sort_by: "invoice_date", sort_direction: "desc" });
        rows.push(...(result?.rows || []));
      }
      return rows;
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const { data: suppliers = [] } = useQuery({ queryKey: ["branch-performance-suppliers"], queryFn: () => base44.entities.Supplier.list(), staleTime: 60000 });
  const { data: expenses = [] } = useQuery({ queryKey: ["branch-performance-expenses"], queryFn: () => base44.entities.Expense.list("-created_date", 5000), staleTime: 30000 });
  const { data: returns = [] } = useQuery({ queryKey: ["branch-performance-returns"], queryFn: () => base44.entities.Return.list("-created_date", 2000), staleTime: 30000 });
  const { data: deliveries = [] } = useQuery({ queryKey: ["branch-performance-deliveries"], queryFn: () => base44.entities.ShiftDelivery.list("-shift_date", 2000), staleTime: 30000 });
  const { data: customerOrders = [] } = useQuery({ queryKey: ["branch-performance-customer-orders"], queryFn: () => base44.entities.CustomerOrder.list("-created_date", 5000), staleTime: 30000 });
  const { data: targets = [] } = useQuery({ queryKey: ["branch-performance-targets"], queryFn: () => base44.entities.TargetGoal.list(), staleTime: 60000 });

  const branchData = useMemo(() => BRANCHES.map((branch) => {
    const branchInvoices = invoices.filter((row) => row.branch === branch);
    const includedInvoices = branchInvoices.filter((row) => !isInvoiceExcluded(row, suppliers).excluded);
    const purchases = includedInvoices.reduce((sum, row) => sum + getInvoiceNetAmount(row, suppliers), 0);
    const excluded = branchInvoices.reduce((sum, row) => sum + (isInvoiceExcluded(row, suppliers).excluded ? Math.max(Number(row.total_value || 0) - Number(row.returned_value || 0), 0) : 0), 0);
    const branchExpenses = expenses.filter((row) => branchMatches(row, branch) && inRange(row, from, to, ["expense_date", "date", "created_date", "created_at"]));
    const expenseTotal = branchExpenses.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const branchReturns = returns.filter((row) => branchMatches(row, branch) && inRange(row, from, to, ["returned_at", "created_date", "created_at"]));
    const pendingReturns = branchReturns.filter((row) => !["completed", "approved", "تم التنفيذ", "منفذ"].includes(String(row.status || "").toLowerCase())).length;
    const branchDeliveries = deliveries.filter((row) => branchMatches(row, branch) && inRange(row, from, to, ["shift_date", "created_date", "created_at"]));
    const pendingTreasury = branchDeliveries.filter((row) => !["approved", "closed"].includes(String(row.treasury_status || "pending").toLowerCase())).length;
    const branchOrders = customerOrders.filter((row) => branchMatches(row, branch) && inRange(row, from, to, ["request_date", "created_date", "created_at"]));
    const openOrders = branchOrders.filter((row) => !["completed", "cancelled", "تم", "ملغي", "مكتمل"].includes(String(row.status || "").toLowerCase())).length;
    const dailyLimitRow = targets.find((row) => row.branch === branch && row.goal_type === "daily_purchase_limit");
    const dailyLimit = Number(dailyLimitRow?.target_amount || 20000);
    const todayPurchases = branchInvoices.filter((row) => row.invoice_date === today).reduce((sum, row) => sum + getInvoiceNetAmount(row, suppliers), 0);
    return {
      branch,
      invoiceCount: branchInvoices.length,
      purchases,
      excluded,
      expenseTotal,
      returnCount: branchReturns.length,
      pendingReturns,
      deliveryCount: branchDeliveries.length,
      pendingTreasury,
      orderCount: branchOrders.length,
      openOrders,
      dailyLimit,
      todayPurchases,
      limitPercent: dailyLimit > 0 ? Math.round((todayPurchases / dailyLimit) * 100) : 0,
    };
  }), [customerOrders, deliveries, expenses, from, invoices, returns, suppliers, targets, to]);

  const leader = [...branchData].sort((a, b) => b.purchases - a.purchases)[0];

  return (
    <div dir="rtl" className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">مركز مقارنة وكفاءة الفروع</h1>
          <p className="mt-1 text-sm text-slate-500">مؤشرات موحدة من بيانات التطبيق الحالية فقط — بدون نقل أو نسخ بيانات.</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500"><CalendarDays className="h-4 w-4" /> من {from} إلى {to}</div>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(PRESETS).map(([key, value]) => <Button key={key} size="sm" variant={preset === key ? "default" : "outline"} onClick={() => setPreset(key)}>{value.label}</Button>)}
          <Button size="sm" variant={preset === "custom" ? "default" : "outline"} onClick={() => setPreset("custom")}>فترة مخصصة</Button>
          {preset === "custom" && <>
            <Input type="date" className="w-40" value={custom.from} onChange={(event) => setCustom((old) => ({ ...old, from: event.target.value }))} />
            <Input type="date" className="w-40" value={custom.to} onChange={(event) => setCustom((old) => ({ ...old, to: event.target.value }))} />
          </>}
        </div>
      </Card>

      {leader && !invoicesLoading && <Card className="border-teal-200 bg-teal-50 p-4 text-sm text-teal-800">
        <span className="font-bold">ملخص سريع:</span> أعلى صافي مشتريات في الفترة هو {leader.branch} بقيمة {money(leader.purchases)} ج.
      </Card>}

      <div className="grid gap-5 xl:grid-cols-2">
        {branchData.map((data) => {
          const overLimit = data.todayPurchases > data.dailyLimit;
          return <Card key={data.branch} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-slate-50 p-4">
              <div><h2 className="text-xl font-bold text-slate-800">{data.branch}</h2><p className="text-xs text-slate-500">تفاصيل قابلة للفتح في كل مسار تشغيلي</p></div>
              <Link to={`/dashboard/advanced?branch=${encodeURIComponent(data.branch)}`} className="text-sm font-semibold text-teal-700 hover:underline">فتح داشبورد الفرع ←</Link>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3">
              <Stat icon={FileText} label="فواتير الفترة" value={data.invoiceCount} detail={`صافي ${money(data.purchases)} ج`} tone="teal" to={`/invoices?branch=${encodeURIComponent(data.branch)}`} />
              <Stat icon={WalletCards} label="المستبعد من الصافي" value={`${money(data.excluded)} ج`} detail="تحويلات داخلية واستبعادات" tone="amber" to={`/review-needed-invoices?branch=${encodeURIComponent(data.branch)}`} />
              <Stat icon={Receipt} label="المصروفات" value={`${money(data.expenseTotal)} ج`} detail="خلال الفترة المحددة" tone="blue" to={`/expenses?branch=${encodeURIComponent(data.branch)}`} />
              <Stat icon={RotateCcw} label="المرتجعات" value={data.returnCount} detail={`${data.pendingReturns} تحتاج متابعة`} tone={data.pendingReturns ? "red" : "emerald"} to={`/returns?branch=${encodeURIComponent(data.branch)}`} />
              <Stat icon={Landmark} label="تسليمات الشيفت" value={data.deliveryCount} detail={`${data.pendingTreasury} لم تُقفل خزنتها`} tone={data.pendingTreasury ? "purple" : "emerald"} to={`/shift-delivery?branch=${encodeURIComponent(data.branch)}`} />
              <Stat icon={ShoppingBag} label="طلبات العملاء" value={data.orderCount} detail={`${data.openOrders} ما زالت مفتوحة`} tone={data.openOrders ? "amber" : "emerald"} to={`/customer-orders?branch=${encodeURIComponent(data.branch)}`} />
            </div>
            <div className={`mx-4 mb-4 rounded-xl border p-4 ${overLimit ? "border-red-200 bg-red-50" : data.limitPercent >= 80 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {overLimit ? <TrendingUp className="h-5 w-5 text-red-600" /> : <TrendingDown className="h-5 w-5 text-emerald-600" />}
                  <div><p className="font-bold text-slate-800">متابعة حد مشتريات اليوم</p><p className="text-xs text-slate-500">الحد {money(data.dailyLimit)} ج — المستخدم {data.limitPercent}%</p></div>
                </div>
                <p className={`text-lg font-bold ${overLimit ? "text-red-700" : "text-slate-800"}`}>{money(data.todayPurchases)} ج</p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/80"><div className={`h-full rounded-full ${overLimit ? "bg-red-500" : data.limitPercent >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(data.limitPercent, 100)}%` }} /></div>
            </div>
          </Card>;
        })}
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2"><BarChart3 className="h-5 w-5 text-teal-600" /><h3 className="font-bold text-slate-800">المسارات المرتبطة بالمركز</h3></div>
        <div className="grid gap-2 text-sm md:grid-cols-3">
          <Link className="rounded-lg border p-3 hover:bg-slate-50" to="/reports">التقارير الإجمالية</Link>
          <Link className="rounded-lg border p-3 hover:bg-slate-50" to="/treasury-operations">رقابة وإقفال الخزنة</Link>
          <Link className="rounded-lg border p-3 hover:bg-slate-50" to="/purchase-operations-review">مراجعة تشغيل الطلبيات</Link>
          <Link className="rounded-lg border p-3 hover:bg-slate-50" to="/data-review">مركز مراجعة البيانات</Link>
          <Link className="rounded-lg border p-3 hover:bg-slate-50" to="/inventory-count">الجرد الدوري</Link>
          <Link className="rounded-lg border p-3 hover:bg-slate-50" to="/system-status"><span className="inline-flex items-center gap-2"><ClipboardList className="h-4 w-4" />حالة النظام والمزامنة</span></Link>
        </div>
      </Card>
    </div>
  );
}
