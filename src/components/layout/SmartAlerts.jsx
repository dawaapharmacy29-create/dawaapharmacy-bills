import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44, performanceApi } from "@/api/base44Client";
import { Bell, X, FileText, RotateCcw, ChevronDown, ChevronUp, Landmark, TrendingUp, Database, Store, Scale, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { getInvoiceNetAmount } from "@/lib/purchaseCalculations";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); };
const historyFrom = daysAgo(14);
const money = (value) => Number(value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });
const recordDate = (row) => row.invoice_date || row.shift_date || row.created_date?.slice(0,10) || row.created_at?.slice(0,10);
const daysDiff = (dateStr) => dateStr ? Math.max(0, Math.floor((new Date() - new Date(dateStr)) / 86400000)) : 0;

async function loadInvoices() {
  const pageSize = 200;
  const first = await performanceApi.invoices({ branch: "all", date_from: historyFrom, date_to: today, page: 1, page_size: pageSize, sort_by: "invoice_date", sort_direction: "desc" });
  const rows = [...(first?.rows || [])];
  for (let page = 2; page <= Number(first?.total_pages || 1); page += 1) {
    const result = await performanceApi.invoices({ branch: "all", date_from: historyFrom, date_to: today, page, page_size: pageSize, sort_by: "invoice_date", sort_direction: "desc" });
    rows.push(...(result?.rows || []));
  }
  return rows;
}

export default function SmartAlerts() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => { try { return JSON.parse(localStorage.getItem("dismissed_alerts") || "[]"); } catch { return []; } });

  const { data: pendingInvoices = [] } = useQuery({ queryKey: ["alerts-pending-invoices"], queryFn: () => base44.entities.PurchaseInvoice.filter({ workflow_status: "submitted" }), staleTime: 30000, refetchInterval: 60000 });
  const { data: returns = [] } = useQuery({ queryKey: ["alerts-returns"], queryFn: () => base44.entities.Return.list("-created_date", 200), staleTime: 30000, refetchInterval: 60000 });
  const { data: shiftDeliveries = [] } = useQuery({ queryKey: ["alerts-shift-deliveries-extended"], queryFn: () => base44.entities.ShiftDelivery.list("-shift_date", 500), staleTime: 30000, refetchInterval: 60000 });
  const { data: targets = [] } = useQuery({ queryKey: ["alerts-daily-purchase-limits"], queryFn: () => base44.entities.TargetGoal.list(), staleTime: 60000 });
  const { data: suppliers = [] } = useQuery({ queryKey: ["alerts-suppliers"], queryFn: () => base44.entities.Supplier.list(), staleTime: 60000 });
  const { data: invoices = [] } = useQuery({ queryKey: ["alerts-purchase-history", historyFrom, today], queryFn: loadInvoices, staleTime: 30000, refetchInterval: 60000, refetchOnWindowFocus: true });

  const alerts = useMemo(() => {
    const list = [];
    const add = (alert) => { if (!dismissed.includes(alert.id)) list.push(alert); };

    pendingInvoices.slice(0, 20).forEach((inv) => add({ id: `inv-${inv.id}`, icon: FileText, title: "فاتورة قيد المراجعة", desc: `فاتورة ${inv.system_invoice_number || ""} — ${inv.supplier_name || ""} — ${inv.branch || ""}`, link: "/pending-invoices", priority: 5, color: "bg-yellow-50 border-yellow-200", iconColor: "text-yellow-600" }));

    returns.filter((r) => ["Pending","Under Review","pending","under_review","قيد المراجعة"].includes(r.status) && daysDiff(recordDate(r)) > 3).slice(0,10).forEach((r) => add({ id: `ret-${r.id}`, icon: RotateCcw, title: `مرتجع متأخر (${daysDiff(recordDate(r))} يوم)`, desc: `${r.supplier_name || ""} — ${r.branch_name || r.branch || ""}`, link: "/returns", priority: 7, color: "bg-red-50 border-red-200", iconColor: "text-red-600" }));

    shiftDeliveries.filter((row) => recordDate(row) >= daysAgo(3)).forEach((row) => {
      const incomplete = !row.branch || !row.shift_date || !row.shift_type || !row.handed_by || row.total_sales === null || row.total_sales === undefined;
      if (incomplete) add({ id: `shift-incomplete-${row.id}`, icon: AlertTriangle, title: "تسليم شيفت ناقص البيانات", desc: `${row.branch || "فرع غير محدد"} — ${row.shift_type || "شيفت غير محدد"} — ${row.shift_date || "بدون تاريخ"}`, link: "/shift-delivery", priority: 9, color: "bg-red-50 border-red-300", iconColor: "text-red-600" });
      if (String(row.treasury_status || "pending").toLowerCase() === "pending" && daysDiff(recordDate(row)) >= 1) add({ id: `shift-review-${row.id}`, icon: Landmark, title: "تسليم شيفت لم تتم مراجعته", desc: `${row.branch || ""} — ${row.shift_type || ""} — ${row.shift_date || ""}`, link: "/treasury-operations", priority: 8, color: "bg-purple-50 border-purple-200", iconColor: "text-purple-600" });
    });

    BRANCHES.forEach((branch) => {
      const branchInvoices = invoices.filter((row) => row.branch === branch);
      const todayPurchases = branchInvoices.filter((row) => recordDate(row) === today).reduce((sum,row) => sum + getInvoiceNetAmount(row, suppliers), 0);
      const oldPurchases = branchInvoices.filter((row) => recordDate(row) < today).reduce((sum,row) => sum + getInvoiceNetAmount(row, suppliers), 0);
      const avgPurchases = oldPurchases / 14;
      const limit = Number(targets.find((row) => row.branch === branch && row.goal_type === "daily_purchase_limit")?.target_amount || 20000);
      const percent = limit > 0 ? Math.round(todayPurchases / limit * 100) : 0;
      if (percent >= 75) add({ id: `limit-${branch}-${today}-${percent >= 100 ? "over" : "near"}`, icon: TrendingUp, title: percent >= 100 ? "تم تجاوز حد المشتريات اليومي" : "تنبيه قبل تجاوز حد المشتريات", desc: `${branch}: ${money(todayPurchases)} ج من ${money(limit)} ج (${percent}%)`, link: "/sales-purchases-report", priority: percent >= 100 ? 10 : 7, color: percent >= 100 ? "bg-red-50 border-red-300" : "bg-amber-50 border-amber-200", iconColor: percent >= 100 ? "text-red-600" : "text-amber-600" });

      const todaySales = shiftDeliveries.filter((row) => row.branch === branch && row.shift_date === today).reduce((sum,row) => sum + Number(row.total_sales || 0), 0);
      const previousSales = shiftDeliveries.filter((row) => row.branch === branch && row.shift_date >= daysAgo(7) && row.shift_date < today).reduce((sum,row) => sum + Number(row.total_sales || 0), 0);
      const avgSales = previousSales / 7;
      if (avgSales > 0 && avgPurchases > 0 && todaySales < avgSales * 0.8 && todayPurchases > avgPurchases * 1.2) add({ id: `sales-down-buy-up-${branch}-${today}`, icon: Scale, title: "انخفاض المبيعات مع ارتفاع الشراء", desc: `${branch}: مبيعات اليوم أقل من المتوسط والمشتريات أعلى منه؛ راجع قرارات الشراء.`, link: "/sales-purchases-report", priority: 9, color: "bg-red-50 border-red-300", iconColor: "text-red-600" });
    });

    const bySupplier = new Map();
    invoices.forEach((row) => {
      const name = row.supplier_name || "مورد غير محدد";
      const item = bySupplier.get(name) || { today: 0, previous: 0 };
      const amount = getInvoiceNetAmount(row, suppliers);
      if (recordDate(row) === today) item.today += amount; else item.previous += amount;
      bySupplier.set(name, item);
    });
    [...bySupplier.entries()].forEach(([name, values]) => {
      const avg = values.previous / 14;
      if (values.today >= 10000 && avg > 0 && values.today > avg * 2) add({ id: `supplier-spike-${name}-${today}`, icon: Store, title: "زيادة مشتريات مورد بشكل غير طبيعي", desc: `${name}: مشتريات اليوم ${money(values.today)} ج مقابل متوسط يومي ${money(avg)} ج`, link: "/suppliers", priority: 8, color: "bg-orange-50 border-orange-200", iconColor: "text-orange-600" });
    });

    const missingSupplierRules = suppliers.filter((row) => !row.supplier_type || !row.default_purchase_category || row.default_purchase_category === "none").length;
    if (missingSupplierRules) add({ id: `supplier-rules-${missingSupplierRules}`, icon: Database, title: "موردون يحتاجون استكمال القواعد", desc: `${missingSupplierRules} مورد بدون تصنيف شراء كامل`, link: "/supplier-rules-backfill", priority: 3, color: "bg-slate-50 border-slate-200", iconColor: "text-slate-600" });

    return list.sort((a,b) => b.priority - a.priority).slice(0,40);
  }, [dismissed, invoices, pendingInvoices, returns, shiftDeliveries, suppliers, targets]);

  const dismiss = (id) => { const next = [...new Set([...dismissed,id])]; setDismissed(next); localStorage.setItem("dismissed_alerts", JSON.stringify(next)); };
  const dismissAll = () => { const next = [...new Set([...dismissed,...alerts.map((a) => a.id)])]; setDismissed(next); localStorage.setItem("dismissed_alerts", JSON.stringify(next)); setOpen(false); };
  if (!alerts.length) return null;

  return <div className="relative"><button onClick={() => setOpen((v) => !v)} className="relative flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-sm font-medium shadow-sm"><Bell className="h-4 w-4 text-orange-500"/><span className="hidden sm:inline">التنبيهات</span><span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">{alerts.length}</span>{open ? <ChevronUp className="h-3 w-3"/> : <ChevronDown className="h-3 w-3"/>}</button>{open && <><div className="fixed inset-0 z-40" onClick={() => setOpen(false)}/><div className="absolute left-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border bg-white shadow-xl sm:w-96"><div className="flex items-center justify-between border-b bg-gray-50 px-4 py-3"><span className="text-sm font-semibold">التنبيهات التشغيلية ({alerts.length})</span><div className="flex gap-2"><button onClick={dismissAll} className="text-xs text-gray-400 hover:text-red-500">تجاهل الكل</button><button onClick={() => setOpen(false)}><X className="h-4 w-4 text-gray-400"/></button></div></div><div className="max-h-96 divide-y overflow-y-auto">{alerts.map((alert) => <div key={alert.id} className={`flex gap-3 border-r-4 px-4 py-3 ${alert.color}`}><alert.icon className={`mt-0.5 h-4 w-4 shrink-0 ${alert.iconColor}`}/><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-gray-800">{alert.title}</p><p className="mt-0.5 text-xs text-gray-600">{alert.desc}</p><Link to={alert.link} onClick={() => setOpen(false)} className="mt-1 inline-block text-xs text-teal-600 hover:underline">عرض التفاصيل ←</Link></div><button onClick={() => dismiss(alert.id)}><X className="h-3.5 w-3.5 text-gray-400"/></button></div>)}</div></div></>}</div>;
}
