import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRightLeft, Ban, CheckCircle2 } from "lucide-react";
import {
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  TRANSACTION_TYPE_LABELS,
  TRANSACTION_TYPE_COLORS,
  NET_MODE_LABELS,
  NET_MODE_COLORS,
  getExclusionReasonLabel,
} from "@/lib/purchaseCalculations";

const statusColor = {
  "انتظار المراجعة": "bg-yellow-100 text-yellow-800",
  "يتم الحفظ": "bg-green-100 text-green-800",
  "تعلق تحت التصريف": "bg-blue-100 text-blue-800",
};
const statusIcon = { "انتظار المراجعة": "⏳", "يتم الحفظ": "✅", "تعلق تحت التصريف": "🔄" };
const paymentColor = { "كاش": "bg-emerald-100 text-emerald-800", "آجل": "bg-orange-100 text-orange-800", "مختلط": "bg-teal-100 text-teal-800", "انستا": "bg-pink-100 text-pink-800", "فودافون": "bg-red-100 text-red-800" };
const branchColor = {
  "دواء شكري": "bg-blue-100 text-blue-800",
  "دواء الشامي": "bg-purple-100 text-purple-800",
};

export default function InvoiceViewDialog({ open, onOpenChange, invoice, onEdit }) {
  if (!invoice) return null;
  const remaining = (invoice.total_value || 0) - (invoice.returned_value || 0) - (invoice.paid_value || 0);

  const category = invoice.purchase_category || "unclassified";
  const txnType = invoice.transaction_type || "external_purchase";
  const netMode = invoice.net_purchase_mode || "inherit";
  const isExcluded = netMode === "exclude" || txnType === "internal_transfer";

  const Row = ({ label, value, valueClass = "" }) => (
    <div className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
      <span className="text-gray-500 text-sm">{label}</span>
      <span className={`text-sm font-semibold ${valueClass}`}>{value || "—"}</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right text-lg font-bold">تفاصيل الفاتورة</DialogTitle>
        </DialogHeader>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {isExcluded && (
            <Badge className="bg-red-100 text-red-800 border-0 gap-1">
              <Ban className="w-3 h-3" /> مستثناة من الصافي
            </Badge>
          )}
          {!isExcluded && netMode === "include" && (
            <Badge className="bg-green-100 text-green-800 border-0 gap-1">
              <CheckCircle2 className="w-3 h-3" /> محتسبة في الصافي
            </Badge>
          )}
          {txnType === "internal_transfer" && (
            <Badge className="bg-purple-100 text-purple-800 border-0 gap-1">
              <ArrowRightLeft className="w-3 h-3" /> تحويل داخلي
            </Badge>
          )}
          <Badge className={`${CATEGORY_COLORS[category]} border-0`}>{CATEGORY_LABELS[category]}</Badge>
        </div>

        <div className="space-y-1">
          <Row label="رقم الفاتورة (البرنامج)" value={<span className="font-mono text-teal-700">{invoice.system_invoice_number}</span>} />
          <Row label="رقم الفاتورة (المورد)" value={invoice.supplier_invoice_number} />
          <Row label="المورد" value={invoice.supplier_name} />
          <Row label="التاريخ" value={invoice.invoice_date} />
          <Row label="الفرع" value={invoice.branch ? <Badge className={`${branchColor[invoice.branch]} border-0`}>{invoice.branch}</Badge> : "—"} />
          <Row label="مدخل الفاتورة" value={invoice.entered_by} />

          {/* بيانات التحويل الداخلي */}
          {txnType === "internal_transfer" && (
            <>
              <div className="flex justify-between items-center py-2 border-b border-gray-100 bg-purple-50/50 -mx-1 px-3 rounded">
                <span className="text-purple-600 text-sm font-medium">الفرع المصدر</span>
                <Badge className={`${branchColor[invoice.source_branch] || "bg-gray-100 text-gray-700"} border-0`}>{invoice.source_branch || "—"}</Badge>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100 bg-purple-50/50 -mx-1 px-3 rounded">
                <span className="text-purple-600 text-sm font-medium">الفرع المستلم</span>
                <Badge className={`${branchColor[invoice.destination_branch] || "bg-gray-100 text-gray-700"} border-0`}>{invoice.destination_branch || "—"}</Badge>
              </div>
            </>
          )}

          <Row label="القيمة الإجمالية" value={`${(invoice.total_value || 0).toLocaleString("ar-EG")} ج`} valueClass="text-gray-800 text-base" />
          <Row label="المرتجع" value={invoice.returned_value ? `${invoice.returned_value.toLocaleString("ar-EG")} ج` : "—"} valueClass="text-red-600" />
          <Row label="المدفوع" value={invoice.paid_value ? `${invoice.paid_value.toLocaleString("ar-EG")} ج` : "—"} valueClass="text-green-600" />
          <Row label="المتبقي" value={`${remaining.toLocaleString("ar-EG")} ج`} valueClass={remaining > 0 ? "text-orange-600" : "text-gray-500"} />

          {/* تفاصيل الكاش للفواتير المختلطة */}
          {invoice.payment_type === "مختلط" && (
            <Row label="المبلغ المدفوع كاش" value={invoice.cash_amount ? `${invoice.cash_amount.toLocaleString("ar-EG")} ج` : "—"} valueClass="text-emerald-600" />
          )}

          <Row label="طريقة الدفع" value={<Badge className={`${paymentColor[invoice.payment_type] || "bg-gray-100 text-gray-700"} border-0`}>{invoice.payment_type}</Badge>} />
          <Row label="الحالة" value={<Badge className={`${statusColor[invoice.status]} border-0`}>{statusIcon[invoice.status]} {invoice.status}</Badge>} />

          {/* التصنيف والحسابات */}
          <div className="pt-2 mt-1 border-t-2 border-gray-200">
            <Row label="تصنيف المشتريات" value={<Badge className={`${CATEGORY_COLORS[category]} border-0`}>{CATEGORY_LABELS[category]}</Badge>} />
            <Row label="نوع العملية" value={<Badge className={`${TRANSACTION_TYPE_COLORS[txnType]} border-0`}>{TRANSACTION_TYPE_LABELS[txnType]}</Badge>} />
            <Row label="احتساب الصافي" value={<Badge className={`${NET_MODE_COLORS[netMode]} border-0`}>{NET_MODE_LABELS[netMode]}</Badge>} />
            {isExcluded && invoice.exclusion_reason && (
              <Row label="سبب الاستثناء" value={getExclusionReasonLabel(invoice.exclusion_reason)} valueClass="text-red-600" />
            )}
            {isExcluded && invoice.exclusion_note && (
              <Row label="ملاحظات الاستثناء" value={invoice.exclusion_note} valueClass="text-red-500" />
            )}
            {isExcluded && invoice.excluded_by && (
              <Row label="نفذ الاستثناء" value={invoice.excluded_by} />
            )}
            {isExcluded && invoice.excluded_at && (
              <Row label="تاريخ الاستثناء" value={new Date(invoice.excluded_at).toLocaleString("ar-EG", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} />
            )}
          </div>

          {invoice.notes && <Row label="ملاحظات" value={invoice.notes} />}
        </div>

        <div className="flex gap-2 justify-end mt-2">
          {onEdit && (
            <Button variant="outline" className="border-blue-300 text-blue-600 hover:bg-blue-50" onClick={() => { onOpenChange(false); onEdit(invoice); }}>
              تعديل
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}