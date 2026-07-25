import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Search, Eye, ArrowRightLeft } from "lucide-react";
import {
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  TRANSACTION_TYPE_LABELS,
} from "@/lib/purchaseCalculations";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortableHeader } from "@/components/table/SortableHeader";
import { SortControls } from "@/components/table/SortControls";
import { CATEGORY_ORDER, TRANSACTION_ORDER } from "@/lib/sortUtils";
import { useUserRole } from "@/lib/useUserRole";

const REVIEW_REASONS = [
  { key: "mixed_supplier_unclassified", label: "مورد مختلط وفاتورة غير مصنفة", color: "bg-amber-100 text-amber-800" },
  { key: "internal_no_linked_branch", label: "مورد داخلي بدون فرع مرتبط", color: "bg-orange-100 text-orange-800" },
  { key: "source_equals_destination", label: "المصدر والمستلم نفس الفرع", color: "bg-red-100 text-red-800" },
  { key: "category_supplier_mismatch", label: "تعارض تصنيف الفاتورة مع إعداد المورد", color: "bg-purple-100 text-purple-800" },
  { key: "incomplete_transfer", label: "تحويل داخلي ناقص المصدر أو المستلم", color: "bg-pink-100 text-pink-800" },
  { key: "invalid_supplier_id", label: "فاتورة بلا معرف مورد صالح", color: "bg-gray-100 text-gray-800" },
];

const SORT_COLUMNS = [
  { field: "system_invoice_number", label: "رقم الفاتورة", type: "number" },
  { field: "supplier_name", label: "المورد", type: "text" },
  { field: "branch", label: "الفرع", type: "text" },
  { field: "purchase_category", label: "التصنيف", type: "status", statusMap: CATEGORY_ORDER },
  { field: "transaction_type", label: "نوع العملية", type: "status", statusMap: TRANSACTION_ORDER },
  { field: "total_value", label: "القيمة", type: "currency" },
  { field: "created_date", label: "التاريخ", type: "date" },
];

export default function ReviewNeededInvoices() {
  const { canSaveInvoice } = useUserRole();
  const [search, setSearch] = useState("");
  const [activeReason, setActiveReason] = useState("all");
  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({
    columns: SORT_COLUMNS,
    defaultSort: { field: "created_date", direction: "desc" },
    paramPrefix: "rev",
  });

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["purchase-invoices"],
    queryFn: async () => {
      let all = [];
      let page = 0;
      while (true) {
        const batch = await base44.entities.PurchaseInvoice.list("-created_date", 500, page * 500);
        all = [...all, ...batch];
        if (batch.length < 500) break;
        page++;
      }
      return all;
    },
    staleTime: 60000,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => base44.entities.Supplier.list(),
  });

  const reviewList = useMemo(() => {
    return invoices
      .map((inv) => {
        const supplier = (inv.supplier_id && suppliers.find((s) => s.id === inv.supplier_id))
          || suppliers.find((s) => s.name === inv.supplier_name);
        const reasons = [];

        // 1. مورد مختلط وفاتورة غير مصنفة
        if (supplier?.default_purchase_category === "mixed"
          && (!inv.purchase_category || inv.purchase_category === "unclassified")) {
          reasons.push("mixed_supplier_unclassified");
        }

        // 2. مورد داخلي بدون linked_branch
        if (supplier?.supplier_type === "internal_branch" && !supplier?.linked_branch) {
          reasons.push("internal_no_linked_branch");
        }

        // 3. المصدر والمستلم نفس الفرع
        if (inv.source_branch && inv.destination_branch && inv.source_branch === inv.destination_branch) {
          reasons.push("source_equals_destination");
        }

        // 4. تعارض التصنيف مع المورد (بدون استثناء يدوي)
        if (inv.purchase_category_source !== "manual" && supplier) {
          const sc = supplier.default_purchase_category;
          if (sc === "medicines" && inv.purchase_category === "supplies_accessories") reasons.push("category_supplier_mismatch");
          if (sc === "supplies_accessories" && inv.purchase_category === "medicines") reasons.push("category_supplier_mismatch");
        }

        // 5. تحويل داخلي ناقص
        if (inv.transaction_type === "internal_transfer" && (!inv.source_branch || !inv.destination_branch)) {
          reasons.push("incomplete_transfer");
        }

        // 6. لا يوجد supplier_id صالح
        if (!inv.supplier_id || !supplier) {
          reasons.push("invalid_supplier_id");
        }

        return { ...inv, reviewReasons: reasons, supplier };
      })
      .filter((inv) => inv.reviewReasons.length > 0);
  }, [invoices, suppliers]);

  const filteredRaw = reviewList.filter((inv) => {
    if (activeReason !== "all" && !inv.reviewReasons.includes(activeReason)) return false;
    if (search) {
      const q = search.toLowerCase();
      return (inv.system_invoice_number || "").toLowerCase().includes(q)
        || (inv.supplier_name || "").toLowerCase().includes(q);
    }
    return true;
  });
  const filtered = sortData(filteredRaw);

  const countByReason = (key) => reviewList.filter((inv) => inv.reviewReasons.includes(key)).length;

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-6 h-6 text-amber-600" />
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-800">فواتير تحتاج مراجعة قواعد المورد</h1>
          <p className="text-gray-500 text-sm">{reviewList.length} فاتورة تحتاج مراجعة من أصل {invoices.length}</p>
        </div>
      </div>

      {/* Reason filters */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setActiveReason("all")}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${activeReason === "all" ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-600 border-gray-200 hover:border-teal-300"}`}
        >
          الكل ({reviewList.length})
        </button>
        {REVIEW_REASONS.map((r) => (
          <button
            key={r.key}
            onClick={() => setActiveReason(r.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${activeReason === r.key ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-600 border-gray-200 hover:border-teal-300"}`}
          >
            {r.label} ({countByReason(r.key)})
          </button>
        ))}
      </div>

      {/* Search + Sort */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-md flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-2.5 w-4 h-4 text-gray-400" />
          <Input placeholder="بحث برقم الفاتورة أو المورد..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9 h-9" />
        </div>
        <SortControls
          columns={SORT_COLUMNS}
          sortField={sortField}
          sortDirection={sortDirection}
          onToggle={toggleSort}
          onSet={setSort}
          onReset={resetSort}
        />
      </div>

      {isLoading ? (
        <Card className="p-8 text-center text-gray-400">
          <div className="w-8 h-8 border-4 border-gray-200 border-t-teal-600 rounded-full animate-spin mx-auto mb-3" />
          جاري التحميل...
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-gray-400 text-lg">✓ لا توجد فواتير تحتاج مراجعة</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-right text-gray-500">
                  <SortableHeader field="system_invoice_number" label="رقم الفاتورة" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="p-3" />
                  <SortableHeader field="supplier_name" label="المورد" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="p-3" />
                  <SortableHeader field="branch" label="الفرع" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="p-3" />
                  <SortableHeader field="purchase_category" label="التصنيف" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="p-3" />
                  <SortableHeader field="transaction_type" label="نوع العملية" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="p-3" />
                  <th className="p-3">المسار</th>
                  <SortableHeader field="total_value" label="القيمة" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="p-3" />
                  <th className="p-3">أسباب المراجعة</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => (
                  <tr key={inv.id} className="border-b hover:bg-gray-50">
                    <td className="p-3 font-mono font-semibold text-teal-700">{inv.system_invoice_number}</td>
                    <td className="p-3 text-gray-700">{inv.supplier_name || "—"}</td>
                    <td className="p-3"><Badge className="bg-gray-100 text-gray-700 border-0 text-xs">{inv.branch || "—"}</Badge></td>
                    <td className="p-3"><Badge className={`${CATEGORY_COLORS[inv.purchase_category || "unclassified"]} border-0 text-xs`}>{CATEGORY_LABELS[inv.purchase_category || "unclassified"]}</Badge></td>
                    <td className="p-3"><Badge className={inv.transaction_type === "internal_transfer" ? "bg-purple-100 text-purple-800 border-0 text-xs" : "bg-blue-100 text-blue-800 border-0 text-xs"}>{TRANSACTION_TYPE_LABELS[inv.transaction_type || "external_purchase"]}</Badge></td>
                    <td className="p-3 text-xs text-gray-600">
                      {inv.source_branch && inv.destination_branch ? `${inv.source_branch} ← ${inv.destination_branch}` : "—"}
                    </td>
                    <td className="p-3 font-semibold">{(inv.total_value || 0).toLocaleString("ar-EG")} ج</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {inv.reviewReasons.map((r) => {
                          const reason = REVIEW_REASONS.find((rr) => rr.key === r);
                          return <Badge key={r} className={`${reason?.color} border-0 text-xs`}>{reason?.label}</Badge>;
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="md:hidden divide-y divide-gray-100">
            {filtered.map((inv) => (
              <div key={inv.id} className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-teal-700">{inv.system_invoice_number}</span>
                  <span className="font-semibold">{(inv.total_value || 0).toLocaleString("ar-EG")} ج</span>
                </div>
                <p className="text-xs text-gray-600">{inv.supplier_name || "—"} — {inv.branch}</p>
                <div className="flex flex-wrap gap-1">
                  {inv.reviewReasons.map((r) => {
                    const reason = REVIEW_REASONS.find((rr) => rr.key === r);
                    return <Badge key={r} className={`${reason?.color} border-0 text-xs`}>{reason?.label}</Badge>;
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}