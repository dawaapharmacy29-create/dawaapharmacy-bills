import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, FileText, PackageCheck, PackageSearch, RotateCcw, ShoppingCart } from "lucide-react";

const DAY = 24 * 60 * 60 * 1000;
const ageDays = (value) => value ? Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / DAY)) : 0;
const amount = (value) => Number(value || 0);

function MetricCard({ title, value, note, icon: Icon, tone = "slate", href }) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
  };
  return (
    <Link to={href} className={`rounded-2xl border p-4 transition hover:shadow-md ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-xs font-semibold opacity-80">{title}</p><p className="mt-1 text-3xl font-black">{value}</p><p className="mt-1 text-xs opacity-70">{note}</p></div>
        <div className="rounded-xl bg-white/70 p-2"><Icon className="h-5 w-5" /></div>
      </div>
    </Link>
  );
}

export default function PurchaseWorkflowCenter() {
  const common = { staleTime: 30000, refetchOnWindowFocus: false };
  const { data: replenishments = [], isLoading: loadingR } = useQuery({ queryKey: ["workflow-replenishments"], queryFn: () => base44.entities.ReplenishmentOrder.list("-created_date", 500), ...common });
  const { data: invoices = [], isLoading: loadingI } = useQuery({ queryKey: ["workflow-invoices"], queryFn: () => base44.entities.PurchaseInvoice.list("-created_date", 1000), ...common });
  const { data: returns = [], isLoading: loadingRet } = useQuery({ queryKey: ["workflow-returns"], queryFn: () => base44.entities.Return.list("-created_date", 500), ...common });
  const { data: customerOrders = [], isLoading: loadingC } = useQuery({ queryKey: ["workflow-customer-orders"], queryFn: () => base44.entities.PharmacyOrder.list("-created_date", 500), ...common });

  const stats = useMemo(() => {
    const pendingReplenishment = replenishments.filter(x => !x.order_status || ["pending", "shortage", "searching"].includes(x.order_status));
    const orderedNotReceived = replenishments.filter(x => ["ordered", "partial_received"].includes(x.order_status));
    const oldCustomerOrders = customerOrders.filter(x => !["تم الاستلام", "تم الإلغاء", "cancelled", "completed"].includes(x.status) && ageDays(x.created_date) >= 7);
    const pendingInvoices = invoices.filter(x => ["انتظار المراجعة", "pending_review", "يتم الحفظ"].includes(x.status));
    const duplicateKey = new Map();
    invoices.forEach(inv => {
      const n = String(inv.supplier_invoice_number || inv.invoice_number || "").trim();
      if (!n) return;
      const key = `${inv.supplier_name || ""}|${n}|${inv.branch || ""}`;
      duplicateKey.set(key, (duplicateKey.get(key) || 0) + 1);
    });
    const duplicateInvoices = [...duplicateKey.values()].reduce((sum, n) => sum + (n > 1 ? n : 0), 0);
    const pendingReturns = returns.filter(x => x.status === "Pending" || x.status === "قيد الانتظار");
    const missingCreditNote = returns.filter(x => ["Returned", "تم الارتجاع"].includes(x.status) && !x.credit_note_number);
    const openInvoiceValue = invoices.reduce((sum, inv) => {
      const total = amount(inv.total_value);
      const paid = amount(inv.paid_value);
      const returned = amount(inv.returned_value);
      return sum + Math.max(0, total - paid - returned);
    }, 0);
    return { pendingReplenishment, orderedNotReceived, oldCustomerOrders, pendingInvoices, duplicateInvoices, pendingReturns, missingCreditNote, openInvoiceValue };
  }, [replenishments, invoices, returns, customerOrders]);

  const loading = loadingR || loadingI || loadingRet || loadingC;
  const issues = [
    ...stats.pendingReplenishment.slice(0, 5).map(x => ({ type: "طلب نقص", title: x.product_name || "صنف بدون اسم", detail: `${x.branch || "بدون فرع"} • ${ageDays(x.created_date)} يوم`, href: "/replenishment" })),
    ...stats.oldCustomerOrders.slice(0, 5).map(x => ({ type: "طلب عميل", title: x.product_name || x.customer_name || "طلب قديم", detail: `${x.branch || x.branch_name || "بدون فرع"} • ${ageDays(x.created_date)} يوم`, href: "/customer-orders" })),
    ...stats.pendingReturns.slice(0, 5).map(x => ({ type: "مرتجع", title: x.return_number || x.invoice_number || "مرتجع معلق", detail: `${x.supplier_name || "بدون مورد"} • ${ageDays(x.created_date)} يوم`, href: "/returns" })),
  ].sort((a,b) => Number(b.detail.match(/\d+/)?.[0] || 0) - Number(a.detail.match(/\d+/)?.[0] || 0)).slice(0, 10);

  return (
    <div dir="rtl" className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="flex items-center gap-2 text-2xl font-black text-gray-900"><ShoppingCart className="h-6 w-6 text-teal-600" /> مركز دورة المشتريات</h1><p className="mt-1 text-sm text-gray-500">متابعة الطلب من النقص وحتى الاستلام والمرتجع والإغلاق المالي</p></div>
        <Button asChild variant="outline"><Link to="/data-review">مراجعة جودة البيانات <ArrowLeft className="mr-2 h-4 w-4" /></Link></Button>
      </div>

      {loading ? <div className="rounded-2xl border bg-white p-12 text-center text-gray-400">جارٍ تحميل دورة المشتريات...</div> : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard title="نواقص لم تُطلب" value={stats.pendingReplenishment.length} note="تحتاج مورد أو قرار شراء" icon={PackageSearch} tone="amber" href="/replenishment" />
          <MetricCard title="تم طلبها ولم تُستلم" value={stats.orderedNotReceived.length} note="مطلوب متابعة الوصول" icon={Clock3} tone="blue" href="/replenishment" />
          <MetricCard title="فواتير تنتظر المراجعة" value={stats.pendingInvoices.length} note={`${stats.duplicateInvoices} سجل محتمل التكرار`} icon={FileText} tone="slate" href="/pending-invoices" />
          <MetricCard title="مرتجعات غير مغلقة ماليًا" value={stats.pendingReturns.length + stats.missingCreditNote.length} note={`${stats.missingCreditNote.length} بدون إشعار خصم`} icon={RotateCcw} tone="rose" href="/returns" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-5 w-5 text-amber-500" /> أقدم الاختناقات التي تحتاج إجراء</CardTitle></CardHeader><CardContent className="space-y-2">
            {issues.length === 0 ? <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-emerald-700"><CheckCircle2 className="h-5 w-5" /> لا توجد اختناقات قديمة ظاهرة.</div> : issues.map((issue, idx) => <Link key={`${issue.type}-${idx}`} to={issue.href} className="flex items-center justify-between rounded-xl border p-3 hover:bg-gray-50"><div><span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600">{issue.type}</span><p className="mt-1 font-semibold text-gray-800">{issue.title}</p><p className="text-xs text-gray-500">{issue.detail}</p></div><ArrowLeft className="h-4 w-4 text-gray-400" /></Link>)}
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">الملخص المالي التشغيلي</CardTitle></CardHeader><CardContent className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">قيمة الفواتير المفتوحة تقديريًا</p><p className="mt-1 text-2xl font-black text-slate-800">{stats.openInvoiceValue.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م</p><p className="mt-1 text-[11px] text-slate-400">القيمة تعتمد على حقول المدفوع والمرتجع الحالية.</p></div>
            <Link to="/invoices" className="flex items-center justify-between rounded-xl border p-3 text-sm font-semibold hover:bg-gray-50"><span className="flex items-center gap-2"><FileText className="h-4 w-4 text-blue-600" /> فواتير المشتريات</span><ArrowLeft className="h-4 w-4" /></Link>
            <Link to="/supplier-balances" className="flex items-center justify-between rounded-xl border p-3 text-sm font-semibold hover:bg-gray-50"><span className="flex items-center gap-2"><PackageCheck className="h-4 w-4 text-emerald-600" /> حسابات الموردين</span><ArrowLeft className="h-4 w-4" /></Link>
          </CardContent></Card>
        </div>
      </>}
    </div>
  );
}
