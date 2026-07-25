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

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const TODAY = new Date().toISOString().split("T")[0];

export default function MedicineSalesTab() {
  const qc = useQueryClient();
  const { isAdmin, isManager } = useUserRole();
  const canAdd = isAdmin || isManager;
  const canDelete = isAdmin || isManager;

  // Add sales dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [branch, setBranch] = useState("");
  const [dateFrom, setDateFrom] = useState(TODAY);
  const [dateTo, setDateTo] = useState(TODAY);
  const [quantities, setQuantities] = useState({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Edit sales dialog
  const [editDialog, setEditDialog] = useState(false);
  const [editRecord, setEditRecord] = useState(null);
  const [editSales, setEditSales] = useState([]);

  // Balance dialog (مستقل)
  const [balanceDialog, setBalanceDialog] = useState(false);
  const [balanceRecord, setBalanceRecord] = useState(null);
  const [balances, setBalances] = useState([]);

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [filterBranch, setFilterBranch] = useState("الكل");

  const { data: settings = [] } = useQuery({
    queryKey: ["report-settings"],
    queryFn: () => base44.entities.ReportSettings.list(),
    staleTime: 30000,
  });

  const displayFrom = settings.find((s) => s.key === "medicine_display_from")?.value || "";
  const displayTo   = settings.find((s) => s.key === "medicine_display_to")?.value   || "";

  const { data: items = [] } = useQuery({
    queryKey: ["medicine-items"],
    queryFn: () => base44.entities.MedicineItem.list("name"),
    staleTime: 60000,
  });

  const { data: sales = [], isLoading } = useQuery({
    queryKey: ["medicine-sales"],
    queryFn: () => base44.entities.MedicineSale.list("-week_start", 500),
    staleTime: 15000,
  });

  const activeItems = items.filter((i) => i.is_active !== false);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.MedicineSale.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["medicine-sales"] }); setDialogOpen(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.MedicineSale.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["medicine-sales"] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.MedicineSale.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["medicine-sales"] });
      setEditDialog(false);
      setEditRecord(null);
      setBalanceDialog(false);
      setBalanceRecord(null);
    },
  });

  // ── Add dialog ──
  const openAddDialog = () => {
    setBranch("");
    setDateFrom(TODAY);
    setDateTo(TODAY);
    const initQ = {};
    activeItems.forEach((item) => { initQ[item.id] = ""; });
    setQuantities(initQ);
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
      quantity: quantities[item.id] === "" ? 0 : Number(quantities[item.id]),
    }));
    createMutation.mutate({ branch, week_start: dateFrom, week_label: `${dateFrom} → ${dateTo}`, sales: salesArr });
  };

  // ── Edit dialog ──
  const openEdit = (record) => {
    setEditRecord(record);
    const merged = activeItems.map((item) => {
      const existing = (record.sales || []).find(
        (s) => s.medicine_id === item.id || s.medicine_name === item.name
      );
      return { medicine_id: item.id, medicine_name: item.name, quantity: existing?.quantity ?? 0, balance: existing?.balance ?? "" };
    });
    setEditSales(merged);
    setEditDialog(true);
  };

  const handleEditSubmit = () => {
    const cleaned = editSales.map((s) => ({
      ...s,
      quantity: s.quantity === "" ? 0 : Number(s.quantity),
      balance: s.balance === "" ? "" : Number(s.balance),
    }));
    updateMutation.mutate({ id: editRecord.id, data: { ...editRecord, sales: cleaned } });
  };

  // ── Balance dialog ──
  const openBalanceDialog = (record) => {
    setBalanceRecord(record);
    const merged = activeItems.map((item) => {
      const existing = (record.sales || []).find(
        (s) => s.medicine_id === item.id || s.medicine_name === item.name
      );
      return {
        medicine_id: item.id,
        medicine_name: item.name,
        quantity: existing?.quantity ?? 0,
        balance: existing?.balance !== undefined && existing?.balance !== null ? existing.balance : "",
      };
    });
    setBalances(merged);
    setBalanceDialog(true);
  };

  const handleBalanceSubmit = () => {
    const cleaned = balances.map((s) => ({
      ...s,
      balance: s.balance === "" ? 0 : Number(s.balance),
    }));
    updateMutation.mutate({ id: balanceRecord.id, data: { ...balanceRecord, sales: cleaned } });
  };

  const filtered = useMemo(() => {
    return sales.filter((s) => {
      const inBranch = filterBranch === "الكل" || s.branch === filterBranch;
      const inRange  = displayFrom && displayTo
        ? s.week_start >= displayFrom && s.week_start <= displayTo
        : true;
      return inBranch && inRange;
    });
  }, [sales, filterBranch, displayFrom, displayTo]);

  return (
    <div className="space-y-4">
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
        {canAdd && (
          <Button onClick={openAddDialog} className="bg-teal-600 hover:bg-teal-700 text-white gap-2">
            <Plus className="w-4 h-4" /> إضافة مبيعات اللسته
          </Button>
        )}
      </div>

      {/* Records list */}
      {isLoading ? (
        <Card className="p-8 text-center text-gray-400">جاري التحميل...</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-gray-400">لا توجد سجلات لهذه الفترة</Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <Badge className="bg-teal-100 text-teal-700 border-0 mb-1">{s.branch}</Badge>
                  <p className="text-sm text-gray-500">الفترة: {s.week_label}</p>
                </div>
                <div className="flex gap-1 flex-wrap justify-end">

                  {canDelete && (
                    <>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-500" onClick={() => openEdit(s)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => setConfirmDeleteId(s.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" dir="rtl">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-right px-2 py-1.5 text-gray-500 font-semibold">الصنف</th>
                      <th className="text-center px-2 py-1.5 text-gray-500 font-semibold">وحدات البيع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(s.sales || []).map((sale, i) => {
                      const itemData = items.find((it) => it.id === sale.medicine_id);
                      return (
                        <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="px-2 py-1.5">
                            <div className="font-medium text-gray-700">{sale.medicine_name}</div>
                            {itemData?.item_code && <div className="text-xs text-teal-600 font-mono">{itemData.item_code}</div>}
                          </td>
                          <td className="px-2 py-1.5 text-center text-blue-700 font-semibold">{sale.quantity ?? 0}</td>
                        </tr>
                      );
                    })}
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

      {/* ── Balance dialog ── */}
      <Dialog open={balanceDialog} onOpenChange={setBalanceDialog}>
        <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>إدخال الرصيد الفعلي</DialogTitle></DialogHeader>
          {balanceRecord && (
            <div className="space-y-4">
              <div className="flex gap-3 text-sm text-gray-600">
                <Badge className="bg-teal-100 text-teal-700 border-0">{balanceRecord.branch}</Badge>
                <span>{balanceRecord.week_label}</span>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-gray-500 border-b pb-1">
                  <span>الصنف</span>
                  <span className="text-center">الرصيد الفعلي</span>
                </div>
                {balances.map((sale, idx) => (
                  <div key={idx} className="grid grid-cols-2 gap-2 items-center">
                    <span className="text-sm font-medium text-gray-700">{sale.medicine_name}</span>
                    <Input
                      type="number" min="0" step="any"
                      value={sale.balance}
                      onChange={(e) => {
                        const updated = [...balances];
                        updated[idx] = { ...updated[idx], balance: e.target.value };
                        setBalances(updated);
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
            <Button className="bg-green-600 hover:bg-green-700" onClick={handleBalanceSubmit} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "جاري الحفظ..." : "حفظ الرصيد"}
            </Button>
            <Button variant="outline" onClick={() => setBalanceDialog(false)}>إلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ── */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>تعديل سجل المبيعات</DialogTitle></DialogHeader>
          {editRecord && (
            <div className="space-y-4">
              <div className="flex gap-4 text-sm text-gray-600">
                <span className="font-medium">{editRecord.branch}</span>
                <span>{editRecord.week_label}</span>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-gray-500 border-b pb-1">
                  <span>الصنف</span>
                  <span className="text-center">وحدات البيع</span>
                </div>
                {editSales.map((sale, idx) => (
                  <div key={idx} className="grid grid-cols-2 gap-2 items-center">
                    <span className="text-sm font-medium text-gray-700">{sale.medicine_name}</span>
                    <Input
                      type="number" min="0" step="any"
                      value={sale.quantity}
                      onChange={(e) => {
                        const updated = [...editSales];
                        updated[idx] = { ...updated[idx], quantity: e.target.value };
                        setEditSales(updated);
                      }}
                      className="h-8 text-center text-sm"
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

      {/* ── Add dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>إضافة مبيعات اللسته</DialogTitle></DialogHeader>
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>من تاريخ *</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label>إلى تاريخ *</Label>
                <Input type="date" value={dateTo} min={dateFrom} onChange={(e) => setDateTo(e.target.value)} required />
              </div>
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-gray-500 border-b pb-1">
                <span>الصنف</span>
                <span className="text-center">وحدات البيع</span>
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
                      value={quantities[item.id] ?? ""}
                      onChange={(e) => setQuantities((prev) => ({ ...prev, [item.id]: e.target.value }))}
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