import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Eye, RefreshCw, RotateCcw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useUserRole } from "@/lib/useUserRole";
import ReturnFormDialog from "@/components/returns/ReturnFormDialog";
import ReturnDetailDialog from "@/components/returns/ReturnDetailDialog";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortableHeader } from "@/components/table/SortableHeader";
import { SortControls } from "@/components/table/SortControls";
import { RETURN_STATUS_ORDER } from "@/lib/sortUtils";
import { buildReturnFollowupCandidates, summarizeReturnItems } from "@/lib/returnFollowup";

const RETURN_SORT_COLUMNS = [
  { field: "return_number", label: "رقم المرتجع", type: "number" },
  { field: "invoice_number", label: "رقم الفاتورة", type: "text" },
  { field: "supplier_name", label: "المورد", type: "text" },
  { field: "branch_name", label: "الفرع", type: "text" },
  { field: "employee_name", label: "الموظف", type: "text" },
  { field: "status", label: "الحالة", type: "status", statusMap: RETURN_STATUS_ORDER },
  { field: "created_date", label: "التاريخ", type: "date" },
];

const BRANCHES = ["دواء شكري", "دواء الشامي"];

const STATUS_CONFIG = {
  Pending: { label: "في الانتظار", color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  "Under Review": { label: "جاري المراجعة", color: "bg-blue-100 text-blue-800 border-blue-200" },
  Approved: { label: "معتمد", color: "bg-green-100 text-green-800 border-green-200" },
  Returned: { label: "تم التنفيذ", color: "bg-teal-100 text-teal-800 border-teal-200" },
  Rejected: { label: "مرفوض", color: "bg-red-100 text-red-800 border-red-200" },
};

const PAGE_SIZE = 20;

const formatMoney = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString("ar-EG", { maximumFractionDigits: 2 }) : "—";
};

const generateFollowupReturnNumber = () => {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `RTN-FU-${y}${m}${d}-${rand}`;
};

export default function Returns() {
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState(null);
  const [filterStatus, setFilterStatus] = useState("الكل");
  const [filterBranch, setFilterBranch] = useState("الكل");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const { user } = useUserRole();
  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({
    columns: RETURN_SORT_COLUMNS,
    defaultSort: { field: "created_date", direction: "desc" },
    paramPrefix: "ret",
  });

  useEffect(() => {
    const unsub = base44.entities.Return.subscribe(() => {
      queryClient.invalidateQueries({ queryKey: ["returns"] });
    });
    return unsub;
  }, [queryClient]);

  const { data: allReturns = [], isLoading } = useQuery({
    queryKey: ["returns"],
    queryFn: () => base44.entities.Return.list("-created_date", 500),
    staleTime: 20000,
  });

  const { data: purchaseInvoices = [], isLoading: invoicesLoading } = useQuery({
    queryKey: ["purchase-invoices-return-followup"],
    queryFn: () => base44.entities.PurchaseInvoice.list("-invoice_date", 5000, 0),
    staleTime: 30000,
  });

  const returnFollowupCandidates = useMemo(
    () => buildReturnFollowupCandidates(purchaseInvoices, allReturns),
    [purchaseInvoices, allReturns]
  );

  const markFollowupDoneMutation = useMutation({
    mutationFn: async (candidate) => {
      const invoice = candidate.invoice || {};
      const now = new Date().toISOString();
      const actor = user?.full_name || user?.name || user?.email || "مستخدم النظام";
      const historyEntry = {
        status: "Returned",
        changed_by: actor,
        changed_at: now,
        note: "تم تأكيد تنفيذ المرتجع من قائمة متابعة مرتجعات الفواتير",
      };

      if (candidate.activeReturn?.id) {
        const existingHistory = Array.isArray(candidate.activeReturn.status_history) ? candidate.activeReturn.status_history : [];
        return base44.entities.Return.update(candidate.activeReturn.id, {
          status: "Returned",
          status_history: [...existingHistory, historyEntry],
        });
      }

      return base44.entities.Return.create({
        return_number: generateFollowupReturnNumber(),
        invoice_number: String(invoice.system_invoice_number || ""),
        supplier_name: invoice.supplier_name || "غير محدد",
        branch_name: invoice.branch || "",
        employee_name: actor,
        return_reason: "متابعة مرتجع فاتورة",
        notes: invoice.notes || "تم تأكيد تنفيذ المرتجع من قائمة المتابعة.",
        items: [],
        invoice_images: [],
        status: "Returned",
        created_date: now,
        status_history: [historyEntry],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["returns"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-invoices-return-followup"] });
    },
  });

  const filteredRaw = allReturns.filter((r) => {
    const statusMatch = filterStatus === "الكل" || r.status === filterStatus;
    const branchMatch = filterBranch === "الكل" || r.branch_name === filterBranch;
    const searchMatch =
      !search ||
      r.return_number?.includes(search) ||
      r.invoice_number?.includes(search) ||
      r.supplier_name?.includes(search) ||
      r.employee_name?.includes(search);
    return statusMatch && branchMatch && searchMatch;
  });
  const filtered = useMemo(() => sortData(filteredRaw), [filteredRaw, sortData]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [filterStatus, filterBranch, search, sortField, sortDirection]);

  const handleView = (ret) => { setSelectedReturn(ret); setDetailOpen(true); };

  const statusCounts = Object.keys(STATUS_CONFIG).reduce((acc, s) => {
    acc[s] = allReturns.filter((r) => r.status === s).length;
    return acc;
  }, {});

  const stalePendingReturns = useMemo(() => {
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    return allReturns.filter((r) => {
      if (r.status !== "Pending") return false;
      const created = new Date(r.created_date).getTime();
      return created < threeDaysAgo;
    });
  }, [allReturns]);

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <RotateCcw className="w-6 h-6 text-teal-600" />
            المرتجعات
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">{filtered.length} مرتجع</p>
        </div>
        <Button onClick={() => setFormOpen(true)} className="bg-teal-600 hover:bg-teal-700 text-white gap-2">
          <Plus className="w-4 h-4" /> مرتجع جديد
        </Button>
      </div>

      <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-black text-amber-950 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              مرتجعات فواتير تحتاج متابعة
            </h2>
            <p className="mt-1 text-xs text-amber-800">
              تظهر هنا الفواتير التي بها قيمة مرتجع، أو ملاحظة تشير لإشعار/مرتجع/صنف خطأ أو مشكلة صلاحية. تختفي من القائمة بعد تأكيد «تم».
            </p>
          </div>
          <Badge className="bg-amber-100 text-amber-900 border border-amber-300">
            {returnFollowupCandidates.length} تحتاج متابعة
          </Badge>
        </div>

        {invoicesLoading ? (
          <div className="flex items-center gap-2 text-sm text-amber-800"><RefreshCw className="w-4 h-4 animate-spin" /> جاري فحص الفواتير...</div>
        ) : returnFollowupCandidates.length === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> لا توجد مرتجعات فواتير معلقة مكتشفة حاليًا.
          </div>
        ) : (
          <div className="space-y-2">
            {returnFollowupCandidates.map((candidate) => {
              const invoice = candidate.invoice || {};
              const linked = candidate.activeReturn;
              const itemSummary = linked ? summarizeReturnItems(linked) : "";
              return (
                <div key={invoice.id || `${invoice.branch}-${invoice.system_invoice_number}`} className="rounded-xl border border-amber-200 bg-white p-3 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-black text-gray-900">فاتورة {invoice.system_invoice_number || "—"}</span>
                        <Badge variant="outline">{invoice.branch || "فرع غير محدد"}</Badge>
                        <Badge variant="outline">{invoice.supplier_name || "مورد غير محدد"}</Badge>
                        {candidate.returned > 0 && <Badge className="bg-rose-50 text-rose-700 border border-rose-200">مرتجع {formatMoney(candidate.returned)} ج</Badge>}
                        {linked && <Badge className="bg-blue-50 text-blue-700 border border-blue-200">مرتجع مسجل: {STATUS_CONFIG[linked.status]?.label || linked.status}</Badge>}
                      </div>

                      <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div className="rounded-lg bg-gray-50 p-2"><span className="text-gray-500">الإجمالي</span><div className="font-bold mt-0.5">{formatMoney(candidate.total)} ج</div></div>
                        <div className="rounded-lg bg-rose-50 p-2"><span className="text-rose-600">المرتجع</span><div className="font-bold mt-0.5 text-rose-700">{formatMoney(candidate.returned)} ج</div></div>
                        <div className="rounded-lg bg-emerald-50 p-2"><span className="text-emerald-600">الصافي</span><div className="font-bold mt-0.5 text-emerald-700">{candidate.net === null ? "—" : `${formatMoney(candidate.net)} ج`}</div></div>
                        <div className="rounded-lg bg-gray-50 p-2"><span className="text-gray-500">التاريخ</span><div className="font-bold mt-0.5">{invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString("ar-EG") : "—"}</div></div>
                      </div>

                      {invoice.notes && (
                        <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-6 text-sky-900">
                          <strong>ملاحظة الفاتورة:</strong> {invoice.notes}
                        </div>
                      )}
                      {linked?.return_reason && (
                        <div className="mt-2 text-xs text-gray-700"><strong>سبب المرتجع المسجل:</strong> {linked.return_reason}</div>
                      )}
                      {itemSummary && (
                        <div className="mt-1 text-xs text-gray-700"><strong>تفاصيل الأصناف:</strong> {itemSummary}</div>
                      )}
                      {linked?.notes && linked.notes !== invoice.notes && (
                        <div className="mt-1 text-xs text-gray-700"><strong>ملاحظة المرتجع:</strong> {linked.notes}</div>
                      )}
                    </div>

                    <Button
                      size="sm"
                      onClick={() => markFollowupDoneMutation.mutate(candidate)}
                      disabled={markFollowupDoneMutation.isPending}
                      className="bg-teal-600 hover:bg-teal-700 text-white gap-1.5 shrink-0"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {markFollowupDoneMutation.isPending ? "جاري الحفظ..." : "تم"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {stalePendingReturns.length > 0 && (
        <div className="bg-orange-50 border border-orange-300 rounded-xl p-3 flex gap-3 items-start">
          <AlertTriangle className="w-5 h-5 text-orange-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-orange-700">{stalePendingReturns.length} مرتجع معلق منذ أكثر من 3 أيام</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {stalePendingReturns.map((r) => {
                const days = Math.floor((Date.now() - new Date(r.created_date).getTime()) / (1000 * 60 * 60 * 24));
                return (
                  <button key={r.id} onClick={() => handleView(r)} className="text-xs bg-orange-100 hover:bg-orange-200 text-orange-800 border border-orange-200 rounded-full px-2 py-0.5 transition-colors">
                    {r.return_number || r.invoice_number} ({days} يوم)
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setFilterStatus(filterStatus === key ? "الكل" : key)}
            className={`rounded-xl border p-3 text-center transition-all hover:shadow-md ${filterStatus === key ? "ring-2 ring-teal-500 shadow-md" : ""} ${cfg.color}`}
          >
            <div className="text-2xl font-bold">{statusCounts[key] || 0}</div>
            <div className="text-xs font-medium mt-1">{cfg.label}</div>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border p-3 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute right-3 top-2.5 w-4 h-4 text-gray-400" />
            <Input
              placeholder="بحث برقم المرتجع أو الفاتورة أو المورد..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9 h-9"
            />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40 h-9"><SelectValue placeholder="كل الحالات" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="الكل">كل الحالات</SelectItem>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {["الكل", ...BRANCHES].map((b) => (
            <button
              key={b}
              onClick={() => setFilterBranch(b)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                filterBranch === b ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-600 border-gray-200 hover:border-teal-300"
              }`}
            >
              {b}
            </button>
          ))}
          <div className="mr-auto">
            <SortControls
              columns={RETURN_SORT_COLUMNS}
              sortField={sortField}
              sortDirection={sortDirection}
              onToggle={toggleSort}
              onSet={setSort}
              onReset={resetSort}
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <RefreshCw className="w-6 h-6 animate-spin text-teal-500" />
          </div>
        ) : paginated.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <RotateCcw className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p>لا توجد مرتجعات</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <SortableHeader field="return_number" label="رقم المرتجع" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
                  <SortableHeader field="invoice_number" label="رقم الفاتورة" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
                  <SortableHeader field="supplier_name" label="المورد" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
                  <SortableHeader field="branch_name" label="الفرع" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3 hidden md:table-cell" />
                  <SortableHeader field="employee_name" label="الموظف" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3 hidden md:table-cell" />
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 hidden lg:table-cell">سبب المرتجع</th>
                  <SortableHeader field="status" label="الحالة" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
                  <SortableHeader field="created_date" label="التاريخ" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3 hidden md:table-cell" />
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paginated.map((ret) => {
                  const cfg = STATUS_CONFIG[ret.status] || STATUS_CONFIG.Pending;
                  return (
                    <tr key={ret.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono font-semibold text-teal-700">{ret.return_number || "—"}</td>
                      <td className="px-4 py-3 text-gray-700">{ret.invoice_number}</td>
                      <td className="px-4 py-3 text-gray-700">{ret.supplier_name}</td>
                      <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{ret.branch_name}</td>
                      <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{ret.employee_name}</td>
                      <td className="px-4 py-3 text-gray-600 hidden lg:table-cell text-xs">{ret.return_reason || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium border ${cfg.color}`}>{cfg.label}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden md:table-cell text-xs">
                        {ret.created_date ? new Date(ret.created_date).toLocaleDateString("ar-EG") : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Button size="sm" variant="ghost" onClick={() => handleView(ret)} className="gap-1 text-teal-600">
                          <Eye className="w-3.5 h-3.5" /> عرض
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
            <span className="text-sm text-gray-500">صفحة {page} من {totalPages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>السابق</Button>
              <Button size="sm" variant="outline" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>التالي</Button>
            </div>
          </div>
        )}
      </div>

      <ReturnFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["returns"] })}
      />

      {selectedReturn && (
        <ReturnDetailDialog
          open={detailOpen}
          onOpenChange={setDetailOpen}
          returnData={selectedReturn}
          onUpdated={(updated) => {
            setSelectedReturn(updated);
            queryClient.invalidateQueries({ queryKey: ["returns"] });
          }}
          onDeleted={() => queryClient.invalidateQueries({ queryKey: ["returns"] })}
        />
      )}
    </div>
  );
}
