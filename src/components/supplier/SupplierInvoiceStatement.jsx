import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText } from "lucide-react";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortableHeader } from "@/components/table/SortableHeader";
import { SortControls } from "@/components/table/SortControls";

const STMT_SORT_COLUMNS = [
  { field: "system_invoice_number", label: "رقم الفاتورة", type: "text" },
  { field: "invoice_date", label: "تاريخ الفاتورة", type: "date" },
  { field: "branch", label: "الفرع", type: "text" },
  { field: "payment_type", label: "طريقة الدفع", type: "text" },
  { field: "total_value", label: "القيمة", type: "number" },
  { field: "returned_value", label: "المرتجع", type: "number" },
  { field: "paid_value", label: "المدفوع", type: "number" },
  { field: "remaining", label: "المتبقي", type: "number" },
];

export default function SupplierInvoiceStatement() {
  const today = new Date().toISOString().split("T")[0];
  const firstOfMonth = today.slice(0, 8) + "01";

  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today);

  const { data: invoices = [] } = useQuery({
    queryKey: ["purchase-invoices"],
    staleTime: 60000,
    placeholderData: (prev) => prev,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["supplier-payments"],
    staleTime: 60000,
  });

  const fmt = (n) => Number(n || 0).toLocaleString("ar-EG");

  const supplierNames = useMemo(() => {
    const names = new Set(invoices.map(i => i.supplier_name).filter(Boolean));
    return [...names].sort();
  }, [invoices]);

  const filtered = useMemo(() => {
    if (!selectedSupplier || !dateFrom || !dateTo) return null;
    return invoices.filter(inv => {
      const d = (inv.invoice_date || inv.created_date || "").slice(0, 10);
      return inv.supplier_name === selectedSupplier && d >= dateFrom && d <= dateTo;
    });
  }, [invoices, selectedSupplier, dateFrom, dateTo]);

  const periodPayments = useMemo(() => {
    if (!selectedSupplier || !dateFrom || !dateTo) return [];
    return payments.filter(p => {
      const d = (p.payment_date || "").slice(0, 10);
      return p.supplier_name === selectedSupplier && d >= dateFrom && d <= dateTo;
    });
  }, [payments, selectedSupplier, dateFrom, dateTo]);

  const totalPurchases = filtered?.reduce((s, i) => s + (i.total_value || 0), 0) || 0;
  const totalReturned = filtered?.reduce((s, i) => s + (i.returned_value || 0), 0) || 0;
  const totalNet = totalPurchases - totalReturned;
  const totalPaid = periodPayments.reduce((s, p) => s + (p.amount || 0), 0);
  const totalRemaining = filtered?.reduce((s, i) => s + Math.max(0, (i.total_value || 0) - (i.returned_value || 0) - (i.paid_value || 0)), 0) || 0;

  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({
    columns: STMT_SORT_COLUMNS,
    defaultSort: { field: "invoice_date", direction: "desc" },
    paramPrefix: "stmt",
  });
  const sortedFiltered = useMemo(() => sortData(
    (filtered || []).map(inv => ({ ...inv, remaining: Math.max(0, (inv.total_value || 0) - (inv.returned_value || 0) - (inv.paid_value || 0)) }))
  ), [filtered, sortData]);

  return (
    <div dir="rtl" className="space-y-4">
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

      <SortControls
        columns={STMT_SORT_COLUMNS}
        sortField={sortField}
        sortDirection={sortDirection}
        onToggle={toggleSort}
        onSet={setSort}
        onReset={resetSort}
      />

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
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card className="p-3 text-center bg-blue-50 border-blue-100">
              <p className="text-xs text-gray-500 mb-1">إجمالي المسحوبات</p>
              <p className="text-lg font-bold text-blue-700">{fmt(totalPurchases)} ج</p>
              <p className="text-xs text-gray-400">{filtered.length} فاتورة</p>
            </Card>
            <Card className="p-3 text-center bg-orange-50 border-orange-100">
              <p className="text-xs text-gray-500 mb-1">المرتجعات</p>
              <p className="text-lg font-bold text-orange-600">{fmt(totalReturned)} ج</p>
            </Card>
            <Card className="p-3 text-center bg-red-50 border-red-100">
              <p className="text-xs text-gray-500 mb-1">الصافي</p>
              <p className="text-lg font-bold text-red-600">{fmt(totalNet)} ج</p>
            </Card>
            <Card className="p-3 text-center bg-green-50 border-green-100">
              <p className="text-xs text-gray-500 mb-1">المدفوع</p>
              <p className="text-lg font-bold text-green-600">{fmt(totalPaid)} ج</p>
            </Card>
            <Card className="p-3 text-center bg-purple-50 border-purple-100">
              <p className="text-xs text-gray-500 mb-1">المتبقي</p>
              <p className="text-lg font-bold text-purple-700">{fmt(totalRemaining)} ج</p>
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
                    <SortableHeader field="system_invoice_number" label="رقم الفاتورة" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="text-right text-xs" />
                    <SortableHeader field="invoice_date" label="تاريخ الفاتورة" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="text-right text-xs" />
                    <SortableHeader field="branch" label="الفرع" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="text-right text-xs" />
                    <SortableHeader field="payment_type" label="طريقة الدفع" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="text-right text-xs" />
                    <SortableHeader field="total_value" label="القيمة" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="text-right text-xs" />
                    <SortableHeader field="returned_value" label="المرتجع" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="text-right text-xs" />
                    <SortableHeader field="paid_value" label="المدفوع" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="text-right text-xs" />
                    <SortableHeader field="remaining" label="المتبقي" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="text-right text-xs" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedFiltered.map(inv => {
                    const net = (inv.total_value || 0) - (inv.returned_value || 0);
                    const remaining = Math.max(0, net - (inv.paid_value || 0));
                    return (
                      <TableRow key={inv.id} className="hover:bg-gray-50 text-sm">
                        <TableCell className="font-mono text-teal-700">{inv.system_invoice_number}</TableCell>
                        <TableCell className="text-gray-600">{inv.invoice_date || inv.created_date?.slice(0, 10) || "—"}</TableCell>
                        <TableCell className="text-gray-600">{inv.branch || "—"}</TableCell>
                        <TableCell>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${inv.payment_type === "آجل" ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"}`}>
                            {inv.payment_type}
                          </span>
                        </TableCell>
                        <TableCell className="font-semibold">{fmt(inv.total_value)} ج</TableCell>
                        <TableCell className="text-orange-600">{fmt(inv.returned_value)} ج</TableCell>
                        <TableCell className="text-green-600">{fmt(inv.paid_value)} ج</TableCell>
                        <TableCell className={remaining > 0 ? "text-red-600 font-semibold" : "text-green-600"}>{fmt(remaining)} ج</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="px-4 py-3 border-t bg-gray-50 flex flex-wrap gap-4 text-sm font-semibold justify-end">
              <span className="text-blue-700">الإجمالي: {fmt(totalPurchases)} ج</span>
              <span className="text-orange-600">المرتجع: {fmt(totalReturned)} ج</span>
              <span className="text-red-600">الصافي: {fmt(totalNet)} ج</span>
              <span className="text-green-600">المدفوع: {fmt(totalPaid)} ج</span>
              <span className="text-purple-700">المتبقي: {fmt(totalRemaining)} ج</span>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}