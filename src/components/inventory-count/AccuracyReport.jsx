import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BarChart2, TrendingDown, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";

export default function AccuracyReport({ branch }) {
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const { data: tasks = [] } = useQuery({
    queryKey: ["inventory-tasks-report", branch],
    queryFn: () => base44.entities.InventoryCountTask.filter({ branch, status: "مكتمل" }),
    staleTime: 30000,
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["inventory-entries-all", branch],
    queryFn: () => base44.entities.InventoryCountEntry.list("-count_date", 2000),
    staleTime: 30000,
  });

  const { data: products = [] } = useQuery({
    queryKey: ["inventory-products", branch],
    queryFn: () => base44.entities.InventoryProduct.filter({ branch }),
    staleTime: 60000,
  });

  const branchEntries = entries.filter(e => e.branch === branch && e.status === "مكتمل");

  const filteredTasks = tasks.filter(t => {
    if (filterFrom && t.task_date < filterFrom) return false;
    if (filterTo && t.task_date > filterTo) return false;
    return true;
  });

  const stats = useMemo(() => {
    const taskIds = new Set(filteredTasks.map(t => t.id));
    const relevant = branchEntries.filter(e => taskIds.has(e.task_id));
    const total = relevant.length;
    const matched = relevant.filter(e => e.difference === 0).length;
    const shortages = relevant.filter(e => e.difference < 0);
    const overages = relevant.filter(e => e.difference > 0);
    const accuracy = total > 0 ? Math.round((matched / total) * 100) : null;
    return { total, matched, shortages, overages, accuracy };
  }, [filteredTasks, branchEntries]);

  // Products with repeated discrepancies
  const repeatedDiscrepancy = useMemo(() => {
    const productMap = {};
    branchEntries.filter(e => e.difference !== 0 && e.difference !== null).forEach(e => {
      if (!productMap[e.product_name]) productMap[e.product_name] = { name: e.product_name, code: e.product_code, count: 0, diffs: [] };
      productMap[e.product_name].count++;
      productMap[e.product_name].diffs.push(e.difference);
    });
    return Object.values(productMap).filter(p => p.count >= 2).sort((a, b) => b.count - a.count);
  }, [branchEntries]);

  // Task history
  const sortedTasks = [...filteredTasks].sort((a, b) => b.task_date?.localeCompare(a.task_date));

  return (
    <div dir="rtl" className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-800">{filteredTasks.length}</p>
          <p className="text-xs text-gray-500 mt-1">مهام مكتملة</p>
        </div>
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-teal-700">{stats.accuracy !== null ? `${stats.accuracy}%` : "--"}</p>
          <p className="text-xs text-teal-600 mt-1">متوسط الدقة</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-red-700">{stats.shortages.length}</p>
          <p className="text-xs text-red-600 mt-1">حالات عجز</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-blue-700">{stats.overages.length}</p>
          <p className="text-xs text-blue-600 mt-1">حالات زيادة</p>
        </div>
      </div>

      {/* Date filter */}
      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-sm text-gray-600">تصفية بالتاريخ:</span>
        <Input type="date" className="w-40" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} placeholder="من" />
        <Input type="date" className="w-40" value={filterTo} onChange={e => setFilterTo(e.target.value)} placeholder="إلى" />
      </div>

      {/* Repeated discrepancies */}
      {repeatedDiscrepancy.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-500" />
            <h4 className="font-semibold text-gray-700 text-sm">أصناف ذات فوارق متكررة</h4>
          </div>
          <div className="overflow-x-auto border rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-orange-50">
                <tr>
                  <th className="px-3 py-2 text-right text-orange-700">اسم الصنف</th>
                  <th className="px-3 py-2 text-right text-orange-700">الكود</th>
                  <th className="px-3 py-2 text-center text-orange-700">مرات الفارق</th>
                  <th className="px-3 py-2 text-right text-orange-700">آخر فوارق</th>
                </tr>
              </thead>
              <tbody>
                {repeatedDiscrepancy.slice(0, 15).map((p, i) => (
                  <tr key={i} className="border-t hover:bg-orange-50">
                    <td className="px-3 py-2 font-medium">{p.name}</td>
                    <td className="px-3 py-2 text-gray-500">{p.code}</td>
                    <td className="px-3 py-2 text-center">
                      <Badge className="bg-orange-100 text-orange-800">{p.count} مرة</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1 flex-wrap">
                        {p.diffs.slice(-3).map((d, j) => (
                          <span key={j} className={`text-xs px-1.5 py-0.5 rounded font-medium ${d < 0 ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                            {d > 0 ? "+" : ""}{d}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Task history */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-teal-600" />
          <h4 className="font-semibold text-gray-700 text-sm">سجل المهام المكتملة</h4>
        </div>
        {sortedTasks.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">لا توجد مهام مكتملة بعد</p>
        ) : (
          <div className="overflow-x-auto border rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-right">التاريخ</th>
                  <th className="px-3 py-2 text-center">الأصناف</th>
                  <th className="px-3 py-2 text-center">المكتمل</th>
                  <th className="px-3 py-2 text-center">دقة الجرد</th>
                </tr>
              </thead>
              <tbody>
                {sortedTasks.map(t => (
                  <tr key={t.id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">{t.task_date}</td>
                    <td className="px-3 py-2 text-center">{t.items_count || 0}</td>
                    <td className="px-3 py-2 text-center">{t.completed_count || 0}</td>
                    <td className="px-3 py-2 text-center">
                      {t.accuracy_rate !== null && t.accuracy_rate !== undefined ? (
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          t.accuracy_rate >= 90 ? "bg-green-100 text-green-800"
                          : t.accuracy_rate >= 70 ? "bg-yellow-100 text-yellow-800"
                          : "bg-red-100 text-red-800"
                        }`}>{t.accuracy_rate}%</span>
                      ) : "--"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}