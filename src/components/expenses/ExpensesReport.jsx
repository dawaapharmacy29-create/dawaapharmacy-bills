import { useMemo } from "react";
import { Card } from "@/components/ui/card";

const COLORS = ["#0d9488", "#6366f1", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];
const BRANCHES = ["دواء شكري", "دواء الشامي"];

export default function ExpensesReport({ expenses }) {
  const total = expenses.reduce((s, e) => s + (e.amount || 0), 0);

  // مصروفات كل فرع حسب النوع
  const branchCategoryData = useMemo(() => {
    const result = {};
    const allCategories = new Set();
    expenses.forEach((e) => {
      const branch = e.branch || "غير محدد";
      const cat = e.category || "أخرى";
      allCategories.add(cat);
      if (!result[branch]) result[branch] = {};
      result[branch][cat] = (result[branch][cat] || 0) + (e.amount || 0);
    });
    return { result, allCategories: [...allCategories].sort() };
  }, [expenses]);

  const branchTotals = useMemo(() => {
    const map = {};
    expenses.forEach((e) => {
      const branch = e.branch || "غير محدد";
      map[branch] = (map[branch] || 0) + (e.amount || 0);
    });
    return map;
  }, [expenses]);

  if (expenses.length === 0) {
    return <div className="text-center py-16 text-gray-400">لا توجد بيانات للعرض</div>;
  }

  const { result, allCategories } = branchCategoryData;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 bg-teal-50 border-teal-200">
          <p className="text-xs text-teal-600">إجمالي المصروفات</p>
          <p className="text-xl font-bold text-teal-800">{total.toLocaleString("ar-EG")} ج</p>
        </Card>
        <Card className="p-4 bg-blue-50 border-blue-200">
          <p className="text-xs text-blue-600">عدد السجلات</p>
          <p className="text-xl font-bold text-blue-800">{expenses.length}</p>
        </Card>
        {BRANCHES.map((b, i) => (
          <Card key={b} className="p-4" style={{ borderColor: COLORS[i] + "66", backgroundColor: COLORS[i] + "11" }}>
            <p className="text-xs font-medium" style={{ color: COLORS[i] }}>{b}</p>
            <p className="text-xl font-bold text-gray-800">{(branchTotals[b] || 0).toLocaleString("ar-EG")} ج</p>
            <p className="text-xs text-gray-400">{total > 0 ? ((branchTotals[b] || 0) / total * 100).toFixed(1) : 0}%</p>
          </Card>
        ))}
      </div>

      {/* جدول المصروفات لكل فرع حسب النوع */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">مصروفات كل فرع حسب النوع</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" dir="rtl">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-right px-3 py-2.5 font-semibold text-gray-600">نوع المصروف</th>
                {BRANCHES.map((b) => (
                  <th key={b} className="text-center px-3 py-2.5 font-semibold text-gray-600">{b}</th>
                ))}
                <th className="text-center px-3 py-2.5 font-semibold text-gray-600">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {allCategories.map((cat, idx) => {
                const rowTotal = BRANCHES.reduce((s, b) => s + (result[b]?.[cat] || 0), 0);
                if (rowTotal === 0) return null;
                return (
                  <tr key={cat} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td className="px-3 py-2.5 font-medium text-gray-700">{cat}</td>
                    {BRANCHES.map((b) => (
                      <td key={b} className="px-3 py-2.5 text-center text-gray-700">
                        {result[b]?.[cat] ? result[b][cat].toLocaleString("ar-EG") + " ج" : "—"}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-center font-bold text-gray-800">
                      {rowTotal.toLocaleString("ar-EG")} ج
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 border-t-2 font-bold">
                <td className="px-3 py-2.5 text-gray-700">الإجمالي</td>
                {BRANCHES.map((b) => (
                  <td key={b} className="px-3 py-2.5 text-center text-gray-800">
                    {(branchTotals[b] || 0).toLocaleString("ar-EG")} ج
                  </td>
                ))}
                <td className="px-3 py-2.5 text-center text-teal-700">{total.toLocaleString("ar-EG")} ج</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* نسبة مصروفات كل فرع */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">نسبة مصروفات كل فرع من الإجمالي</h3>
        <div className="space-y-3">
          {BRANCHES.map((b, i) => {
            const val = branchTotals[b] || 0;
            const pct = total > 0 ? (val / total) * 100 : 0;
            return (
              <div key={b}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-gray-700">{b}</span>
                  <span className="font-bold text-gray-800">
                    {val.toLocaleString("ar-EG")} ج{" "}
                    <span className="text-xs text-gray-400">({pct.toFixed(1)}%)</span>
                  </span>
                </div>
                <div className="w-full h-2.5 bg-gray-100 rounded-full">
                  <div className="h-2.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: COLORS[i] }} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}