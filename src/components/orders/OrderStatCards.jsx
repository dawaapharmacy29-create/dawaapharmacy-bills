const STATS = [
  { status: "طلب جديد",       label: "جديدة",       color: "bg-blue-50 border-blue-200 text-blue-700",     dot: "bg-blue-500" },
  { status: "جاري البحث",     label: "جاري البحث",  color: "bg-yellow-50 border-yellow-200 text-yellow-700", dot: "bg-yellow-500" },
  { status: "تم الطلب",       label: "تم الطلب",    color: "bg-indigo-50 border-indigo-200 text-indigo-700", dot: "bg-indigo-500" },
  { status: "النواقص",        label: "النواقص",      color: "bg-purple-50 border-purple-200 text-purple-700", dot: "bg-purple-500" },
  { status: "تم توفير الصنف", label: "تم التوفير",  color: "bg-teal-50 border-teal-200 text-teal-700",     dot: "bg-teal-500" },
  { status: "تم التوصيل",     label: "تم التوصيل",  color: "bg-green-50 border-green-200 text-green-700",  dot: "bg-green-500" },
  { status: "تم الإلغاء",     label: "ملغية",        color: "bg-red-50 border-red-200 text-red-700",        dot: "bg-red-500" },
];

export default function OrderStatCards({ orders, onFilterStatus, activeStatus }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
      {STATS.map((s) => {
        const count = orders.filter((o) => o.status === s.status).length;
        const isActive = activeStatus === s.status;
        return (
          <button
            key={s.status}
            onClick={() => onFilterStatus(isActive ? "all" : s.status)}
            className={`rounded-xl border p-3 text-right transition-all hover:shadow-md ${s.color} ${isActive ? "ring-2 ring-offset-1 ring-current" : ""}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2 h-2 rounded-full ${s.dot}`} />
              <span className="text-xs font-medium">{s.label}</span>
            </div>
            <div className="text-2xl font-bold">{count}</div>
          </button>
        );
      })}
    </div>
  );
}