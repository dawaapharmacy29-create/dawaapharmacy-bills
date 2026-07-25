import { Card } from "@/components/ui/card";
import { FileText, DollarSign, Clock, CheckCircle } from "lucide-react";

export default function InvoiceStats({ invoices }) {
  const total = invoices.length;
  const totalValue = invoices.reduce((s, i) => s + (i.total_value || 0), 0);
  const totalPaid = invoices.reduce((s, i) => s + (i.paid_value || 0), 0);
  const pending = invoices.filter((i) => i.status === "انتظار المراجعة").length;
  const saved = invoices.filter((i) => i.status === "يتم الحفظ").length;

  const stats = [
    {
      label: "إجمالي الفواتير",
      value: total,
      icon: FileText,
      color: "text-teal-600",
      bg: "bg-teal-50",
    },
    {
      label: "إجمالي القيمة",
      value: totalValue.toLocaleString("ar-EG"),
      icon: DollarSign,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "إجمالي المدفوع",
      value: totalPaid.toLocaleString("ar-EG"),
      icon: CheckCircle,
      color: "text-green-600",
      bg: "bg-green-50",
    },
    {
      label: "انتظار المراجعة",
      value: pending,
      icon: Clock,
      color: "text-yellow-600",
      bg: "bg-yellow-50",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <Card key={stat.label} className="p-4 flex items-center gap-3">
          <div className={`p-2 rounded-lg ${stat.bg}`}>
            <stat.icon className={`w-5 h-5 ${stat.color}`} />
          </div>
          <div>
            <p className="text-xs text-gray-500">{stat.label}</p>
            <p className="text-lg font-bold text-gray-800">{stat.value}</p>
          </div>
        </Card>
      ))}
    </div>
  );
}