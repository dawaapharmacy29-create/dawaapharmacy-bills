import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, FilePlus2, Loader2, RotateCcw, Send, Save } from "lucide-react";
import { base44, invoiceWorkflowApi } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const BRANCHES = ["دواء الشامي", "دواء شكري"];
const PAYMENT_TYPES = ["آجل", "كاش", "مختلط", "انستا", "فودافون"];

const initialForm = () => ({
  system_invoice_number: "",
  supplier_invoice_number: "",
  supplier_id: "",
  supplier_name: "",
  branch: "",
  invoice_date: new Date().toISOString().slice(0, 10),
  total_value: "",
  returned_value: "0",
  cash_amount: "0",
  payment_type: "",
  purchase_category: "medicines",
  purchase_category_source: "manual",
  transaction_type: "external_purchase",
  net_purchase_mode: "inherit",
  notes: "",
});

export default function QuickInvoiceEntry() {
  const [form, setForm] = useState(initialForm);
  const [savingMode, setSavingMode] = useState("");
  const [message, setMessage] = useState(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: suppliers = [], isLoading: suppliersLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => base44.entities.Supplier.list("name"),
    staleTime: 5 * 60 * 1000,
  });

  const selectedSupplier = useMemo(
    () => suppliers.find((supplier) => supplier.id === form.supplier_id),
    [suppliers, form.supplier_id]
  );

  const netValue = Math.max(
    (Number(form.total_value) || 0) - (Number(form.returned_value) || 0),
    0
  );

  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const reset = () => {
    setForm(initialForm());
    setMessage(null);
    window.setTimeout(() => document.getElementById("system-invoice-number")?.focus(), 50);
  };

  const validate = () => {
    if (!form.system_invoice_number.trim()) return "اكتب رقم الفاتورة على البرنامج";
    if (!form.supplier_id || !form.supplier_name) return "اختر المورد";
    if (!form.branch) return "اختر الفرع";
    if (!form.invoice_date) return "حدد تاريخ الفاتورة";
    if (form.invoice_date > new Date().toISOString().slice(0, 10)) return "لا يمكن تسجيل فاتورة بتاريخ مستقبلي";
    if (!(Number(form.total_value) > 0)) return "إجمالي الفاتورة يجب أن يكون أكبر من صفر";
    if (Number(form.returned_value) < 0 || Number(form.returned_value) > Number(form.total_value)) return "قيمة المرتجع غير صحيحة";
    if (!form.payment_type) return "اختر طريقة الدفع";
    if (form.payment_type === "مختلط" && Number(form.cash_amount) > netValue) return "المبلغ الكاش أكبر من صافي الفاتورة";
    return "";
  };

  const checkDuplicate = async () => {
    const systemMatches = await base44.entities.PurchaseInvoice.filter({
      branch: form.branch,
      system_invoice_number: form.system_invoice_number.trim(),
    }, "-created_at", 5, 0);
    if (systemMatches.length) return `رقم الفاتورة ${form.system_invoice_number} مسجل بالفعل في ${form.branch}`;

    if (form.supplier_invoice_number.trim()) {
      const supplierMatches = await base44.entities.PurchaseInvoice.filter({
        branch: form.branch,
        supplier_id: form.supplier_id,
        supplier_invoice_number: form.supplier_invoice_number.trim(),
      }, "-created_at", 5, 0);
      if (supplierMatches.length) return `فاتورة المورد رقم ${form.supplier_invoice_number} مسجلة بالفعل لنفس المورد والفرع`;
    }
    return "";
  };

  const save = async (mode) => {
    setMessage(null);
    const validationError = validate();
    if (validationError) {
      setMessage({ type: "error", text: validationError });
      return;
    }

    setSavingMode(mode);
    try {
      const duplicateError = await checkDuplicate();
      if (duplicateError) throw new Error(duplicateError);

      const isCash = ["كاش", "انستا", "فودافون"].includes(form.payment_type);
      const cashAmount = form.payment_type === "مختلط" ? Number(form.cash_amount) || 0 : 0;
      const payload = {
        ...form,
        system_invoice_number: form.system_invoice_number.trim(),
        supplier_invoice_number: form.supplier_invoice_number.trim(),
        total_value: Number(form.total_value),
        returned_value: Number(form.returned_value) || 0,
        cash_amount: cashAmount,
        paid_value: isCash ? netValue : cashAmount,
        status: mode === "submit" ? "انتظار المراجعة" : "يتم الحفظ",
        workflow_status: "draft",
        entered_by: user?.full_name || user?.display_name || user?.username || "",
        entered_by_name: user?.full_name || user?.display_name || user?.username || "",
      };

      const created = await base44.entities.PurchaseInvoice.create(payload);
      if (mode === "submit") await invoiceWorkflowApi.submit(created.id, "إرسال مباشر من شاشة الإدخال السريع");

      queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["pending-invoices-count"] });
      queryClient.invalidateQueries({ queryKey: ["invoice-workflow"] });
      setMessage({
        type: "success",
        text: mode === "submit" ? "تم حفظ الفاتورة وإرسالها للمراجعة" : "تم حفظ الفاتورة كمسودة",
        invoiceId: created.id,
      });
      setForm(initialForm());
      window.setTimeout(() => document.getElementById("system-invoice-number")?.focus(), 50);
    } catch (error) {
      setMessage({ type: "error", text: error?.message || "تعذر حفظ الفاتورة" });
    } finally {
      setSavingMode("");
    }
  };

  return (
    <div dir="rtl" className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><FilePlus2 className="h-6 w-6 text-teal-600" />الإدخال السريع للفواتير</h1>
          <p className="mt-1 text-sm text-slate-500">إدخال الفاتورة وحفظها كمسودة أو إرسالها للمراجعة مباشرة.</p>
        </div>
        <Button variant="outline" onClick={() => navigate("/invoices")}>عرض كل الفواتير</Button>
      </div>

      {message && (
        <div className={`mb-4 flex items-center gap-2 rounded-xl border p-3 text-sm ${message.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          {message.type === "success" ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertTriangle className="h-5 w-5 shrink-0" />}
          <span className="flex-1">{message.text}</span>
        </div>
      )}

      <div className="rounded-2xl border bg-white p-4 shadow-sm md:p-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label>رقم الفاتورة على البرنامج *</Label>
            <Input id="system-invoice-number" autoFocus value={form.system_invoice_number} onChange={(e) => set("system_invoice_number", e.target.value)} placeholder="مثال: 15801" />
          </div>
          <div className="space-y-1.5">
            <Label>رقم فاتورة المورد</Label>
            <Input value={form.supplier_invoice_number} onChange={(e) => set("supplier_invoice_number", e.target.value)} placeholder="رقم الفاتورة المطبوعة" />
          </div>
          <div className="space-y-1.5">
            <Label>تاريخ الفاتورة *</Label>
            <Input type="date" value={form.invoice_date} onChange={(e) => set("invoice_date", e.target.value)} />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label>المورد *</Label>
            <Select value={form.supplier_id} onValueChange={(id) => {
              const supplier = suppliers.find((item) => item.id === id);
              setForm((current) => ({
                ...current,
                supplier_id: id,
                supplier_name: supplier?.name || "",
                payment_type: supplier?.payment_type || current.payment_type,
                purchase_category: supplier?.default_purchase_category || current.purchase_category,
                purchase_category_source: supplier?.default_purchase_category ? "supplier_default" : current.purchase_category_source,
              }));
            }}>
              <SelectTrigger><SelectValue placeholder={suppliersLoading ? "جاري تحميل الموردين..." : "اختر المورد"} /></SelectTrigger>
              <SelectContent>{suppliers.map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}</SelectContent>
            </Select>
            {selectedSupplier?.exclude_from_net_purchases && <p className="text-xs text-amber-700">هذا المورد مستثنى افتراضيًا من صافي المشتريات.</p>}
          </div>
          <div className="space-y-1.5">
            <Label>الفرع *</Label>
            <Select value={form.branch} onValueChange={(value) => set("branch", value)}>
              <SelectTrigger><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
              <SelectContent>{BRANCHES.map((branch) => <SelectItem key={branch} value={branch}>{branch}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>إجمالي الفاتورة *</Label>
            <Input type="number" min="0" step="0.01" value={form.total_value} onChange={(e) => set("total_value", e.target.value)} placeholder="0.00" />
          </div>
          <div className="space-y-1.5">
            <Label>قيمة المرتجع</Label>
            <Input type="number" min="0" step="0.01" value={form.returned_value} onChange={(e) => set("returned_value", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>صافي الفاتورة</Label>
            <div className="flex h-10 items-center rounded-md border bg-slate-50 px-3 font-bold text-teal-700">{netValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جنيه</div>
          </div>

          <div className="space-y-1.5">
            <Label>طريقة الدفع *</Label>
            <Select value={form.payment_type} onValueChange={(value) => set("payment_type", value)}>
              <SelectTrigger><SelectValue placeholder="اختر طريقة الدفع" /></SelectTrigger>
              <SelectContent>{PAYMENT_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {form.payment_type === "مختلط" && (
            <div className="space-y-1.5">
              <Label>المبلغ المدفوع كاش</Label>
              <Input type="number" min="0" step="0.01" value={form.cash_amount} onChange={(e) => set("cash_amount", e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>التصنيف</Label>
            <Select value={form.purchase_category} onValueChange={(value) => setForm((current) => ({ ...current, purchase_category: value, purchase_category_source: "manual" }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="medicines">أدوية</SelectItem>
                <SelectItem value="supplies_accessories">مستلزمات وإكسسوار</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
            <Label>ملاحظات</Label>
            <Textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="أي ملاحظات تخص الفاتورة أو المراجعة" />
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={reset} disabled={Boolean(savingMode)}><RotateCcw className="ml-2 h-4 w-4" />تفريغ الحقول</Button>
          <Button variant="outline" onClick={() => save("draft")} disabled={Boolean(savingMode)}>
            {savingMode === "draft" ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Save className="ml-2 h-4 w-4" />}حفظ كمسودة
          </Button>
          <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => save("submit")} disabled={Boolean(savingMode)}>
            {savingMode === "submit" ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Send className="ml-2 h-4 w-4" />}حفظ وإرسال للمراجعة
          </Button>
        </div>
      </div>
    </div>
  );
}