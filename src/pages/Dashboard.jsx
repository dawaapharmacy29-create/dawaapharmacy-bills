import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileText, Users, Receipt, TrendingUp, Building2, Pencil, Check, Calendar, X, Target } from "lucide-react";
import BranchBudgetCard from "@/components/dashboard/BranchBudgetCard";
import BudgetAlert from "@/components/dashboard/BudgetAlert";
import LowStockAlert from "@/components/dashboard/LowStockAlert";
import DailyProgressIndicator from "@/components/dashboard/DailyProgressIndicator";
import PurchaseDashboard from "@/components/dashboard/PurchaseDashboard";
import BranchSelector from "@/components/dashboard/BranchSelector";
import { getInvoiceNetAmount, getInvoiceCashAmount, isInvoiceExcluded } from "@/lib/purchaseCalculations";
import { useSearchParams } from "react-router-dom";
import { useToast } from "@/components/ui/use-toast";
import { useUserRole } from "@/lib/useUserRole";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const branchColor = {
  "دواء شكري": "bg-blue-50 border-blue-200 text-blue-700",
  "دواء الشامي": "bg-purple-50 border-purple-200 text-purple-700",
};
const today = new Date().toISOString().split("T")[0];
const firstOfMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;

function getStoredDates() {
  try {
    const stored = localStorage.getItem("dashboard_date_filter");
    if (stored) return JSON.parse(stored);
  } catch {}
  return { from: firstOfMonth, to: today };
}

function money(value) {
  return Number(value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });
}

export default function Dashboard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isAdmin } = useUserRole();
  const [dateFilter, setDateFilter] = useState(getStoredDates);
  const [tempDate, setTempDate] = useState(getStoredDates);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInputs, setTargetInputs] = useState({ "دواء شكري": "", "دواء الشامي": "" });
  const [searchParams, setSearchParams] = useSearchParams();
  const branch = searchParams.get("branch") || "all";

  const setBranch = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value === "all") next.delete("branch");
    else next.set("branch", value);
    setSearchParams(next, { replace: true });
    setEditingTarget(false);
  };

  const applyDateFilter = () => {
    if (!tempDate.from || !tempDate.to || tempDate.from > tempDate.to) {
      toast({ title: "الفترة غير صحيحة", description: "تأكد من تاريخ البداية والنهاية.", variant: "destructive" });
      return;
    }
    setDateFilter(tempDate);
    localStorage.setItem("dashboard_date_filter", JSON.stringify(tempDate));
    setShowDateFilter(false);
  };

  const { data: invoices = [], isLoading: invoicesLoading, refetch: refetchInvoices } = useQuery({
    queryKey: ["purchase-invoices"],
    queryFn: async () => {
      const PAGE = 500;
      let all = [];
      let page = 0;
      while (true) {
        const batch = await base44.entities.PurchaseInvoice.list("-created_date", PAGE, page * PAGE);
        all = [...all, ...batch];
        if (batch.length < PAGE) break;
        page += 1;
      }
      return all;
    },
    staleTime: 20000,
    refetchOnWindowFocus: false,
  });

  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: () => base44.entities.Supplier.list(), staleTime: 60000 });
  const { data: expenses = [], refetch: refetchExpenses } = useQuery({ queryKey: ["expenses"], queryFn: () => base44.entities.Expense.list("-created_date", 2000), staleTime: 20000 });
  const { data: budgets = [] } = useQuery({ queryKey: ["branch-budgets"], queryFn: () => base44.entities.BranchBudget.list(), staleTime: 60000 });
  const currentMonth = new Date().toISOString().slice(0, 7);
  const { data: targetGoals = [], isError: targetError } = useQuery({ queryKey: ["target-goals"], queryFn: () => base44.entities.TargetGoal.list(), staleTime: 30000 });

  useEffect(() => {
    const unsub1 = base44.entities.PurchaseInvoice.subscribe(() => {
      refetchInvoices();
      qc.invalidateQueries({ queryKey: ["pending-invoices-count"] });
    });
    const unsub2 = base44.entities.Expense.subscribe(() => refetchExpenses());
    return () => { unsub1(); unsub2(); };
  }, [qc, refetchExpenses, refetchInvoices]);

  const branchTargets = useMemo(() => {
    const result = { "دواء شكري": 0, "دواء الشامي": 0 };
    BRANCHES.forEach((branchName) => {
      const row = targetGoals.find((goal) => goal.month === currentMonth && goal.branch === branchName);
      result[branchName] = Number(row?.target_amount || 0);
    });
    return result;
  }, [targetGoals, currentMonth]);

  const totalTarget = BRANCHES.reduce((sum, branchName) => sum + branchTargets[branchName], 0);
  const displayedTarget = branch === "all" ? totalTarget : branchTargets[branch] || 0;

  const saveTargetMutation = useMutation({
    mutationFn: async (values) => {
      for (const branchName of Object.keys(values)) {
        const amount = Number(values[branchName]);
        if (!Number.isFinite(amount) || amount < 0) throw new Error(`قيمة هدف ${branchName} غير صحيحة`);
        const existing = targetGoals.find((goal) => goal.month === currentMonth && goal.branch === branchName);
        const payload = {
          month: currentMonth,
          branch: branchName,
          goal_type: "sales",
          label: `الهدف الشهري - ${branchName}`,
          target_amount: amount,
        };
        if (existing) await base44.entities.TargetGoal.update(existing.id, payload);
        else await base44.entities.TargetGoal.create(payload);
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["target-goals"] });
      setEditingTarget(false);
      toast({ title: "تم حفظ التارجت", description: branch === "all" ? "تم تحديث هدف كل فرع والإجمالي سيُحسب تلقائيًا." : `تم تحديث هدف ${branch}.` });
    },
    onError: (error) => toast({ title: "تعذر حفظ التارجت", description: error?.message || "حدث خطأ غير متوقع.", variant: "destructive" }),
  });

  const openTargetEditor = () => {
    setTargetInputs({
      "دواء شكري": String(branchTargets["دواء شكري"] || ""),
      "دواء الشامي": String(branchTargets["دواء الشامي"] || ""),
    });
    setEditingTarget(true);
  };

  const submitTargets = () => {
    if (branch === "all") {
      saveTargetMutation.mutate({ "دواء شكري": targetInputs["دواء شكري"], "دواء الشامي": targetInputs["دواء الشامي"] });
    } else {
      saveTargetMutation.mutate({ [branch]: targetInputs[branch] });
    }
  };

  const { from: monthStart, to: monthEnd } = dateFilter;
  const monthInvoices = invoices.filter((invoice) => {
    const date = invoice.invoice_date || invoice.created_date?.split("T")[0];
    return date && date >= monthStart && date <= monthEnd;
  });
  const monthExpenses = expenses.filter((expense) => {
    const date = expense.date || expense.created_date?.split("T")[0];
    return date && date >= monthStart && date <= monthEnd;
  });
  const branchMonthInvoices = branch === "all" ? monthInvoices : monthInvoices.filter((invoice) => invoice.branch === branch);
  const branchMonthExpenses = branch === "all" ? monthExpenses : monthExpenses.filter((expense) => expense.branch === branch);
  const totalInvoiceValue = branchMonthInvoices.reduce((sum, invoice) => sum + getInvoiceNetAmount(invoice, suppliers), 0);
  const totalExpenses = branchMonthExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const totalPayments = totalInvoiceValue + totalExpenses;
  const targetPercent = displayedTarget > 0 ? Math.min(Math.round((totalPayments / displayedTarget) * 100), 100) : 0;
  const pending = invoices.filter((invoice) => invoice.status === "انتظار المراجعة" && (branch === "all" || invoice.branch === branch)).length;
  const totalCashPurchases = branchMonthInvoices.filter((invoice) => !isInvoiceExcluded(invoice, suppliers).excluded).reduce((sum, invoice) => sum + getInvoiceCashAmount(invoice), 0);

  const stats = [
    { label: "فواتير الفترة", value: branchMonthInvoices.length, icon: FileText, color: "text-teal-600", bg: "bg-teal-50" },
    { label: "إجمالي قيمة المدفوعات", value: `${money(totalPayments)} ج`, icon: TrendingUp, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "مشتريات الكاش", value: `${money(totalCashPurchases)} ج`, icon: Users, color: "text-purple-600", bg: "bg-purple-50" },
    { label: "المصروفات", value: `${money(totalExpenses)} ج`, icon: Receipt, color: "text-orange-600", bg: "bg-orange-50" },
  ];

  return (
    <div dir="rtl" className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-gray-800">الصفحة الرئيسية</h1><p className="mt-0.5 text-sm text-gray-500">من {monthStart} إلى {monthEnd}</p></div>
        <div className="relative">
          <Button variant="outline" size="sm" onClick={() => { setTempDate(dateFilter); setShowDateFilter((value) => !value); }} className="gap-2"><Calendar className="h-4 w-4" /> تحديد الفترة</Button>
          {showDateFilter && <div className="absolute left-0 top-10 z-50 w-64 max-w-[calc(100vw-2rem)] space-y-3 rounded-xl border bg-white p-4 shadow-lg">
            <p className="text-sm font-semibold text-gray-700">اختر الفترة الزمنية</p>
            <div className="space-y-1"><label className="text-xs text-gray-500">من تاريخ</label><Input type="date" value={tempDate.from} onChange={(e) => setTempDate((old) => ({ ...old, from: e.target.value }))} /></div>
            <div className="space-y-1"><label className="text-xs text-gray-500">إلى تاريخ</label><Input type="date" value={tempDate.to} onChange={(e) => setTempDate((old) => ({ ...old, to: e.target.value }))} /></div>
            <div className="flex gap-2"><Button size="sm" className="flex-1 bg-teal-600 hover:bg-teal-700" onClick={applyDateFilter}>تطبيق</Button><Button size="sm" variant="outline" onClick={() => setShowDateFilter(false)}>إلغاء</Button></div>
          </div>}
        </div>
      </div>

      <BranchSelector value={branch} onChange={setBranch} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((item) => <Card key={item.label} className={`flex items-center gap-3 p-4 ${item.label === "إجمالي قيمة المدفوعات" ? "col-span-2 md:col-span-1" : ""}`}>
          <div className={`rounded-lg p-2 ${item.bg}`}><item.icon className={`h-5 w-5 ${item.color}`} /></div>
          <div className="min-w-0 flex-1"><p className="text-xs text-gray-500">{item.label}</p><p className="text-lg font-bold text-gray-800">{item.value}</p>
            {item.label === "إجمالي قيمة المدفوعات" && <div className="mt-1.5">
              {targetError ? <p className="text-xs text-red-600">تعذر تحميل التارجت</p> : displayedTarget > 0 ? <>
                <div className="mb-0.5 flex justify-between text-xs"><span className="text-gray-400">المستهدف: {money(displayedTarget)} ج</span><span className={targetPercent >= 100 ? "font-bold text-red-600" : targetPercent >= 80 ? "font-bold text-orange-500" : "font-semibold text-green-600"}>{targetPercent}%</span></div>
                <DailyProgressIndicator startDate={monthStart} endDate={monthEnd} currentAmount={totalPayments} targetAmount={displayedTarget} height="h-3" />
              </> : <p className="text-xs text-gray-400">لم يحدد هدف شهري</p>}
              {isAdmin && !editingTarget && <button type="button" onClick={openTargetEditor} className="mt-1 flex items-center gap-1 text-xs text-teal-600 hover:underline"><Pencil className="h-3 w-3" /> {branch === "all" ? "تعديل أهداف الفروع" : `تعديل هدف ${branch}`}</button>}
            </div>}
          </div>
        </Card>)}
      </div>

      {editingTarget && <Card className="border-teal-200 p-4">
        <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><Target className="h-5 w-5 text-teal-700" /><div><p className="font-bold">تعديل التارجت الشهري</p><p className="text-xs text-gray-500">الإجمالي يُحسب تلقائيًا من مجموع الفرعين.</p></div></div><Button size="icon" variant="ghost" onClick={() => setEditingTarget(false)}><X className="h-4 w-4" /></Button></div>
        <div className={`grid gap-3 ${branch === "all" ? "md:grid-cols-2" : "max-w-sm"}`}>
          {(branch === "all" ? BRANCHES : [branch]).map((branchName) => <div key={branchName} className="space-y-1"><label className="text-sm font-semibold">{branchName}</label><Input type="number" min="0" step="1000" value={targetInputs[branchName]} onChange={(e) => setTargetInputs((old) => ({ ...old, [branchName]: e.target.value }))} placeholder="اكتب الهدف الشهري" /></div>)}
        </div>
        {branch === "all" && <p className="mt-3 rounded-lg bg-gray-50 p-2 text-sm">الإجمالي المتوقع: <strong>{money(Number(targetInputs["دواء شكري"] || 0) + Number(targetInputs["دواء الشامي"] || 0))} ج</strong></p>}
        <div className="mt-3 flex gap-2"><Button onClick={submitTargets} disabled={saveTargetMutation.isPending} className="gap-2 bg-teal-600 hover:bg-teal-700"><Check className="h-4 w-4" /> {saveTargetMutation.isPending ? "جاري الحفظ..." : "حفظ التارجت"}</Button><Button variant="outline" onClick={() => setEditingTarget(false)}>إلغاء</Button></div>
      </Card>}

      <PurchaseDashboard invoices={branchMonthInvoices} suppliers={suppliers} branch={branch} onBranchChange={setBranch} dateFilter={dateFilter} isLoading={invoicesLoading} />
      <LowStockAlert />
      <BudgetAlert invoices={branchMonthInvoices} expenses={branchMonthExpenses} budgets={budgets} suppliers={suppliers} />
      <BranchBudgetCard invoices={branchMonthInvoices} budgets={budgets} suppliers={suppliers} startDate={monthStart} endDate={monthEnd} />

      {branch === "all" && <div><h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-700"><Building2 className="h-4 w-4" /> ملخص الفروع</h2><div className="grid gap-4 md:grid-cols-2">
        {BRANCHES.map((branchName) => {
          const branchInvoices = monthInvoices.filter((invoice) => invoice.branch === branchName);
          const branchNetInvoices = branchInvoices.filter((invoice) => !isInvoiceExcluded(invoice, suppliers).excluded);
          const branchTotal = branchNetInvoices.reduce((sum, invoice) => sum + getInvoiceNetAmount(invoice, suppliers), 0);
          const branchPaid = branchInvoices.reduce((sum, invoice) => sum + Number(invoice.paid_value || 0), 0);
          const branchExpenses = monthExpenses.filter((expense) => expense.branch === branchName).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
          const goal = branchTargets[branchName];
          const progress = goal > 0 ? Math.round(((branchTotal + branchExpenses) / goal) * 100) : 0;
          return <Card key={branchName} className={`border-2 p-4 ${branchColor[branchName]}`}><div className="mb-3 flex items-center justify-between"><h3 className="font-bold">{branchName}</h3><BadgeText value={goal ? `هدف ${money(goal)} ج` : "بدون هدف"} /></div><div className="space-y-1.5 text-sm"><div className="flex justify-between"><span>عدد الفواتير (صافي)</span><strong>{branchNetInvoices.length}</strong></div><div className="flex justify-between"><span>صافي المشتريات</span><strong>{money(branchTotal)} ج</strong></div><div className="flex justify-between"><span>المدفوع</span><strong>{money(branchPaid)} ج</strong></div><div className="flex justify-between border-t pt-1.5"><span>المصروفات</span><strong>{money(branchExpenses)} ج</strong></div>{goal > 0 && <div className="flex justify-between border-t pt-1.5"><span>نسبة التارجت</span><strong>{progress}%</strong></div>}</div></Card>;
        })}
      </div></div>}

      {pending > 0 && <Card className="border-yellow-200 bg-yellow-50 p-4"><p className="text-sm font-semibold text-yellow-800">⏳ يوجد {pending} فاتورة في انتظار المراجعة</p></Card>}
    </div>
  );
}

function BadgeText({ value }) {
  return <span className="rounded-full border bg-white/70 px-2 py-1 text-xs font-semibold">{value}</span>;
}
