import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44, performanceApi } from "@/api/base44Client";
import { Bell, X, FileText, RotateCcw, Receipt, ChevronDown, ChevronUp, Landmark, TrendingUp, Database } from "lucide-react";
import { Link } from "react-router-dom";
import { getInvoiceNetAmount } from "@/lib/purchaseCalculations";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const today = new Date().toISOString().slice(0, 10);

function daysDiff(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}

function money(value) {
  return Number(value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });
}

export default function SmartAlerts() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem("dismissed_alerts") || "[]"); } catch { return []; }
  });

  const { data: pendingInvoices = [] } = useQuery({
    queryKey: ["alerts-pending-invoices"],
    queryFn: () => base44.entities.PurchaseInvoice.filter({ workflow_status: "submitted" }),
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const { data: returns = [] } = useQuery({
    queryKey: ["alerts-returns"],
    queryFn: () => base44.entities.Return.list("-created_date", 200),
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ["alerts-expenses"],
    queryFn: () => base44.entities.Expense.list("-created_date", 50),
    staleTime: 30000,
  });

  const { data: shiftDeliveries = [] } = useQuery({
    queryKey: ["alerts-shift-deliveries"],
    queryFn: () => base44.entities.ShiftDelivery.list("-shift_date", 100),
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const { data: targets = [] } = useQuery({
    queryKey: ["alerts-daily-purchase-limits"],
    queryFn: () => base44.entities.TargetGoal.list(),
    staleTime: 60000,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["alerts-suppliers"],
    queryFn: () => base44.entities.Supplier.list(),
    staleTime: 60000,
  });

  const { data: todayInvoices = [] } = useQuery({
    queryKey: ["alerts-today-invoices", today],
    queryFn: async () => {
      const pageSize = 200;
      const first = await performanceApi.invoices({ branch: "all", date_from: today, date_to: today, page: 1, page_size: pageSize, sort_by: "created_at", sort_direction: "desc" });
      const rows = [...(first?.rows || [])];
      const totalPages = Number(first?.total_pages || 1);
      for (let page = 2; page <= totalPages; page += 1) {
        const result = await performanceApi.invoices({ branch: "all", date_from: today, date_to: today, page, page_size: pageSize, sort_by: "created_at", sort_direction: "desc" });
        rows.push(...(result?.rows || []));
      }
      return rows;
    },
    staleTime: 30000,
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  });

  const alerts = useMemo(() => {
    const list = [];

    pendingInvoices.forEach((inv) => {
      const id = `inv-${inv.id}`;
      if (!dismissed.includes(id)) {
        list.push({
          id,
          type: "invoice",
          icon: FileText,
          color: "text-yellow-600 bg-yellow-50 border-yellow-200",
          iconColor: "text-yellow-600",
          title: "فاتورة قيد المراجعة",
          desc: `فاتورة ${inv.system_invoice_number || ""} — ${inv.supplier_name || ""} — ${inv.branch || ""}`,
          link: "/pending-invoices",
          age: daysDiff(inv.created_date || inv.created_at),
          priority: 4,
        });
      }
    });

    returns
      .filter((r) => ["Pending", "Under Review", "pending", "under_review", "قيد المراجعة"].includes(r.status) && daysDiff(r.created_date || r.created_at) > 3)
      .forEach((r) => {
        const id = `ret-${r.id}`;
        if (!dismissed.includes(id)) {
          list.push({
            id,
            type: "return",
            icon: RotateCcw,
            color: "text-red-600 bg-red-50 border-red-200",
            iconColor: "text-red-500",
            title: `مرتجع متأخر (${daysDiff(r.created_date || r.created_at)} يوم)`,
            desc: `مرتجع ${r.return_number || ""} — ${r.supplier_name || ""} — ${r.branch_name || r.branch || ""}`,
            link: "/returns",
            age: daysDiff(r.created_date || r.created_at),
            priority: 5,
          });
        }
      });

    expenses
      .filter((e) => daysDiff(e.created_date || e.created_at) < 1)
      .forEach((e) => {
        const id = `exp-${e.id}`;
        if (!dismissed.includes(id)) {
          list.push({
            id,
            type: "expense",
            icon: Receipt,
            color: "text-blue-600 bg-blue-50 border-blue-200",
            iconColor: "text-blue-500",
            title: "مصروف جديد",
            desc: `${e.description || e.category || "مصروف"} — ${money(e.amount)} ج — ${e.branch || ""}`,
            link: "/expenses",
            age: 0,
            priority: 1,
          });
        }
      });

    shiftDeliveries
      .filter((row) => String(row.treasury_status || "pending").toLowerCase() === "pending" && daysDiff(row.shift_date || row.created_date || row.created_at) >= 1)
      .forEach((row) => {
        const id = `shift-${row.id}`;
        if (!dismissed.includes(id)) {
          list.push({
            id,
            type: "shift",
            icon: Landmark,
            color: "text-purple-700 bg-purple-50 border-purple-200",
            iconColor: "text-purple-600",
            title: "تسليم شيفت لم تتم مراجعته",
            desc: `${row.branch || ""} — ${row.shift_type || ""} — ${row.shift_date || ""}`,
            link: "/shift-delivery",
            age: daysDiff(row.shift_date || row.created_date || row.created_at),
            priority: 5,
          });
        }
      });

    BRANCHES.forEach((branch) => {
      const limitRow = targets.find((row) => row.branch === branch && row.goal_type === "daily_purchase_limit");
      const limit = Number(limitRow?.target_amount || 20000);
      const purchases = todayInvoices.filter((row) => row.branch === branch).reduce((sum, row) => sum + getInvoiceNetAmount(row, suppliers), 0);
      const percent = limit > 0 ? Math.round((purchases / limit) * 100) : 0;
      if (percent >= 80) {
        const level = percent >= 100 ? "exceeded" : "warning";
        const id = `daily-limit-${branch}-${today}-${level}`;
        if (!dismissed.includes(id)) {
          list.push({
            id,
            type: "limit",
            icon: TrendingUp,
            color: percent >= 100 ? "text-red-700 bg-red-50 border-red-300" : "text-amber-700 bg-amber-50 border-amber-200",
            iconColor: percent >= 100 ? "text-red-600" : "text-amber-600",
            title: percent >= 100 ? "تم تجاوز حد المشتريات اليومي" : "اقترب حد المشتريات اليومي",
            desc: `${branch}: ${money(purchases)} ج من حد ${money(limit)} ج (${percent}%)`,
            link: `/branch-performance`,
            age: 0,
            priority: percent >= 100 ? 10 : 7,
          });
        }
      }
    });

    const missingSupplierRules = suppliers.filter((row) => !row.supplier_type || !row.default_purchase_category || row.default_purchase_category === "none").length;
    if (missingSupplierRules > 0) {
      const id = `supplier-rules-${missingSupplierRules}`;
      if (!dismissed.includes(id)) {
        list.push({
          id,
          type: "data",
          icon: Database,
          color: "text-slate-700 bg-slate-50 border-slate-200",
          iconColor: "text-slate-600",
          title: "موردون يحتاجون استكمال القواعد",
          desc: `${missingSupplierRules} مورد بدون تصنيف شراء كامل`,
          link: "/supplier-rules-backfill",
          age: 0,
          priority: 3,
        });
      }
    }

    return list.sort((a, b) => (b.priority || 0) - (a.priority || 0) || b.age - a.age);
  }, [dismissed, expenses, pendingInvoices, returns, shiftDeliveries, suppliers, targets, todayInvoices]);

  const dismiss = (id) => {
    const next = [...new Set([...dismissed, id])];
    setDismissed(next);
    localStorage.setItem("dismissed_alerts", JSON.stringify(next));
  };

  const dismissAll = () => {
    const ids = alerts.map((a) => a.id);
    const next = [...new Set([...dismissed, ...ids])];
    setDismissed(next);
    localStorage.setItem("dismissed_alerts", JSON.stringify(next));
    setOpen(false);
  };

  if (alerts.length === 0) return null;

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="relative flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50">
        <Bell className="h-4 w-4 text-orange-500" />
        <span className="hidden sm:inline">التنبيهات</span>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">{alerts.length}</span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {open && <>
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
        <div className="absolute left-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl sm:w-96">
          <div className="flex items-center justify-between border-b bg-gray-50 px-4 py-3">
            <span className="text-sm font-semibold text-gray-800">التنبيهات الذكية ({alerts.length})</span>
            <div className="flex items-center gap-2"><button onClick={dismissAll} className="text-xs text-gray-400 transition-colors hover:text-red-500">تجاهل الكل</button><button onClick={() => setOpen(false)}><X className="h-4 w-4 text-gray-400 hover:text-gray-600" /></button></div>
          </div>
          <div className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
            {alerts.map((alert) => <div key={alert.id} className={`flex items-start gap-3 border-r-4 px-4 py-3 ${alert.color}`}>
              <alert.icon className={`mt-0.5 h-4 w-4 shrink-0 ${alert.iconColor}`} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-gray-800">{alert.title}</p>
                <p className="mt-0.5 text-xs text-gray-600">{alert.desc}</p>
                <Link to={alert.link} onClick={() => setOpen(false)} className="mt-1 inline-block text-xs text-teal-600 hover:underline">عرض التفاصيل ←</Link>
              </div>
              <button onClick={() => dismiss(alert.id)} className="mt-0.5 shrink-0"><X className="h-3.5 w-3.5 text-gray-400 hover:text-red-500" /></button>
            </div>)}
          </div>
        </div>
      </>}
    </div>
  );
}
