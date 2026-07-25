import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Save, AlertTriangle } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortableHeader } from "@/components/table/SortableHeader";
import { SortControls } from "@/components/table/SortControls";

const REORDER_SORT_COLUMNS = [
  { field: "product_name", label: "اسم الصنف", type: "text" },
  { field: "company", label: "الشركة", type: "text" },
  { field: "branch", label: "الفرع", type: "text" },
  { field: "stock_quantity", label: "الكمية الحالية", type: "number" },
  { field: "reorder_point", label: "حد الطلب", type: "number" },
];

const BRANCHES = ["دواء شكري", "دواء الشامي"];

export default function ReorderPointsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterBranch, setFilterBranch] = useState("all");
  const [editingValues, setEditingValues] = useState({});

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["inventory-products-reorder"],
    queryFn: () => base44.entities.InventoryProduct.list(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, reorder_point }) =>
      base44.entities.InventoryProduct.update(id, { reorder_point }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory-products-reorder"] });
      qc.invalidateQueries({ queryKey: ["inventory-products-low-stock"] });
    },
  });

  const handleSave = (product) => {
    const val = parseFloat(editingValues[product.id]);
    if (isNaN(val) || val < 0) return;
    updateMutation.mutate({ id: product.id, reorder_point: val });
    setEditingValues((prev) => {
      const next = { ...prev };
      delete next[product.id];
      return next;
    });
    toast({ description: `تم حفظ حد الطلب للصنف: ${product.product_name}` });
  };

  const activeProducts = products.filter((p) => p.is_active !== false);

  const filteredRaw = useMemo(() => activeProducts.filter((p) => {
    if (filterBranch !== "all" && p.branch !== filterBranch) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        p.product_name?.toLowerCase().includes(q) ||
        p.product_code?.toLowerCase().includes(q) ||
        p.company?.toLowerCase().includes(q)
      );
    }
    return true;
  }), [activeProducts, filterBranch, search]);

  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({
    columns: REORDER_SORT_COLUMNS,
    defaultSort: { field: "product_name", direction: "asc" },
    paramPrefix: "reord",
  });
  const filtered = useMemo(() => sortData(filteredRaw), [filteredRaw, sortData]);

  const lowCount = filtered.filter(
    (p) => p.reorder_point > 0 && (p.stock_quantity || 0) <= p.reorder_point
  ).length;

  return (
    <div className="space-y-4" dir="rtl">
      {/* Summary */}
      {lowCount > 0 && (
        <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-4 py-2.5 text-sm text-orange-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span><strong>{lowCount}</strong> صنف وصل إلى حد الطلب أو أقل في الفلتر الحالي</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-2.5 w-4 h-4 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم الصنف أو الكود..."
            className="pr-9 h-9 text-sm"
          />
        </div>
        <div className="flex gap-2">
          {["all", ...BRANCHES].map((b) => (
            <button
              key={b}
              onClick={() => setFilterBranch(b)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                filterBranch === b
                  ? "bg-gray-800 text-white border-gray-800"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
              }`}
            >
              {b === "all" ? "كل الفروع" : b}
            </button>
          ))}
        </div>
        <SortControls
          columns={REORDER_SORT_COLUMNS}
          sortField={sortField}
          sortDirection={sortDirection}
          onToggle={toggleSort}
          onSet={setSort}
          onReset={resetSort}
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border overflow-hidden">
        {isLoading ? (
          <div className="text-center py-12 text-gray-400">جارٍ التحميل...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs">
              <tr>
                <SortableHeader field="product_name" label="اسم الصنف" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
                <SortableHeader field="company" label="الشركة" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
                <SortableHeader field="branch" label="الفرع" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
                <SortableHeader field="stock_quantity" label="الكمية الحالية" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3 text-center" />
                <SortableHeader field="reorder_point" label="حد الطلب" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3 text-center" />
                <th className="px-4 py-3 text-center font-medium">الحالة</th>
                <th className="px-4 py-3 text-center font-medium">حفظ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((p) => {
                const qty = p.stock_quantity || 0;
                const reorder = p.reorder_point || 0;
                const isLow = reorder > 0 && qty <= reorder;
                const isOut = qty === 0;
                const displayVal =
                  editingValues[p.id] !== undefined
                    ? editingValues[p.id]
                    : reorder === 0
                    ? ""
                    : String(reorder);

                return (
                  <tr
                    key={p.id}
                    className={`hover:bg-gray-50 ${isOut ? "bg-red-50" : isLow ? "bg-orange-50" : ""}`}
                  >
                    <td className="px-4 py-2.5 font-medium text-gray-800">{p.product_name}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{p.company || "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">{p.branch}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`font-bold ${isOut ? "text-red-600" : isLow ? "text-orange-600" : "text-gray-800"}`}>
                        {qty}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Input
                        type="number"
                        min="0"
                        value={displayVal}
                        onChange={(e) =>
                          setEditingValues((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                        onKeyDown={(e) => e.key === "Enter" && handleSave(p)}
                        className="w-20 h-7 text-center text-sm mx-auto"
                        placeholder="0"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {isOut ? (
                        <span className="text-xs text-red-600 font-semibold">نفد</span>
                      ) : isLow ? (
                        <span className="text-xs text-orange-600 font-semibold">⚠ منخفض</span>
                      ) : reorder > 0 ? (
                        <span className="text-xs text-green-600">✓ كافٍ</span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {editingValues[p.id] !== undefined && (
                        <Button
                          size="icon"
                          className="h-7 w-7 bg-teal-600 hover:bg-teal-700"
                          onClick={() => handleSave(p)}
                        >
                          <Save className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-gray-400">
                    لا توجد أصناف
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-gray-400 text-center">
        أدخل حد الطلب لكل صنف ثم اضغط على أيقونة الحفظ أو Enter
      </p>
    </div>
  );
}