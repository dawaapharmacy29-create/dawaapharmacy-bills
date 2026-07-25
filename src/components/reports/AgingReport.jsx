import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const BUCKETS = [
  { label: "0-30 يوم", min: 0, max: 30, color: "bg-green-100 text-green-700" },
  { label: "31-60 يوم", min: 31, max: 60, color: "bg-yellow-100 text-yellow-700" },
  { label: "61-90 يوم", min: 61, max: 90, color: "bg-orange-100 text-orange-700" },
  { label: "+90 يوم", min: 91, max: Infinity, color: "bg-red-100 text-red-700" },
];

function daysSince(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  if (isNaN(d)) return 0;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export default function AgingReport({ invoices }) {
  const agingData = useMemo(() => {
    const unpaid = invoices.filter((i) => {
      const remaining = (i.total_value || 0) - (i.returned_value || 0) - (i.paid_value || 0);
      return remaining > 0 && i.payment_type === "آجل";
    });

    const buckets = BUCKETS.map((b) => ({ ...b, invoices: [], total: 0 }));

    unpaid.forEach((inv) => {
      const days = daysSince(inv.invoice_date || inv.created_date);
      const remaining = (inv.total_value || 0) - (inv.returned_value || 0) - (inv.paid_value || 0);
      const bucket = buckets.find((b) => days >= b.min && days <= b.max);
      if (bucket) {
        bucket.invoices.push({ ...inv, days, remaining });
        bucket.total += remaining;
      }
    });

    return buckets;
  }, [invoices]);

  const grandTotal = agingData.reduce((s, b) => s + b.total, 0);
  const fmt = (n) => Number(n || 0).toLocaleString("ar-EG");

  if (grandTotal === 0) return null;

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">تقرير عمر الديون (Aging Report) — الفواتير الآجلة فقط</h2>

      {/* Summary buckets */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {agingData.map((b) => (
          <div key={b.label} className={`rounded-lg p-3 ${b.color.replace("text-", "border-").replace("bg-", "border-")} border`}>
            <p className="text-xs font-medium mb-1">{b.label}</p>
            <p className={`text-lg font-bold ${b.color.split(" ")[1]}`}>{fmt(b.total)} ج</p>
            <p className="text-xs text-gray-500">{b.invoices.length} فاتورة</p>
          </div>
        ))}
      </div>

      {/* Detail table for overdue items */}
      {agingData.filter((b) => b.min > 30 && b.invoices.length > 0).map((b) => (
        <div key={b.label} className="mb-3">
          <p className="text-xs font-semibold text-gray-600 mb-1">{b.label} — تفاصيل</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="text-right text-xs">رقم الفاتورة</TableHead>
                  <TableHead className="text-right text-xs">المورد</TableHead>
                  <TableHead className="text-right text-xs">الفرع</TableHead>
                  <TableHead className="text-right text-xs">الأيام</TableHead>
                  <TableHead className="text-right text-xs">المتبقي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {b.invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-teal-700 text-xs">{inv.system_invoice_number}</TableCell>
                    <TableCell className="text-xs">{inv.supplier_name || "—"}</TableCell>
                    <TableCell className="text-xs">{inv.branch || "—"}</TableCell>
                    <TableCell><Badge className={`${b.color} border-0 text-xs`}>{inv.days} يوم</Badge></TableCell>
                    <TableCell className="font-semibold text-red-600 text-xs">{fmt(inv.remaining)} ج</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </Card>
  );
}