import { AlertTriangle, CheckCircle2, Clock3, UserRoundCheck } from "lucide-react";

const age = (o) => Math.max(0, (Date.now() - new Date(o.created_date || o.request_date || 0).getTime()) / 3600000);
const open = (o) => !["تم التوصيل", "تم الإلغاء"].includes(o.status);

export default function OrderWorkspaceDashboard({ orders = [], onOpen }) {
  const cards = [
    ["عاجل مفتوح", orders.filter((o) => open(o) && o.priority === "عاجل").length, AlertTriangle, "text-red-600 bg-red-50"],
    ["متأخر +12س", orders.filter((o) => open(o) && age(o) >= 12).length, Clock3, "text-amber-700 bg-amber-50"],
    ["بدون مسؤول", orders.filter((o) => open(o) && !o.assigned_employee).length, UserRoundCheck, "text-purple-700 bg-purple-50"],
    ["تم التوصيل", orders.filter((o) => o.status === "تم التوصيل").length, CheckCircle2, "text-green-700 bg-green-50"],
  ];
  const attention = orders.filter((o) => open(o) && (o.priority === "عاجل" || age(o) >= 12 || !o.assigned_employee)).slice(0, 6);
  return <div className="space-y-3">
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">{cards.map(([label, value, Icon, tone]) => <div key={label} className="bg-white border rounded-2xl p-3 flex items-center gap-3"><div className={`w-9 h-9 rounded-xl flex items-center justify-center ${tone}`}><Icon className="w-4 h-4" /></div><div><div className="text-xl font-black text-gray-900">{value}</div><div className="text-[11px] text-gray-500">{label}</div></div></div>)}</div>
    <div className="bg-white border rounded-2xl overflow-hidden"><div className="px-4 py-3 border-b"><h2 className="font-bold text-sm">يحتاج تدخل الآن</h2><p className="text-xs text-gray-500">أهم الطلبات فقط</p></div>{attention.length ? <div className="divide-y">{attention.map((o) => <button key={o.id} onClick={() => onOpen(o)} className="w-full px-4 py-3 text-right hover:bg-gray-50 flex justify-between gap-3"><span className="min-w-0"><b className="block text-sm truncate">{o.product_name}</b><span className="text-xs text-gray-500 truncate block">{o.customer_name} • {o.branch}</span></span><span className="text-xs shrink-0 text-amber-700 font-bold">{o.priority === "عاجل" ? "عاجل" : `${Math.floor(age(o))}س`}</span></button>)}</div> : <div className="py-8 text-center text-sm text-gray-400">لا توجد طلبات عاجلة</div>}</div>
  </div>;
}
