import { useEffect, useState, useRef } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { ChevronDown, X, AlertTriangle, ArrowRightLeft, Info, Loader2 } from "lucide-react";
import {
  BRANCHES,
  EXCLUSION_REASONS,
} from "@/lib/purchaseCalculations";
import { useInvoiceRulesResolver } from "@/hooks/useInvoiceRulesResolver";
import { findDuplicateSupplierInvoice, isFutureDate } from "@/lib/dataIntegrity";

function SearchableSelect({ value, onChange, options, placeholder, className = "" }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = options.filter((o) => o.toLowerCase().includes(search.toLowerCase()));
  const displayValue = value || "";

  return (
    <div className={`relative ${className}`} ref={ref}>
      <div
        className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm cursor-pointer hover:bg-accent/20"
        onClick={() => { setOpen((p) => !p); setSearch(""); }}
      >
        <span className={displayValue ? "text-foreground" : "text-muted-foreground"}>{displayValue || placeholder}</span>
        <div className="flex items-center gap-1">
          {value && (
            <X className="w-3 h-3 text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); onChange(""); setOpen(false); }} />
          )}
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
      </div>
      {open && (
        <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-md">
          <div className="p-1 border-b">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث..."
              className="w-full px-2 py-1 text-sm outline-none bg-transparent"
            />
          </div>
          <div className="max-h-44 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">لا توجد نتائج</p>
            ) : filtered.map((o) => (
              <div
                key={o}
                className={`px-2 py-1.5 text-sm rounded cursor-pointer hover:bg-accent hover:text-accent-foreground ${value === o ? "bg-accent font-medium" : ""}`}
                onClick={() => { onChange(o); setOpen(false); setSearch(""); }}
              >
                {o}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const emptyForm = {
  system_invoice_number: "",
  supplier_invoice_number: "",
  supplier_name: "",
  supplier_id: "",
  branch: "",
  entered_by: "",
  invoice_date: new Date().toISOString().split("T")[0],
  total_value: "",
  returned_value: "",
  payment_type: "",
  status: "انتظار المراجعة",
  notes: "",
  purchase_category: "",
  purchase_category_source: "",
  transaction_type: "external_purchase",
  net_purchase_mode: "inherit",
  exclusion_reason: "",
  exclusion_note: "",
  source_branch: "",
  destination_branch: "",
  cash_amount: "",
};

export default function InvoiceFormDialog({ open, onOpenChange, onSubmit, invoice, isLoading, allInvoices = [] }) {
  const [form, setForm] = useState(emptyForm);
  const [dupError, setDupError] = useState("");

  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: () => base44.entities.Supplier.list() });
  const { data: teamMembers = [] } = useQuery({ queryKey: ["team-members"], queryFn: () => base44.entities.TeamMember.list("name") });
  const branchMembers = teamMembers.filter((m) => (m.branches || []).includes(form.branch));

  useEffect(() => {
    if (invoice) {
      setForm({
        system_invoice_number: invoice.system_invoice_number || "",
        supplier_invoice_number: invoice.supplier_invoice_number || "",
        supplier_name: invoice.supplier_name || "",
        supplier_id: invoice.supplier_id || "",
        branch: invoice.branch || "",
        entered_by: invoice.entered_by || "",
        invoice_date: invoice.invoice_date || new Date().toISOString().split("T")[0],
        total_value: invoice.total_value !== undefined ? invoice.total_value : "",
        returned_value: invoice.returned_value !== undefined ? invoice.returned_value : "",
        payment_type: invoice.payment_type || "",
        status: invoice.status || "انتظار المراجعة",
        notes: invoice.notes || "",
        purchase_category: invoice.purchase_category || "",
        purchase_category_source: invoice.purchase_category_source || "",
        transaction_type: invoice.transaction_type || "external_purchase",
        net_purchase_mode: invoice.net_purchase_mode || "inherit",
        exclusion_reason: invoice.exclusion_reason || "",
        exclusion_note: invoice.exclusion_note || "",
        source_branch: invoice.source_branch || "",
        destination_branch: invoice.destination_branch || "",
        cash_amount: invoice.cash_amount !== undefined ? invoice.cash_amount : "",
      });
    } else {
      setForm(emptyForm);
    }
    setDupError("");
  }, [invoice, open]);

  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const selectedSupplier = suppliers.find((s) => s.name === form.supplier_name);
  const supplierExcluded = selectedSupplier?.exclude_from_net_purchases;

  // استدعاء قواعد الموردين من الـ Backend عند تغيير المورد أو الفرع
  const { resolution, isLoading: isResolving } = useInvoiceRulesResolver({
    supplierId: form.supplier_id,
    branch: form.branch,
    currentCategory: form.purchase_category,
    categorySource: form.purchase_category_source,
    currentTransactionType: form.transaction_type,
    enabled: open,
  });

  // تطبيق نتيجة القواعد على الفورم (مع الحفاظ على الاستثناء اليدوي)
  useEffect(() => {
    if (!resolution || !form.supplier_id || !form.branch) {
      return;
    }

    // إذا كان الاستثناء يدويًا محفوظًا، لا نغير التصنيف
    const isManualOverride = form.purchase_category_source === "manual";

    if (!isManualOverride) {
      // تطبيق التصنيف التلقائي من المورد
      if (resolution.resolved_purchase_category && resolution.resolved_purchase_category !== "unclassified") {
        if (form.purchase_category !== resolution.resolved_purchase_category) {
          set("purchase_category", resolution.resolved_purchase_category);
        }
      }
      if (resolution.resolved_purchase_category_source && form.purchase_category_source !== resolution.resolved_purchase_category_source) {
        set("purchase_category_source", resolution.resolved_purchase_category_source);
      }
    }

    // تطبيق نوع العملية (تحويل داخلي / شراء خارجي)
    if (resolution.resolved_transaction_type && form.transaction_type !== resolution.resolved_transaction_type) {
      set("transaction_type", resolution.resolved_transaction_type);
    }
    if (resolution.source_branch !== undefined && form.source_branch !== resolution.source_branch) {
      set("source_branch", resolution.source_branch || "");
    }
    if (resolution.destination_branch !== undefined && form.destination_branch !== resolution.destination_branch) {
      set("destination_branch", resolution.destination_branch || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolution]);

  // When supplier changes, set supplier_id + payment_type
  const handleSupplierChange = (supplierName) => {
    const supplier = suppliers.find((s) => s.name === supplierName);
    set("supplier_name", supplierName);
    set("supplier_id", supplier?.id || "");
    if (supplier?.payment_type) {
      set("payment_type", supplier.payment_type);
    }
    // تصنيف الفاتورة سيُحدد تلقائيًا عبر resolveInvoiceSupplierRules
  };

  const supplierMode = selectedSupplier?.default_purchase_category || "none";
  const isAutoClassified = supplierMode === "medicines" || supplierMode === "supplies_accessories";

  const remaining = () => {
    const total = parseFloat(form.total_value) || 0;
    const ret = parseFloat(form.returned_value) || 0;
    return (total - ret).toFixed(2);
  };

  const isInternalTransfer = form.transaction_type === "internal_transfer";
  const isExcluded = form.net_purchase_mode === "exclude";
  const isMixed = form.payment_type === "مختلط";
  const isOtherReason = form.exclusion_reason === "other";

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.branch) {
      setDupError("يجب اختيار الفرع");
      return;
    }
    if (!form.payment_type) {
      setDupError("يجب اختيار طريقة الدفع");
      return;
    }
    if (isFutureDate(form.invoice_date)) {
      setDupError("لا يمكن تسجيل فاتورة بتاريخ مستقبلي");
      return;
    }
    // التحقق من التصنيف للفواتير الجديدة
    if (!invoice && !form.purchase_category) {
      setDupError("يجب اختيار تصنيف الفاتورة (أدوية / مستلزمات وإكسسوار)");
      return;
    }
    // التحقق من سبب الاستثناء
    if (isExcluded && !form.exclusion_reason) {
      setDupError("يجب اختيار سبب الاستثناء");
      return;
    }
    // التحقق من ملاحظة "أخرى"
    if (isExcluded && isOtherReason && !form.exclusion_note?.trim()) {
      setDupError("يجب كتابة ملاحظة عند اختيار سبب 'أخرى'");
      return;
    }
    // التحقق من التحويل الداخلي
    if (isInternalTransfer) {
      if (!form.source_branch || !form.destination_branch) {
        setDupError("يجب تحديد الفرع المصدر والفرع المستلم للتحويل الداخلي");
        return;
      }
      if (form.source_branch === form.destination_branch) {
        setDupError("لا يمكن أن يكون الفرع المصدر هو نفسه الفرع المستلم");
        return;
      }
    }
    // التحقق من مبلغ الكاش
    if (isMixed) {
      const totalVal = parseFloat(form.total_value) || 0;
      const returnedVal = parseFloat(form.returned_value) || 0;
      const netTotal = totalVal - returnedVal;
      const cashAmt = parseFloat(form.cash_amount) || 0;
      if (cashAmt > netTotal) {
        setDupError("المبلغ المدفوع كاش لا يمكن أن يتجاوز إجمالي الفاتورة");
        return;
      }
    }

    // Check duplicate system_invoice_number per branch
    const isDuplicate = allInvoices.some(
      (inv) =>
        inv.branch === form.branch &&
        inv.system_invoice_number === form.system_invoice_number &&
        (!invoice || inv.id !== invoice.id)
    );
    if (isDuplicate) {
      setDupError(`رقم الفاتورة "${form.system_invoice_number}" موجود بالفعل في ${form.branch}`);
      return;
    }
    const duplicateSupplierInvoice = findDuplicateSupplierInvoice(allInvoices, form, invoice?.id);
    if (duplicateSupplierInvoice) {
      setDupError(`فاتورة المورد رقم "${form.supplier_invoice_number}" مسجلة بالفعل لنفس المورد والفرع`);
      return;
    }
    setDupError("");

    const totalVal = parseFloat(form.total_value) || 0;
    const returnedVal = parseFloat(form.returned_value) || 0;
    const cashAmt = parseFloat(form.cash_amount) || 0;
    const isCash = ["كاش", "انستا", "فودافون"].includes(form.payment_type);
    const currentPaid = parseFloat(invoice?.paid_value) || 0;

    // بيانات الاستثناء
    const exclusionData = {};
    if (form.net_purchase_mode === "exclude") {
      exclusionData.excluded_by = invoice?.excluded_by || "";
      // إذا كان استثناء جديد، نسجل الوقت (سيُحدث في الـ mutation)
      exclusionData.excluded_at = new Date().toISOString();
    } else {
      // مسح بيانات الاستثناء عند الإلغاء
      exclusionData.excluded_by = "";
      exclusionData.excluded_at = "";
      exclusionData.exclusion_reason = "";
      exclusionData.exclusion_note = "";
    }

    // للتحويل الداخلي، نجعل net_purchase_mode = exclude تلقائيًا إذا كان inherit
    let finalNetMode = form.net_purchase_mode;
    if (isInternalTransfer && form.net_purchase_mode === "inherit") {
      finalNetMode = "inherit"; // يبقى inherit لكن isInvoiceExcluded سيعالجه عبر transaction_type
    }

    onSubmit({
      ...form,
      total_value: totalVal,
      returned_value: returnedVal,
      cash_amount: isMixed ? cashAmt : 0,
      purchase_category_source: form.purchase_category_source || (form.purchase_category ? "manual" : ""),
      paid_value: isCash ? totalVal - returnedVal : (form.payment_type === "آجل" ? currentPaid : (isMixed ? cashAmt : 0)),
      net_purchase_mode: finalNetMode,
      ...exclusionData,
      ...(!invoice && { added_at: new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right text-base font-bold">
            {invoice ? "تعديل الفاتورة" : "إضافة فاتورة شراء"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Invoice Numbers */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">رقم الفاتورة على البرنامج *</Label>
              <Input value={form.system_invoice_number} onChange={(e) => set("system_invoice_number", e.target.value)} placeholder="INV-001" required className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">رقم الفاتورة من المورد</Label>
              <Input value={form.supplier_invoice_number} onChange={(e) => set("supplier_invoice_number", e.target.value)} placeholder="رقم المورد" className="h-8 text-sm" />
            </div>
          </div>

          {/* Supplier & Branch */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">المورد</Label>
              <SearchableSelect
                value={form.supplier_name}
                onChange={handleSupplierChange}
                options={suppliers.map((s) => s.name)}
                placeholder="اختر المورد"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">الفرع *</Label>
              <Select value={form.branch} onValueChange={(v) => { set("branch", v); setDupError(""); }} required>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
                <SelectContent>
                  {BRANCHES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Supplier exclusion warning */}
          {supplierExcluded && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <p className="text-xs text-amber-700">هذا المورد مستثنى افتراضيًا من صافي المشتريات. يمكنك تجاوز الاستثناء باختيار "محتسبة يدويًا".</p>
            </div>
          )}

          {/* Date */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">تاريخ الفاتورة</Label>
              <Input type="date" value={form.invoice_date} onChange={(e) => set("invoice_date", e.target.value)} className="h-8 text-sm" />
            </div>
            {form.branch && (
              <div className="space-y-1">
                <Label className="text-xs">مدخل الفاتورة</Label>
                <SearchableSelect
                  value={form.entered_by}
                  onChange={(v) => set("entered_by", v)}
                  options={branchMembers.map((m) => m.name)}
                  placeholder={branchMembers.length === 0 ? "لا يوجد عاملين" : "اختر"}
                />
              </div>
            )}
          </div>

          {/* Values */}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">الإجمالي *</Label>
              <Input type="number" step="0.01" min="0" value={form.total_value} onChange={(e) => set("total_value", e.target.value)} placeholder="0.00" required className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">المرتجع</Label>
              <Input type="number" step="0.01" min="0" value={form.returned_value} onChange={(e) => set("returned_value", e.target.value)} placeholder="0.00" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">المتبقي</Label>
              <div className="h-8 px-3 rounded-md border bg-gray-50 text-sm font-semibold text-gray-700 flex items-center">
                {remaining()}
              </div>
            </div>
          </div>

          {/* ===== قسم التصنيف والحسابات ===== */}
          <div className="border rounded-lg p-3 bg-slate-50/50 space-y-3">
            <p className="text-sm font-bold text-slate-700 border-b pb-1.5">التصنيف والحسابات</p>

            {/* تصنيف الفاتورة */}
            <div className="space-y-1">
              <Label className="text-xs">
                تصنيف الفاتورة {!invoice && "*"}
                {invoice && !form.purchase_category && (
                  <span className="text-amber-600 mr-1">(غير مصنفة — يرجى التصنيف)</span>
                )}
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const defaultCat = selectedSupplier?.default_purchase_category;
                    // إذا اختار نفس تصنيف المورد → source=supplier_default، وإلا → manual (استثناء يدوي محفوظ)
                    const isMatchingDefault = defaultCat === "medicines";
                    set("purchase_category", "medicines");
                    set("purchase_category_source", isMatchingDefault ? "supplier_default" : "manual");
                  }}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border transition-colors ${form.purchase_category === "medicines" ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-600 border-gray-300 hover:border-teal-400"}`}
                >
                  💊 أدوية
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const defaultCat = selectedSupplier?.default_purchase_category;
                    const isMatchingDefault = defaultCat === "supplies_accessories";
                    set("purchase_category", "supplies_accessories");
                    set("purchase_category_source", isMatchingDefault ? "supplier_default" : "manual");
                  }}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border transition-colors ${form.purchase_category === "supplies_accessories" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-300 hover:border-indigo-400"}`}
                >
                  📦 مستلزمات وإكسسوار
                </button>
              </div>
              {form.purchase_category && form.purchase_category_source === "supplier_default" && (
                <p className="text-xs text-teal-600 bg-teal-50 px-2 py-1 rounded">✓ تم تصنيف الفاتورة تلقائيًا كـ{form.purchase_category === "medicines" ? "أدوية" : "مستلزمات وإكسسوار"} بناءً على إعداد المورد.</p>
              )}
              {form.purchase_category && form.purchase_category_source === "manual" && isAutoClassified && (
                <p className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">⚠ تم تغيير تصنيف هذه الفاتورة يدويًا عن التصنيف الافتراضي للمورد. سيظل هذا الاستثناء محفوظًا.</p>
              )}
              {!form.purchase_category && (supplierMode === "mixed" || supplierMode === "none") && (
                <p className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">⚠ هذا المورد مختلط؛ يجب اختيار تصنيف الفاتورة يدويًا.</p>
              )}
              {/* رسائل قواعد المورد من الـ Backend */}
              {isResolving && form.supplier_id && form.branch && (
                <p className="text-xs text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> جاري تطبيق قواعد المورد...</p>
              )}
              {resolution?.auto_transfer_message && (
                <p className="text-xs text-purple-600 bg-purple-50 px-2 py-1 rounded flex items-center gap-1"><ArrowRightLeft className="w-3 h-3" /> {resolution.auto_transfer_message}</p>
              )}
              {resolution?.warning_message && resolution?.requires_review && (
                <p className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {resolution.warning_message}</p>
              )}
              {resolution?.warning_message && !resolution?.requires_review && resolution?.requires_manual_category && (
                <p className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {resolution.warning_message}</p>
              )}
              {resolution?.manual_override_preserved && (
                <p className="text-xs text-teal-600 bg-teal-50 px-2 py-1 rounded flex items-center gap-1"><Info className="w-3 h-3" /> تم الحفاظ على الاستثناء اليدوي للتصنيف.</p>
              )}
            </div>

            {/* نوع العملية */}
            <div className="space-y-1">
              <Label className="text-xs">نوع العملية</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => set("transaction_type", "external_purchase")}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border transition-colors ${form.transaction_type === "external_purchase" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"}`}
                >
                  🏪 شراء من مورد خارجي
                </button>
                <button
                  type="button"
                  onClick={() => set("transaction_type", "internal_transfer")}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border transition-colors ${form.transaction_type === "internal_transfer" ? "bg-purple-600 text-white border-purple-600" : "bg-white text-gray-600 border-gray-300 hover:border-purple-400"}`}
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" /> تحويل داخلي
                </button>
              </div>
            </div>

            {/* التحويل الداخلي — فروع */}
            {isInternalTransfer && (
              <div className="grid grid-cols-2 gap-2 bg-purple-50/50 p-2 rounded-md">
                <div className="space-y-1">
                  <Label className="text-xs">الفرع المصدر *</Label>
                  <Select value={form.source_branch} onValueChange={(v) => set("source_branch", v)}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="اختر الفرع المصدر" /></SelectTrigger>
                    <SelectContent>
                      {BRANCHES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">الفرع المستلم *</Label>
                  <Select value={form.destination_branch} onValueChange={(v) => set("destination_branch", v)}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="اختر الفرع المستلم" /></SelectTrigger>
                    <SelectContent>
                      {BRANCHES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {form.source_branch && form.destination_branch && form.source_branch === form.destination_branch && (
                  <p className="col-span-2 text-xs text-red-500">⚠️ لا يمكن أن يكون الفرع المصدر هو نفسه الفرع المستلم</p>
                )}
              </div>
            )}

            {/* طريقة احتساب الصافي */}
            <div className="space-y-1">
              <Label className="text-xs">طريقة احتساب الفاتورة في صافي المشتريات</Label>
              <Select value={form.net_purchase_mode} onValueChange={(v) => set("net_purchase_mode", v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">اتباع إعداد المورد</SelectItem>
                  <SelectItem value="include">محتسبة يدويًا</SelectItem>
                  <SelectItem value="exclude">مستثناة يدويًا</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* سبب الاستثناء */}
            {isExcluded && (
              <div className="space-y-2 bg-red-50/50 p-2 rounded-md">
                <div className="space-y-1">
                  <Label className="text-xs">سبب الاستثناء *</Label>
                  <Select value={form.exclusion_reason} onValueChange={(v) => set("exclusion_reason", v)}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="اختر السبب" /></SelectTrigger>
                    <SelectContent>
                      {EXCLUSION_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">ملاحظات الاستثناء {isOtherReason && "*"}</Label>
                  <Textarea
                    value={form.exclusion_note}
                    onChange={(e) => set("exclusion_note", e.target.value)}
                    rows={2}
                    placeholder={isOtherReason ? "اكتب تفاصيل سبب الاستثناء..." : "ملاحظات إضافية (اختياري)"}
                    className="text-sm"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Payment & Status */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">طريقة الدفع *</Label>
              <Select value={form.payment_type} onValueChange={(v) => set("payment_type", v)} required>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="كاش">💵 كاش</SelectItem>
                  <SelectItem value="آجل">📋 آجل</SelectItem>
                  <SelectItem value="مختلط">🔀 مختلط</SelectItem>
                  <SelectItem value="انستا">📱 انستا</SelectItem>
                  <SelectItem value="فودافون">📱 فودافون</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">حالة الفاتورة</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="انتظار المراجعة">⏳ انتظار المراجعة</SelectItem>
                  <SelectItem value="يتم الحفظ">✅ يتم الحفظ</SelectItem>
                  <SelectItem value="تعلق تحت التصريف">🔄 تعلق تحت التصريف</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* مبلغ الكاش للفواتير المختلطة */}
          {isMixed && (
            <div className="grid grid-cols-2 gap-2 bg-emerald-50/50 p-2 rounded-md">
              <div className="space-y-1">
                <Label className="text-xs">المبلغ المدفوع كاش *</Label>
                <Input type="number" step="0.01" min="0" value={form.cash_amount} onChange={(e) => set("cash_amount", e.target.value)} placeholder="0.00" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">المبلغ الآجل (متبقي)</Label>
                <div className="h-8 px-3 rounded-md border bg-gray-50 text-sm font-semibold text-gray-700 flex items-center">
                  {(() => {
                    const total = parseFloat(form.total_value) || 0;
                    const ret = parseFloat(form.returned_value) || 0;
                    const cash = parseFloat(form.cash_amount) || 0;
                    return Math.max(total - ret - cash, 0).toFixed(2);
                  })()}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">ملاحظات</Label>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="text-sm" />
          </div>

          {dupError && <p className="text-red-500 text-xs bg-red-50 p-2 rounded-md">{dupError}</p>}

          <DialogFooter className="gap-2 flex-row-reverse">
            <Button type="submit" disabled={isLoading} className="bg-teal-600 hover:bg-teal-700">
              {isLoading ? "جاري الحفظ..." : invoice ? "تحديث" : "حفظ الفاتورة"}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}