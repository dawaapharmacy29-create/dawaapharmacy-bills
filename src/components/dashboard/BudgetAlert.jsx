import { Card } from "@/components/ui/card";
import { AlertTriangle, Bell } from "lucide-react";
import { getInvoiceNetAmount } from "@/lib/purchaseCalculations";

const BRANCHES = ["دواء شكري", "دواء الشامي"];

export default function BudgetAlert({ invoices, expenses, budgets, suppliers = [] }) {
  const alerts = BRANCHES.map((branch) => {
    const budget = budgets.find((b) => b.branch === branch);
    if (!budget) return null;
    const spent = invoices
      .filter((i) => i.branch === branch)
      .reduce((s, i) => s + getInvoiceNetAmount(i, suppliers), 0);
    const pct = budget.budget_limit > 0 ? (spent / budget.budget_limit) * 100 : 0;
    if (pct < 80) return null;
    return { branch, spent, limit: budget.budget_limit, pct: Math.round(pct) };
  }).filter(Boolean);

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      {alerts.map((a) => (
        <Card key={a.branch} className={`p-3 flex items-center gap-3 border-r-4 ${a.pct >= 100 ? "border-r-red-500 bg-red-50" : "border-r-orange-400 bg-orange-50"}`}>
          {a.pct >= 100
            ? <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
            : <Bell className="w-5 h-5 text-orange-500 shrink-0" />}
          <p className="text-sm font-medium text-gray-800">
            {a.pct >= 100
              ? `⚠️ ${a.branch}: تجاوز الميزانية! (${a.pct}%) — صُرف ${a.spent.toLocaleString("ar-EG")} ج من ${a.limit.toLocaleString("ar-EG")} ج`
              : `🔔 ${a.branch}: اقترب من الحد (${a.pct}%) — صُرف ${a.spent.toLocaleString("ar-EG")} ج من ${a.limit.toLocaleString("ar-EG")} ج`}
          </p>
        </Card>
      ))}
    </div>
  );
}