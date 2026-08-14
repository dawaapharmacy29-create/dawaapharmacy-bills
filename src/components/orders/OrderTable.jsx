import { useEffect, useMemo, useState } from "react";
import { Loader2, Trash2, MessageSquare, ChevronLeft, ChevronRight, Clock3, UserRound, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/invoices/ConfirmDialog";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortControls } from "@/components/table/SortControls";
import { ORDER_STATUS_ORDER, PRIORITY_ORDER } from "@/lib/sortUtils";

const PAGE_SIZE = 30;
const ORDER_SORT_COLUMNS = [
  { field: "created_date", label: "الأحدث", type: "date" },
  { field: "priority", label: "الأولوية", type: "status", statusMap: PRIORITY_ORDER },
  { field: "status", label: "الحالة", type: "status", statusMap: ORDER_STATUS_ORDER },
  { field: "customer_name", label: "العميل", type: "text" },
  { field: "product_name", label: "الصنف", type: "text" },
  { field: "assigned_employee", label: "المسؤول", type: "text" },
];
const STATUS_STYLE = {
  "طلب جديد": "bg-blue-100 text-blue-700", "جاري البحث": "bg-yellow-100 text-yellow-700", "تم الطلب": "bg-indigo-100 text-indigo-700", "النواقص": "bg-purple-100 text-purple-700", "تم توفير الصنف": "bg-teal-100 text-teal-700", "تم التوصيل": "bg-green-100 text-green-700", "تم توفير بديل": "bg-cyan-100 text-cyan-700", "الصنف غير متوفر حاليا": "bg-orange-100 text-orange-700", "تم الإلغاء": "bg-red-100 text-red-700",
};
const PRIORITY_STYLE = { "عاجل": "bg-red-100 text-red-700 border border-red-200", "متوسط": "bg-yellow-100 text-yellow-700 border border-yellow-200", "عادي": "bg-gray-100 text-gray-600" };
const SOURCE_LABEL = { "واتساب": "واتساب", "مكالمة هاتفية": "مكالمة", "داخل الصيدلية": "داخل الفرع" };

function ageLabel(order) {
  const raw = order.created_date || order.request_date;
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return String(order.request_date || "—");
  const hours = Math.max(0, Math.floor((Date.now() - date.getTime()) / 3600000));
  if (hours < 1) return "منذ أقل من ساعة";
  if (hours < 24) return `منذ ${hours} س`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}
function isAttention(order) {
  const raw = order.created_date || order.request_date;
  const ageHours = raw ? (Date.now() - new Date(raw).getTime()) / 3600000 : 0;
  return order.priority === "عاجل" || (["طلب جديد", "جاري البحث", "الصنف غير متوفر حاليا"].includes(order.status) && ageHours >= 12);
}

export default function OrderTable({ orders, isLoading, onSelect, onDelete, isManager }) {
  const [confirmId, setConfirmId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({ columns: ORDER_SORT_COLUMNS, defaultSort: { field: "created_date", direction: "desc" }, paramPrefix: "ord" });
  useEffect(() => { setCurrentPage(1); }, [sortField, sortDirection, orders.length]);
  const sorted = useMemo(() => sortData(orders), [orders, sortData]);
  const total = sorted.length;
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const safePage = Math.min(currentPage, totalPages);
  const pageData = useMemo(() => sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [sorted, safePage]);

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-teal-500" /></div>;
  if (!orders.length) return <div className="text-center py-16 text-gray-400"><div className="text-4xl mb-2">📦</div><p className="font-medium">لا توجد طلبات في هذا العرض</p><p className="text-xs mt-1">غيّر التاب أو الفلاتر لعرض طلبات أخرى</p></div>;

  return <>
    <div className="hidden md:block bg-white rounded-2xl border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50/60"><span className="text-xs text-gray-500">عرض تشغيلي مختصر — اضغط على أي طلب للتفاصيل</span><SortControls columns={ORDER_SORT_COLUMNS} sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} onSet={setSort} onReset={resetSort} /></div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs"><tr><th className="px-4 py-3 text-right font-medium w-24">الطلب</th><th className="px-4 py-3 text-right font-medium">العميل والصنف</th><th className="px-4 py-3 text-right font-medium w-24">الأولوية</th><th className="px-4 py-3 text-right font-medium w-36">الفرع</th><th className="px-4 py-3 text-right font-medium w-36">المسؤول</th><th className="px-4 py-3 text-right font-medium w-32">العمر</th><th className="px-4 py-3 text-right font-medium w-40">الحالة</th><th className="w-12"></th></tr></thead>
        <tbody className="divide-y divide-gray-100">{pageData.map((o) => <tr key={o.id} className={`cursor-pointer transition-colors ${isAttention(o) ? "bg-amber-50/45 hover:bg-amber-50" : "hover:bg-gray-50"}`} onClick={() => onSelect(o)}>
          <td className="px-4 py-3"><div className="font-mono text-xs text-gray-500">#{o.order_number || o.id?.slice(-6)}</div><div className="text-[10px] text-gray-400 mt-1">{SOURCE_LABEL[o.request_source] || o.request_source || "—"}</div></td>
          <td className="px-4 py-3 max-w-[420px]"><div className="flex items-center gap-2"><span className="font-bold text-gray-900 truncate">{o.product_name || "صنف غير محدد"}</span>{o.notes && <MessageSquare className="w-3.5 h-3.5 text-amber-500 shrink-0" title="يوجد ملاحظات" />}</div><div className="text-xs text-gray-500 mt-1 flex items-center gap-2"><span className="font-medium">{o.customer_name || "—"}</span>{o.customer_code && <span>• كود {o.customer_code}</span>}{o.phone && <span className="text-gray-400">• {o.phone}</span>}</div></td>
          <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-semibold ${PRIORITY_STYLE[o.priority] || PRIORITY_STYLE["عادي"]}`}>{o.priority || "عادي"}</span></td>
          <td className="px-4 py-3"><span className="inline-flex items-center gap-1 text-xs text-gray-600"><MapPin className="w-3.5 h-3.5" />{o.branch || "—"}</span></td>
          <td className="px-4 py-3"><span className="inline-flex items-center gap-1 text-xs text-gray-600"><UserRound className="w-3.5 h-3.5" />{o.assigned_employee || "غير مسند"}</span></td>
          <td className="px-4 py-3"><span className={`inline-flex items-center gap-1 text-xs ${isAttention(o) ? "font-bold text-amber-700" : "text-gray-500"}`}><Clock3 className="w-3.5 h-3.5" />{ageLabel(o)}</span></td>
          <td className="px-4 py-3"><span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_STYLE[o.status] || "bg-gray-100 text-gray-600"}`}>{o.status || "—"}</span></td>
          <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>{isManager && <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-300 hover:text-red-600" onClick={() => setConfirmId(o.id)}><Trash2 className="w-3.5 h-3.5" /></Button>}</td>
        </tr>)}</tbody>
      </table>
      {totalPages > 1 && <Pagination safePage={safePage} totalPages={totalPages} total={total} onPage={setCurrentPage} />}
    </div>

    <div className="md:hidden space-y-2">{pageData.map((o) => <div key={o.id} className={`rounded-xl border p-3 cursor-pointer ${isAttention(o) ? "bg-amber-50 border-amber-200" : "bg-white"}`} onClick={() => onSelect(o)}>
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-bold text-gray-900 truncate">{o.product_name || "صنف غير محدد"}</div><div className="text-xs text-gray-500 truncate mt-0.5">{o.customer_name} {o.customer_code ? `• ${o.customer_code}` : ""}</div></div><span className={`px-2 py-1 rounded-full text-[11px] font-semibold shrink-0 ${STATUS_STYLE[o.status] || "bg-gray-100 text-gray-600"}`}>{o.status}</span></div>
      <div className="mt-3 flex items-center gap-2 flex-wrap text-[11px] text-gray-500"><span className={`px-1.5 py-0.5 rounded ${PRIORITY_STYLE[o.priority] || PRIORITY_STYLE["عادي"]}`}>{o.priority || "عادي"}</span>{o.branch && <span>📍 {o.branch}</span>}<span>👤 {o.assigned_employee || "غير مسند"}</span><span className={isAttention(o) ? "font-bold text-amber-700" : ""}>⏱ {ageLabel(o)}</span></div>
    </div>)}</div>
    {totalPages > 1 && <div className="md:hidden"><Pagination safePage={safePage} totalPages={totalPages} total={total} onPage={setCurrentPage} compact /></div>}
    <ConfirmDialog open={!!confirmId} onOpenChange={(v) => !v && setConfirmId(null)} title="تأكيد الحذف" description="هل أنت متأكد من حذف هذا الطلب؟ لا يمكن التراجع." onConfirm={() => { onDelete(confirmId); setConfirmId(null); }} confirmLabel="حذف" />
  </>;
}

function Pagination({ safePage, totalPages, total, onPage, compact = false }) {
  return <div className={`flex items-center justify-between border-t bg-gray-50/50 ${compact ? "px-2 py-2" : "px-4 py-3"}`}><span className="text-xs text-gray-500">{total} طلب</span><div className="flex items-center gap-1.5"><Button size="sm" variant="outline" className="h-7 px-2" disabled={safePage <= 1} onClick={() => onPage(safePage - 1)}><ChevronRight className="w-3.5 h-3.5" /></Button><span className="text-xs text-gray-600 font-medium px-2">{safePage} / {totalPages}</span><Button size="sm" variant="outline" className="h-7 px-2" disabled={safePage >= totalPages} onClick={() => onPage(safePage + 1)}><ChevronLeft className="w-3.5 h-3.5" /></Button></div></div>;
}
