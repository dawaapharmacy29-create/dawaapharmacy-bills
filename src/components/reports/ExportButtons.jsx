import { Button } from "@/components/ui/button";
import { FileDown, FileSpreadsheet } from "lucide-react";
import jsPDF from "jspdf";

const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

function toCSV(rows, headers) {
  const lines = [headers.join(",")];
  rows.forEach((r) => lines.push(r.map((c) => `"${c}"`).join(",")));
  return lines.join("\n");
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob(["\ufeff" + content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportButtons({ invoices, expenses, year, branchData, monthlyData }) {
  const exportExcel = () => {
    // Invoices sheet
    const invHeaders = ["رقم الفاتورة", "المورد", "الفرع", "القيمة الإجمالية", "المرتجع", "المدفوع", "المتبقي", "طريقة الدفع", "الحالة"];
    const invRows = invoices.map((i) => [
      i.system_invoice_number,
      i.supplier_name || "",
      i.branch || "",
      i.total_value || 0,
      i.returned_value || 0,
      i.paid_value || 0,
      (i.total_value || 0) - (i.returned_value || 0) - (i.paid_value || 0),
      i.payment_type || "",
      i.status || "",
    ]);

    // Expenses sheet
    const expHeaders = ["الوصف", "المبلغ", "الفرع", "الفئة", "التاريخ"];
    const expRows = expenses.map((e) => [e.description, e.amount || 0, e.branch || "", e.category || "", e.date || ""]);

    // Monthly summary
    const sumHeaders = ["الشهر", "المشتريات", "المصروفات"];
    const sumRows = monthlyData.map((m) => [m.month, m.invoices, m.expenses]);

    const invCSV = toCSV(invRows, invHeaders);
    const expCSV = toCSV(expRows, expHeaders);
    const sumCSV = toCSV(sumRows, sumHeaders);

    const combined = `--- فواتير الشراء ---\n${invCSV}\n\n--- المصروفات ---\n${expCSV}\n\n--- الملخص الشهري ---\n${sumCSV}`;
    downloadFile(combined, `تقرير_مالي_${year}.csv`, "text/csv;charset=utf-8;");
  };

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(`Financial Report - ${year}`, 148, 15, { align: "center" });

    // Branch summary table
    doc.setFontSize(12);
    doc.text("Branch Summary", 14, 28);

    const branchHeaders = ["Branch", "Purchases (EGP)", "Expenses (EGP)", "Total (EGP)"];
    let y = 35;
    const colW = [50, 50, 50, 50];
    const startX = 14;

    // Header row
    doc.setFillColor(59, 130, 246);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    branchHeaders.forEach((h, i) => {
      const x = startX + colW.slice(0, i).reduce((a, b) => a + b, 0);
      doc.rect(x, y - 5, colW[i], 8, "F");
      doc.text(h, x + 2, y);
    });
    doc.setTextColor(0, 0, 0);
    y += 8;

    branchData.forEach((row, idx) => {
      if (idx % 2 === 0) {
        doc.setFillColor(240, 247, 255);
        doc.rect(startX, y - 5, colW.reduce((a, b) => a + b, 0), 8, "F");
      }
      doc.setFontSize(9);
      const total = row["مشتريات"] + row["مصروفات"];
      [row.branch, row["مشتريات"].toLocaleString(), row["مصروفات"].toLocaleString(), total.toLocaleString()].forEach((v, i) => {
        const x = startX + colW.slice(0, i).reduce((a, b) => a + b, 0);
        doc.text(String(v), x + 2, y);
      });
      y += 8;
    });

    y += 10;

    // Monthly summary
    doc.setFontSize(12);
    doc.text("Monthly Summary", 14, y);
    y += 8;

    const mHeaders = ["Month", "Purchases", "Expenses"];
    const mColW = [40, 40, 40];
    doc.setFillColor(59, 130, 246);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    mHeaders.forEach((h, i) => {
      const x = startX + mColW.slice(0, i).reduce((a, b) => a + b, 0);
      doc.rect(x, y - 5, mColW[i], 8, "F");
      doc.text(h, x + 2, y);
    });
    doc.setTextColor(0, 0, 0);
    y += 8;

    monthlyData.forEach((row, idx) => {
      if (y > 185) {
        doc.addPage();
        y = 15;
      }
      if (idx % 2 === 0) {
        doc.setFillColor(240, 247, 255);
        doc.rect(startX, y - 5, mColW.reduce((a, b) => a + b, 0), 8, "F");
      }
      doc.setFontSize(9);
      [row.month, row.invoices.toLocaleString(), row.expenses.toLocaleString()].forEach((v, i) => {
        const x = startX + mColW.slice(0, i).reduce((a, b) => a + b, 0);
        doc.text(String(v), x + 2, y);
      });
      y += 8;
    });

    doc.save(`financial_report_${year}.pdf`);
  };

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={exportExcel} className="text-green-700 border-green-300 hover:bg-green-50">
        <FileSpreadsheet className="w-4 h-4 ml-1" />
        تصدير Excel
      </Button>
      <Button variant="outline" size="sm" onClick={exportPDF} className="text-red-600 border-red-300 hover:bg-red-50">
        <FileDown className="w-4 h-4 ml-1" />
        تصدير PDF
      </Button>
    </div>
  );
}