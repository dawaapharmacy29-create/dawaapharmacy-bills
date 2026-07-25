import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Trash2, CheckSquare, ClipboardList } from "lucide-react";
import InvoiceTable from "@/components/invoices/InvoiceTable";
import InvoiceViewDialog from "@/components/invoices/InvoiceViewDialog";
import InvoiceFormDialog from "@/components/invoices/InvoiceFormDialog";
import ConfirmDialog from "@/components/invoices/ConfirmDialog";
import { logActivity } from "@/lib/activityLogger";
import { useUserRole } from "@/lib/useUserRole";

export default function PendingInvoices() {
  const [selectedIds, setSelectedIds] = useState([]);
  const [viewInvoice, setViewInvoice] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [singleDeleteId, setSingleDeleteId] = useState(null);

  const qc = useQueryClient();
  const { canSaveInvoice, canDeleteInvoice } = useUserRole();

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["purchase-invoices"],
    queryFn: () => base44.entities.PurchaseInvoice.list("-created_date"),
  });

  const pending = invoices.filter((i) => i.status === "انتظار المراجعة");

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.PurchaseInvoice.update(id, data),
    onSuccess: (_, { data }) => {
      qc.invalidateQueries({ queryKey: ["purchase-invoices"] });
      setDialogOpen(false);
      setEditingInvoice(null);
      logActivity({ action_type: "update", entity_type: "invoice", entity_id: _.id, entity_label: data.system_invoice_number, details: `تعديل فاتورة` });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.PurchaseInvoice.delete(id),
    onSuccess: (_, id) => {
      qc.setQueryData(["purchase-invoices"], (old = []) => old.filter((inv) => inv.id !== id));
      setSelectedIds((prev) => prev.filter((s) => s !== id));
      logActivity({ action_type: "delete", entity_type: "invoice", entity_id: id, entity_label: id, details: `حذف فاتورة` });
    },
  });

  const executeBulkSave = () => {
    selectedIds.forEach((id) => {
      const inv = pending.find((i) => i.id === id);
      if (inv) updateMutation.mutate({ id, data: { ...inv, status: "يتم الحفظ" } });
    });
    setSelectedIds([]);
  };

  const executeBulkDelete = () => {
    selectedIds.forEach((id) => deleteMutation.mutate(id));
    setSelectedIds([]);
  };

  const executeSingleDelete = () => {
    if (singleDeleteId) deleteMutation.mutate(singleDeleteId);
    setSingleDeleteId(null);
  };

  const handleToggleSelect = (id) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
  };

  const handleToggleAll = (checked, rows) => {
    if (checked) setSelectedIds(rows.map((r) => r.id));
    else setSelectedIds([]);
  };

  const handleView = (inv) => { setViewInvoice(inv); setViewOpen(true); };
  const handleEdit = (inv) => { setEditingInvoice(inv); setDialogOpen(true); };
  const handleSingleDelete = (id) => { setSingleDeleteId(id); setConfirmDelete(true); };

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-yellow-100 rounded-lg shrink-0">
            <ClipboardList className="w-5 h-5 text-yellow-700" />
          </div>
          <div>
            <h1 className="text-lg md:text-2xl font-bold text-gray-800">فواتير تنتظر المراجعة</h1>
            <p className="text-gray-500 text-sm mt-0.5">{pending.length} فاتورة في انتظار المراجعة</p>
          </div>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2.5">
          <span className="text-sm font-semibold text-yellow-700">تم تحديد {selectedIds.length} فاتورة</span>
          <div className="flex gap-2 sm:mr-auto">
            {canSaveInvoice && (
              <Button size="sm" variant="outline" className="border-green-400 text-green-700 hover:bg-green-50 gap-1.5" onClick={() => setConfirmSave(true)}>
                <CheckSquare className="w-3.5 h-3.5" /> <span className="hidden sm:inline">تحويل إلى</span> "يتم الحفظ"
              </Button>
            )}
            {canDeleteInvoice && (
              <Button size="sm" variant="outline" className="border-red-400 text-red-600 hover:bg-red-50 gap-1.5" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="w-3.5 h-3.5" /> حذف المحدد
              </Button>
            )}
            <button className="text-xs text-gray-500 hover:underline" onClick={() => setSelectedIds([])}>إلغاء</button>
          </div>
        </div>
      )}

      <InvoiceTable
        invoices={pending}
        isLoading={isLoading}
        onEdit={handleEdit}
        onDelete={handleSingleDelete}
        onView={handleView}
        selectedIds={selectedIds}
        onToggleSelect={handleToggleSelect}
        onToggleAll={handleToggleAll}
      />

      <InvoiceFormDialog
        open={dialogOpen}
        onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingInvoice(null); }}
        onSubmit={(formData) => { if (editingInvoice) updateMutation.mutate({ id: editingInvoice.id, data: formData }); }}
        invoice={editingInvoice}
        isLoading={updateMutation.isPending}
        allInvoices={invoices}
      />

      <InvoiceViewDialog
        open={viewOpen}
        onOpenChange={setViewOpen}
        invoice={viewInvoice}
        onEdit={canSaveInvoice ? handleEdit : null}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(o) => { setConfirmDelete(o); if (!o) setSingleDeleteId(null); }}
        title="تأكيد الحذف"
        description={singleDeleteId ? "هل أنت متأكد من حذف هذه الفاتورة؟" : `هل أنت متأكد من حذف ${selectedIds.length} فاتورة؟`}
        onConfirm={singleDeleteId ? executeSingleDelete : executeBulkDelete}
        confirmLabel="حذف"
      />

      <ConfirmDialog
        open={confirmSave}
        onOpenChange={setConfirmSave}
        title="تأكيد التحويل"
        description={`هل أنت متأكد من تحويل ${selectedIds.length} فاتورة إلى "يتم الحفظ"؟`}
        onConfirm={executeBulkSave}
        confirmLabel="تحويل"
        confirmClass="bg-green-600 hover:bg-green-700"
      />
    </div>
  );
}