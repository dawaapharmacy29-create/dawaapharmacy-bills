import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Bell, X, FileText, RotateCcw, Receipt, ChevronDown, ChevronUp } from "lucide-react";
import { Link } from "react-router-dom";

function daysDiff(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}

export default function SmartAlerts() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem("dismissed_alerts") || "[]"); } catch { return []; }
  });

  const { data: pendingInvoices = [] } = useQuery({
    queryKey: ["alerts-pending-invoices"],
    queryFn: () => base44.entities.PurchaseInvoice.filter({ status: "انتظار المراجعة" }),
    staleTime: 30000,
  });

  const { data: returns = [] } = useQuery({
    queryKey: ["alerts-returns"],
    queryFn: () => base44.entities.Return.list("-created_date", 200),
    staleTime: 30000,
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ["alerts-expenses"],
    queryFn: () => base44.entities.Expense.list("-created_date", 50),
    staleTime: 30000,
  });

  const alerts = useMemo(() => {
    const list = [];

    // Pending invoices
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
          age: daysDiff(inv.created_date),
        });
      }
    });

    // Returns older than 3 days not executed (Pending or Under Review)
    returns
      .filter((r) => ["Pending", "Under Review"].includes(r.status) && daysDiff(r.created_date) > 3)
      .forEach((r) => {
        const id = `ret-${r.id}`;
        if (!dismissed.includes(id)) {
          list.push({
            id,
            type: "return",
            icon: RotateCcw,
            color: "text-red-600 bg-red-50 border-red-200",
            iconColor: "text-red-500",
            title: `مرتجع متأخر (${daysDiff(r.created_date)} يوم)`,
            desc: `مرتجع ${r.return_number || ""} — ${r.supplier_name || ""} — ${r.branch_name || ""}`,
            link: "/returns",
            age: daysDiff(r.created_date),
          });
        }
      });

    // New expenses (last 24h)
    expenses
      .filter((e) => daysDiff(e.created_date) < 1)
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
            desc: `${e.description} — ${e.amount?.toLocaleString("ar-EG")} ج.م — ${e.branch || ""}`,
            link: "/expenses",
            age: daysDiff(e.created_date),
          });
        }
      });

    return list.sort((a, b) => b.age - a.age);
  }, [pendingInvoices, returns, expenses, dismissed]);

  const dismiss = (id) => {
    const next = [...dismissed, id];
    setDismissed(next);
    localStorage.setItem("dismissed_alerts", JSON.stringify(next));
  };

  const dismissAll = () => {
    const ids = alerts.map((a) => a.id);
    const next = [...dismissed, ...ids];
    setDismissed(next);
    localStorage.setItem("dismissed_alerts", JSON.stringify(next));
    setOpen(false);
  };

  if (alerts.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm transition-colors"
      >
        <Bell className="w-4 h-4 text-orange-500" />
        <span className="hidden sm:inline">التنبيهات</span>
        <span className="bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
          {alerts.length}
        </span>
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
              <span className="font-semibold text-gray-800 text-sm">التنبيهات الذكية ({alerts.length})</span>
              <div className="flex items-center gap-2">
                <button onClick={dismissAll} className="text-xs text-gray-400 hover:text-red-500 transition-colors">تجاهل الكل</button>
                <button onClick={() => setOpen(false)}><X className="w-4 h-4 text-gray-400 hover:text-gray-600" /></button>
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
              {alerts.map((alert) => (
                <div key={alert.id} className={`flex items-start gap-3 px-4 py-3 ${alert.color} border-r-4`}>
                  <alert.icon className={`w-4 h-4 mt-0.5 shrink-0 ${alert.iconColor}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800">{alert.title}</p>
                    <p className="text-xs text-gray-600 mt-0.5 truncate">{alert.desc}</p>
                    <Link
                      to={alert.link}
                      onClick={() => setOpen(false)}
                      className="text-xs text-teal-600 hover:underline mt-1 inline-block"
                    >
                      عرض التفاصيل ←
                    </Link>
                  </div>
                  <button onClick={() => dismiss(alert.id)} className="shrink-0 mt-0.5">
                    <X className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}