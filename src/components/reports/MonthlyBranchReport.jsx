import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FileDown } from "lucide-react";
import jsPDF from "jspdf";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

function getMonthKey(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function MonthlyBranchReport({ invoices, expenses, singleBranch }) {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);

  // Build available months
  const availableMonths = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 2; y--) {
    for (let m = 12; m >= 1; m--) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      availableMonths.push({ key, label: `${MONTHS_AR[m - 1]} ${y}` });
    }
  }

  const filteredInvoices = invoices.filter((i) => getMonthKey(i.invoice_date || i.created_date) === selectedMonth);

  // Build supplier stats from invoices
  const supplierMap = {};
  filteredInvoices.forEach((inv) => {
    const name = inv.supplier_name || "غير محدد";
    if (!supplierMap[name]) supplierMap[name] = { name, count: 0, total: 0, cash: 0, credit: 0, other: 0 };
    supplierMap[name].count += 1;
    supplierMap[name].total += inv.total_value || 0;
    if (inv.payment_type === "كاش") supplierMap[name].cash += inv.total_value || 0;
    else if (inv.payment_type === "آجل") supplierMap[name].credit += inv.total_value || 0;
    else supplierMap[name].other += inv.total_value || 0;
  });
  const supplierStats = Object.values(supplierMap).sort((a, b) => b.total - a.total);

  const monthLabel = availableMonths.find((m) => m.key === selectedMonth)?.label || selectedMonth;

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    doc.setFontSize(14);
    doc.text(`Suppliers Report - ${monthLabel}`, 105, 15, { align: "center" });
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString("en-GB")}`, 105, 22, { align: "center" });

    let y = 32;
    const startX = 14;

    supplierStats.forEach((stat) => {
      const rows = [
        ["عدد الفواتير", String(stat.count)],
        ["إجمالي المشتريات", stat.total.toLocaleString("en-EG") + " EGP"],
        ["كاش", stat.cash.toLocaleString("en-EG") + " EGP"],
        ["آجل", stat.credit.toLocaleString("en-EG") + " EGP"],
        ["أخرى", stat.other.toLocaleString("en-EG") + " EGP"],
      ];

      doc.setFillColor(59, 130, 246);
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(11);
      doc.rect(startX, y, 182, 8, "F");
      doc.text(stat.name, startX + 3, y + 5.5);
      doc.setTextColor(0, 0, 0);
      y += 10;

      doc.setFontSize(9);
      rows.forEach(([label, value], idx) => {
        if (idx % 2 === 0) { doc.setFillColor(245, 247, 250); doc.rect(startX, y, 182, 7, "F"); }
        doc.text(label, startX + 3, y + 4.5);
        doc.text(value, startX + 179, y + 4.5, { align: "right" });
        y += 7;
      });
      y += 4;
      if (y > 260) { doc.addPage(); y = 20; }
    });

    doc.save(`suppliers_report_${selectedMonth}.pdf`);
  };

  const fmt = (n) => n.toLocaleString("ar-EG");

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-sm font-semibold text-gray-700">تقرير الموردين الشهري</h2>
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white"
        >
          {availableMonths.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
      </div>

      {supplierStats.length === 0 ? (
        <p className="text-center text-gray-400 py-6">لا توجد فواتير لهذا الشهر</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th className="p-2 border text-right">المورد</th>
                <th className="p-2 border text-center">عدد الفواتير</th>
                <th className="p-2 border text-center">إجمالي المشتريات</th>
                <th className="p-2 border text-center">كاش</th>
                <th className="p-2 border text-center">آجل</th>
                <th className="p-2 border text-center">أخرى</th>
              </tr>
            </thead>
            <tbody>
              {supplierStats.map((stat) => (
                <tr key={stat.name} className="hover:bg-gray-50">
                  <td className="p-2 border font-semibold text-gray-700">{stat.name}</td>
                  <td className="p-2 border text-center">{stat.count}</td>
                  <td className="p-2 border text-center font-semibold text-blue-700">{fmt(stat.total)} ج</td>
                  <td className="p-2 border text-center text-green-700">{fmt(stat.cash)} ج</td>
                  <td className="p-2 border text-center text-orange-700">{fmt(stat.credit)} ج</td>
                  <td className="p-2 border text-center text-gray-600">{fmt(stat.other)} ج</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-teal-50 font-bold">
                <td className="p-2 border text-teal-800">الإجمالي</td>
                <td className="p-2 border text-center text-teal-800">{supplierStats.reduce((s, b) => s + b.count, 0)}</td>
                <td className="p-2 border text-center text-blue-800">{fmt(supplierStats.reduce((s, b) => s + b.total, 0))} ج</td>
                <td className="p-2 border text-center text-green-800">{fmt(supplierStats.reduce((s, b) => s + b.cash, 0))} ج</td>
                <td className="p-2 border text-center text-orange-800">{fmt(supplierStats.reduce((s, b) => s + b.credit, 0))} ج</td>
                <td className="p-2 border text-center text-gray-700">{fmt(supplierStats.reduce((s, b) => s + b.other, 0))} ج</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}