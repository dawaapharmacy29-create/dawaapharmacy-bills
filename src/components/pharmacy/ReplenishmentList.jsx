import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, PackageSearch, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { useToast } from "@/components/ui/use-toast";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortableHeader } from "@/components/table/SortableHeader";
import { SortControls } from "@/components/table/SortControls";
import { REPLENISH_STATUS_ORDER } from "@/lib/sortUtils";

const REPL_SORT_COLUMNS = [
  { field: "product_name", label: "اسم الصنف", type: "text" },
  { field: "product_code", label: "الكود", type: "text" },
  { field: "branch", label: "الفرع", type: "text" },
  { field: "actual_balance", label: "الرصيد الفعلي", type: "number" },
  { field: "requested_quantity", label: "الكمية المطلوبة", type: "number" },
  { field: "order_status", label: "الحالة", type: "status", statusMap: REPLENISH_STATUS_ORDER },
  { field: "created_date", label: "وقت الإضافة", type: "date" },
];

const BRANCHES = ["دواء شكري", "دواء الشامي"];

const emptyForm = {
  product_name: "",
  product_code: "",
  branch: "دواء شكري",
  requested_quantity: "",
  actual_balance: "",
  notes: "",
};

function exportReplenishmentToExcel(items) {
  const statusLabel = { pending: "لم يُطلب", shortage: "نواقص", searching: "جاري البحث", approved: "تم الاعتماد", ordered: "تم الطلب", partial_received: "وصل جزئيًا", received: "وصل بالكامل", closed: "مغلق", cancelled: "ملغي" };
  const rows = items.map((item) => ({
    "اسم الصنف": item.product_name || "",
    "كود الصنف": item.product_code || "",
    "الفرع": item.branch || "",
    "الرصيد الفعلي": item.actual_balance ?? "",
    "الكمية المطلوبة": item.requested_quantity || "",
    "الحالة": statusLabel[item.order_status || "pending"] || "",
    "ملاحظات": item.notes || "",
    "تاريخ الإضافة": item.created_date ? new Date(item.created_date).toLocaleString("ar-EG") : "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const colWidths = Object.keys(rows[0] || {}).map(() => ({ wch: 20 }));
  ws["!cols"] = colWidths;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "الأصناف المطلوبة");
  XLSX.writeFile(wb, `الأصناف_المطلوبة_${new Date().toISOString().slice(0,10)}.xlsx`);
}

export default function ReplenishmentList() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [filterBranch, setFilterBranch] = useState("all");
  const [filterOrdered, setFilterOrdered] = useState("all");

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["replenishment-orders"],
    queryFn: () => base44.entities.ReplenishmentOrder.list("-created_date", 300),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ReplenishmentOrder.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["replenishment-orders"] });
      setShowForm(false);
      setForm(emptyForm);
      toast({ description: "تمت إضافة الصنف بنجاح" });
    },
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, order_status }) =>
      base44.entities.ReplenishmentOrder.update(id, { order_status, status_updated_at: new Date().toISOString(), ...(order_status === 'closed' ? { closed_at: new Date().toISOString() } : {}) }),
    onMutate: async ({ id, order_status }) => {
      await qc.cancelQueries({ queryKey: ["replenishment-orders"] });
      const previous = qc.getQueryData(["replenishment-orders"]);
      qc.setQueryData(["replenishment-orders"], (old) =>
        old ? old.map((i) => i.id === id ? { ...i, order_status } : i) : old
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(["replenishment-orders"], context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["replenishment-orders"] }),
  });

  const getStatus = (item) => item.order_status || "pending";

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ReplenishmentOrder.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["replenishment-orders"] });
      toast({ description: "تم حذف الصنف" });
    },
  });

  const handleSubmit = () => {
    if (!form.product_name || !form.product_code || !form.branch || !form.requested_quantity) {
      toast({ variant: "destructive", description: "اسم الصنف والكود والفرع والكمية حقول مطلوبة" });
      return;
    }
    const normalizedCode = String(form.product_code || '').trim().toLowerCase();
    const normalizedName = String(form.product_name || '').trim().toLowerCase();
    const duplicate = items.find((item) => item.branch === form.branch && !['closed', 'cancelled', 'received'].includes(getStatus(item)) && ((normalizedCode && String(item.product_code || '').trim().toLowerCase() === normalizedCode) || (!normalizedCode && String(item.product_name || '').trim().toLowerCase() === normalizedName)));
    if (duplicate) {
      toast({ variant: 'destructive', description: `الصنف موجود بالفعل كنقص مفتوح في ${form.branch}. افتح السجل الحالي بدل إنشاء تكرار جديد.` });
      return;
    }
    const qty = parseFloat(form.requested_quantity) || 0;
    const unitPrice = parseFloat(form.purchase_price) || 0;
    createMutation.mutate({
      ...form,
      requested_quantity: qty,
      approved_quantity: 0,
      ordered_quantity: 0,
      received_quantity: 0,
      outstanding_quantity: qty,
      expected_total: qty * unitPrice,
      actual_balance: parseFloat(form.actual_balance) || 0,
      priority: 'normal',
      source_type: 'manual',
      status_updated_at: new Date().toISOString(),
      added_at: new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
    });
  };

  const filteredRaw = useMemo(() => items.filter((item) => {
    if (filterBranch !== "all" && item.branch !== filterBranch) return false;
    if (filterOrdered !== "all" && getStatus(item) !== filterOrdered) return false;
    return true;
  }), [items, filterBranch, filterOrdered]);

  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({
    columns: REPL_SORT_COLUMNS,
    defaultSort: { field: "created_date", direction: "desc" },
    paramPrefix: "repl",
  });
  const filtered = useMemo(() => sortData(filteredRaw), [filteredRaw, sortData]);

  const orderedCount = items.filter((i) => ["ordered", "partial_received"].includes(getStatus(i))).length;
  const shortageCount = items.filter((i) => getStatus(i) === "shortage").length;
  const pendingCount = items.filter((i) => getStatus(i) === "pending").length;

  return (
    <div dir="rtl" className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center">
            <PackageSearch className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-800">قائمة الطلبات المطلوبة</h2>
            <p className="text-xs text-gray-500">
              <span className="text-orange-600 font-semibold">{pendingCount}</span> لم يُطلب •{" "}
              <span className="text-amber-600 font-semibold">{shortageCount}</span> نواقص •{" "}
              <span className="text-emerald-600 font-semibold">{orderedCount}</span> تم الطلب
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => exportReplenishmentToExcel(filtered)} className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50" size="sm">
            <Download className="w-4 h-4" /> تصدير Excel
          </Button>
          <Button onClick={() => setShowForm(true)} className="bg-emerald-600 hover:bg-emerald-700 gap-2" size="sm">
            <Plus className="w-4 h-4" /> إضافة صنف
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
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
        <div className="h-4 w-px bg-gray-200 mx-1" />
        {[
          { id: "all", label: "الكل" },
          { id: "pending", label: "⏳ لم يُطلب" },
          { id: "shortage", label: "⚠️ نواقص" },
          { id: "searching", label: "🔎 جاري البحث" },
          { id: "approved", label: "👍 تم الاعتماد" },
          { id: "ordered", label: "✅ تم الطلب" },
          { id: "partial_received", label: "📦 وصل جزئيًا" },
          { id: "received", label: "✅ وصل بالكامل" },
          { id: "closed", label: "🔒 مغلق" },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setFilterOrdered(f.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              filterOrdered === f.id
                ? "bg-emerald-600 text-white border-emerald-600"
                : "bg-white text-gray-600 border-gray-200 hover:border-emerald-300"
            }`}
          >
            {f.label}
          </button>
        ))}
        <SortControls
          columns={REPL_SORT_COLUMNS}
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
          <div className="text-center py-10 text-gray-400">جارٍ التحميل...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs">
              <tr>
                <SortableHeader field="product_name" label="اسم الصنف" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
                <SortableHeader field="product_code" label="الكود" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
                <SortableHeader field="branch" label="الفرع" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3" />
                <SortableHeader field="actual_balance" label="الرصيد الفعلي" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3 text-center" />
                <SortableHeader field="requested_quantity" label="الكمية المطلوبة" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3 text-center" />
                <SortableHeader field="order_status" label="تم الطلب؟" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3 text-center" />
                <th className="px-4 py-3 text-center font-medium">ملاحظات</th>
                <SortableHeader field="created_date" label="وقت الإضافة" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-4 py-3 text-center" />
                <th className="px-4 py-3 text-center font-medium">حذف</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((item) => (
                <tr
                  key={item.id}
                  className={`hover:bg-gray-50 transition-colors ${getStatus(item) === "ordered" ? "bg-emerald-50/40" : getStatus(item) === "shortage" ? "bg-amber-50/40" : ""}`}
                >
                  <td className="px-4 py-2.5 font-medium text-gray-800">{item.product_name}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{item.product_code || "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">{item.branch}</td>
                  <td className="px-4 py-2.5 text-center text-gray-700">{item.actual_balance ?? "—"}</td>
                  <td className="px-4 py-2.5 text-center font-semibold text-blue-700">{item.requested_quantity}</td>
                  <td className="px-4 py-2.5 text-center">
                    <select
                      value={getStatus(item)}
                      onChange={(e) => updateStatus.mutate({ id: item.id, order_status: e.target.value })}
                      className={`text-xs font-medium rounded-lg px-2 py-1 border cursor-pointer outline-none transition-colors ${
                        getStatus(item) === "ordered"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : getStatus(item) === "shortage"
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : "bg-gray-50 text-gray-500 border-gray-200"
                      }`}
                    >
                      <option value="pending">لم يُطلب</option>
                      <option value="shortage">نواقص</option>
                      <option value="searching">جاري البحث</option>
                      <option value="approved">تم الاعتماد</option>
                      <option value="ordered">تم الطلب</option>
                      <option value="partial_received">وصل جزئيًا</option>
                      <option value="received">وصل بالكامل</option>
                      <option value="closed">مغلق</option>
                      <option value="cancelled">ملغي</option>
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-center text-xs text-gray-500">{item.notes || "—"}</td>
                  <td className="px-4 py-2.5 text-center text-xs text-gray-400 max-w-[60px] overflow-hidden">
                    <span className="block truncate cursor-default" title={item.created_date ? new Date(item.created_date).toLocaleString("ar-EG", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}>
                      {item.created_date ? new Date(item.created_date).toLocaleString("ar-EG", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      type="button"
                      onClick={() => toast({ variant: "destructive", description: "تم إيقاف الحذف المباشر. غيّر الحالة إلى ملغي للحفاظ على سجل الطلب." })}
                      className="text-gray-300 cursor-not-allowed"
                      title="الحذف المباشر متوقف"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-gray-400">
                    لا توجد أصناف مضافة
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>إضافة صنف مطلوب</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">اسم الصنف *</label>
              <Input
                value={form.product_name}
                onChange={(e) => setForm((f) => ({ ...f, product_name: e.target.value }))}
                placeholder="اسم الصنف"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">كود الصنف</label>
              <Input
                value={form.product_code}
                onChange={(e) => setForm((f) => ({ ...f, product_code: e.target.value }))}
                placeholder="اختياري"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">الفرع *</label>
              <Select value={form.branch} onValueChange={(v) => setForm((f) => ({ ...f, branch: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BRANCHES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">الرصيد الفعلي</label>
                <Input
                  type="number"
                  min="0"
                  value={form.actual_balance}
                  onChange={(e) => setForm((f) => ({ ...f, actual_balance: e.target.value }))}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">الكمية المطلوبة *</label>
                <Input
                  type="number"
                  min="1"
                  value={form.requested_quantity}
                  onChange={(e) => setForm((f) => ({ ...f, requested_quantity: e.target.value }))}
                  placeholder="0"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">ملاحظات</label>
              <Input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="اختياري"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>إلغاء</Button>
            <Button
              disabled={!form.product_name || !form.requested_quantity || createMutation.isPending}
              onClick={handleSubmit}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              إضافة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}