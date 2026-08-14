import { useState } from "react";
import { Bell } from "lucide-react";

function daysSince(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

export default function OrderAlerts({ orders, onOpen }) {
  const [open, setOpen] = useState(false);
  const alerts = [];

  orders.forEach((o) => {
    if (o.status === "طلب جديد" && o.priority === "عاجل") {
      alerts.push({ type: "urgent", label: `طلب عاجل: ${o.product_name} — ${o.customer_name}`, id: `${o.id}_u`, order: o });
    }
    const created = o.created_date || o.request_date;
    if (["طلب جديد", "جاري البحث"].includes(o.status) && daysSince(created) >= 3) {
      alerts.push({ type: "waiting", label: `طلب قديم (${daysSince(created)} يوم): ${o.product_name}`, id: `${o.id}_w`, order: o });
    }
    if (o.status === "تم توفير الصنف" && !o.customer_contacted) {
      const arrivedFromPurchases = String(o.arrival_notes || '').includes('استلام المشتريات');
      alerts.push({
        type: "available",
        label: arrivedFromPurchases
          ? `وصل من المشتريات: ${o.product_name} — افتح طلب ${o.customer_name || 'العميل'} للمتابعة`
          : `صنف متوفر لم يُبلّغ عنه: ${o.product_name} — ${o.customer_name}`,
        id: `${o.id}_a`,
        order: o,
      });
    }
  });

  if (!alerts.length) return null;
  const COLORS = { urgent: "text-red-600 bg-red-50", waiting: "text-yellow-700 bg-yellow-50", available: "text-teal-700 bg-teal-50" };
  const ICONS = { urgent: "🚨", waiting: "⏳", available: "✅" };

  return <div className="relative">
    <button onClick={() => setOpen(!open)} className="relative flex items-center justify-center w-9 h-9 rounded-full bg-orange-50 border border-orange-200 text-orange-600 hover:bg-orange-100 transition-colors">
      <Bell className="w-4 h-4" />
      <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">{Math.min(alerts.length, 99)}</span>
    </button>
    {open && <><div className="fixed inset-0 z-40" onClick={() => setOpen(false)} /><div className="absolute left-0 top-11 z-50 bg-white rounded-xl border shadow-xl w-80 max-w-[calc(100vw-2rem)] max-h-96 overflow-y-auto" dir="rtl">
      <div className="p-3 border-b bg-gray-50 rounded-t-xl"><h3 className="text-sm font-bold text-gray-700">تنبيهات الطلبات ({alerts.length})</h3><p className="mt-1 text-[10px] text-gray-500">اضغط على أي تنبيه لفتح طلب العميل بتفاصيله.</p></div>
      <div className="p-2 space-y-1">{alerts.map((a) => <button key={a.id} type="button" onClick={() => { setOpen(false); onOpen?.(a.order); }} className={`w-full flex items-start gap-2 p-2.5 rounded-lg text-xs text-right hover:ring-1 hover:ring-current ${COLORS[a.type]}`}><span>{ICONS[a.type]}</span><span>{a.label}</span></button>)}</div>
    </div></>}
  </div>;
}
