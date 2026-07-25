import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileText, Users, Receipt, TrendingUp, Building2, Pencil, Check, Calendar } from "lucide-react";
import BranchBudgetCard from "@/components/dashboard/BranchBudgetCard";
import BudgetAlert from "@/components/dashboard/BudgetAlert";
import LowStockAlert from "@/components/dashboard/LowStockAlert";
import DailyProgressIndicator from "@/components/dashboard/DailyProgressIndicator";
import PurchaseDashboard from "@/components/dashboard/PurchaseDashboard";
import BranchSelector from "@/components/dashboard/BranchSelector";
import { getInvoiceNetAmount, getInvoiceCashAmount, isInvoiceExcluded } from "@/lib/purchaseCalculations";
import { useSearchParams } from "react-router-dom";

const BRANCHES = ["دواء شكري", "دواء الشامي"];

const branchColor = {
  "دواء شكري": "bg-blue-50 border-blue-200 text-blue-700",
  "دواء الشامي": "bg-purple-50 border-purple-200 text-purple-700",
};

const today = new Date().toISOString().split("T")[0];
const firstOfMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;

function getStoredDates() {
  try {
    const s = localStorage.getItem("dashboard_date_filter");
    if (s) return JSON.parse(s);
  } catch {}
  return { from: firstOfMonth, to: today };
}

export default function Dashboard() {
  const qc = useQueryClient();
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState("");
  const [dateFilter, setDateFilter] = useState(getStoredDates);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const branch = searchParams.get("branch") || "all";
  const setBranch = (b) => {
    const next = new URLSearchParams(searchParams);
    if (b === "all") next.delete("branch");
    else next.set("branch", b);
    setSearchParams(next, { replace: true });
  };
  const [tempDate, setTempDate] = useState(getStoredDates);

  const applyDateFilter = () => {
    setDateFilter(tempDate);
    localStorage.setItem("dashboard_date_filter", JSON.stringify(tempDate));
    setShowDateFilter(false);
  };

  const { data: invoices = [], isLoading: invoicesLoading, refetch: refetchInvoices } = useQuery({
    queryKey: ["purchase-invoices"],
    queryFn: async () => {
      const PAGE = 500; let all = []; let page = 0;
      while (true) {
        const batch = await base44.entities.PurchaseInvoice.list("-created_date", PAGE, page * PAGE);
        all = [...all, ...batch];
        if (batch.length < PAGE) break;
        page++;
      }
      return all;
    },
    staleTime: 20000,
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => base44.entities.Supplier.list(),
    staleTime: 60000,
  });
  const { data: expenses = [], refetch: refetchExpenses } = useQuery({
    queryKey: ["expenses"],
    queryFn: () => base44.entities.Expense.list("-created_date", 2000),
    staleTime: 20000,
  });
  const { data: budgets = [] } = useQuery({
    queryKey: ["branch-budgets"],
    queryFn: () => base44.entities.BranchBudget.list(),
    staleTime: 60000,
  });

  // Real-time subscriptions
  useEffect(() => {
    const unsub1 = base44.entities.PurchaseInvoice.subscribe(() => {
      refetchInvoices();
      qc.invalidateQueries({ queryKey: ["pending-invoices-count"] });
    });
    const unsub2 = base44.entities.Expense.subscribe(() => {
      refetchExpenses();
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  const currentMonth = new Date().toISOString().slice(0, 7);
  const { data: targetGoals = [] } = useQuery({
    queryKey: ["target-goals"],
    queryFn: () => base44.entities.TargetGoal.list(),
  });
  const currentTarget = targetGoals.find((t) => t.month === currentMonth);

  const saveTargetMutation = useMutation({
    mutationFn: async (amount) => {
      if (currentTarget) return base44.entities.TargetGoal.update(currentTarget.id, { target_amount: amount, month: currentMonth });
      return base44.entities.TargetGoal.create({ label: "الهدف الشهري", target_amount: amount, month: currentMonth });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["target-goals"] }); setEditingTarget(false); },
  });

  const now = new Date();
  const { from: monthStart, to: monthEnd } = dateFilter;

  const monthInvoices = invoices.filter((i) => {
    const d = i.invoice_date || i.created_date?.split("T")[0];
    return d && d >= monthStart && d <= monthEnd;
  });
  const monthExpenses = expenses.filter((e) => {
    const d = e.date || e.created_date?.split("T")[0];
    return d && d >= monthStart && d <= monthEnd;
  });
  const branchMonthInvoices = branch === "all" ? monthInvoices : monthInvoices.filter((i) => i.branch === branch);
  const branchMonthExpenses = branch === "all" ? monthExpenses : monthExpenses.filter((e) => e.branch === branch);

  const totalInvoiceValue = branchMonthInvoices.reduce((s, i) => s + getInvoiceNetAmount(i, suppliers), 0);
  const totalExpenses = branchMonthExpenses.reduce((s, e) => s + (e.amount || 0), 0);
  const totalPayments = totalInvoiceValue + totalExpenses;
  const targetAmount = currentTarget?.target_amount || 0;
  const targetPercent = targetAmount > 0 ? Math.min(Math.round((totalPayments / targetAmount) * 100), 100) : 0;
  const pending = invoices.filter((i) => i.status === "انتظار المراجعة" && (branch === "all" || i.branch === branch)).length;
  const totalCashPurchases = branchMonthInvoices
    .filter((i) => !isInvoiceExcluded(i, suppliers).excluded)
    .reduce((s, i) => s + getInvoiceCashAmount(i), 0);

  const stats = [
    { label: "فواتير الفترة", value: branchMonthInvoices.length, icon: FileText, color: "text-teal-600", bg: "bg-teal-50" },
    { label: "إجمالي قيمة المدفوعات", value: totalPayments.toLocaleString("ar-EG") + " ج", icon: TrendingUp, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "مشتريات الكاش", value: totalCashPurchases.toLocaleString("ar-EG") + " ج", icon: Users, color: "text-purple-600", bg: "bg-purple-50" },
    { label: "المصروفات", value: totalExpenses.toLocaleString("ar-EG") + " ج", icon: Receipt, color: "text-orange-600", bg: "bg-orange-50" },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">الصفحة الرئيسية</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            من {monthStart} إلى {monthEnd}
          </p>
        </div>
        <div className="relative">
          <Button variant="outline" size="sm" onClick={() => { setTempDate(dateFilter); setShowDateFilter((v) => !v); }} className="gap-2 text-sm">
            <Calendar className="w-4 h-4" /> تحديد الفترة
          </Button>
          {showDateFilter && (
            <div className="absolute left-0 top-10 z-50 bg-white border rounded-xl shadow-lg p-4 space-y-3 w-64 max-w-[calc(100vw-2rem)]" dir="rtl">
              <p className="text-sm font-semibold text-gray-700">اختر الفترة الزمنية</p>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">من تاريخ</label>
                <Input type="date" value={tempDate.from} onChange={(e) => setTempDate((p) => ({ ...p, from: e.target.value }))} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">إلى تاريخ</label>
                <Input type="date" value={tempDate.to} onChange={(e) => setTempDate((p) => ({ ...p, to: e.target.value }))} className="h-8 text-sm" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="bg-teal-600 hover:bg-teal-700 flex-1" onClick={applyDateFilter}>تطبيق</Button>
                <Button size="sm" variant="outline" onClick={() => setShowDateFilter(false)}>إلغاء</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <BranchSelector value={branch} onChange={setBranch} />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className={`p-4 flex items-center gap-3 ${s.label === "إجمالي قيمة المدفوعات" ? "col-span-2 md:col-span-1" : ""}`}>
            <div className={`p-2 rounded-lg ${s.bg}`}>
              <s.icon className={`w-5 h-5 ${s.color}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className="text-lg font-bold text-gray-800">{s.value}</p>
              {s.label === "إجمالي قيمة المدفوعات" && (
                <div className="mt-1.5">
                  {targetAmount > 0 ? (
                    <div>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-gray-400">المستهدف: {targetAmount.toLocaleString("ar-EG")} ج</span>
                        <span className={targetPercent >= 100 ? "text-red-600 font-bold" : targetPercent >= 80 ? "text-orange-500 font-bold" : "text-green-600 font-semibold"}>{targetPercent}%</span>
                      </div>
                      <DailyProgressIndicator startDate={monthStart} endDate={monthEnd} currentAmount={totalPayments} targetAmount={targetAmount} height="h-3" />
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">لم يحدد هدف شهري</p>
                  )}
                  {editingTarget ? (
                    <div className="flex gap-1 mt-1.5">
                      <Input type="number" value={targetInput} onChange={(e) => setTargetInput(e.target.value)} className="h-6 text-xs px-2 w-28" placeholder="الهدف..." />
                      <Button size="icon" className="h-6 w-6 bg-teal-600" onClick={() => saveTargetMutation.mutate(parseFloat(targetInput))}><Check className="w-3 h-3" /></Button>
                    </div>
                  ) : (
                    <button onClick={() => { setTargetInput(targetAmount ? targetAmount.toString() : ""); setEditingTarget(true); }} className="flex items-center gap-1 text-xs text-teal-600 hover:underline mt-1">
                      <Pencil className="w-3 h-3" /> تعديل الهدف
                    </button>
                  )}
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* Purchase Dashboard */}
      <PurchaseDashboard
        invoices={branchMonthInvoices}
        suppliers={suppliers}
        branch={branch}
        onBranchChange={setBranch}
        dateFilter={dateFilter}
        isLoading={invoicesLoading}
      />

      {/* Low Stock Alerts */}
      <LowStockAlert />

      {/* Budget Alerts */}
      <BudgetAlert invoices={branchMonthInvoices} expenses={branchMonthExpenses} budgets={budgets} suppliers={suppliers} />

      {/* Branch Budget */}
      <div>
        <BranchBudgetCard invoices={branchMonthInvoices} budgets={budgets} suppliers={suppliers} startDate={monthStart} endDate={monthEnd} />
      </div>

      {/* Branches Summary - only when all branches selected */}
      {branch === "all" && (
      <div>
        <h2 className="text-base font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Building2 className="w-4 h-4" /> ملخص الفروع
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {BRANCHES.map((branch) => {
            const branchInvoices = monthInvoices.filter((i) => i.branch === branch);
            const branchNetInvoices = branchInvoices.filter((i) => !isInvoiceExcluded(i, suppliers).excluded);
            const branchTotal = branchNetInvoices.reduce((s, i) => s + getInvoiceNetAmount(i, suppliers), 0);
            const branchPaid = branchInvoices.reduce((s, i) => s + (i.paid_value || 0), 0);
            const branchExpenses = monthExpenses.filter((e) => e.branch === branch);
            const branchExpTotal = branchExpenses.reduce((s, e) => s + (e.amount || 0), 0);
            return (
              <Card key={branch} className={`p-4 border-2 ${branchColor[branch]}`}>
                <h3 className="font-bold text-base mb-3">{branch}</h3>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span>عدد الفواتير (صافي)</span>
                    <span className="font-semibold">{branchNetInvoices.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>صافي المشتريات</span>
                    <span className="font-semibold">{branchTotal.toLocaleString("ar-EG")} ج</span>
                  </div>
                  <div className="flex justify-between">
                    <span>المدفوع</span>
                    <span className="font-semibold">{branchPaid.toLocaleString("ar-EG")} ج</span>
                  </div>
                  <div className="flex justify-between border-t pt-1.5 mt-1.5">
                    <span>المصروفات</span>
                    <span className="font-semibold">{branchExpTotal.toLocaleString("ar-EG")} ج</span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
      )}

      {/* Pending invoices */}
      {pending > 0 && (
        <Card className="p-4 border-yellow-200 bg-yellow-50">
          <p className="text-yellow-800 font-semibold text-sm">
            ⏳ يوجد {pending} فاتورة في انتظار المراجعة
          </p>
        </Card>
      )}
    </div>
  );
}