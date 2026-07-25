import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { AlertTriangle, ChevronDown, ChevronUp, Package } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function LowStockAlert() {
  const [expanded, setExpanded] = useState(false);
  const [filterBranch, setFilterBranch] = useState("all");

  const { data: products = [] } = useQuery({
    queryKey: ["inventory-products-low-stock"],
    queryFn: () => base44.entities.InventoryProduct.list(),
    staleTime: 60000,
  });

  // Only products where reorder_point is set (>0) and stock is at or below it
  const lowStockItems = products.filter(
    (p) => p.is_active !== false && p.reorder_point > 0 && (p.stock_quantity || 0) <= p.reorder_point
  );

  const filtered = filterBranch === "all"
    ? lowStockItems
    : lowStockItems.filter((p) => p.branch === filterBranch);

  if (lowStockItems.length === 0) return null;

  const branches = ["دواء شكري", "دواء الشامي"];

  return (
    <Card className="border-orange-200 bg-orange-50 overflow-hidden" dir="rtl">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-orange-100 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-orange-100 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-orange-600" />
          </div>
          <span className="font-semibold text-orange-800 text-sm">
            تنبيه مخزون منخفض
          </span>
          <Badge className="bg-orange-500 text-white text-xs px-2 py-0">{lowStockItems.length} صنف</Badge>
        </div>
        <div className="flex items-center gap-2 text-orange-600">
          <span className="text-xs">يحتاج إعادة طلب</span>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Branch filter */}
          <div className="flex gap-2 flex-wrap">
            {["all", ...branches].map((b) => (
              <button
                key={b}
                onClick={() => setFilterBranch(b)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  filterBranch === b
                    ? "bg-orange-500 text-white border-orange-500"
                    : "bg-white text-gray-600 border-gray-200 hover:border-orange-300"
                }`}
              >
                {b === "all" ? "كل الفروع" : b}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="bg-white rounded-lg border border-orange-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-orange-50 text-orange-700 text-xs">
                <tr>
                  <th className="px-3 py-2 text-right font-semibold">اسم الصنف</th>
                  <th className="px-3 py-2 text-right font-semibold">الشركة</th>
                  <th className="px-3 py-2 text-right font-semibold">الفرع</th>
                  <th className="px-3 py-2 text-center font-semibold">الكمية الحالية</th>
                  <th className="px-3 py-2 text-center font-semibold">حد الطلب</th>
                  <th className="px-3 py-2 text-center font-semibold">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-orange-50">
                {filtered.map((p) => {
                  const qty = p.stock_quantity || 0;
                  const isOut = qty === 0;
                  return (
                    <tr key={p.id} className={`hover:bg-orange-50 ${isOut ? "bg-red-50" : ""}`}>
                      <td className="px-3 py-2 font-medium text-gray-800">
                        <div className="flex items-center gap-1.5">
                          <Package className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                          {p.product_name}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{p.company || "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{p.branch}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`font-bold text-sm ${isOut ? "text-red-600" : "text-orange-600"}`}>
                          {qty}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center text-gray-500 text-sm">{p.reorder_point}</td>
                      <td className="px-3 py-2 text-center">
                        {isOut ? (
                          <Badge className="bg-red-100 text-red-700 text-xs border border-red-200">نفد المخزون</Badge>
                        ) : (
                          <Badge className="bg-orange-100 text-orange-700 text-xs border border-orange-200">منخفض</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-4 text-gray-400 text-sm">لا توجد أصناف لهذا الفرع</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-orange-600 text-center">
            💡 يمكنك تحديد حد الطلب لكل صنف من صفحة إدارة المخزون
          </p>
        </div>
      )}
    </Card>
  );
}