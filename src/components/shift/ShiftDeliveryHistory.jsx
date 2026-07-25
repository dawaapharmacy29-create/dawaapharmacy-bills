import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Trash2, Pencil, Eye, Plus } from "lucide-react";
import ShiftDeliveryDetail from "./ShiftDeliveryDetail";
import ShiftDeliveryEditDialog from "./ShiftDeliveryEditDialog";
import { useUserRole } from "@/lib/useUserRole";
import DateRangeFilter from "./DateRangeFilter";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortControls } from "@/components/table/SortControls";
import { SHIFT_TYPE_ORDER } from "@/lib/sortUtils";

const SHIFT_SORT_COLUMNS = [
  { field: "shift_type", label: "نوع الشفت", type: "status", statusMap: SHIFT_TYPE_ORDER },
  { field: "submitted_by", label: "الموظف", type: "text" },
  { field: "total_sales", label: "المبيعات", type: "number" },
  { field: "total_expenses", label: "المصروفات", type: "number" },
  { field: "net_amount", label: "الصافي", type: "number" },
];

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const BRANCH_COLORS = {
  "دواء شكري": { dot: "bg-teal-500", text: "text-teal-700", bg: "bg-teal-50", border: "border-teal-200" },
  "دواء الشامي": { dot: "bg-orange-500", text: "text-orange-700", bg: "bg-orange-50", border: "border-orange-200" },
};
const SHIFT_BADGE = {
  "صباحي": "bg-amber-100 text-amber-700",
  "مسائي": "bg-blue-100 text-blue-700",
  "ليلي": "bg-indigo-100 text-indigo-700",
};

const fmt = (n) => Number(n || 0).toLocaleString("ar-EG");

export default function ShiftDeliveryHistory({ deliveries, onNewShift }) {
  const qc = useQueryClient();
  const { isAdmin } = useUserRole();
  const [detailItem, setDetailItem] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const dateFilteredRaw = useMemo(() => {
    return deliveries.filter((d) => {
      if (!d.shift_date) return false;
      if (fromDate && d.shift_date < fromDate) return false;
      if (toDate && d.shift_date > toDate) return false;
      return true;
    });
  }, [deliveries, fromDate, toDate]);

  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({
    columns: SHIFT_SORT_COLUMNS,
    defaultSort: { field: "shift_type", direction: "asc" },
    paramPrefix: "shift",
  });
  const dateFiltered = useMemo(() => sortData(dateFilteredRaw), [dateFilteredRaw, sortData]);

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ShiftDelivery.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shift-deliveries"] }),
  });

  // Group by date (descending)
  const grouped = useMemo(() => {
    const map = {};
    for (const d of dateFiltered) {
      const key = d.shift_date || "—";
      if (!map[key]) map[key] = [];
      map[key].push(d);
    }
    return Object.entries(map).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [dateFiltered]);

  const dateLabel = (dateStr) => {
    if (!dateStr || dateStr === "—") return "تسليمات بدون تاريخ";
    const d = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.getTime() === today.getTime()) return "تسليمات اليوم";
    if (d.getTime() === yesterday.getTime()) return "تسليمات الأمس";
    const dayName = d.toLocaleDateString("ar-EG", { weekday: "long" });
    return `تسليمات ${dayName}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-gray-800">سجل التسليمات</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToDateChange={setToDate} />
          <SortControls
            columns={SHIFT_SORT_COLUMNS}
            sortField={sortField}
            sortDirection={sortDirection}
            onToggle={toggleSort}
            onSet={setSort}
            onReset={resetSort}
            cardMode
          />
          <Button onClick={onNewShift} size="sm" className="bg-indigo-600 hover:bg-indigo-700">
            <Plus className="w-4 h-4" /> تسليم جديد
          </Button>
        </div>
      </div>

      {dateFiltered.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">لا توجد تسليمات بعد</p>
        </div>
      )}

      {grouped.map(([date, items]) => {
        const totalSales = items.reduce((s, d) => s + (d.total_sales || 0), 0);
        const totalExpenses = items.reduce((s, d) => s + (d.total_expenses || 0), 0);
        const totalNet = items.reduce((s, d) => s + (d.net_amount || 0), 0);

        return (
          <div key={date} className="space-y-3">
            {/* Date Header */}
            <div className="flex items-center justify-between bg-white rounded-lg px-4 py-3 shadow-sm border">
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-800">{dateLabel(date)}</span>
                <span className="text-sm text-gray-500">({date})</span>
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{items.length} تسليم</span>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <div className="text-center">
                  <p className="text-xs text-gray-400">الإجمالي مبيعات</p>
                  <p className="font-bold text-blue-700">{fmt(totalSales)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-400">إجمالي مصروفات</p>
                  <p className="font-bold text-red-600">{fmt(totalExpenses)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-400">الصافي</p>
                  <p className="font-bold text-green-600">{fmt(totalNet)}</p>
                </div>
              </div>
            </div>

            {/* Branch Columns */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {BRANCHES.map((branch) => {
                const branchItems = items.filter((d) => d.branch === branch);
                if (branchItems.length === 0) return (
                  <div key={branch} className={`rounded-lg border-2 border-dashed ${BRANCH_COLORS[branch].border} p-4 text-center`}>
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${BRANCH_COLORS[branch].dot}`} />
                      <span className={`text-sm font-semibold ${BRANCH_COLORS[branch].text}`}>{branch}</span>
                    </div>
                    <p className="text-xs text-gray-400">لا توجد تسليمات</p>
                  </div>
                );
                const branchTotal = branchItems.reduce((s, d) => s + (d.net_amount || 0), 0);
                return (
                  <div key={branch} className={`rounded-lg ${BRANCH_COLORS[branch].bg} border ${BRANCH_COLORS[branch].border} p-3 space-y-2`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${BRANCH_COLORS[branch].dot}`} />
                        <span className={`text-sm font-semibold ${BRANCH_COLORS[branch].text}`}>{branch}</span>
                      </div>
                      <span className="text-xs text-gray-500">{branchItems.length} تسليم</span>
                    </div>
                    {branchItems.map((item) => (
                      <div key={item.id} className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SHIFT_BADGE[item.shift_type] || "bg-gray-100 text-gray-600"}`}>
                              {item.shift_type}
                            </span>
                            <span className="text-xs text-gray-500">{item.submitted_by || "—"}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button onClick={() => setDetailItem(item)} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded">
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            {isAdmin && (
                              <button onClick={() => setEditItem(item)} className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded" title="تعديل">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button onClick={() => deleteMutation.mutate(item.id)} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs">
                          <div>
                            <span className="text-gray-400">مبيعات: </span>
                            <span className="font-bold text-green-600">{fmt(item.total_sales)}</span>
                          </div>
                          <div>
                            <span className="text-gray-400">صافي: </span>
                            <span className="font-bold text-green-600">{fmt(item.net_amount)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                      <span className="text-xs text-gray-500">إجمالي الفرع</span>
                      <span className="font-bold text-gray-700">{fmt(branchTotal)} ج.م</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {detailItem && <ShiftDeliveryDetail item={detailItem} onClose={() => setDetailItem(null)} />}
      {editItem && <ShiftDeliveryEditDialog item={editItem} onClose={() => setEditItem(null)} />}
    </div>
  );
}