import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, RotateCcw, CheckCircle2, Search, X } from "lucide-react";
import { useUserRole } from "@/lib/useUserRole";
import ConfirmDialog from "@/components/invoices/ConfirmDialog";
import { format } from "date-fns";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortableHeader } from "@/components/table/SortableHeader";
import { SortControls } from "@/components/table/SortControls";
import { EXPIRED_STATUS_ORDER } from "@/lib/sortUtils";

const EXPIRED_SORT_COLUMNS = [
  { field: "item_name", label: "اسم الصنف", type: "text" },
  { field: "branch", label: "الفرع", type: "text" },
  { field: "quantity", label: "العدد", type: "number" },
  { field: "price", label: "السعر", type: "number" },
  { field: "expiry_date", label: "تاريخ الصلاحية", type: "date" },
  { field: "source", label: "المصدر", type: "text" },
  { field: "status", label: "الحالة", type: "status", statusMap: EXPIRED_STATUS_ORDER },
];

const BRANCHES = ["دواء شكري", "دواء الشامي"];

const emptyForm = () => ({
  item_name: "", quantity: "", price: "", expiry_date: "", branch: "", notes: ""
});

const STATUS_COLORS = {
  "منتهي": "bg-red-100 text-red-800",
  "تم الإرجاع للشركة": "bg-blue-100 text-blue-800",
  "تم التبديل / التصريف": "bg-green-100 text-green-800",
};

export default function ExpiredItemsTab() {
  const { isAdmin, isManager } = useUserRole();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [actionItem, setActionItem] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [search, setSearch] = useState("");
  const [filterBranch, setFilterBranch] = useState("الكل");
  const [filterStatus, setFilterStatus] = useState("الكل");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const { data: items = [] } = useQuery({
    queryKey: ["expired-items"],
    queryFn: () => base44.entities.ExpiredItem.list(),
  });

  const filteredItems = useMemo(() => [...items]
    .filter(i => !search || i.item_name.includes(search))
    .filter(i => filterBranch === "الكل" || i.branch === filterBranch)
    .filter(i => filterStatus === "الكل" || i.status === filterStatus)
    .filter(i => !filterFrom || i.expiry_date >= filterFrom)
    .filter(i => !filterTo || i.expiry_date <= filterTo)
  , [items, search, filterBranch, filterStatus, filterFrom, filterTo]);

  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({
    columns: EXPIRED_SORT_COLUMNS,
    defaultSort: { field: "expiry_date", direction: "asc" },
    paramPrefix: "expt",
  });
  const sortedItems = useMemo(() => sortData(filteredItems), [filteredItems, sortData]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ExpiredItem.create(data),
    onSuccess: () => { queryClient.invalidateQueries(["expired-items"]); setShowAdd(false); setForm(emptyForm()); }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ExpiredItem.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries(["expired-items"]); setActionItem(null); }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ExpiredItem.delete(id),
    onSuccess: () => queryClient.invalidateQueries(["expired-items"])
  });

  const handleAdd = () => {
    if (!form.item_name || !form.quantity || !form.price || !form.expiry_date || !form.branch) return;
    createMutation.mutate({ ...form, quantity: Number(form.quantity), price: Number(form.price), status: "منتهي", source: "إدخال مباشر" });
  };

  const handleReturn = () => {
    updateMutation.mutate({ id: actionItem.item.id, data: { status: "تم الإرجاع للشركة" } });
  };

  const handleDispose = () => {
    updateMutation.mutate({ id: actionItem.item.id, data: { status: "تم التبديل / التصريف" } });
  };

  // Bulk delete
  const handleBulkDelete = async () => {
    for (const id of selectedIds) {
      await base44.entities.ExpiredItem.delete(id);
    }
    queryClient.invalidateQueries(["expired-items"]);
    setSelectedIds([]);
    setBulkDeleteOpen(false);
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    const allIds = sortedItems.map(i => i.id);
    if (selectedIds.length === allIds.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(allIds);
    }
  };

  const canAct = isAdmin || isManager;
  const allSelected = sortedItems.length > 0 && selectedIds.length === sortedItems.length;

  return (
    <div dir="rtl" className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-lg font-semibold text-gray-800">الأصناف المنتهية (أكسبير)</h3>
        {canAct && (
          <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1 bg-gray-900 hover:bg-black text-white">
            <Plus className="w-4 h-4" /> إضافة صنف منتهي
          </Button>
        )}
      </div>

      {/* Branch filter buttons */}
      <div className="flex flex-wrap gap-2">
        {["الكل", ...BRANCHES].map(b => (
          <Button
            key={b}
            size="sm"
            variant={filterBranch === b ? "default" : "outline"}
            onClick={() => setFilterBranch(b)}
            className="text-xs"
          >
            {b === "الكل" ? "كل الفروع" : b}
          </Button>
        ))}
      </div>

      {/* Search & Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute right-2 top-2 w-4 h-4 text-gray-400" />
          <Input className="pr-7" placeholder="بحث باسم الصنف..." value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button className="absolute left-2 top-2" onClick={() => setSearch("")}><X className="w-4 h-4 text-gray-400" /></button>}
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="الكل">كل الحالات</SelectItem>
            <SelectItem value="منتهي">منتهي</SelectItem>
            <SelectItem value="تم الإرجاع للشركة">تم الإرجاع</SelectItem>
            <SelectItem value="تم التبديل / التصريف">تم التصريف</SelectItem>
          </SelectContent>
        </Select>
        <Input type="month" className="w-36" placeholder="من" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
        <Input type="month" className="w-36" placeholder="إلى" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
        <SortControls
          columns={EXPIRED_SORT_COLUMNS}
          sortField={sortField}
          sortDirection={sortDirection}
          onToggle={toggleSort}
          onSet={setSort}
          onReset={resetSort}
        />
        {(filterStatus !== "الكل" || filterFrom || filterTo) && (
          <Button size="sm" variant="ghost" className="text-gray-400 text-xs" onClick={() => { setFilterStatus("الكل"); setFilterFrom(""); setFilterTo(""); }}>
            <X className="w-3 h-3" /> مسح
          </Button>
        )}
      </div>

      {/* Bulk Action Bar */}
      {canAct && selectedIds.length > 0 && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <span className="text-sm font-medium text-red-700">تم تحديد {selectedIds.length} صنف</span>
          <Button size="sm" variant="outline" className="text-xs h-7 gap-1 text-red-600 border-red-300"
            onClick={() => setBulkDeleteOpen(true)}>
            <Trash2 className="w-3 h-3" /> حذف المحدد
          </Button>
          <Button size="sm" variant="ghost" className="text-xs h-7 text-gray-500 mr-auto"
            onClick={() => setSelectedIds([])}>
            إلغاء التحديد
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-white">
            <tr>
              {canAct && (
                <th className="px-3 py-2 text-center w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleSelectAll}
                    className="border-white data-[state=checked]:bg-white data-[state=checked]:text-gray-900"
                  />
                </th>
              )}
              <SortableHeader field="item_name" label="اسم الصنف" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-3 py-2 text-white" />
              <SortableHeader field="branch" label="الفرع" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-3 py-2 text-white" />
              <SortableHeader field="quantity" label="العدد" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-3 py-2 text-white" />
              <SortableHeader field="price" label="السعر" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-3 py-2 text-white" />
              <SortableHeader field="expiry_date" label="تاريخ الصلاحية" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-3 py-2 text-white" />
              <SortableHeader field="source" label="المصدر" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-3 py-2 text-white" />
              <SortableHeader field="status" label="الحالة" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-3 py-2 text-white" />
              {canAct && <th className="px-3 py-2 text-right">إجراءات</th>}
            </tr>
          </thead>
          <tbody>
            {sortedItems.length === 0 && (
              <tr><td colSpan={9} className="text-center py-8 text-gray-400">لا توجد أصناف منتهية</td></tr>
            )}
            {sortedItems.map(item => (
              <tr key={item.id} className={`border-t hover:bg-gray-50 ${selectedIds.includes(item.id) ? "bg-red-50" : ""}`}>
                {canAct && (
                  <td className="px-3 py-2 text-center">
                    <Checkbox checked={selectedIds.includes(item.id)} onCheckedChange={() => toggleSelect(item.id)} />
                  </td>
                )}
                <td className="px-3 py-2 font-medium">{item.item_name}</td>
                <td className="px-3 py-2">{item.branch}</td>
                <td className="px-3 py-2">{item.quantity}</td>
                <td className="px-3 py-2">{item.price} ج</td>
                <td className="px-3 py-2">
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                    {format(new Date(item.expiry_date), "MM/yyyy")}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="text-xs text-gray-500">{item.source || "إدخال مباشر"}</span>
                </td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[item.status] || "bg-gray-100 text-gray-700"}`}>
                    {item.status}
                  </span>
                </td>
                {canAct && (
                  <td className="px-3 py-2">
                    <div className="flex gap-1 flex-wrap">
                      {item.status === "منتهي" && (
                        <>
                          <Button size="sm" variant="outline" className="text-xs h-7 px-2 gap-1 text-blue-600 border-blue-300"
                            onClick={() => setActionItem({ item, type: "return" })}>
                            <RotateCcw className="w-3 h-3" /> إرجاع
                          </Button>
                          <Button size="sm" variant="outline" className="text-xs h-7 px-2 gap-1 text-green-600 border-green-300"
                            onClick={() => setActionItem({ item, type: "dispose" })}>
                            <CheckCircle2 className="w-3 h-3" /> تصريف
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant="ghost" className="text-xs h-7 px-2 text-red-500"
                        onClick={() => setConfirmDeleteId(item.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bulk Delete Confirm */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(o) => { if (!o) setBulkDeleteOpen(false); }}
        title="تأكيد الحذف الجماعي"
        description={`هل أنت متأكد من حذف ${selectedIds.length} صنف؟ لا يمكن التراجع.`}
        onConfirm={handleBulkDelete}
        confirmLabel="حذف الكل"
      />

      {/* Single Delete Confirm */}
      <ConfirmDialog
        open={!!confirmDeleteId}
        onOpenChange={(o) => { if (!o) setConfirmDeleteId(null); }}
        title="تأكيد الحذف"
        description="هل أنت متأكد من حذف هذا الصنف المنتهي؟ لا يمكن التراجع عن هذا الإجراء."
        onConfirm={() => { deleteMutation.mutate(confirmDeleteId); setConfirmDeleteId(null); }}
        confirmLabel="حذف"
      />

      {/* Add Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader><DialogTitle>إضافة صنف منتهي</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="اسم الصنف" value={form.item_name} onChange={e => setForm({ ...form, item_name: e.target.value })} />
            <Select value={form.branch} onValueChange={v => setForm({ ...form, branch: v })}>
              <SelectTrigger><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
              <SelectContent>{BRANCHES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
            </Select>
            <Input type="number" placeholder="العدد" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
            <Input type="number" placeholder="السعر" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
            <Input type="month" placeholder="تاريخ الصلاحية" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })} />
            <Input placeholder="ملاحظات (اختياري)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
          <DialogFooter className="flex-row-reverse gap-2">
            <Button onClick={handleAdd} disabled={createMutation.isPending} className="bg-gray-900 hover:bg-black">
              {createMutation.isPending ? "جاري الحفظ..." : "حفظ"}
            </Button>
            <Button variant="outline" onClick={() => setShowAdd(false)}>إلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Action Dialog */}
      <Dialog open={!!actionItem} onOpenChange={() => setActionItem(null)}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {actionItem?.type === "return" ? "إرجاع للشركة" : "تبديل / تصريف"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-gray-600">الصنف: <strong>{actionItem?.item?.item_name}</strong></p>
            <p className="text-sm text-gray-500">
              {actionItem?.type === "return"
                ? "سيتم تسجيل هذا الصنف كمرتجع للشركة."
                : "سيتم تسجيل هذا الصنف كتم تبديله أو تصريفه."}
            </p>
          </div>
          <DialogFooter className="flex-row-reverse gap-2">
            <Button onClick={actionItem?.type === "return" ? handleReturn : handleDispose}
              disabled={updateMutation.isPending} className="bg-gray-900 hover:bg-black">
              تأكيد
            </Button>
            <Button variant="outline" onClick={() => setActionItem(null)}>إلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}