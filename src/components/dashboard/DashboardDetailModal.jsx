import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CATEGORY_LABELS } from "@/lib/purchaseCalculations";

const fmt = (n) => (n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 0 });

export default function DashboardDetailModal({ open, onClose, title, branch, period, invoices, formula }) {
  const total = invoices.reduce((s, i) => s + (i.total_value || 0), 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">{title}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-gray-500 mb-3 flex flex-wrap gap-3">
          <span>الفرع: {branch === "all" ? "كل الفروع" : branch}</span>
          {period && <span>الفترة: {period.from} → {period.to}</span>}
          <span>عدد الفواتير: {invoices.length}</span>
          <span className="font-semibold text-gray-700">الإجمالي: {fmt(total)} ج</span>
        </div>
        {formula && <div className="text-xs text-gray-400 bg-gray-50 p-2 rounded mb-3">{formula}</div>}
        <div className="max-h-[50vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="text-right text-xs text-gray-400 border-b">
                <th className="p-2">رقم الفاتورة</th>
                <th className="p-2">المورد</th>
                <th className="p-2">الفرع</th>
                <th className="p-2">التاريخ</th>
                <th className="p-2">القيمة</th>
                <th className="p-2">التصنيف</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b hover:bg-gray-50">
                  <td className="p-2 font-mono text-xs">{inv.system_invoice_number}</td>
                  <td className="p-2">{inv.supplier_name}</td>
                  <td className="p-2 text-xs">{inv.branch}</td>
                  <td className="p-2 text-xs">{inv.invoice_date}</td>
                  <td className="p-2 font-semibold">{fmt(inv.total_value)} ج</td>
                  <td className="p-2 text-xs">{CATEGORY_LABELS[inv.purchase_category || "unclassified"]}</td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr><td colSpan={6} className="p-4 text-center text-gray-400">لا توجد فواتير</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end mt-3">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">إغلاق</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}