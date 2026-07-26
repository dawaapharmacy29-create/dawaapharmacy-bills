import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CATEGORY_LABELS } from "@/lib/purchaseCalculations";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

const fmt = (n) => (n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 0 });

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function normalizeInvoiceNumber(value) {
  const normalized = String(value || "")
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .trim();

  const numericPart = normalized.match(/\d+/g)?.join("");
  return numericPart ? Number(numericPart) : null;
}

export default function DashboardDetailModal({ open, onClose, title, branch, period, invoices, formula }) {
  const [invoiceSort, setInvoiceSort] = useState("desc");
  const total = invoices.reduce((s, i) => s + (i.total_value || 0), 0);

  const sortedInvoices = useMemo(() => {
    return invoices
      .map((invoice, originalIndex) => ({ invoice, originalIndex }))
      .sort((a, b) => {
        const aNumber = normalizeInvoiceNumber(a.invoice.system_invoice_number);
        const bNumber = normalizeInvoiceNumber(b.invoice.system_invoice_number);

        if (aNumber === null && bNumber === null) return a.originalIndex - b.originalIndex;
        if (aNumber === null) return 1;
        if (bNumber === null) return -1;

        const difference = invoiceSort === "asc" ? aNumber - bNumber : bNumber - aNumber;
        return difference || a.originalIndex - b.originalIndex;
      })
      .map(({ invoice }) => invoice);
  }, [invoices, invoiceSort]);

  const toggleInvoiceSort = () => setInvoiceSort((current) => (current === "asc" ? "desc" : "asc"));
  const SortIcon = invoiceSort === "asc" ? ArrowUp : invoiceSort === "desc" ? ArrowDown : ArrowUpDown;

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
        <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
          <SortIcon className="h-3.5 w-3.5" />
          الترتيب الحالي: رقم الفاتورة {invoiceSort === "asc" ? "من الأصغر إلى الأكبر" : "من الأكبر إلى الأصغر"}
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="text-right text-xs text-gray-400 border-b">
                <th className="p-2">
                  <button
                    type="button"
                    onClick={toggleInvoiceSort}
                    className="inline-flex items-center gap-1.5 font-semibold text-gray-600 hover:text-teal-700 focus:outline-none"
                    title={invoiceSort === "asc" ? "اضغط للترتيب من الأكبر إلى الأصغر" : "اضغط للترتيب من الأصغر إلى الأكبر"}
                  >
                    رقم الفاتورة
                    <SortIcon className="h-3.5 w-3.5" />
                  </button>
                </th>
                <th className="p-2">المورد</th>
                <th className="p-2">الفرع</th>
                <th className="p-2">التاريخ</th>
                <th className="p-2">القيمة</th>
                <th className="p-2">التصنيف</th>
              </tr>
            </thead>
            <tbody>
              {sortedInvoices.map((inv) => (
                <tr key={inv.id} className="border-b hover:bg-gray-50">
                  <td className="p-2 font-mono text-xs">{inv.system_invoice_number || "—"}</td>
                  <td className="p-2">{inv.supplier_name}</td>
                  <td className="p-2 text-xs">{inv.branch}</td>
                  <td className="p-2 text-xs">{inv.invoice_date}</td>
                  <td className="p-2 font-semibold">{fmt(inv.total_value)} ج</td>
                  <td className="p-2 text-xs">{CATEGORY_LABELS[inv.purchase_category || "unclassified"]}</td>
                </tr>
              ))}
              {sortedInvoices.length === 0 && (
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
