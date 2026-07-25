import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Database, Download, Users, HandCoins, Receipt, RotateCcw } from "lucide-react";
import * as XLSX from "xlsx";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { normalizeText, normalizeDigits } from "@/lib/dataIntegrity";

const load = (entity, sort = "-created_date", limit = 5000) => base44.entities[entity].list(sort, limit);
const branches = ["دواء شكري", "دواء الشامي"];
const validMobile = (value) => /^01[0125][0-9]{8}$/.test(normalizeDigits(value));

function IssueCard({ title, count, icon: Icon, children, tone = "amber" }) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-red-200 bg-red-50 text-red-800",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
  };
  return (
    <Card className={`p-4 border ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><Icon className="w-5 h-5" /><h3 className="font-bold">{title}</h3></div>
        <Badge className="bg-white text-gray-800 border">{count}</Badge>
      </div>
      <div className="text-xs mt-2 leading-6">{children}</div>
    </Card>
  );
}

export default function DataReviewCenter() {
  const queries = {
    members: useQuery({ queryKey: ["review-team-members"], queryFn: () => load("TeamMember", "name") }),
    suppliers: useQuery({ queryKey: ["review-suppliers"], queryFn: () => load("Supplier", "name") }),
    payments: useQuery({ queryKey: ["review-supplier-payments"], queryFn: () => load("SupplierPayment", "-payment_date") }),
    invoices: useQuery({ queryKey: ["review-purchase-invoices"], queryFn: () => load("PurchaseInvoice") }),
    returns: useQuery({ queryKey: ["review-returns"], queryFn: () => load("Return") }),
    shifts: useQuery({ queryKey: ["review-shifts"], queryFn: () => load("ShiftDelivery") }),
    orders: useQuery({ queryKey: ["review-pharmacy-orders"], queryFn: () => load("PharmacyOrder") }),
    replenishment: useQuery({ queryKey: ["review-replenishment"], queryFn: () => load("ReplenishmentOrder") }),
  };
  const loading = Object.values(queries).some((q) => q.isLoading);
  const failed = Object.values(queries).some((q) => q.isError);
  const data = Object.fromEntries(Object.entries(queries).map(([key, q]) => [key, q.data || []]));

  const audit = useMemo(() => {
    const duplicateMemberGroups = Object.values(data.members.reduce((acc, member) => {
      const key = normalizeText(member.name);
      if (!key) return acc;
      (acc[key] ||= []).push(member);
      return acc;
    }, {})).filter((group) => group.length > 1);

    const memberIssues = data.members.filter((m) => !m.role || !(m.branches || []).length || (m.phone && !validMobile(m.phone)));
    const internalNames = new Set(data.suppliers.filter((s) => s.supplier_type === "internal_branch").map((s) => normalizeText(s.name)));
    const supplierIssues = data.suppliers.filter((s) => !s.supplier_type || (s.supplier_type === "external_supplier" && !s.payment_type) || (s.payment_type === "آجل" && !Number(s.payment_terms_days)));
    const unscopedPayments = data.payments.filter((p) => !p.branch || !branches.includes(p.branch));
    const internalPayments = data.payments.filter((p) => internalNames.has(normalizeText(p.supplier_name)) && p.payment_kind !== "branch_settlement" && p.transaction_type !== "branch_settlement");
    const unallocatedPayments = data.payments.filter((p) => !p.invoice_id && branches.includes(p.branch) && !internalNames.has(normalizeText(p.supplier_name)) && p.payment_kind !== "branch_settlement" && p.transaction_type !== "branch_settlement");

    const invoiceGroups = Object.values(data.invoices.reduce((acc, inv) => {
      const number = normalizeText(inv.supplier_invoice_number);
      if (!number) return acc;
      const key = [normalizeText(inv.supplier_name), normalizeText(inv.branch), number].join("|");
      (acc[key] ||= []).push(inv);
      return acc;
    }, {})).filter((group) => group.length > 1);

    const pendingReturns = data.returns.filter((r) => ["Pending", "Under Review", "Approved"].includes(r.status));
    const incompleteReturns = data.returns.filter((r) => !(r.items || []).length || (r.items || []).some((item) => !item.item_reason));
    const returnsWithoutCreditNote = data.returns.filter((r) => r.status === "Returned" && (!r.credit_note_number || Number(r.credit_note_amount || 0) <= 0));

    const shiftGroups = Object.values(data.shifts.reduce((acc, shift) => {
      const key = [normalizeText(shift.branch), shift.shift_date || shift.date, normalizeText(shift.shift_type || shift.shift)].join("|");
      if (!key.replaceAll("|", "")) return acc;
      (acc[key] ||= []).push(shift);
      return acc;
    }, {})).filter((group) => group.length > 1);

    const oldOrders = data.orders.filter((o) => {
      const status = normalizeText(o.status);
      const created = new Date(o.created_date || o.order_date || 0);
      return ["طلب جديد", "new", "pending"].includes(status) && created && (Date.now() - created.getTime()) / 86400000 > 7;
    });
    const badOrders = data.orders.filter((o) => !o.branch || !o.employee_name || !o.product_name || (o.customer_phone && !validMobile(o.customer_phone)));
    const badReplenishment = data.replenishment.filter((o) => !o.product_name || !o.product_code || !o.branch || Number(o.quantity || 0) <= 0);

    const rows = [
      ...duplicateMemberGroups.flatMap((g) => g.map((x) => ({ category: "موظف مكرر", record_id: x.id, name: x.name, details: `عدد النسخ: ${g.length}` }))),
      ...memberIssues.map((x) => ({ category: "بيانات موظف ناقصة", record_id: x.id, name: x.name, details: `الدور: ${x.role || "ناقص"} | الفروع: ${(x.branches || []).join(", ") || "ناقصة"}` })),
      ...unscopedPayments.map((x) => ({ category: "دفعة بدون فرع", record_id: x.id, name: x.supplier_name, details: `${x.amount || 0} - ${x.payment_date || ""}` })),
      ...internalPayments.map((x) => ({ category: "دفعة لفرع داخلي", record_id: x.id, name: x.supplier_name, details: `${x.amount || 0} - يجب نقلها لتسويات الفروع` })),
      ...unallocatedPayments.map((x) => ({ category: "دفعة غير موزعة على فواتير", record_id: x.id, name: x.supplier_name, details: `${x.amount || 0} | ${x.branch} | ${x.payment_date || ""}` })),
      ...invoiceGroups.flatMap((g) => g.map((x) => ({ category: "فاتورة محتملة التكرار", record_id: x.id, name: x.supplier_name, details: `${x.supplier_invoice_number} | ${x.branch}` }))),
      ...pendingReturns.map((x) => ({ category: "مرتجع مفتوح", record_id: x.id, name: x.supplier_name, details: `${x.return_number || ""} | ${x.status}` })),
      ...returnsWithoutCreditNote.map((x) => ({ category: "مرتجع منفذ بدون إشعار خصم", record_id: x.id, name: x.supplier_name, details: `${x.return_number || ""} | ${x.branch_name || ""}` })),
      ...shiftGroups.flatMap((g) => g.map((x) => ({ category: "تسليم شيفت محتمل التكرار", record_id: x.id, name: x.employee_name, details: `${x.branch} | ${x.shift_date || x.date} | ${x.shift_type || x.shift}` }))),
      ...oldOrders.map((x) => ({ category: "طلب عميل قديم", record_id: x.id, name: x.product_name, details: `${x.branch || "بدون فرع"} | ${x.status}` })),
      ...badReplenishment.map((x) => ({ category: "طلب توريد ناقص", record_id: x.id, name: x.product_name, details: `الكود: ${x.product_code || "ناقص"} | الفرع: ${x.branch || "ناقص"}` })),
    ];

    return { duplicateMemberGroups, memberIssues, supplierIssues, unscopedPayments, internalPayments, unallocatedPayments, invoiceGroups, pendingReturns, incompleteReturns, returnsWithoutCreditNote, shiftGroups, oldOrders, badOrders, badReplenishment, rows };
  }, [data]);

  const exportAudit = () => {
    const ws = XLSX.utils.json_to_sheet(audit.rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "مراجعة البيانات");
    XLSX.writeFile(wb, `مراجعة-بيانات-دواء-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  if (loading) return <div dir="rtl" className="p-8 text-center text-gray-500">جاري فحص البيانات...</div>;
  if (failed) return <div dir="rtl" className="p-8 text-center text-red-600">تعذر تحميل بعض البيانات. راجع صلاحيات الكيانات في Base44.</div>;

  const totalIssues = audit.rows.length;
  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-800">مركز مراجعة البيانات</h1><p className="text-sm text-gray-500 mt-1">فحص آمن فقط؛ لا يحذف أو يغير أي سجل.</p></div>
        <Button onClick={exportAudit} disabled={!audit.rows.length} className="gap-2 bg-teal-600 hover:bg-teal-700"><Download className="w-4 h-4" />تصدير ملف المراجعة</Button>
      </div>

      <Card className="p-5 flex items-center gap-4">
        {totalIssues ? <AlertTriangle className="w-9 h-9 text-amber-500" /> : <CheckCircle2 className="w-9 h-9 text-emerald-500" />}
        <div><p className="font-bold text-lg">{totalIssues ? `${totalIssues} سجل يحتاج مراجعة` : "لا توجد مشاكل ظاهرة"}</p><p className="text-sm text-gray-500">الأرقام قد تتداخل لأن السجل الواحد يمكن أن يحمل أكثر من مشكلة.</p></div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <IssueCard title="تكرارات فريق العمل" count={audit.duplicateMemberGroups.length} icon={Users} tone={audit.duplicateMemberGroups.length ? "red" : "green"}>مجموعات أسماء متطابقة تحتاج اختيار سجل أساسي ونقل العلاقات قبل التعطيل.</IssueCard>
        <IssueCard title="بيانات موظفين ناقصة" count={audit.memberIssues.length} icon={Users}>وظيفة أو فرع مفقود، أو رقم هاتف مكتوب بصيغة غير صحيحة.</IssueCard>
        <IssueCard title="موردون يحتاجون استكمال" count={audit.supplierIssues.length} icon={Database}>نوع المورد أو طريقة الدفع أو مدة الائتمان غير مكتملة.</IssueCard>
        <IssueCard title="دفعات بدون فرع" count={audit.unscopedPayments.length} icon={HandCoins} tone={audit.unscopedPayments.length ? "red" : "green"}>لا يمكن نسب الدفعة إلى كشف حساب فرع محدد.</IssueCard>
        <IssueCard title="حركات فروع داخل حساب الموردين" count={audit.internalPayments.length} icon={HandCoins} tone={audit.internalPayments.length ? "red" : "green"}>يجب نقلها إلى تسويات وتحويلات الفروع بدل مديونية الموردين.</IssueCard>
        <IssueCard title="دفعات غير موزعة" count={audit.unallocatedPayments.length} icon={HandCoins} tone={audit.unallocatedPayments.length ? "amber" : "green"}>دفعات صحيحة الفرع لكنها غير مرتبطة بفاتورة؛ يلزم توزيعها أو توثيقها كتسوية رصيد سابق.</IssueCard>
        <IssueCard title="فواتير محتملة التكرار" count={audit.invoiceGroups.length} icon={Receipt} tone={audit.invoiceGroups.length ? "red" : "green"}>نفس المورد والفرع ورقم فاتورة المورد.</IssueCard>
        <IssueCard title="مرتجعات مفتوحة" count={audit.pendingReturns.length} icon={RotateCcw}>مرتجعات لم تصل إلى التنفيذ أو الإغلاق.</IssueCard>
        <IssueCard title="مرتجعات ناقصة السبب" count={audit.incompleteReturns.length} icon={RotateCcw}>يوجد صنف بدون سبب واضح أو مرتجع بدون أصناف.</IssueCard>
        <IssueCard title="مرتجعات بلا إشعار خصم" count={audit.returnsWithoutCreditNote.length} icon={RotateCcw} tone={audit.returnsWithoutCreditNote.length ? "red" : "green"}>مرتجع تم تنفيذه لكن لم يتم توثيق رقم وقيمة إشعار الخصم.</IssueCard>
        <IssueCard title="تسليمات شيفت مكررة" count={audit.shiftGroups.length} icon={AlertTriangle} tone={audit.shiftGroups.length ? "red" : "green"}>نفس الفرع والتاريخ والشيفت مسجل أكثر من مرة.</IssueCard>
        <IssueCard title="طلبات عملاء قديمة" count={audit.oldOrders.length} icon={AlertTriangle}>طلبات ما زالت جديدة أو معلقة لأكثر من 7 أيام.</IssueCard>
        <IssueCard title="طلبات عملاء ناقصة" count={audit.badOrders.length} icon={AlertTriangle}>فرع أو موظف أو صنف ناقص، أو رقم هاتف غير صالح.</IssueCard>
        <IssueCard title="طلبات توريد ناقصة" count={audit.badReplenishment.length} icon={AlertTriangle}>كود الصنف أو الفرع أو الكمية غير مكتملة.</IssueCard>
      </div>
    </div>
  );
}
