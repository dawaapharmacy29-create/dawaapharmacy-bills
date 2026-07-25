import { Loader2, Trash2, Eye, MessageSquare, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/invoices/ConfirmDialog";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortableHeader } from "@/components/table/SortableHeader";
import { SortControls } from "@/components/table/SortControls";
import { ORDER_STATUS_ORDER, PRIORITY_ORDER } from "@/lib/sortUtils";

const ORDER_SORT_COLUMNS = [
  { field: "order_number", label: "رقم الطلب", type: "text" },
  { field: "customer_name", label: "العميل", type: "text" },
  { field: "product_name", label: "الصنف", type: "text" },
  { field: "request_source", label: "المصدر", type: "text" },
  { field: "priority", label: "الأولوية", type: "status", statusMap: PRIORITY_ORDER },
  { field: "branch", label: "الفرع", type: "text" },
  { field: "assigned_employee", label: "الموظف", type: "text" },
  { field: "request_date", label: "التاريخ", type: "date" },
  { field: "status", label: "الحالة", type: "status", statusMap: ORDER_STATUS_ORDER },
  { field: "created_date", label: "وقت الإضافة", type: "date" },
];
import { useState, useMemo, useEffect } from "react";

const PAGE_SIZE = 30;

const STATUS_STYLE = {
  "طلب جديد":              "bg-blue-100 text-blue-700",
  "جاري البحث":            "bg-yellow-100 text-yellow-700",
  "تم الطلب":              "bg-indigo-100 text-indigo-700",
  "النواقص":               "bg-purple-100 text-purple-700",
  "تم توفير الصنف":        "bg-teal-100 text-teal-700",
  "تم التوصيل":            "bg-green-100 text-green-700",
  "تم توفير بديل":         "bg-cyan-100 text-cyan-700",
  "الصنف غير متوفر حاليا": "bg-orange-100 text-orange-700",
  "تم الإلغاء":            "bg-red-100 text-red-700",
};

const PRIORITY_STYLE = {
  "عاجل": "bg-red-100 text-red-700 border border-red-200",
  "متوسط": "bg-yellow-100 text-yellow-700 border border-yellow-200",
  "عادي": "bg-gray-100 text-gray-600",
};

const WHATSAPP_ICON = "https://media.base44.com/images/public/6a00735e63f2bcce7f4bb37e/174725006_WhatsApp_icon.png";

const SOURCE_ICONS = { "واتساب": null, "مكالمة هاتفية": "📞", "داخل الصيدلية": "🏪" };

const SourceIcon = ({ source }) => {
  if (source === "واتساب") {
    return <img src={WHATSAPP_ICON} alt="واتساب" className="w-6 h-6 inline-block" />;
  }
  return <span>{SOURCE_ICONS[source] || "—"}</span>;
};

export default function OrderTable({ orders, isLoading, onSelect, onDelete, isManager }) {
  const [confirmId, setConfirmId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({
    columns: ORDER_SORT_COLUMNS,
    defaultSort: { field: "created_date", direction: "desc" },
    paramPrefix: "ord",
  });
  useEffect(() => { setCurrentPage(1); }, [sortField, sortDirection]);
  const sorted = useMemo(() => sortData(orders), [orders, sortData]);
  const total = sorted.length;
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const safePage = Math.min(currentPage, totalPages);
  const pageData = useMemo(
    () => sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sorted, safePage]
  );

  if (isLoading) return (
    <div className="flex justify-center py-16">
      <Loader2 className="w-8 h-8 animate-spin text-teal-500" />
    </div>
  );

  if (!orders.length) return (
    <div className="text-center py-16 text-gray-400">
      <div className="text-4xl mb-2">📦</div>
      <p>لا توجد طلبات</p>
    </div>
  );

  return (
    <>
      {/* Desktop Table */}
      <div className="hidden md:block bg-white rounded-xl border overflow-hidden">
        <div className="flex items-center justify-end px-4 py-1.5 border-b bg-gray-50/50">
          <SortControls
            columns={ORDER_SORT_COLUMNS}
            sortField={sortField}
            sortDirection={sortDirection}
            onToggle={toggleSort}
            onSet={setSort}
            onReset={resetSort}
          />
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs">
            <tr>
              <SortableHeader field="order_number" label="رقم الطلب" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
              <SortableHeader field="customer_name" label="العميل" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
              <SortableHeader field="product_name" label="الصنف" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
              <SortableHeader field="request_source" label="المصدر" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
              <SortableHeader field="priority" label="الأولوية" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
              <SortableHeader field="branch" label="الفرع" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
              <SortableHeader field="assigned_employee" label="الموظف" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
              <SortableHeader field="request_date" label="التاريخ" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
              <SortableHeader field="created_date" label="وقت الإضافة" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
              <SortableHeader field="status" label="الحالة" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
              <th className="px-4 py-3 text-right font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {pageData.map((o) => (
              <tr key={o.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => onSelect(o)}>
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{o.order_number || o.id?.slice(-6)}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-800">{o.customer_name}</div>
                  <div className="text-xs text-gray-400">{o.phone}</div>
                </td>
                <td className="px-4 py-3 font-medium text-gray-700">
                  <div className="flex items-center gap-1.5">
                    {o.product_name}
                    {o.notes && <MessageSquare className="w-3.5 h-3.5 text-amber-500 shrink-0" title={o.notes} />}
                  </div>
                </td>
                <td className="px-4 py-3 text-lg"><SourceIcon source={o.request_source} /></td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_STYLE[o.priority] || ""}`}>{o.priority}</span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">{o.branch}</td>
                <td className="px-4 py-3 text-xs text-gray-600">{o.assigned_employee || "—"}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{o.request_date || (o.created_date ? new Date(o.created_date).toLocaleDateString("ar-EG") : "—")}</td>
                <td className="px-4 py-3 text-xs text-gray-400 max-w-[60px] overflow-hidden">
                  <span
                    className="block truncate cursor-default"
                    title={o.created_date ? new Date(o.created_date).toLocaleString("ar-EG", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                  >
                    {o.created_date ? new Date(o.created_date).toLocaleString("ar-EG", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${STATUS_STYLE[o.status] || "bg-gray-100 text-gray-600"}`}>{o.status}</span>
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  {isManager && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => setConfirmId(o.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50/50">
            <span className="text-xs text-gray-500">
              عرض {(safePage - 1) * PAGE_SIZE + 1} - {Math.min(safePage * PAGE_SIZE, total)} من {total}
            </span>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-7 px-2" disabled={safePage <= 1} onClick={() => setCurrentPage(safePage - 1)}>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
              <span className="text-xs text-gray-600 font-medium px-2">{safePage} / {totalPages}</span>
              <Button size="sm" variant="outline" className="h-7 px-2" disabled={safePage >= totalPages} onClick={() => setCurrentPage(safePage + 1)}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-3">
        {pageData.map((o) => (
          <div key={o.id} className="bg-white rounded-xl border p-3 cursor-pointer" onClick={() => onSelect(o)}>
            <div className="flex items-start justify-between mb-2">
              <div className="min-w-0">
                <div className="font-bold text-gray-800 truncate">{o.customer_name}</div>
                <div className="text-xs text-gray-400">{o.phone}</div>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs font-semibold shrink-0 ${STATUS_STYLE[o.status] || ""}`}>{o.status}</span>
            </div>
            <div className="text-sm font-medium text-teal-700 mb-2 flex items-center gap-1.5 truncate">🔹 {o.product_name} {o.notes && <MessageSquare className="w-3.5 h-3.5 text-amber-500 shrink-0" />}</div>
            <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
              <span className="flex items-center gap-1"><SourceIcon source={o.request_source} /> {o.request_source}</span>
              {o.branch && <span>📍 {o.branch}</span>}
              <span className={`px-1.5 py-0.5 rounded ${PRIORITY_STYLE[o.priority]}`}>{o.priority}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination (mobile) */}
      {totalPages > 1 && (
        <div className="md:hidden flex items-center justify-between py-2">
          <span className="text-xs text-gray-500">{safePage * PAGE_SIZE > total ? total : safePage * PAGE_SIZE} من {total}</span>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-7 px-2" disabled={safePage <= 1} onClick={() => setCurrentPage(safePage - 1)}>
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
            <span className="text-xs text-gray-600 font-medium px-1">{safePage} / {totalPages}</span>
            <Button size="sm" variant="outline" className="h-7 px-2" disabled={safePage >= totalPages} onClick={() => setCurrentPage(safePage + 1)}>
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmId}
        onOpenChange={(v) => !v && setConfirmId(null)}
        title="تأكيد الحذف"
        description="هل أنت متأكد من حذف هذا الطلب؟ لا يمكن التراجع."
        onConfirm={() => { onDelete(confirmId); setConfirmId(null); }}
        confirmLabel="حذف"
      />
    </>
  );
}