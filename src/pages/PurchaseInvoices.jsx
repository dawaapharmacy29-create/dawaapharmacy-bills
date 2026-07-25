import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Trash2, CheckSquare, ChevronLeft, ChevronRight, Ban, Tag, ArrowRightLeft, Store, Pill } from "lucide-react";
import InvoiceTable from "@/components/invoices/InvoiceTable";
import InvoiceFormDialog from "@/components/invoices/InvoiceFormDialog";
import InvoiceViewDialog from "@/components/invoices/InvoiceViewDialog";
import ConfirmDialog from "@/components/invoices/ConfirmDialog";
import BulkExcludeDialog from "@/components/invoices/BulkExcludeDialog";
import BulkCategoryDialog from "@/components/invoices/BulkCategoryDialog";
import InvoiceStats from "@/components/invoices/InvoiceStats";
import { logActivity } from "@/lib/activityLogger";
import { useUserRole } from "@/lib/useUserRole";
import { CATEGORY_LABELS, TRANSACTION_TYPE_LABELS, isInvoiceExcluded } from "@/lib/purchaseCalculations";

const BRANCHES = ["دواء شكري", "دواء الشامي"];

const CATEGORY_OPTIONS = [
  { value: "الكل", label: "كل التصنيفات" },
  { value: "medicines", label: CATEGORY_LABELS.medicines },
  { value: "supplies_accessories", label: CATEGORY_LABELS.supplies_accessories },
  { value: "unclassified", label: CATEGORY_LABELS.unclassified },
];

const TRANSACTION_OPTIONS = [
  { value: "الكل", label: "كل الأنواع" },
  { value: "external_purchase", label: TRANSACTION_TYPE_LABELS.external_purchase },
  { value: "internal_transfer", label: TRANSACTION_TYPE_LABELS.internal_transfer },
];

const NET_MODE_OPTIONS = [
  { value: "الكل", label: "الكل (محتسبة + مستثناة)" },
  { value: "included", label: "محتسبة فقط" },
  { value: "excluded", label: "مستثناة فقط" },
];

export default function PurchaseInvoices() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [viewInvoice, setViewInvoice] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [filterBranch, setFilterBranch] = useState("الكل");
  const [filterSupplier, setFilterSupplier] = useState("الكل");
  const [filterCategory, setFilterCategory] = useState("الكل");
  const [filterTransactionType, setFilterTransactionType] = useState("الكل");
  const [filterNetMode, setFilterNetMode] = useState("الكل");
  const [filterSourceBranch, setFilterSourceBranch] = useState("الكل");
  const [filterDestBranch, setFilterDestBranch] = useState("الكل");
  const [filterManualException, setFilterManualException] = useState(false);
  const [filterReviewNeeded, setFilterReviewNeeded] = useState(false);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmExclude, setConfirmExclude] = useState(false);
  const [confirmCategory, setConfirmCategory] = useState(false);
  const [singleDeleteId, setSingleDeleteId] = useState(null);
  const [activeMonthOffset, setActiveMonthOffset] = useState(0); // 0 = الشهر الحالي، -1 = السابق، null = لا يوجد
  const queryClient = useQueryClient();

  // حساب أزرار الشهور: الشهر الحالي + الشهرين السابقين
  const monthButtons = Array.from({ length: 3 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const year = d.getFullYear();
    const month = d.getMonth();
    const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const to = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const label = d.toLocaleDateString("ar-EG", { month: "long", year: "numeric" });
    return { offset: -i, from, to, label };
  });

  const selectMonth = (btn) => {
    if (activeMonthOffset === btn.offset) {
      // إلغاء الاختيار
      setActiveMonthOffset(null);
      setDateFrom("");
      setDateTo("");
    } else {
      setActiveMonthOffset(btn.offset);
      setDateFrom(btn.from);
      setDateTo(btn.to);
    }
  };
  const { canSaveInvoice, canDeleteInvoice } = useUserRole();

  // Real-time: تحديث تلقائي عند أي تغيير
  useEffect(() => {
    let timeout;
    const unsub = base44.entities.PurchaseInvoice.subscribe(() => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
        queryClient.invalidateQueries({ queryKey: ["pending-invoices-count"] });
      }, 800);
    });
    return () => { unsub(); clearTimeout(timeout); };
  }, []);

  // نحمل الكل مرة واحدة لكن مع keepPreviousData لمنع الوميض
  const { data: invoices = [], isLoading, isFetching } = useQuery({
    queryKey: ["purchase-invoices"],
    queryFn: async () => {
      const PAGE = 500;
      let all = [];
      let page = 0;
      while (true) {
        const batch = await base44.entities.PurchaseInvoice.list("-created_date", PAGE, page * PAGE);
        all = [...all, ...batch];
        if (batch.length < PAGE) break;
        page++;
      }
      return all;
    },
    staleTime: 60000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => base44.entities.Supplier.list(),
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const inv = await base44.entities.PurchaseInvoice.create(data);
      await logActivity({ action_type: "create", entity_type: "invoice", entity_id: inv?.id, entity_label: data.system_invoice_number, details: `إنشاء فاتورة ${data.system_invoice_number}` });
      return inv;
    },
    onSuccess: (inv) => {
      // تحديث ذكي: أضف الفاتورة الجديدة للكاش مباشرة بدلاً من إعادة تحميل الكل
      queryClient.setQueryData(["purchase-invoices"], (old = []) => [inv, ...old]);
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
      queryClient.invalidateQueries({ queryKey: ["pending-invoices-count"] });
      setDialogOpen(false);
    },
  });
  const updateMutation = useMutation({
    mutationFn: async ({ id, data, batch_id, change_type, reason }) => {
      const oldInv = invoices.find((i) => i.id === id) || {};
      await base44.entities.PurchaseInvoice.update(id, data);
      const trackedFields = ["total_value", "paid_value", "returned_value", "supplier_name", "branch", "payment_type", "purchase_category", "net_purchase_mode", "exclusion_reason", "status"];
      const changes = trackedFields.filter(f => data[f] !== undefined && JSON.stringify(data[f]) !== JSON.stringify(oldInv[f]));
      if (changes.length > 0) {
        const oldVals = changes.map(f => `${f}: ${JSON.stringify(oldInv[f])}`).join(" | ");
        const newVals = changes.map(f => `${f}: ${JSON.stringify(data[f])}`).join(" | ");
        await logActivity({
          action_type: change_type || "update",
          entity_type: "invoice",
          entity_id: id,
          record_id: id,
          entity_label: oldInv.system_invoice_number || data.system_invoice_number || id,
          old_value: oldVals,
          new_value: newVals,
          batch_id: batch_id || "",
          reason: reason || "",
          details: changes.includes("net_purchase_mode") ? `تغيير الاستثناء: ${oldInv.net_purchase_mode} → ${data.net_purchase_mode}`
            : changes.includes("purchase_category") ? `تغيير التصنيف: ${oldInv.purchase_category} → ${data.purchase_category}`
            : changes.includes("branch") ? `تغيير الفرع: ${oldInv.branch} → ${data.branch}`
            : changes.includes("supplier_name") ? `تغيير المورد: ${oldInv.supplier_name} → ${data.supplier_name}`
            : changes.includes("total_value") ? `تغيير القيمة: ${oldInv.total_value} → ${data.total_value}`
            : changes.includes("paid_value") ? `تغيير المدفوع: ${oldInv.paid_value} → ${data.paid_value}`
            : `تعديل: ${changes.join(", ")}`,
        });
      }
      return { id, data };
    },
    onSuccess: ({ id, data }) => {
      // تحديث ذكي: عدّل الفاتورة في الكاش مباشرة بدلاً من إعادة تحميل الكل
      queryClient.setQueryData(["purchase-invoices"], (old = []) =>
        old.map((inv) => (inv.id === id ? { ...inv, ...data } : inv))
      );
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
      setDialogOpen(false);
      setEditingInvoice(null);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const inv = invoices.find((i) => i.id === id);
      await logActivity({ action_type: "delete", entity_type: "invoice", entity_id: id, entity_label: inv?.system_invoice_number || id, details: `حذف فاتورة ${inv?.system_invoice_number || ""}` });
      await base44.entities.PurchaseInvoice.delete(id);
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData(["purchase-invoices"], (old = []) => old.filter((inv) => inv.id !== id));
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
      setSelectedIds((prev) => prev.filter((s) => s !== id));
    },
  });

  const handleSubmit = (formData) => {
    if (editingInvoice) updateMutation.mutate({ id: editingInvoice.id, data: formData });
    else createMutation.mutate(formData);
  };

  // Bulk actions
  const executeBulkDelete = () => {
    selectedIds.forEach((id) => deleteMutation.mutate(id));
    setSelectedIds([]);
  };

  const executeSingleDelete = () => {
    if (singleDeleteId) deleteMutation.mutate(singleDeleteId);
    setSingleDeleteId(null);
  };

  const executeBulkSave = () => {
    const batchId = `bulk-save-${Date.now()}`;
    selectedIds.forEach((id) => {
      const inv = invoices.find((i) => i.id === id);
      if (inv) updateMutation.mutate({ id, data: { ...inv, status: "يتم الحفظ" }, batch_id: batchId, change_type: "status_change", reason: "حفظ جماعي" });
    });
    setSelectedIds([]);
  };

  const executeBulkExclude = ({ exclusion_reason, exclusion_note }) => {
    const batchId = `bulk-exclude-${Date.now()}`;
    selectedIds.forEach((id) => {
      const inv = invoices.find((i) => i.id === id);
      if (inv) updateMutation.mutate({
        id,
        data: { ...inv, net_purchase_mode: "exclude", exclusion_reason, exclusion_note },
        batch_id: batchId,
        change_type: "exclusion_change",
        reason: exclusion_reason || "استثناء جماعي",
      });
    });
    setSelectedIds([]);
    setConfirmExclude(false);
  };

  const executeBulkCategory = ({ purchase_category, purchase_category_source }) => {
    const batchId = `bulk-category-${Date.now()}`;
    selectedIds.forEach((id) => {
      const inv = invoices.find((i) => i.id === id);
      if (inv) updateMutation.mutate({
        id,
        data: { ...inv, purchase_category, purchase_category_source },
        batch_id: batchId,
        change_type: "category_change",
        reason: "تغيير تصنيف جماعي",
      });
    });
    setSelectedIds([]);
    setConfirmCategory(false);
  };

  // تصنيف جماعي كأدوية
  const executeBulkMedicines = () => {
    const batchId = `bulk-medicines-${Date.now()}`;
    selectedIds.forEach((id) => {
      const inv = invoices.find((i) => i.id === id);
      if (inv) updateMutation.mutate({
        id,
        data: { ...inv, purchase_category: "medicines", purchase_category_source: "bulk_update" },
        batch_id: batchId,
        change_type: "category_change",
        reason: "تصنيف جماعي كأدوية",
      });
    });
    setSelectedIds([]);
  };

  // تصنيف جماعي كمستلزمات
  const executeBulkSupplies = () => {
    const batchId = `bulk-supplies-${Date.now()}`;
    selectedIds.forEach((id) => {
      const inv = invoices.find((i) => i.id === id);
      if (inv) updateMutation.mutate({
        id,
        data: { ...inv, purchase_category: "supplies_accessories", purchase_category_source: "bulk_update" },
        batch_id: batchId,
        change_type: "category_change",
        reason: "تصنيف جماعي كمستلزمات",
      });
    });
    setSelectedIds([]);
  };

  // تطبيق إعداد المورد جماعيًا
  const executeBulkApplySupplierDefault = () => {
    const batchId = `bulk-supplier-default-${Date.now()}`;
    selectedIds.forEach((id) => {
      const inv = invoices.find((i) => i.id === id);
      if (!inv) return;
      const supplier = (inv.supplier_id && suppliers.find((s) => s.id === inv.supplier_id)) || suppliers.find((s) => s.name === inv.supplier_name);
      const defaultCat = supplier?.default_purchase_category;
      if (defaultCat === "medicines" || defaultCat === "supplies_accessories") {
        updateMutation.mutate({
          id,
          data: { ...inv, purchase_category: defaultCat, purchase_category_source: "supplier_bulk_apply" },
          batch_id: batchId,
          change_type: "category_change",
          reason: "تطبيق إعداد المورد جماعيًا",
        });
      }
    });
    setSelectedIds([]);
  };

  // تحويل جماعي لشراء خارجي
  const executeBulkExternal = () => {
    const batchId = `bulk-external-${Date.now()}`;
    selectedIds.forEach((id) => {
      const inv = invoices.find((i) => i.id === id);
      if (inv) updateMutation.mutate({
        id,
        data: { ...inv, transaction_type: "external_purchase", source_branch: "", destination_branch: "" },
        batch_id: batchId,
        change_type: "update",
        reason: "تحويل جماعي لشراء خارجي",
      });
    });
    setSelectedIds([]);
  };

  // إلغاء الاستبعاد جماعيًا
  const executeBulkInclude = () => {
    const batchId = `bulk-include-${Date.now()}`;
    selectedIds.forEach((id) => {
      const inv = invoices.find((i) => i.id === id);
      if (inv) updateMutation.mutate({
        id,
        data: { ...inv, net_purchase_mode: "include", exclusion_reason: "", exclusion_note: "", excluded_by: "", excluded_at: "" },
        batch_id: batchId,
        change_type: "exclusion_change",
        reason: "إلغاء الاستبعاد جماعيًا",
      });
    });
    setSelectedIds([]);
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

  const uniqueSuppliers = [...new Set(invoices.map((i) => i.supplier_name).filter(Boolean))];

  const filtered = invoices.filter((i) => {
    const branchMatch = filterBranch === "الكل" || i.branch === filterBranch;
    const supplierMatch = filterSupplier === "الكل" || i.supplier_name === filterSupplier;
    const categoryMatch = filterCategory === "الكل" || (i.purchase_category || "unclassified") === filterCategory;
    const transactionMatch = filterTransactionType === "الكل" || (i.transaction_type || "external_purchase") === filterTransactionType;
    const exclusion = isInvoiceExcluded(i, suppliers);
    const netModeMatch = filterNetMode === "الكل" || (filterNetMode === "excluded" ? exclusion.excluded : !exclusion.excluded);
    const sourceBranchMatch = filterSourceBranch === "الكل" || i.source_branch === filterSourceBranch;
    const destBranchMatch = filterDestBranch === "الكل" || i.destination_branch === filterDestBranch;
    const manualExceptionMatch = !filterManualException || i.purchase_category_source === "manual";
    // review needed: source=dest, or incomplete transfer, or mixed supplier unclassified
    const supplier = (i.supplier_id && suppliers.find((s) => s.id === i.supplier_id)) || suppliers.find((s) => s.name === i.supplier_name);
    const reviewNeeded = (i.source_branch && i.destination_branch && i.source_branch === i.destination_branch)
      || (i.transaction_type === "internal_transfer" && (!i.source_branch || !i.destination_branch))
      || (supplier?.default_purchase_category === "mixed" && (!i.purchase_category || i.purchase_category === "unclassified"))
      || (!i.supplier_id || !supplier);
    const reviewNeededMatch = !filterReviewNeeded || reviewNeeded;
    const searchMatch = !search || i.system_invoice_number?.includes(search) || i.supplier_name?.includes(search) || i.supplier_invoice_number?.includes(search);
    const dateKey = i.invoice_date || i.created_date?.split("T")[0];
    const fromMatch = !dateFrom || (dateKey && dateKey >= dateFrom);
    const toMatch = !dateTo || (dateKey && dateKey <= dateTo);
    return branchMatch && supplierMatch && categoryMatch && transactionMatch && netModeMatch && sourceBranchMatch && destBranchMatch && manualExceptionMatch && reviewNeededMatch && searchMatch && fromMatch && toMatch;
  });

  const hasFilters = filterBranch !== "الكل" || filterSupplier !== "الكل" || filterCategory !== "الكل" || filterTransactionType !== "الكل" || filterNetMode !== "الكل" || filterSourceBranch !== "الكل" || filterDestBranch !== "الكل" || filterManualException || filterReviewNeeded || search || dateFrom || dateTo;

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-800">فواتير الشراء</h1>
          <p className="text-gray-500 text-sm mt-0.5">{filtered.length} من {invoices.length} فاتورة</p>
        </div>
        {canSaveInvoice && (
          <Button onClick={() => { setEditingInvoice(null); setDialogOpen(true); }} className="bg-teal-600 hover:bg-teal-700 text-white gap-2">
            <Plus className="w-4 h-4" /> إضافة فاتورة
          </Button>
        )}
      </div>

      <InvoiceStats invoices={invoices} />

      {/* Month Buttons */}
      <div className="flex gap-2 flex-wrap">
        {monthButtons.map((btn) => (
          <button
            key={btn.offset}
            onClick={() => selectMonth(btn)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              activeMonthOffset === btn.offset
                ? "bg-teal-600 text-white border-teal-600"
                : "bg-white text-gray-600 border-gray-300 hover:border-teal-400"
            }`}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* Filters Row */}
      <div className="bg-white rounded-lg border p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 items-center">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="absolute right-3 top-2.5 w-4 h-4 text-gray-400" />
            <Input placeholder="بحث برقم الفاتورة أو المورد..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9 h-9" />
          </div>
          <Select value={filterSupplier} onValueChange={setFilterSupplier}>
            <SelectTrigger className="h-9"><SelectValue placeholder="كل الموردين" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="الكل">كل الموردين</SelectItem>
              {uniqueSuppliers.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="h-9"><SelectValue placeholder="التصنيف" /></SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterTransactionType} onValueChange={setFilterTransactionType}>
            <SelectTrigger className="h-9"><SelectValue placeholder="نوع العملية" /></SelectTrigger>
            <SelectContent>
              {TRANSACTION_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterNetMode} onValueChange={setFilterNetMode}>
            <SelectTrigger className="h-9"><SelectValue placeholder="حالة الصافي" /></SelectTrigger>
            <SelectContent>
              {NET_MODE_OPTIONS.map((n) => <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterSourceBranch} onValueChange={setFilterSourceBranch}>
            <SelectTrigger className="h-9"><SelectValue placeholder="الفرع المصدر" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="الكل">كل المصادر</SelectItem>
              {BRANCHES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterDestBranch} onValueChange={setFilterDestBranch}>
            <SelectTrigger className="h-9"><SelectValue placeholder="الفرع المستلم" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="الكل">كل المستلمين</SelectItem>
              {BRANCHES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setFilterManualException(!filterManualException)}
              className={`px-3 py-1.5 rounded-full font-medium border transition-colors ${filterManualException ? "bg-amber-600 text-white border-amber-600" : "bg-white text-gray-600 border-gray-200 hover:border-amber-300"}`}
            >
              استثناء يدوي
            </button>
            <button
              onClick={() => setFilterReviewNeeded(!filterReviewNeeded)}
              className={`px-3 py-1.5 rounded-full font-medium border transition-colors ${filterReviewNeeded ? "bg-red-600 text-white border-red-600" : "bg-white text-gray-600 border-gray-200 hover:border-red-300"}`}
            >
              تحتاج مراجعة
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-sm text-gray-600">
            <span className="whitespace-nowrap">من:</span><Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setActiveMonthOffset(null); }} className="h-9 flex-1" />
          </div>
          <div className="flex items-center gap-1.5 text-sm text-gray-600">
            <span className="whitespace-nowrap">إلى:</span><Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setActiveMonthOffset(null); }} className="h-9 flex-1" />
          </div>
          {hasFilters && (
            <button onClick={() => { setDateFrom(""); setDateTo(""); setSearch(""); setFilterBranch("الكل"); setFilterSupplier("الكل"); setFilterCategory("الكل"); setFilterTransactionType("الكل"); setFilterNetMode("الكل"); setFilterSourceBranch("الكل"); setFilterDestBranch("الكل"); setFilterManualException(false); setFilterReviewNeeded(false); setActiveMonthOffset(null); }} className="text-xs text-red-500 hover:underline whitespace-nowrap sm:col-span-2 lg:col-span-1">
              مسح الكل
            </button>
          )}
        </div>

        {/* Branch Filter */}
        <div className="flex gap-2 flex-wrap">
          {["الكل", ...BRANCHES].map((b) => (
            <button key={b} onClick={() => setFilterBranch(b)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filterBranch === b ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-600 border-gray-200 hover:border-teal-300"}`}>
              {b}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-teal-50 border border-teal-200 rounded-lg px-4 py-2.5">
          <span className="text-sm font-semibold text-teal-700">تم تحديد {selectedIds.length} فاتورة</span>
          <div className="flex gap-2 sm:mr-auto flex-wrap">
            {canSaveInvoice && (
              <Button size="sm" variant="outline" className="border-teal-400 text-teal-700 hover:bg-teal-50 gap-1.5" onClick={executeBulkMedicines} title="تصنيف كأدوية">
                <Pill className="w-3.5 h-3.5" /> أدوية
              </Button>
            )}
            {canSaveInvoice && (
              <Button size="sm" variant="outline" className="border-indigo-400 text-indigo-700 hover:bg-indigo-50 gap-1.5" onClick={executeBulkSupplies} title="تصنيف كمستلزمات">
                <Tag className="w-3.5 h-3.5" /> مستلزمات
              </Button>
            )}
            {canSaveInvoice && (
              <Button size="sm" variant="outline" className="border-cyan-400 text-cyan-700 hover:bg-cyan-50 gap-1.5" onClick={executeBulkApplySupplierDefault} title="تطبيق إعداد المورد">
                <Store className="w-3.5 h-3.5" /> إعداد المورد
              </Button>
            )}
            {canSaveInvoice && (
              <Button size="sm" variant="outline" className="border-purple-400 text-purple-700 hover:bg-purple-50 gap-1.5" onClick={() => {
                const batchId = `bulk-internal-${Date.now()}`;
                selectedIds.forEach((id) => {
                  const inv = invoices.find((i) => i.id === id);
                  if (inv) {
                    const supplier = (inv.supplier_id && suppliers.find((s) => s.id === inv.supplier_id)) || suppliers.find((s) => s.name === inv.supplier_name);
                    const linked = supplier?.linked_branch;
                    if (supplier?.supplier_type === "internal_branch" && linked && linked !== inv.branch) {
                      updateMutation.mutate({
                        id,
                        data: { ...inv, transaction_type: "internal_transfer", source_branch: linked, destination_branch: inv.branch, transaction_type_source: "supplier_auto" },
                        batch_id: batchId,
                        change_type: "update",
                        reason: "تحويل جماعي لتحويل داخلي",
                      });
                    }
                  }
                });
                setSelectedIds([]);
              }} title="تحويل إلى تحويل داخلي">
                <ArrowRightLeft className="w-3.5 h-3.5" /> تحويل داخلي
              </Button>
            )}
            {canSaveInvoice && (
              <Button size="sm" variant="outline" className="border-blue-400 text-blue-700 hover:bg-blue-50 gap-1.5" onClick={executeBulkExternal} title="تحويل إلى شراء خارجي">
                <Store className="w-3.5 h-3.5" /> شراء خارجي
              </Button>
            )}
            {canSaveInvoice && (
              <Button size="sm" variant="outline" className="border-green-400 text-green-700 hover:bg-green-50 gap-1.5" onClick={executeBulkInclude} title="إلغاء الاستبعاد">
                <CheckSquare className="w-3.5 h-3.5" /> إدراج
              </Button>
            )}
            {canSaveInvoice && (
              <Button size="sm" variant="outline" className="border-amber-400 text-amber-700 hover:bg-amber-50 gap-1.5" onClick={() => setConfirmExclude(true)}>
                <Ban className="w-3.5 h-3.5" /> استثناء
              </Button>
            )}
            {canSaveInvoice && (
              <Button size="sm" variant="outline" className="border-green-400 text-green-700 hover:bg-green-50 gap-1.5" onClick={() => setConfirmSave(true)}>
                <CheckSquare className="w-3.5 h-3.5" /> حفظ
              </Button>
            )}
            {canSaveInvoice && (
              <Button size="sm" variant="outline" className="border-indigo-400 text-indigo-700 hover:bg-indigo-50 gap-1.5" onClick={() => setConfirmCategory(true)}>
                <Tag className="w-3.5 h-3.5" /> تصنيف
              </Button>
            )}
            {canDeleteInvoice && (
              <Button size="sm" variant="outline" className="border-red-400 text-red-600 hover:bg-red-50 gap-1.5" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="w-3.5 h-3.5" /> حذف
              </Button>
            )}
            <button className="text-xs text-gray-500 hover:underline" onClick={() => setSelectedIds([])}>إلغاء</button>
          </div>
        </div>
      )}

      <InvoiceTable
        key={`${filterBranch}-${filterSupplier}-${filterCategory}-${filterTransactionType}-${filterNetMode}-${search}-${dateFrom}-${dateTo}`}
        invoices={filtered}
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
        onSubmit={handleSubmit}
        invoice={editingInvoice}
        isLoading={createMutation.isPending || updateMutation.isPending}
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

      <BulkExcludeDialog
        open={confirmExclude}
        onOpenChange={setConfirmExclude}
        count={selectedIds.length}
        onConfirm={executeBulkExclude}
      />

      <BulkCategoryDialog
        open={confirmCategory}
        onOpenChange={setConfirmCategory}
        count={selectedIds.length}
        onConfirm={executeBulkCategory}
      />
    </div>
  );
}