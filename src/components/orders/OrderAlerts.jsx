import { useState } from "react";
import { Bell } from "lucide-react";

function daysSince(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

export default function OrderAlerts({ orders }) {
  const [open, setOpen] = useState(false);

  const alerts = [];

  orders.forEach((o) => {
    // New urgent requests
    if (o.status === "طلب جديد" && o.priority === "عاجل") {
      alerts.push({ type: "urgent", label: `طلب عاجل: ${o.product_name} — ${o.customer_name}`, id: o.id });
    }
    // Waiting too long (new > 3 days)
    const created = o.created_date || o.request_date;
    if (["طلب جديد", "جاري البحث"].includes(o.status) && daysSince(created) >= 3) {
      alerts.push({ type: "waiting", label: `طلب قديم (${daysSince(created)} يوم): ${o.product_name}`, id: o.id + "_w" });
    }
    // Product became available but not delivered
    if (o.status === "تم توفير الصنف" && !o.customer_contacted) {
      alerts.push({ type: "available", label: `صنف متوفر لم يُبلّغ عنه: ${o.product_name} — ${o.customer_name}`, id: o.id + "_a" });
    }
  });

  if (!alerts.length) return null;

  const COLORS = { urgent: "text-red-600 bg-red-50", waiting: "text-yellow-700 bg-yellow-50", available: "text-teal-700 bg-teal-50" };
  const ICONS = { urgent: "🚨", waiting: "⏳", available: "✅" };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative flex items-center justify-center w-9 h-9 rounded-full bg-orange-50 border border-orange-200 text-orange-600 hover:bg-orange-100 transition-colors"
      >
        <Bell className="w-4 h-4" />
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
          {Math.min(alerts.length, 9)}
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-11 z-50 bg-white rounded-xl border shadow-xl w-72 max-w-[calc(100vw-2rem)] max-h-80 overflow-y-auto" dir="rtl">
            <div className="p-3 border-b bg-gray-50 rounded-t-xl">
              <h3 className="text-sm font-bold text-gray-700">تنبيهات الطلبات ({alerts.length})</h3>
            </div>
            <div className="p-2 space-y-1">
              {alerts.map((a) => (
                <div key={a.id} className={`flex items-start gap-2 p-2.5 rounded-lg text-xs ${COLORS[a.type]}`}>
                  <span>{ICONS[a.type]}</span>
                  <span>{a.label}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}