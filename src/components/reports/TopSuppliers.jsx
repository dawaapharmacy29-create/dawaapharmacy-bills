import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortableHeader } from "@/components/table/SortableHeader";
import { SortControls } from "@/components/table/SortControls";

const TOP_SORT_COLUMNS = [
  { field: "name", label: "المورد", type: "text" },
  { field: "count", label: "عدد الفواتير", type: "number" },
  { field: "total", label: "إجمالي المشتريات", type: "number" },
];

export default function TopSuppliers({ invoices, dateFrom, dateTo }) {
  const data = useMemo(() => {
    const from = dateFrom ? new Date(dateFrom) : null;
    const to = dateTo ? new Date(dateTo) : null;
    const map = {};
    invoices
      .filter((i) => {
        const d = new Date(i.created_date);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      })
      .forEach((inv) => {
        const name = inv.supplier_name || "غير محدد";
        if (!map[name]) map[name] = { name, total: 0, count: 0 };
        map[name].total += inv.total_value || 0;
        map[name].count++;
      });
    return Object.values(map);
  }, [invoices, dateFrom, dateTo]);

  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({
    columns: TOP_SORT_COLUMNS,
    defaultSort: { field: "total", direction: "desc" },
    paramPrefix: "top",
  });
  const sortedData = useMemo(() => sortData(data), [data, sortData]);

  if (sortedData.length === 0) return null;

  const grandTotal = sortedData.reduce((s, r) => s + r.total, 0);

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">جميع الموردين وحجم التعامل</h2>
      <SortControls
        columns={TOP_SORT_COLUMNS}
        sortField={sortField}
        sortDirection={sortDirection}
        onToggle={toggleSort}
        onSet={setSort}
        onReset={resetSort}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm" dir="rtl">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-right px-3 py-2 text-xs text-gray-500 font-semibold">#</th>
              <SortableHeader field="name" label="المورد" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="text-right px-3 py-2 text-xs" />
              <SortableHeader field="count" label="عدد الفواتير" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="text-right px-3 py-2 text-xs" />
              <SortableHeader field="total" label="إجمالي المشتريات" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="text-right px-3 py-2 text-xs" />
              <th className="text-right px-3 py-2 text-xs text-gray-500 font-semibold">النسبة</th>
            </tr>
          </thead>
          <tbody>
            {sortedData.map((row, i) => (
              <tr key={row.name} className="border-b hover:bg-gray-50 transition-colors">
                <td className="px-3 py-2 text-gray-400 text-xs">{i + 1}</td>
                <td className="px-3 py-2 font-medium text-gray-800">{row.name}</td>
                <td className="px-3 py-2 text-gray-600">{row.count}</td>
                <td className="px-3 py-2 font-semibold text-teal-700">{row.total.toLocaleString("ar-EG")} ج</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-200 rounded-full h-1.5 min-w-[60px]">
                      <div
                        className="bg-teal-500 h-1.5 rounded-full"
                        style={{ width: `${grandTotal ? (row.total / grandTotal) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 shrink-0">
                      {grandTotal ? ((row.total / grandTotal) * 100).toFixed(1) : 0}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-semibold">
              <td colSpan={2} className="px-3 py-2 text-sm text-gray-700">الإجمالي</td>
              <td className="px-3 py-2 text-sm text-gray-700">{sortedData.reduce((s, r) => s + r.count, 0)}</td>
              <td className="px-3 py-2 text-sm text-teal-700">{grandTotal.toLocaleString("ar-EG")} ج</td>
              <td className="px-3 py-2 text-sm text-gray-500">100%</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}