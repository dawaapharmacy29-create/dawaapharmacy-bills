import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, X } from "lucide-react";

const BRANCHES = ["دواء شكري", "دواء الشامي"];

export default function SupplierStatement({ branch, onClose }) {
  const today = new Date().toISOString().split("T")[0];
  const firstOfMonth = today.slice(0, 8) + "01";

  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [selectedSupplier, setSelectedSupplier] = useState("");

  const { data: allInvoices = [] } = useQuery({
    queryKey: ["purchase-invoices"],
    queryFn: () => base44.entities.PurchaseInvoice.list("-created_date", 2000),
    staleTime: 60000,
  });
  const { data: payments = [] } = useQuery({
    queryKey: ["supplier-payments"],
    queryFn: () => base44.entities.SupplierPayment.list("-payment_date"),
    staleTime: 60000,
  });

  const branchInvoices = useMemo(() => allInvoices.filter(i => i.branch === branch), [allInvoices, branch]);

  const supplierNames = useMemo(() => {
    const names = new Set(branchInvoices.map(i => i.supplier_name).filter(Boolean));
    return [...names].sort();
  }, [branchInvoices]);

  const filtered = useMemo(() => {
    if (!selectedSupplier || !dateFrom || !dateTo) return null;
    return branchInvoices.filter(inv => {
      const d = (inv.invoice_date || inv.created_date || "").slice(0, 10);
      return inv.supplier_name === selectedSupplier && d >= dateFrom && d <= dateTo;
    });
  }, [branchInvoices, selectedSupplier, dateFrom, dateTo]);

  const periodPayments = useMemo(() => {
    if (!selectedSupplier || !dateFrom || !dateTo) return [];
    return payments.filter(p => {
      const d = (p.payment_date || "").slice(0, 10);
      return p.supplier_name === selectedSupplier && d >= dateFrom && d <= dateTo;
    });
  }, [payments, selectedSupplier, dateFrom, dateTo]);

  const fmt = (n) => Number(n || 0).toLocaleString("ar-EG");

  const totalPurchases = filtered?.reduce((s, i) => s + (i.total_value || 0), 0) || 0;
  const totalReturned = filtered?.reduce((s, i) => s + (i.returned_value || 0), 0) || 0;
  const totalNet = totalPurchases - totalReturned;
  const totalPaid = periodPayments.reduce((s, p) => s + (p.amount || 0), 0);

  return (
    <div dir="rtl" className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-bold text-gray-800">كشف حساب مورد — {branch}</h2>
        </div>
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose} className="text-gray-500">
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label>المورد</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={selectedSupplier}
              onChange={e => setSelectedSupplier(e.target.value)}
            >
              <option value="">-- اختر مورد --</option>
              {supplierNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label>من تاريخ</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>إلى تاريخ</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
        </div>
      </Card>

      {/* Results */}
      {filtered === null ? (
        <Card className="p-10 text-center text-gray-400">
          <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>اختر مورداً ومدة زمنية لعرض كشف الحساب</p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center text-gray-400">
          <p>لا توجد فواتير لهذا المورد في المدة المحددة</p>
        </Card>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-4 text-center bg-blue-50 border-blue-100">
              <p className="text-xs text-gray-500 mb-1">إجمالي المسحوبات</p>
              <p className="text-xl font-bold text-blue-700">{fmt(totalPurchases)} ج</p>
              <p className="text-xs text-gray-400 mt-1">{filtered.length} فاتورة</p>
            </Card>
            <Card className="p-4 text-center bg-orange-50 border-orange-100">
              <p className="text-xs text-gray-500 mb-1">المرتجعات</p>
              <p className="text-xl font-bold text-orange-600">{fmt(totalReturned)} ج</p>
            </Card>
            <Card className="p-4 text-center bg-red-50 border-red-100">
              <p className="text-xs text-gray-500 mb-1">الصافي</p>
              <p className="text-xl font-bold text-red-600">{fmt(totalNet)} ج</p>
            </Card>
            <Card className="p-4 text-center bg-green-50 border-green-100">
              <p className="text-xs text-gray-500 mb-1">المدفوع في المدة</p>
              <p className="text-xl font-bold text-green-600">{fmt(totalPaid)} ج</p>
            </Card>
          </div>

          {/* Invoices Table */}
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50">
              <p className="font-semibold text-gray-700 text-sm">الفواتير ({filtered.length})</p>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="text-right text-xs">رقم الفاتورة</TableHead>
                    <TableHead className="text-right text-xs">تاريخ الفاتورة</TableHead>
                    <TableHead className="text-right text-xs">طريقة الدفع</TableHead>
                    <TableHead className="text-right text-xs">القيمة</TableHead>
                    <TableHead className="text-right text-xs">المرتجع</TableHead>
                    <TableHead className="text-right text-xs">الصافي</TableHead>
                    <TableHead className="text-right text-xs">المدفوع</TableHead>
                    <TableHead className="text-right text-xs">المتبقي</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(inv => {
                    const net = (inv.total_value || 0) - (inv.returned_value || 0);
                    const remaining = net - (inv.paid_value || 0);
                    return (
                      <TableRow key={inv.id} className="hover:bg-gray-50 text-sm">
                        <TableCell className="font-mono text-teal-700">{inv.system_invoice_number}</TableCell>
                        <TableCell className="text-gray-600">{inv.invoice_date || inv.created_date?.slice(0, 10) || "—"}</TableCell>
                        <TableCell>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${inv.payment_type === "آجل" ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"}`}>
                            {inv.payment_type}
                          </span>
                        </TableCell>
                        <TableCell className="font-semibold">{fmt(inv.total_value)} ج</TableCell>
                        <TableCell className="text-orange-600">{fmt(inv.returned_value)} ج</TableCell>
                        <TableCell className="font-semibold">{fmt(net)} ج</TableCell>
                        <TableCell className="text-green-600">{fmt(inv.paid_value)} ج</TableCell>
                        <TableCell className={remaining > 0 ? "text-red-600 font-semibold" : "text-green-600"}>{fmt(remaining)} ج</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {/* Footer Total */}
            <div className="px-4 py-3 border-t bg-gray-50 flex flex-wrap gap-6 text-sm font-semibold justify-end">
              <span className="text-blue-700">الإجمالي: {fmt(totalPurchases)} ج</span>
              <span className="text-orange-600">المرتجع: {fmt(totalReturned)} ج</span>
              <span className="text-red-600">الصافي: {fmt(totalNet)} ج</span>
              <span className="text-green-600">المدفوع: {fmt(periodPayments.reduce((s, p) => s + (p.amount || 0), 0))} ج</span>
            </div>
          </Card>

          {/* Payments Table */}
          {periodPayments.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b bg-green-50">
                <p className="font-semibold text-green-700 text-sm">المدفوعات في هذه المدة ({periodPayments.length})</p>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="text-right text-xs">تاريخ السداد</TableHead>
                      <TableHead className="text-right text-xs">رقم الفاتورة</TableHead>
                      <TableHead className="text-right text-xs">ملاحظات</TableHead>
                      <TableHead className="text-right text-xs">المبلغ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {periodPayments.map(p => (
                      <TableRow key={p.id} className="text-sm">
                        <TableCell className="text-gray-600">{p.payment_date}</TableCell>
                        <TableCell className="font-mono text-teal-700">{p.invoice_number || "—"}</TableCell>
                        <TableCell className="text-gray-500">{p.notes || "—"}</TableCell>
                        <TableCell className="font-semibold text-green-700">{fmt(p.amount)} ج</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}