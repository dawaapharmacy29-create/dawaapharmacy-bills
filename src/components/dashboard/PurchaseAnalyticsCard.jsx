import { Card } from "@/components/ui/card";
import { calculatePurchaseSummary, CATEGORY_LABELS } from "@/lib/purchaseCalculations";
import { Package, Ban, ArrowRightLeft, Stethoscope } from "lucide-react";

export default function PurchaseAnalyticsCard({ invoices, suppliers, startDate, endDate }) {
  const summary = calculatePurchaseSummary(invoices, suppliers, {
    dateFrom: startDate,
    dateTo: endDate,
  });

  const fmt = (n) => n.toLocaleString("ar-EG", { maximumFractionDigits: 0 });

  const categories = [
    { key: "medicines", value: summary.medicines_purchases, icon: Stethoscope, color: "text-teal-600", bg: "bg-teal-50" },
    { key: "supplies_accessories", value: summary.supplies_accessories_purchases, icon: Package, color: "text-indigo-600", bg: "bg-indigo-50" },
    { key: "unclassified", value: summary.unclassified_purchases, icon: Package, color: "text-gray-500", bg: "bg-gray-50" },
  ];

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-800 text-base">تحليل المشتريات</h3>
        <span className="text-xs text-gray-400">{summary.invoice_count} فاتورة</span>
      </div>

      {/* Net vs Gross vs Excluded */}
      <div className="grid grid-cols-3 gap-2">
        <div className="text-center p-2 rounded-lg bg-blue-50">
          <p className="text-xs text-gray-500 mb-0.5">إجمالي المشتريات</p>
          <p className="text-sm font-bold text-blue-700">{fmt(summary.gross_purchases)} ج</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-green-50 border-2 border-green-200">
          <p className="text-xs text-gray-500 mb-0.5">صافي المشتريات</p>
          <p className="text-sm font-bold text-green-700">{fmt(summary.net_purchases)} ج</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-red-50">
          <p className="text-xs text-gray-500 mb-0.5">المستثنى</p>
          <p className="text-sm font-bold text-red-700">{fmt(summary.excluded_purchases)} ج</p>
          <p className="text-[10px] text-red-400">{summary.excluded_count} فاتورة</p>
        </div>
      </div>

      {/* Excluded bar */}
      {summary.gross_purchases > 0 && (
        <div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden flex">
          <div
            className="bg-green-500"
            style={{ width: `${(summary.net_purchases / summary.gross_purchases) * 100}%` }}
          />
          <div
            className="bg-red-400"
            style={{ width: `${(summary.excluded_purchases / summary.gross_purchases) * 100}%` }}
          />
        </div>
      )}

      {/* Classification breakdown */}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-2">تصنيف المشتريات (الصافي)</p>
        <div className="space-y-1.5">
          {categories.map((c) => {
            const total = summary.medicines_purchases + summary.supplies_accessories_purchases + summary.unclassified_purchases;
            const pct = total > 0 ? (c.value / total) * 100 : 0;
            return (
              <div key={c.key} className="flex items-center gap-2">
                <div className={`p-1 rounded ${c.bg}`}>
                  <c.icon className={`w-3 h-3 ${c.color}`} />
                </div>
                <span className="text-xs text-gray-600 w-28">{CATEGORY_LABELS[c.key]}</span>
                <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className={`h-full ${c.color.replace("text-", "bg-")}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs font-semibold text-gray-700 w-16 text-left">{fmt(c.value)} ج</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Internal transfers */}
      {summary.internal_transfers_count > 0 && (
        <div className="flex items-center justify-between p-2 rounded-lg bg-purple-50">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-purple-600" />
            <span className="text-xs text-gray-600">التحويلات الداخلية</span>
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-purple-700">{fmt(summary.internal_transfers)} ج</p>
            <p className="text-[10px] text-purple-400">{summary.internal_transfers_count} فاتورة</p>
          </div>
        </div>
      )}
    </Card>
  );
}