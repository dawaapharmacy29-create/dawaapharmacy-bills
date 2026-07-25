import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Eye, RefreshCw, RotateCcw, AlertTriangle } from "lucide-react";
import { useUserRole } from "@/lib/useUserRole";
import ReturnFormDialog from "@/components/returns/ReturnFormDialog";
import ReturnDetailDialog from "@/components/returns/ReturnDetailDialog";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortableHeader } from "@/components/table/SortableHeader";
import { SortControls } from "@/components/table/SortControls";
import { RETURN_STATUS_ORDER } from "@/lib/sortUtils";

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

export default function Returns() {
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState(null);
  const [filterStatus, setFilterStatus] = useState("الكل");
  const [filterBranch, setFilterBranch] = useState("الكل");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const { isManager, user } = useUserRole();
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
  }, []);

  const { data: allReturns = [], isLoading } = useQuery({
    queryKey: ["returns"],
    queryFn: () => base44.entities.Return.list("-created_date", 500),
    staleTime: 20000,
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
      {/* Header */}
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

      {/* Stale Pending Alert */}
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

      {/* Status Summary Cards */}
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

      {/* Filters */}
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

      {/* Table */}
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

        {/* Pagination */}
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