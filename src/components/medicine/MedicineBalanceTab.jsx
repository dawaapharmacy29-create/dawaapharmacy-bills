import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Pencil } from "lucide-react";
import { useUserRole } from "@/lib/useUserRole";
import ConfirmDialog from "@/components/invoices/ConfirmDialog";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortControls } from "@/components/table/SortControls";

const MBAL_SORT_COLUMNS = [
  { field: "branch", label: "الفرع", type: "text" },
  { field: "week_label", label: "الفترة", type: "text" },
  { field: "week_start", label: "تاريخ البداية", type: "date" },
];

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const TODAY = new Date().toISOString().split("T")[0];

/**
 * هذا التبويب مخصص لتسجيل الرصيد الفعلي أسبوعياً.
 * البيانات المُدخلة هنا تُحفظ في نفس entity "MedicineSale" 
 * كحقل "balance" على كل صنف، وهو نفس الحقل الذي يقرأه
 * جدول "الرصيد الفعلي الإجمالي" في تبويب أصناف اللسته.
 */
export default function MedicineBalanceTab() {
  const qc = useQueryClient();
  const { isAdmin, isManager } = useUserRole();
  const canAdd = isAdmin || isManager;
  const canDelete = isAdmin || isManager;

  // Add dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [branch, setBranch] = useState("");
  const [balances, setBalances] = useState({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Edit dialog
  const [editDialog, setEditDialog] = useState(false);
  const [editRecord, setEditRecord] = useState(null);
  const [editBalances, setEditBalances] = useState([]);

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [filterBranch, setFilterBranch] = useState("الكل");

  const { data: items = [] } = useQuery({
    queryKey: ["medicine-items"],
    queryFn: () => base44.entities.MedicineItem.list("name"),
    staleTime: 60000,
  });

  // نجلب كل السجلات ونفلتر محلياً على record_type === "balance"
  const { data: rawRecords = [], isLoading } = useQuery({
    queryKey: ["medicine-balance-records"],
    queryFn: () => base44.entities.MedicineSale.list("-week_start", 500),
    staleTime: 15000,
  });
  const allRecords = rawRecords.filter((r) => r.record_type === "balance");

  const activeItems = items.filter((i) => i.is_active !== false);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.MedicineSale.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["medicine-balance-records"] });
      qc.invalidateQueries({ queryKey: ["medicine-sales"] }); // لتحديث الجدول في dashboard
      setDialogOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.MedicineSale.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["medicine-balance-records"] });
      qc.invalidateQueries({ queryKey: ["medicine-sales"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.MedicineSale.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["medicine-balance-records"] });
      qc.invalidateQueries({ queryKey: ["medicine-sales"] });
      setEditDialog(false);
      setEditRecord(null);
    },
  });

  const openAddDialog = () => {
    setBranch("");
    const init = {};
    activeItems.forEach((item) => { init[item.id] = ""; });
    setBalances(init);
    setSubmitAttempted(false);
    setDialogOpen(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!branch) return;

    const salesArr = activeItems.map((item) => ({
      medicine_id: item.id,
      medicine_name: item.name,
      quantity: 0,
      balance: balances[item.id] === "" ? 0 : Number(balances[item.id]),
    }));

    createMutation.mutate({
      branch,
      week_start: TODAY,
      week_label: TODAY,
      record_type: "balance",
      sales: salesArr,
    });
  };

  const openEdit = (record) => {
    setEditRecord(record);
    const merged = activeItems.map((item) => {
      const existing = (record.sales || []).find(
        (s) => s.medicine_id === item.id || s.medicine_name === item.name
      );
      return {
        medicine_id: item.id,
        medicine_name: item.name,
        balance: existing?.balance !== undefined && existing?.balance !== null ? existing.balance : "",
      };
    });
    setEditBalances(merged);
    setEditDialog(true);
  };

  const handleEditSubmit = () => {
    const cleaned = editBalances.map((s) => ({
      ...s,
      quantity: 0,
      balance: s.balance === "" ? 0 : Number(s.balance),
    }));
    updateMutation.mutate({ id: editRecord.id, data: { ...editRecord, sales: cleaned } });
  };

  const filteredRaw = useMemo(() => {
    return allRecords.filter((s) =>
      filterBranch === "الكل" || s.branch === filterBranch
    );
  }, [allRecords, filterBranch]);

  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({
    columns: MBAL_SORT_COLUMNS,
    defaultSort: { field: "week_start", direction: "desc" },
    paramPrefix: "mbal",
  });
  const filtered = useMemo(() => sortData(filteredRaw), [filteredRaw, sortData]);

  return (
    <div className="space-y-4">
      <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg text-sm text-teal-800">
        📊 الأرصدة المُدخلة هنا تظهر تلقائياً في جدول <strong>"الرصيد الفعلي الإجمالي"</strong> في تبويب <strong>أصناف اللسته</strong>
      </div>

      {/* Filters + add button */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2 flex-wrap">
          {["الكل", ...BRANCHES].map((b) => (
            <button key={b} onClick={() => setFilterBranch(b)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                filterBranch === b ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-600 border-gray-200 hover:border-teal-300"
              }`}>
              {b}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <SortControls
            columns={MBAL_SORT_COLUMNS}
            sortField={sortField}
            sortDirection={sortDirection}
            onToggle={toggleSort}
            onSet={setSort}
            onReset={resetSort}
            cardMode
          />
          {canAdd && (
            <Button onClick={openAddDialog} className="bg-teal-600 hover:bg-teal-700 text-white gap-2">
              <Plus className="w-4 h-4" /> إضافة رصيد أسبوعي
            </Button>
          )}
        </div>
      </div>

      {/* Records */}
      {isLoading ? (
        <Card className="p-8 text-center text-gray-400">جاري التحميل...</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-gray-400">لا توجد سجلات رصيد بعد</Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <Badge className="bg-teal-100 text-teal-700 border-0 mb-1">{s.branch}</Badge>
                  <p className="text-sm text-gray-500">الفترة: {s.week_label}</p>
                </div>
                {canDelete && (
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-500" onClick={() => openEdit(s)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => setConfirmDeleteId(s.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" dir="rtl">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-right px-2 py-1.5 text-gray-500 font-semibold">الصنف</th>
                      <th className="text-center px-2 py-1.5 text-gray-500 font-semibold">الرصيد الفعلي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(s.sales || []).map((sale, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="px-2 py-1.5 font-medium text-gray-700">{sale.medicine_name}</td>
                        <td className="px-2 py-1.5 text-center text-teal-700 font-semibold">
                          {sale.balance !== undefined && sale.balance !== null ? sale.balance : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Confirm delete */}
      <ConfirmDialog
        open={!!confirmDeleteId}
        onOpenChange={(o) => { if (!o) setConfirmDeleteId(null); }}
        title="تأكيد الحذف"
        description="هل أنت متأكد من حذف هذا السجل؟"
        onConfirm={() => { deleteMutation.mutate(confirmDeleteId); setConfirmDeleteId(null); }}
        confirmLabel="حذف"
      />

      {/* Edit dialog */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>تعديل الرصيد الفعلي</DialogTitle></DialogHeader>
          {editRecord && (
            <div className="space-y-4">
              <div className="flex gap-3 text-sm text-gray-600">
                <Badge className="bg-teal-100 text-teal-700 border-0">{editRecord.branch}</Badge>
                <span>{editRecord.week_label}</span>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-gray-500 border-b pb-1">
                  <span>الصنف</span>
                  <span className="text-center">الرصيد الفعلي</span>
                </div>
                {editBalances.map((sale, idx) => (
                  <div key={idx} className="grid grid-cols-2 gap-2 items-center">
                    <span className="text-sm font-medium text-gray-700">{sale.medicine_name}</span>
                    <Input
                      type="number" min="0" step="any"
                      value={sale.balance}
                      onChange={(e) => {
                        const updated = [...editBalances];
                        updated[idx] = { ...updated[idx], balance: e.target.value };
                        setEditBalances(updated);
                      }}
                      className="h-8 text-center text-sm"
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 flex-row-reverse">
            <Button className="bg-teal-600 hover:bg-teal-700" onClick={handleEditSubmit} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "جاري الحفظ..." : "حفظ التعديلات"}
            </Button>
            <Button variant="outline" onClick={() => setEditDialog(false)}>إلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>إضافة رصيد أسبوعي</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label>الفرع *</Label>
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger className={submitAttempted && !branch ? "border-red-500" : ""}>
                  <SelectValue placeholder="اختر الفرع" />
                </SelectTrigger>
                <SelectContent>
                  {BRANCHES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
              {submitAttempted && !branch && <p className="text-xs text-red-500">الفرع مطلوب</p>}
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-gray-500 border-b pb-1">
                <span>الصنف</span>
                <span className="text-center">الرصيد الفعلي</span>
              </div>
              {activeItems.length === 0 ? (
                <p className="text-sm text-gray-400">لا توجد أصناف — أضفها من تبويب إدارة الأصناف</p>
              ) : (
                activeItems.map((item) => (
                  <div key={item.id} className="grid grid-cols-2 gap-2 items-center">
                    <div>
                      <span className="text-sm font-medium text-gray-700">{item.name}</span>
                      {item.item_code && <p className="text-xs text-teal-600 font-mono">{item.item_code}</p>}
                    </div>
                    <Input
                      type="number" min="0" step="any"
                      value={balances[item.id] ?? ""}
                      onChange={(e) => setBalances((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      className="h-8 text-center text-sm"
                      placeholder="0"
                    />
                  </div>
                ))
              )}
            </div>

            <DialogFooter className="gap-2 flex-row-reverse">
              <Button type="submit" className="bg-teal-600 hover:bg-teal-700" disabled={createMutation.isPending}>
                {createMutation.isPending ? "جاري الحفظ..." : "حفظ"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}