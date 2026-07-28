import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, ArrowRightLeft, AlertTriangle, CheckCircle, Loader2, FileSearch, RefreshCw } from "lucide-react";
import { useUserRole } from "@/lib/useUserRole";

const START_DATE = "2026-07-15";
const money = (value) => Number(value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 0 });
const norm = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

function StatCard({ label, value, tone = "slate", suffix = "" }) {
  const tones = {
    slate: "bg-slate-50 text-slate-700",
    blue: "bg-blue-50 text-blue-700",
    teal: "bg-teal-50 text-teal-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    violet: "bg-violet-50 text-violet-700",
    green: "bg-emerald-50 text-emerald-700",
  };
  return <Card className={`p-4 ${tones[tone]}`}><p className="text-xs opacity-75">{label}</p><p className="mt-2 text-2xl font-bold">{value}{suffix}</p></Card>;
}

export default function SupplierRulesBackfill() {
  const { isAdmin } = useUserRole();
  const [manualPolicy, setManualPolicy] = useState("skip_manual");

  const suppliersQuery = useQuery({ queryKey: ["supplier-rules-preview-suppliers"], queryFn: () => base44.entities.Supplier.list("name", 5000), enabled: isAdmin, staleTime: 30000 });
  const invoicesQuery = useQuery({ queryKey: ["supplier-rules-preview-invoices"], queryFn: () => base44.entities.PurchaseInvoice.list("-invoice_date", 10000), enabled: isAdmin, staleTime: 30000 });

  const preview = useMemo(() => {
    const suppliers = suppliersQuery.data || [];
    const invoices = (invoicesQuery.data || []).filter((row) => (row.invoice_date || row.created_at || "") >= START_DATE);
    const supplierMap = new Map(suppliers.map((s) => [norm(s.name), s]));
    const changes = [];
    let categoryChanges = 0;
    let transactionChanges = 0;
    let manualPreserved = 0;
    let valueAffected = 0;

    invoices.forEach((invoice) => {
      const supplier = supplierMap.get(norm(invoice.supplier_name));
      const isManual = ["manual", "user", "manual_override"].includes(String(invoice.purchase_category_source || "").toLowerCase()) || Boolean(invoice.excluded_by);
      if (manualPolicy === "skip_manual" && isManual) { manualPreserved += 1; return; }
      const expectedCategory = supplier?.default_purchase_category && supplier.default_purchase_category !== "none" ? supplier.default_purchase_category : null;
      const internal = supplier?.supplier_type === "internal_branch" || Boolean(invoice.source_branch && invoice.destination_branch);
      const expectedTransaction = internal ? "internal_transfer" : "purchase";
      const categoryWillChange = Boolean(expectedCategory && expectedCategory !== invoice.purchase_category);
      const transactionWillChange = expectedTransaction !== (invoice.transaction_type || "purchase");
      if (categoryWillChange || transactionWillChange) {
        if (categoryWillChange) categoryChanges += 1;
        if (transactionWillChange) transactionChanges += 1;
        valueAffected += Number(invoice.total_value || 0);
        changes.push({
          id: invoice.id,
          invoice_number: invoice.system_invoice_number || invoice.supplier_invoice_number || "—",
          supplier_name: invoice.supplier_name || "مورد غير محدد",
          branch: invoice.branch || "فرع غير محدد",
          current_category: invoice.purchase_category || "غير مصنف",
          resolved_category: expectedCategory || invoice.purchase_category || "غير مصنف",
          current_transaction: invoice.transaction_type || "purchase",
          resolved_transaction: expectedTransaction,
          value: Number(invoice.total_value || 0),
        });
      }
    });

    return {
      reviewed: invoices.length,
      totalWillChange: changes.length,
      categoryChanges,
      transactionChanges,
      manualPreserved,
      valueAffected,
      missingSupplierRules: suppliers.filter((s) => !s.supplier_type || !s.default_purchase_category || s.default_purchase_category === "none").length,
      changes,
    };
  }, [invoicesQuery.data, suppliersQuery.data, manualPolicy]);

  if (!isAdmin) return <div dir="rtl" className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-gray-400"><Shield className="h-12 w-12" /><p className="text-lg font-medium">هذه الصفحة للمدير العام فقط</p></div>;
  const loading = suppliersQuery.isLoading || invoicesQuery.isLoading;
  const failed = suppliersQuery.isError || invoicesQuery.isError;

  return <div dir="rtl" className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><FileSearch className="h-7 w-7 text-teal-600" /><div><h1 className="text-2xl font-bold text-gray-800">معاينة قواعد الموردين والتحويلات</h1><p className="mt-1 text-sm text-gray-500">فحص آمن من {START_DATE} حتى الآن — لا يتم تعديل أي فاتورة من هذه الصفحة.</p></div></div>
      <Button variant="outline" onClick={() => { suppliersQuery.refetch(); invoicesQuery.refetch(); }} className="gap-2"><RefreshCw className="h-4 w-4" /> تحديث</Button>
    </div>

    <Card className="p-5"><label className="mb-2 block text-sm font-semibold">سياسة الفواتير اليدوية</label><select value={manualPolicy} onChange={(e) => setManualPolicy(e.target.value)} className="w-full max-w-md rounded-lg border p-2.5"><option value="skip_manual">الحفاظ على التعديلات والاستثناءات اليدوية</option><option value="override_all">إظهار نتيجة تطبيق قواعد المورد على الجميع في المعاينة فقط</option></select></Card>

    {loading ? <Card className="p-12 text-center text-gray-500"><Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />جاري فحص البيانات...</Card> : failed ? <Card className="border-red-200 p-6 text-center text-red-700">تعذر تحميل الفواتير أو الموردين. أعد المحاولة بعد تحديث الصفحة.</Card> : <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="إجمالي الفواتير المراجعة" value={preview.reviewed} />
        <StatCard label="فواتير قد تحتاج تصحيح" value={preview.totalWillChange} tone={preview.totalWillChange ? "blue" : "green"} />
        <StatCard label="القيمة محل المراجعة" value={money(preview.valueAffected)} tone="teal" suffix=" ج" />
        <StatCard label="تعديلات يدوية محفوظة" value={preview.manualPreserved} tone="green" />
        <StatCard label="اختلافات التصنيف" value={preview.categoryChanges} tone="amber" />
        <StatCard label="اختلافات نوع العملية" value={preview.transactionChanges} tone="violet" />
        <StatCard label="موردون ناقصو القواعد" value={preview.missingSupplierRules} tone={preview.missingSupplierRules ? "red" : "green"} />
        <StatCard label="تحويلات داخلية محتملة" value={preview.changes.filter((x) => x.resolved_transaction === "internal_transfer").length} tone="violet" />
      </div>

      <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><p><strong>هذه معاينة فقط.</strong> لن يتم تطبيق تغيير جماعي تلقائيًا. راجع العينة ثم استخدم صفحة الفواتير أو مركز مراجعة البيانات لتصحيح السجلات المعتمدة فقط.</p></div></Card>

      <Card className="overflow-hidden"><div className="flex items-center justify-between border-b p-4"><h2 className="font-bold">عينة الفواتير المقترح مراجعتها</h2><Badge variant="outline">أول 100 سجل</Badge></div><div className="overflow-x-auto"><table className="min-w-[1000px] w-full text-sm"><thead className="bg-gray-50"><tr>{["رقم الفاتورة","المورد","الفرع","التصنيف الحالي","المقترح","العملية الحالية","المقترحة","القيمة"].map((h) => <th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody>{preview.changes.slice(0,100).map((row) => <tr key={row.id} className="border-t"><td className="p-3 font-medium">{row.invoice_number}</td><td className="p-3">{row.supplier_name}</td><td className="p-3">{row.branch}</td><td className="p-3">{row.current_category}</td><td className="p-3 text-teal-700">{row.resolved_category}</td><td className="p-3">{row.current_transaction}</td><td className="p-3 text-violet-700">{row.resolved_transaction}</td><td className="p-3">{money(row.value)} ج</td></tr>)}{!preview.changes.length && <tr><td colSpan="8" className="p-10 text-center text-emerald-700"><CheckCircle className="mx-auto mb-2 h-7 w-7" />لا توجد اختلافات ظاهرة حسب القواعد الحالية.</td></tr>}</tbody></table></div></Card>
    </>}
  </div>;
}