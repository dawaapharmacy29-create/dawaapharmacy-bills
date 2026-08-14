import { LayoutDashboard, ClipboardList, RefreshCw, BarChart3, Archive } from "lucide-react";

const TABS = [
  ["dashboard", "لوحة اليوم", LayoutDashboard],
  ["orders", "الطلبات", ClipboardList],
  ["followup", "المتابعة", RefreshCw],
  ["analytics", "التحليلات", BarChart3],
  ["archive", "الأرشيف", Archive],
];

export default function OrderWorkspaceTabs({ value, onChange }) {
  return <div className="bg-white border rounded-2xl p-1.5 overflow-x-auto">
    <div className="grid grid-cols-5 min-w-[620px] gap-1.5">
      {TABS.map(([id, label, Icon]) => <button key={id} onClick={() => onChange(id)} className={`h-11 px-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition ${value === id ? "bg-teal-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-50"}`}><Icon className="w-4 h-4" />{label}</button>)}
    </div>
  </div>;
}
