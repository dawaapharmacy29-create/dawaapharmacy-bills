import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Loader2 } from "lucide-react";
import { buildLinkedPaymentsByInvoice, getInvoiceRemaining, roundMoney } from "@/lib/supplierFinancialIntegrity";

export default function PaymentAllocationDialog({ payment, invoices = [], payments = [], open, onOpenChange }) {
  const qc = useQueryClient();
  const [allocations, setAllocations] = useState({});
  const [error, setError] = useState("");

  useEffect(() => {
    setAllocations({});
    setError("");
  }, [payment?.id]);

  const linkedPaymentsByInvoice = useMemo(() => buildLinkedPaymentsByInvoice(payments), [payments]);
  const eligibleInvoices = useMemo(() => invoices
    .filter((invoice) =>
      payment && invoice.supplier_name === payment.supplier_name && invoice.branch === payment.branch &&
      invoice.payment_type === "آجل" && getInvoiceRemaining(invoice, linkedPaymentsByInvoice) > 0
    )
    .sort((a, b) => String(a.invoice_date || a.created_date || "").localeCompare(String(b.invoice_date || b.created_date || ""))),
  [invoices, payment, linkedPaymentsByInvoice]);

  const allocatedTotal = roundMoney(Object.values(allocations).reduce((sum, value) => sum + Number(value || 0), 0));
  const available = roundMoney(payment?.amount || 0);
  const remainingPayment = roundMoney(available - allocatedTotal);

  const setAllocation = (invoice, rawValue) => {
    const invoiceRemaining = getInvoiceRemaining(invoice, linkedPaymentsByInvoice);
    const value = Math.max(0, Math.min(roundMoney(rawValue), invoiceRemaining));
    setAllocations((current) => ({ ...current, [invoice.id]: value || "" }));
    setError("");
  };

  const autoAllocate = () => {
    let pool = available;
    const next = {};
    eligibleInvoices.forEach((invoice) => {
      if (pool <= 0) return;
      const invoiceRemaining = getInvoiceRemaining(invoice, linkedPaymentsByInvoice);
      const value = roundMoney(Math.min(pool, invoiceRemaining));
      if (value > 0) next[invoice.id] = value;
      pool = roundMoney(pool - value);
    });
    setAllocations(next);
    setError("");
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!payment?.id) throw new Error("تعذر تحديد الدفعة.");
      if (!payment.branch) throw new Error("لا يمكن توزيع دفعة بدون فرع.");
      if (allocatedTotal <= 0) throw new Error("أدخل مبلغًا واحدًا على الأقل للتوزيع.");
      if (allocatedTotal > available) throw new Error("إجمالي التوزيع أكبر من قيمة الدفعة.");

      const selected = eligibleInvoices
        .map((invoice) => ({ invoice, amount: roundMoney(allocations[invoice.id] || 0) }))
        .filter((item) => item.amount > 0);

      for (const { invoice, amount } of selected) {
        const invoiceRemaining = getInvoiceRemaining(invoice, linkedPaymentsByInvoice);
        if (amount > invoiceRemaining) throw new Error(`المبلغ المخصص للفاتورة ${invoice.system_invoice_number || invoice.id} أكبر من المتبقي.`);
      }

      // نُنشئ قيودًا مرتبطة أولاً، ثم نقلل رصيد الدفعة العامة. عند فشل تحديث الأصل نحاول التراجع.
      const createdIds = [];
      for (const { invoice, amount } of selected) {
        const created = await base44.entities.SupplierPayment.create({
          supplier_name: payment.supplier_name,
          branch: payment.branch,
          invoice_id: invoice.id,
          invoice_number: invoice.system_invoice_number || invoice.supplier_invoice_number || "",
          amount,
          payment_date: payment.payment_date,
          notes: `[توزيع من الدفعة ${payment.id}] ${payment.notes || ""}`.trim(),
        });
        if (created?.id) createdIds.push(created.id);
      }

      const allocationSummary = selected
        .map(({ invoice, amount }) => `${invoice.system_invoice_number || invoice.supplier_invoice_number || invoice.id}: ${amount}`)
        .join(" | ");
      try {
        await base44.entities.SupplierPayment.update(payment.id, {
          amount: remainingPayment,
          notes: `${payment.notes || ""}\n[تم توزيع ${allocatedTotal}] ${allocationSummary}`.trim(),
        });
      } catch (updateError) {
        await Promise.allSettled(createdIds.map((id) => base44.entities.SupplierPayment.delete(id)));
        throw updateError;
      }
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["supplier-payments"] }),
        qc.invalidateQueries({ queryKey: ["purchase-invoices"] }),
      ]);
      setAllocations({});
      setError("");
      onOpenChange(false);
    },
    onError: (err) => setError(err?.message || "تعذر توزيع الدفعة."),
  });

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!mutation.isPending) onOpenChange(value); }}>
      <DialogContent dir="rtl" className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>توزيع دفعة على الفواتير</DialogTitle></DialogHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg border p-3"><p className="text-gray-500">المورد</p><p className="font-bold">{payment?.supplier_name}</p></div>
          <div className="rounded-lg border p-3"><p className="text-gray-500">الفرع</p><p className="font-bold">{payment?.branch}</p></div>
          <div className="rounded-lg border p-3"><p className="text-gray-500">قيمة الدفعة</p><p className="font-bold text-green-700">{available.toLocaleString("ar-EG")} ج</p></div>
          <div className="rounded-lg border p-3"><p className="text-gray-500">المتبقي غير الموزع</p><p className={`font-bold ${remainingPayment < 0 ? "text-red-600" : "text-orange-600"}`}>{remainingPayment.toLocaleString("ar-EG")} ج</p></div>
        </div>

        {error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}

        <div className="flex justify-between items-center gap-2">
          <p className="text-sm text-gray-600">الفواتير الآجلة المفتوحة لنفس المورد والفرع، مرتبة من الأقدم.</p>
          <Button type="button" variant="outline" onClick={autoAllocate} disabled={!eligibleInvoices.length}>توزيع تلقائي على الأقدم</Button>
        </div>

        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="text-right">التاريخ</TableHead><TableHead className="text-right">رقم الفاتورة</TableHead>
              <TableHead className="text-right">صافي الفاتورة</TableHead><TableHead className="text-right">المتبقي</TableHead><TableHead className="text-right w-44">المبلغ المخصص</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {eligibleInvoices.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-500">لا توجد فواتير مفتوحة مطابقة.</TableCell></TableRow> : eligibleInvoices.map((invoice) => {
                const invoiceRemaining = getInvoiceRemaining(invoice, linkedPaymentsByInvoice);
                const net = roundMoney(Number(invoice.total_value || 0) - Number(invoice.returned_value || 0));
                return <TableRow key={invoice.id}>
                  <TableCell>{invoice.invoice_date || String(invoice.created_date || "").slice(0, 10) || "—"}</TableCell>
                  <TableCell className="font-mono">{invoice.system_invoice_number || invoice.supplier_invoice_number || "—"}</TableCell>
                  <TableCell>{net.toLocaleString("ar-EG")} ج</TableCell>
                  <TableCell><Badge variant="outline" className="text-red-700">{invoiceRemaining.toLocaleString("ar-EG")} ج</Badge></TableCell>
                  <TableCell><Input type="number" min="0" step="0.01" max={Math.min(invoiceRemaining, available)} value={allocations[invoice.id] ?? ""} onChange={(e) => setAllocation(invoice, e.target.value)} placeholder="0.00" /></TableCell>
                </TableRow>;
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex gap-2 justify-end text-sm">
          <Badge variant="secondary">إجمالي التوزيع: {allocatedTotal.toLocaleString("ar-EG")} ج</Badge>
          {remainingPayment === 0 && <Badge className="bg-green-600">تم توزيع الدفعة بالكامل</Badge>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>إلغاء</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || allocatedTotal <= 0 || remainingPayment < 0} className="bg-green-600 hover:bg-green-700">
            {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />} اعتماد التوزيع
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
