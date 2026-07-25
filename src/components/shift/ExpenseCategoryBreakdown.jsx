import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Receipt } from "lucide-react";
import { Card } from "@/components/ui/card";

const fmt = (n) => Number(n || 0).toLocaleString("ar-EG");

const COLORS = [
  { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", icon_bg: "bg-red-100", icon_text: "text-red-600" },
  { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", icon_bg: "bg-blue-100", icon_text: "text-blue-600" },
  { bg: "bg-green-50", border: "border-green-200", text: "text-green-700", icon_bg: "bg-green-100", icon_text: "text-green-600" },
  { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", icon_bg: "bg-amber-100", icon_text: "text-amber-600" },
  { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-700", icon_bg: "bg-purple-100", icon_text: "text-purple-600" },
  { bg: "bg-pink-50", border: "border-pink-200", text: "text-pink-700", icon_bg: "bg-pink-100", icon_text: "text-pink-600" },
  { bg: "bg-teal-50", border: "border-teal-200", text: "text-teal-700", icon_bg: "bg-teal-100", icon_text: "text-teal-600" },
  { bg: "bg-indigo-50", border: "border-indigo-200", text: "text-indigo-700", icon_bg: "bg-indigo-100", icon_text: "text-indigo-600" },
];

export default function ExpenseCategoryBreakdown({ deliveries, title = "تفصيل المصروفات حسب البند" }) {
  const [expanded, setExpanded] = useState(null);

  const categories = useMemo(() => {
    const map = {};
    deliveries.forEach((d) => {
      (d.expenses || []).forEach((e) => {
        const cat = (e.category && e.category.trim()) || "أخرى";
        if (!map[cat]) map[cat] = { total: 0, items: [] };
        map[cat].total += e.amount || 0;
        map[cat].items.push({
          description: e.description || "—",
          amount: e.amount || 0,
          branch: d.branch || "—",
          shift_date: d.shift_date || "—",
        });
      });
    });
    return Object.entries(map)
      .map(([name, data], idx) => ({ name, ...data, color: COLORS[idx % COLORS.length] }))
      .sort((a, b) => b.total - a.total);
  }, [deliveries]);

  const grandTotal = categories.reduce((s, c) => s + c.total, 0);

  if (categories.length === 0) {
    return (
      <Card className="p-6 text-center text-gray-400 text-sm">
        <Receipt className="w-6 h-6 mx-auto mb-2 opacity-40" />
        لا توجد بنود مصروفات في الفترة المحددة
      </Card>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-700">{title}</h3>
        <span className="text-xs text-gray-500">
          الإجمالي: <span className="font-bold text-red-600">{fmt(grandTotal)}</span> ج.م
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {categories.map((cat) => (
          <div key={cat.name}>
            <button
              onClick={() => setExpanded(expanded === cat.name ? null : cat.name)}
              className={`w-full text-right ${cat.color.bg} ${cat.color.border} border rounded-xl p-3 transition-all hover:shadow-md`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`w-7 h-7 rounded-lg ${cat.color.icon_bg} flex items-center justify-center`}>
                  <Receipt className={`w-3.5 h-3.5 ${cat.color.icon_text}`} />
                </div>
                {expanded === cat.name ? (
                  <ChevronUp className={`w-4 h-4 ${cat.color.icon_text}`} />
                ) : (
                  <ChevronDown className={`w-4 h-4 ${cat.color.icon_text}`} />
                )}
              </div>
              <p className="text-xs text-gray-600 mb-1 truncate">{cat.name}</p>
              <p className={`text-lg font-bold ${cat.color.text}`}>
                {fmt(cat.total)}
                <span className="text-xs font-normal text-gray-400 mr-1">ج.م</span>
              </p>
              <p className="text-xs text-gray-400 mt-1">{cat.items.length} حركة</p>
            </button>

            {expanded === cat.name && (
              <div className="mt-2 bg-white border border-gray-200 rounded-xl p-2 space-y-1.5 max-h-48 overflow-y-auto shadow-sm">
                {cat.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-start gap-2 text-xs pb-1.5 border-b border-gray-100 last:border-0 last:pb-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-700 truncate">{item.description}</p>
                      <p className="text-gray-400 text-[10px]">{item.branch} • {item.shift_date}</p>
                    </div>
                    <span className="font-medium text-gray-700 whitespace-nowrap">{fmt(item.amount)} ج.م</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}