import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ArrowRightLeft, RotateCcw, AlertTriangle, Search, X, CheckSquare } from "lucide-react";
import { useUserRole } from "@/lib/useUserRole";
import ConfirmDialog from "@/components/invoices/ConfirmDialog";
import { format, differenceInDays } from "date-fns";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortableHeader } from "@/components/table/SortableHeader";
import { SortControls } from "@/components/table/SortControls";
import { SLOW_STATUS_ORDER } from "@/lib/sortUtils";

const SLOW_SORT_COLUMNS = [
  { field: "item_name", label: "اسم الصنف", type: "text" },
  { field: "branch", label: "الفرع", type: "text" },
  { field: "quantity", label: "العدد", type: "number" },
  { field: "price", label: "السعر", type: "number" },
  { field: "expiry_date", label: "تاريخ الصلاحية", type: "date" },
  { field: "status", label: "الحالة", type: "status", statusMap: SLOW_STATUS_ORDER },
];

const BRANCHES = ["دواء شكري", "دواء الشامي"];

const emptyForm = () => ({
  item_name: "", quantity: "", price: "", expiry_date: "", branch: "", notes: ""
});

const TRANSFER_STATUS_COLORS = {
  "منتظر التحويل": "bg-yellow-100 text-yellow-800",
  "تم النقل": "bg-green-100 text-green-800",
};

export default function SlowMovingTab() {
  const { isAdmin, isManager } = useUserRole();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [actionItem, setActionItem] = useState(null);
  const [transferBranch, setTransferBranch] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [search, setSearch] = useState("");
  const [filterBranch, setFilterBranch] = useState("الكل");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkAction, setBulkAction] = useState(null); // "delete" | "expire"
  const [bulkTransferBranch, setBulkTransferBranch] = useState("");

  const { data: items = [] } = useQuery({
    queryKey: ["slow-moving-items"],
    queryFn: () => base44.entities.SlowMovingItem.list(),
  });

  const filteredItems = useMemo(() => [...items]
    .filter(i => i.status === "راكد" || i.status === "منتظر التحويل")
    .filter(i => !search || i.item_name.includes(search))
    .filter(i => filterBranch === "الكل" || i.branch === filterBranch)
    .filter(i => !filterFrom || i.expiry_date >= filterFrom)
    .filter(i => !filterTo || i.expiry_date <= filterTo)
  , [items, search, filterBranch, filterFrom, filterTo]);

  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({
    columns: SLOW_SORT_COLUMNS,
    defaultSort: { field: "expiry_date", direction: "asc" },
    paramPrefix: "slow",
  });
  const sortedItems = useMemo(() => sortData(filteredItems), [filteredItems, sortData]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.SlowMovingItem.create(data),
    onSuccess: () => { queryClient.invalidateQueries(["slow-moving-items"]); setShowAdd(false); setForm(emptyForm()); }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.SlowMovingItem.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries(["slow-moving-items"]); setActionItem(null); setTransferBranch(""); }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.SlowMovingItem.delete(id),
    onSuccess: () => queryClient.invalidateQueries(["slow-moving-items"])
  });

  const expiredCreateMutation = useMutation({
    mutationFn: (data) => base44.entities.ExpiredItem.create(data),
    onSuccess: () => queryClient.invalidateQueries(["expired-items"])
  });

  const handleAdd = () => {
    if (!form.item_name || !form.quantity || !form.price || !form.expiry_date || !form.branch) return;
    createMutation.mutate({ ...form, quantity: Number(form.quantity), price: Number(form.price), status: "راكد" });
  };

  const handleTransfer = () => {
    if (!transferBranch || transferBranch === actionItem.item.branch) return;
    // Mark original as "منتظر التحويل"
    updateMutation.mutate({ id: actionItem.item.id, data: { status: "منتظر التحويل", notes: (actionItem.item.notes || "") + ` | في انتظار التحويل إلى ${transferBranch}` } });
    // Create new record in new branch
    base44.entities.SlowMovingItem.create({
      item_name: actionItem.item.item_name,
      quantity: actionItem.item.quantity,
      price: actionItem.item.price,
      expiry_date: actionItem.item.expiry_date,
      branch: transferBranch,
      status: "راكد",
      notes: `منقول من ${actionItem.item.branch}`
    }).then(() => {
      // Mark original as "تم النقل"
      base44.entities.SlowMovingItem.update(actionItem.item.id, { status: "تم النقل" })
        .then(() => queryClient.invalidateQueries(["slow-moving-items"]));
    });
  };

  const handleReturn = () => {
    updateMutation.mutate({ id: actionItem.item.id, data: { status: "تم الإرجاع للشركة" } });
  };

  const handleToExpired = () => {
    expiredCreateMutation.mutate({
      item_name: actionItem.item.item_name,
      quantity: actionItem.item.quantity,
      price: actionItem.item.price,
      expiry_date: actionItem.item.expiry_date,
      branch: actionItem.item.branch,
      status: "منتهي",
      source: "محول من الراكد",
      notes: actionItem.item.notes || ""
    });
    updateMutation.mutate({ id: actionItem.item.id, data: { status: "تم التحويل لمنتهي" } });
  };

  // Bulk actions
  const handleBulkDelete = async () => {
    for (const id of selectedIds) {
      await base44.entities.SlowMovingItem.delete(id);
    }
    queryClient.invalidateQueries(["slow-moving-items"]);
    setSelectedIds([]);
    setBulkAction(null);
  };

  const handleBulkToExpired = async () => {
    const selected = sortedItems.filter(i => selectedIds.includes(i.id));
    for (const item of selected) {
      await base44.entities.ExpiredItem.create({
        item_name: item.item_name,
        quantity: item.quantity,
        price: item.price,
        expiry_date: item.expiry_date,
        branch: item.branch,
        status: "منتهي",
        source: "محول من الراكد",
        notes: item.notes || ""
      });
      await base44.entities.SlowMovingItem.update(item.id, { status: "تم التحويل لمنتهي" });
    }
    queryClient.invalidateQueries(["slow-moving-items"]);
    queryClient.invalidateQueries(["expired-items"]);
    setSelectedIds([]);
    setBulkAction(null);
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    const activeIds = sortedItems.map(i => i.id);
    if (selectedIds.length === activeIds.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(activeIds);
    }
  };

  const getExpiryColor = (expiry_date) => {
    const days = differenceInDays(new Date(expiry_date), new Date());
    if (days < 0) return "bg-red-100 text-red-800";
    if (days <= 30) return "bg-orange-100 text-orange-800";
    if (days <= 90) return "bg-yellow-100 text-yellow-800";
    return "bg-green-100 text-green-800";
  };

  const canAct = isAdmin || isManager;
  const allSelected = sortedItems.length > 0 && selectedIds.length === sortedItems.length;

  return (
    <div dir="rtl" className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-lg font-semibold text-gray-700">الأصناف الراكدة</h3>
        {canAct && (
          <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1">
            <Plus className="w-4 h-4" /> إضافة صنف راكد
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

      {/* Search & date Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute right-2 top-2 w-4 h-4 text-gray-400" />
          <Input className="pr-7" placeholder="بحث باسم الصنف..." value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button className="absolute left-2 top-2" onClick={() => setSearch("")}><X className="w-4 h-4 text-gray-400" /></button>}
        </div>
        <Input type="month" className="w-36" placeholder="من" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
        <Input type="month" className="w-36" placeholder="إلى" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
        <SortControls
          columns={SLOW_SORT_COLUMNS}
          sortField={sortField}
          sortDirection={sortDirection}
          onToggle={toggleSort}
          onSet={setSort}
          onReset={resetSort}
        />
        {(filterFrom || filterTo) && (
          <Button size="sm" variant="ghost" className="text-gray-400 text-xs" onClick={() => { setFilterFrom(""); setFilterTo(""); }}>
            <X className="w-3 h-3" /> مسح
          </Button>
        )}
      </div>

      {/* Bulk Action Bar */}
      {canAct && selectedIds.length > 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          <span className="text-sm font-medium text-blue-700">تم تحديد {selectedIds.length} صنف</span>
          <Button size="sm" variant="outline" className="text-xs h-7 gap-1 text-red-600 border-red-300"
            onClick={() => setBulkAction("delete")}>
            <Trash2 className="w-3 h-3" /> حذف المحدد
          </Button>
          <Button size="sm" variant="outline" className="text-xs h-7 gap-1 text-orange-600 border-orange-300"
            onClick={() => setBulkAction("expire")}>
            <AlertTriangle className="w-3 h-3" /> تحويل لأكسبير
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
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              {canAct && (
                <th className="px-3 py-2 text-center w-10">
                  <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
                </th>
              )}
              <SortableHeader field="item_name" label="اسم الصنف" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-3 py-2" />
              <SortableHeader field="branch" label="الفرع" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-3 py-2" />
              <SortableHeader field="quantity" label="العدد" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-3 py-2" />
              <SortableHeader field="price" label="السعر" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-3 py-2" />
              <SortableHeader field="expiry_date" label="تاريخ الصلاحية" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-3 py-2" />
              <SortableHeader field="status" label="الحالة" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="px-3 py-2" />
              {canAct && <th className="px-3 py-2 text-right">إجراءات</th>}
            </tr>
          </thead>
          <tbody>
            {sortedItems.length === 0 && (
              <tr><td colSpan={8} className="text-center py-8 text-gray-400">لا توجد أصناف راكدة</td></tr>
            )}
            {sortedItems.map(item => (
              <tr key={item.id} className={`border-t hover:bg-gray-50 ${selectedIds.includes(item.id) ? "bg-blue-50" : ""}`}>
                {canAct && (
                  <td className="px-3 py-2 text-center">
                    <Checkbox checked={selectedIds.includes(item.id)} onCheckedChange={() => toggleSelect(item.id)} />
                  </td>
                )}
                <td className="px-3 py-2 font-medium">
                  {item.item_name}
                  {item.notes && <div className="text-xs text-gray-400 mt-0.5">{item.notes}</div>}
                </td>
                <td className="px-3 py-2">{item.branch}</td>
                <td className="px-3 py-2">{item.quantity}</td>
                <td className="px-3 py-2">{item.price} ج</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${getExpiryColor(item.expiry_date)}`}>
                    {format(new Date(item.expiry_date), "MM/yyyy")}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {item.status === "منتظر التحويل" || item.status === "تم النقل" ? (
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${TRANSFER_STATUS_COLORS[item.status] || "bg-gray-100 text-gray-600"}`}>
                      {item.status}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">{item.status}</span>
                  )}
                </td>
                {canAct && (
                  <td className="px-3 py-2">
                    <div className="flex gap-1 flex-wrap">
                      <Button size="sm" variant="outline" className="text-xs h-7 px-2 gap-1"
                        onClick={() => setActionItem({ item, type: "transfer" })}>
                        <ArrowRightLeft className="w-3 h-3" /> نقل
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs h-7 px-2 gap-1 text-orange-600 border-orange-300"
                        onClick={() => setActionItem({ item, type: "expire" })}>
                        <AlertTriangle className="w-3 h-3" /> منتهي
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs h-7 px-2 gap-1 text-blue-600 border-blue-300"
                        onClick={() => setActionItem({ item, type: "return" })}>
                        <RotateCcw className="w-3 h-3" /> إرجاع
                      </Button>
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
        open={bulkAction === "delete"}
        onOpenChange={(o) => { if (!o) setBulkAction(null); }}
        title="تأكيد الحذف الجماعي"
        description={`هل أنت متأكد من حذف ${selectedIds.length} صنف؟ لا يمكن التراجع.`}
        onConfirm={handleBulkDelete}
        confirmLabel="حذف الكل"
      />

      {/* Bulk Expire Confirm */}
      <ConfirmDialog
        open={bulkAction === "expire"}
        onOpenChange={(o) => { if (!o) setBulkAction(null); }}
        title="تحويل للأكسبير"
        description={`هل تريد تحويل ${selectedIds.length} صنف إلى تبويب الأكسبير (المنتهي)؟`}
        onConfirm={handleBulkToExpired}
        confirmLabel="تحويل"
      />

      {/* Single Delete Confirm */}
      <ConfirmDialog
        open={!!confirmDeleteId}
        onOpenChange={(o) => { if (!o) setConfirmDeleteId(null); }}
        title="تأكيد الحذف"
        description="هل أنت متأكد من حذف هذا الصنف؟ لا يمكن التراجع عن هذا الإجراء."
        onConfirm={() => { deleteMutation.mutate(confirmDeleteId); setConfirmDeleteId(null); }}
        confirmLabel="حذف"
      />

      {/* Add Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader><DialogTitle>إضافة صنف راكد</DialogTitle></DialogHeader>
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
            <Button onClick={handleAdd} disabled={createMutation.isPending}>
              {createMutation.isPending ? "جاري الحفظ..." : "حفظ"}
            </Button>
            <Button variant="outline" onClick={() => setShowAdd(false)}>إلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Action Dialog */}
      <Dialog open={!!actionItem} onOpenChange={() => { setActionItem(null); setTransferBranch(""); }}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {actionItem?.type === "transfer" && "نقل الصنف لفرع آخر"}
              {actionItem?.type === "return" && "إرجاع الصنف للشركة"}
              {actionItem?.type === "expire" && "تحويل إلى تبويب المنتهي"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">الصنف: <strong>{actionItem?.item?.item_name}</strong></p>
            {actionItem?.type === "transfer" && (
              <>
                <p className="text-sm text-gray-500">الفرع الحالي: {actionItem?.item?.branch}</p>
                <Select value={transferBranch} onValueChange={setTransferBranch}>
                  <SelectTrigger><SelectValue placeholder="اختر الفرع المستقبل" /></SelectTrigger>
                  <SelectContent>
                    {BRANCHES.filter(b => b !== actionItem?.item?.branch).map(b => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded p-2">
                  سيظهر الصنف الأصلي بحالة "منتظر التحويل" ثم "تم النقل" بعد إنشاء السجل الجديد.
                </p>
              </>
            )}
            {actionItem?.type === "return" && (
              <p className="text-sm text-gray-500">سيتم تسجيل هذا الصنف كمرتجع للشركة.</p>
            )}
            {actionItem?.type === "expire" && (
              <p className="text-sm text-gray-500">سيتم نقل هذا الصنف إلى تبويب الأكسبير (المنتهي).</p>
            )}
          </div>
          <DialogFooter className="flex-row-reverse gap-2">
            <Button
              onClick={actionItem?.type === "transfer" ? handleTransfer : actionItem?.type === "return" ? handleReturn : handleToExpired}
              disabled={updateMutation.isPending || (actionItem?.type === "transfer" && !transferBranch)}>
              تأكيد
            </Button>
            <Button variant="outline" onClick={() => { setActionItem(null); setTransferBranch(""); }}>إلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}