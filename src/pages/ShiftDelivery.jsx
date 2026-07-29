import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useUserRole } from "@/lib/useUserRole";
import ShiftDeliveryForm from "@/components/shift/ShiftDeliveryForm";
import ShiftDeliveryHistory from "@/components/shift/ShiftDeliveryHistory";
import ShiftDeliveryStats from "@/components/shift/ShiftDeliveryStats";
import ShiftDeliveryReport from "@/components/shift/ShiftDeliveryReport";
import ShiftDeliveryInsights from "@/components/shift/ShiftDeliveryInsights";
import ExpenseItemsTab from "@/components/shift/ExpenseItemsTab";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowLeft, CheckCircle2, Landmark, Loader2, Receipt, RefreshCw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

const localDate = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const fmt = (value) => Number(value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });

function MetricCard({ label, value, hint, icon: Icon, className }) {
  return <div className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-gray-500">{label}</p><p className={`mt-1 text-2xl font-bold ${className || "text-gray-900"}`}>{value}</p>{hint && <p className="mt-1 text-[11px] text-gray-400">{hint}</p>}</div><div className="rounded-xl bg-gray-50 p-2"><Icon className="h-5 w-5 text-gray-500" /></div></div></div>;
}

export default function ShiftDelivery() {
  const { isAdmin, isManager } = useUserRole();
  const canViewAll = isAdmin || isManager;
  const [activeTab, setActiveTab] = useState("new");

  const { data: deliveries = [], refetch, isFetching, error } = useQuery({
    queryKey: ["shift-deliveries"],
    queryFn: async () => {
      const pageSize = 500;
      let all = [];
      let page = 0;
      while (true) {
        const batch = await base44.entities.ShiftDelivery.list("-shift_date", pageSize, page * pageSize);
        all = [...all, ...batch];
        if (batch.length < pageSize) break;
        page += 1;
      }
      return all;
    },
    staleTime: 30000,
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  });

  const today = localDate();
  const overview = useMemo(() => {
    const todayRows = deliveries.filter((delivery) => delivery.shift_date === today);
    const pending = deliveries.filter((delivery) => !["approved", "reviewed"].includes(delivery.treasury_status || "pending")).length;
    const approvedToday = todayRows.filter((delivery) => ["approved", "reviewed"].includes(delivery.treasury_status || "pending")).length;
    const todayNet = todayRows.reduce((sum, delivery) => sum + Number(delivery.net_amount || 0), 0);
    const expectedShifts = 6;
    return { todayCount: todayRows.length, missingToday: Math.max(0, expectedShifts - todayRows.length), pending, approvedToday, todayNet };
  }, [deliveries, today]);

  const tabs = canViewAll ? [
    { key: "new", label: "تسليم جديد" },
    { key: "history", label: "التسليمات والتفاصيل" },
    { key: "insights", label: "التحليل التشغيلي" },
    { key: "stats", label: "الإحصائيات" },
    { key: "report", label: "التقرير" },
    { key: "items", label: "بنود المصروفات" },
  ] : [{ key: "new", label: "تسليم جديد" }];

  return <div className="space-y-5 p-4 md:p-6" dir="rtl">
    <header className="rounded-2xl border bg-gradient-to-l from-indigo-50 via-white to-teal-50 p-4 shadow-sm md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><Wallet className="h-6 w-6 text-indigo-600" /><h1 className="text-2xl font-bold text-gray-900">مركز تسليم وإقفال الشيفتات</h1></div><p className="mt-1 text-sm text-gray-600">من تسجيل طرق التحصيل والمصروفات إلى مطابقة النقدية ثم اعتماد الخزنة.</p></div><Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>{isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}تحديث البيانات</Button></div>
      {canViewAll && <div className="mt-4 grid gap-2 sm:grid-cols-3"><Link to="/treasury" className="flex items-center justify-between rounded-xl border bg-white p-3 text-sm font-semibold text-gray-700 hover:border-indigo-300 hover:text-indigo-700"><span className="flex items-center gap-2"><Landmark className="h-4 w-4" />مراجعة واعتماد الخزنة</span><ArrowLeft className="h-4 w-4" /></Link><Link to="/expenses" className="flex items-center justify-between rounded-xl border bg-white p-3 text-sm font-semibold text-gray-700 hover:border-indigo-300 hover:text-indigo-700"><span className="flex items-center gap-2"><Receipt className="h-4 w-4" />المصروفات المسجلة</span><ArrowLeft className="h-4 w-4" /></Link><Link to="/branch-settlements" className="flex items-center justify-between rounded-xl border bg-white p-3 text-sm font-semibold text-gray-700 hover:border-indigo-300 hover:text-indigo-700"><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />تسويات الفروع</span><ArrowLeft className="h-4 w-4" /></Link></div>}
    </header>

    {canViewAll && <div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><MetricCard label="تسليمات اليوم" value={overview.todayCount} hint="المسجل من 6 شيفتات متوقعة" icon={Wallet} /><MetricCard label="شيفتات ناقصة اليوم" value={overview.missingToday} hint="فرعان × 3 شيفتات" icon={AlertTriangle} className={overview.missingToday ? "text-red-600" : "text-emerald-700"} /><MetricCard label="بانتظار مراجعة الخزنة" value={overview.pending} icon={AlertTriangle} className={overview.pending ? "text-amber-600" : "text-emerald-700"} /><MetricCard label="معتمد اليوم" value={overview.approvedToday} icon={CheckCircle2} className="text-emerald-700" /><MetricCard label="صافي تسليمات اليوم" value={`${fmt(overview.todayNet)} ج`} icon={Landmark} className="text-indigo-700" /></div>}

    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">تعذر تحميل بعض تسليمات الشيفت: {error.message}</div>}

    <div className="flex items-center gap-1 overflow-x-auto border-b bg-white px-2">
      {tabs.map((tab) => <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={cn("whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors", activeTab === tab.key ? "border-indigo-600 text-indigo-700" : "border-transparent text-gray-500 hover:text-gray-800")}>{tab.label}{tab.key === "history" && overview.pending > 0 && <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">{overview.pending}</span>}</button>)}
    </div>

    {activeTab === "new" && <ShiftDeliveryForm onSaved={async () => { await refetch(); if (canViewAll) setActiveTab("history"); }} />}
    {activeTab === "history" && canViewAll && <ShiftDeliveryHistory deliveries={deliveries} onNewShift={() => setActiveTab("new")} />}
    {activeTab === "insights" && canViewAll && <ShiftDeliveryInsights deliveries={deliveries} />}
    {activeTab === "stats" && canViewAll && <ShiftDeliveryStats deliveries={deliveries} />}
    {activeTab === "report" && canViewAll && <ShiftDeliveryReport deliveries={deliveries} />}
    {activeTab === "items" && canViewAll && <ExpenseItemsTab />}
  </div>;
}
