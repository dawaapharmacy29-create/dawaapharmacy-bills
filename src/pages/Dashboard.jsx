import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44, performanceApi } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileText, Users, Receipt, TrendingUp, Pencil, Calendar, Gauge, AlertTriangle, CheckCircle2 } from "lucide-react";
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

function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const today = localDate();
const firstOfMonth = `${today.slice(0, 7)}-01`;
const DEFAULT_DATES = { from: firstOfMonth, to: today };

function isValidDateValue(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeDates(value) {
  if (!value || typeof value !== "object") return { ...DEFAULT_DATES };
  const from = isValidDateValue(value.from) ? value.from : firstOfMonth;
  const to = isValidDateValue(value.to) ? value.to : today;
  if (from > to) return { ...DEFAULT_DATES };
  return { from, to };
}

function getStoredDates() {
  try {
    const stored = localStorage.getItem("dashboard_date_filter");
    if (stored) return normalizeDates(JSON.parse(stored));
  } catch {
    localStorage.removeItem("dashboard_date_filter");
  }
  return { ...DEFAULT_DATES };
}

function money(value) {
  return Number(value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });
}

async function loadInvoices({ branch, from, to }) {
  const pageSize = 200;
  const first = await performanceApi.invoices({
    branch,
    date_from: from,
    date_to: to,
    page: 1,
    page_size: pageSize,
    sort_by: "invoice_date",
    sort_direction: "desc",
  });
  const rows = [...(first?.rows || [])];
  const totalPages = Number(first?.total_pages || 1);
  for (let page = 2; page <= totalPages; page += 1) {
    const result = await performanceApi.invoices({
      branch,
      date_from: from,
      date_to: to,
      page,
      page_size: pageSize,
      sort_by: "invoice_date",
      sort_direction: "desc",
    });
    rows.push(...(result?.rows || []));
  }
  return rows;
}

export default function Dashboard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isAdmin } = useUserRole();
  const [dateFilter, setDateFilter] = useState(() => getStoredDates());
  const [tempDate, setTempDate] = useState(() => getStoredDates());
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [editingTarget, setEditingTarget] = useState(false);
  const [editingDailyLimit, setEditingDailyLimit] = useState(false);
  const [targetInputs, setTargetInputs] = useState({ "دواء شكري": "", "دواء الشامي": "" });
  const [dailyLimitInputs, setDailyLimitInputs] = useState({ "دواء شكري": "20000", "دواء الشامي": "20000" });
  const [searchParams, setSearchParams] = useSearchParams();
  const branch = searchParams.get("branch") || "all";
  const safeDates = normalizeDates(dateFilter);
  const monthStart = safeDates.from;
  const monthEnd = safeDates.to;

  const setBranch = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value === "all") next.delete("branch");
    else next.set("branch", value);
    setSearchParams(next, { replace: true });
    setEditingTarget(false);
    setEditingDailyLimit(false);
  };

  const applyDates = (nextDates) => {
    const normalized = normalizeDates(nextDates);
    setDateFilter(normalized);
    setTempDate(normalized);
    localStorage.setItem("dashboard_date_filter", JSON.stringify(normalized));
    setShowDateFilter(false);
  };

  const applyDateFilter = () => {
    if (!tempDate?.from || !tempDate?.to || tempDate.from > tempDate.to) {
      toast({ title: "الفترة غير صحيحة", description: "تأكد من تاريخ البداية والنهاية.", variant: "destructive" });
      return;
    }
    applyDates(tempDate);
  };

  const applyPreset = (preset) => {
    if (preset === "today") applyDates({ from: today, to: today });
    if (preset === "14days") applyDates({ from: localDate(-13), to: today });
    if (preset === "month") applyDates({ from: firstOfMonth, to: today });
  };

  const { data: invoices = [], isLoading: invoicesLoading, refetch: refetchInvoices, isError: invoicesError } = useQuery({
    queryKey: ["advanced-dashboard-invoices", monthStart, monthEnd, branch],
    queryFn: () => loadInvoices({ branch, from: monthStart, to: monthEnd }),
    staleTime: 20000,
    refetchOnWindowFocus: false,
  });

  const { data: todayInvoices = [], refetch: refetchTodayInvoices } = useQuery({
    queryKey: ["advanced-dashboard-today-invoices", today, branch],
    queryFn: () => loadInvoices({ branch, from: today, to: today }),
    staleTime: 15000,
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  });

  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: () => base44.entities.Supplier.list(), staleTime: 60000 });
  const { data: expenses = [], refetch: refetchExpenses } = useQuery({ queryKey: ["expenses"], queryFn: () => base44.entities.Expense.list("-created_date", 2000), staleTime: 20000 });
  const { data: budgets = [] } = useQuery({ queryKey: ["branch-budgets"], queryFn: () => base44.entities.BranchBudget.list(), staleTime: 60000 });
  const currentMonth = today.slice(0, 7);
  const { data: targetGoals = [], isError: targetError } = useQuery({ queryKey: ["target-goals"], queryFn: () => base44.entities.TargetGoal.list(), staleTime: 30000 });

  useEffect(() => {
    const unsub1 = base44.entities.PurchaseInvoice.subscribe(() => {
      refetchInvoices();
      refetchTodayInvoices();
      qc.invalidateQueries({ queryKey: ["pending-invoices-count"] });
    });
    const unsub2 = base44.entities.Expense.subscribe(() => refetchExpenses());
    return () => { unsub1(); unsub2(); };
  }, [qc, refetchExpenses, refetchInvoices, refetchTodayInvoices]);

  const branchTargets = useMemo(() => {
    const result = { "دواء شكري": 0, "دواء الشامي": 0 };
    BRANCHES.forEach((branchName) => {
      const row = targetGoals.find((goal) => goal.month === currentMonth && goal.branch === branchName && (goal.goal_type === "sales" || !goal.goal_type));
      result[branchName] = Number(row?.target_amount || 0);
    });
    return result;
  }, [targetGoals, currentMonth]);

  const dailyLimits = useMemo(() => {
    const result = { "دواء شكري": 20000, "دواء الشامي": 20000 };
    BRANCHES.forEach((branchName) => {
      const row = targetGoals.find((goal) => goal.month === currentMonth && goal.branch === branchName && goal.goal_type === "daily_purchase_limit");
      if (row) result[branchName] = Number(row.target_amount || 0);
    });
    return result;
  }, [targetGoals, currentMonth]);

  const totalTarget = BRANCHES.reduce((sum, branchName) => sum + branchTargets[branchName], 0);
  const displayedTarget = branch === "all" ? totalTarget : branchTargets[branch] || 0;
  const displayedDailyLimit = branch === "all"
    ? BRANCHES.reduce((sum, branchName) => sum + dailyLimits[branchName], 0)
    : dailyLimits[branch] || 0;

  const saveTargetMutation = useMutation({
    mutationFn: async (values) => {
      for (const branchName of Object.keys(values)) {
        const amount = Number(values[branchName]);
        if (!Number.isFinite(amount) || amount < 0) throw new Error(`قيمة هدف ${branchName} غير صحيحة`);
        const existing = targetGoals.find((goal) => goal.month === currentMonth && goal.branch === branchName && (goal.goal_type === "sales" || !goal.goal_type));
        const payload = { month: currentMonth, branch: branchName, goal_type: "sales", label: `الهدف الشهري - ${branchName}`, target_amount: amount };
        if (existing) await base44.entities.TargetGoal.update(existing.id, payload);
        else await base44.entities.TargetGoal.create(payload);
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["target-goals"] });
      setEditingTarget(false);
      toast({ title: "تم حفظ التارجت", description: "تم تحديث الهدف الشهري بنجاح." });
    },
    onError: (error) => toast({ title: "تعذر حفظ التارجت", description: error?.message || "حدث خطأ غير متوقع.", variant: "destructive" }),
  });

  const saveDailyLimitMutation = useMutation({
    mutationFn: async (values) => {
      for (const branchName of Object.keys(values)) {
        const amount = Number(values[branchName]);
        if (!Number.isFinite(amount) || amount < 0) throw new Error(`حد المشتريات اليومي لفرع ${branchName} غير صحيح`);
        const existing = targetGoals.find((goal) => goal.month === currentMonth && goal.branch === branchName && goal.goal_type === "daily_purchase_limit");
        const payload = { month: currentMonth, branch: branchName, goal_type: "daily_purchase_limit", label: `حد المشتريات اليومي - ${branchName}`, target_amount: amount };
        if (existing) await base44.entities.TargetGoal.update(existing.id, payload);
        else await base44.entities.TargetGoal.create(payload);
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["target-goals"] });
      setEditingDailyLimit(false);
      toast({ title: "تم حفظ الحد اليومي", description: "سيتم استخدامه في متابعة مشتريات اليوم والتنبيهات." });
    },
    onError: (error) => toast({ title: "تعذر حفظ الحد اليومي", description: error?.message || "حدث خطأ غير متوقع.", variant: "destructive" }),
  });

  const openTargetEditor = () => {
    setTargetInputs({ "دواء شكري": String(branchTargets["دواء شكري"] || ""), "دواء الشامي": String(branchTargets["دواء الشامي"] || "") });
    setEditingTarget(true);
  };

  const openDailyLimitEditor = () => {
    setDailyLimitInputs({ "دواء شكري": String(dailyLimits["دواء شكري"] || 20000), "دواء الشامي": String(dailyLimits["دواء الشامي"] || 20000) });
    setEditingDailyLimit(true);
  };

  const selectedBranches = branch === "all" ? BRANCHES : [branch];
  const submitTargets = () => saveTargetMutation.mutate(Object.fromEntries(selectedBranches.map((name) => [name, targetInputs[name]])));
  const submitDailyLimits = () => saveDailyLimitMutation.mutate(Object.fromEntries(selectedBranches.map((name) => [name, dailyLimitInputs[name]])));

  const monthExpenses = expenses.filter((expense) => {
    const date = expense.expense_date || expense.date || expense.created_date?.split("T")[0];
    return date && date >= monthStart && date <= monthEnd;
  });
  const branchMonthInvoices = invoices;
  const branchMonthExpenses = branch === "all" ? monthExpenses : monthExpenses.filter((expense) => expense.branch === branch);
  const totalInvoiceValue = branchMonthInvoices.reduce((sum, invoice) => sum + getInvoiceNetAmount(invoice, suppliers), 0);
  const totalExpenses = branchMonthExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const totalPayments = totalInvoiceValue + totalExpenses;
  const targetPercent = displayedTarget > 0 ? Math.min(Math.round((totalPayments / displayedTarget) * 100), 100) : 0;
  const pending = invoices.filter((invoice) => invoice.workflow_status === 'submitted').length;
  const totalCashPurchases = branchMonthInvoices.filter((invoice) => !isInvoiceExcluded(invoice, suppliers).excluded).reduce((sum, invoice) => sum + getInvoiceCashAmount(invoice), 0);

  const todayNetPurchases = todayInvoices.reduce((sum, invoice) => sum + getInvoiceNetAmount(invoice, suppliers), 0);
  const dailyLimitPercent = displayedDailyLimit > 0 ? Math.round((todayNetPurchases / displayedDailyLimit) * 100) : 0;
  const dailyRemaining = displayedDailyLimit - todayNetPurchases;
  const dailyExceeded = displayedDailyLimit > 0 && dailyRemaining < 0;

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
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border bg-white p-1 shadow-sm">
            <Button type="button" size="sm" variant={monthStart === today && monthEnd === today ? "default" : "ghost"} onClick={() => applyPreset("today")} className="h-8">اليوم</Button>
            <Button type="button" size="sm" variant={monthStart === localDate(-13) && monthEnd === today ? "default" : "ghost"} onClick={() => applyPreset("14days")} className="h-8">آخر 14 يوم</Button>
            <Button type="button" size="sm" variant={monthStart === firstOfMonth && monthEnd === today ? "default" : "ghost"} onClick={() => applyPreset("month")} className="h-8">الشهر الحالي</Button>
          </div>
          <div className="relative">
            <Button variant="outline" size="sm" onClick={() => { setTempDate({ ...safeDates }); setShowDateFilter((value) => !value); }} className="gap-2"><Calendar className="h-4 w-4" /> فترة مخصصة</Button>
            {showDateFilter && <div className="absolute left-0 top-10 z-50 w-64 max-w-[calc(100vw-2rem)] space-y-3 rounded-xl border bg-white p-4 shadow-lg">
              <p className="text-sm font-semibold text-gray-700">اختر الفترة الزمنية</p>
              <div className="space-y-1"><label className="text-xs text-gray-500">من تاريخ</label><Input type="date" value={tempDate?.from || firstOfMonth} onChange={(e) => setTempDate((old) => ({ ...normalizeDates(old), from: e.target.value }))} /></div>
              <div className="space-y-1"><label className="text-xs text-gray-500">إلى تاريخ</label><Input type="date" value={tempDate?.to || today} onChange={(e) => setTempDate((old) => ({ ...normalizeDates(old), to: e.target.value }))} /></div>
              <div className="flex gap-2"><Button size="sm" className="flex-1 bg-teal-600 hover:bg-teal-700" onClick={applyDateFilter}>تطبيق</Button><Button size="sm" variant="outline" onClick={() => setShowDateFilter(false)}>إلغاء</Button></div>
            </div>}
          </div>
        </div>
      </div>

      <BranchSelector value={branch} onChange={setBranch} />
      {invoicesError && <Card className="border-red-200 bg-red-50 p-3 text-sm text-red-700">تعذر تحميل الفواتير. حدّث الصفحة أو أعد تسجيل الدخول.</Card>}

      <Card className={`border-2 p-4 ${dailyExceeded ? "border-red-300 bg-red-50" : dailyLimitPercent >= 80 ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`rounded-xl p-3 ${dailyExceeded ? "bg-red-100" : "bg-white"}`}><Gauge className={`h-6 w-6 ${dailyExceeded ? "text-red-600" : "text-emerald-600"}`} /></div>
            <div>
              <div className="flex items-center gap-2"><h2 className="font-bold text-gray-800">متابعة مشتريات اليوم</h2>{dailyExceeded ? <AlertTriangle className="h-5 w-5 text-red-600" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}</div>
              <p className="text-sm text-gray-500">صافي مشتريات {branch === "all" ? "كل الفروع" : branch} بتاريخ {today}</p>
            </div>
          </div>
          <div className="grid min-w-[280px] flex-1 grid-cols-2 gap-3 md:max-w-2xl md:grid-cols-4">
            <div><p className="text-xs text-gray-500">مشتريات اليوم</p><p className="text-lg font-bold">{money(todayNetPurchases)} ج</p></div>
            <div><p className="text-xs text-gray-500">الحد اليومي</p><p className="text-lg font-bold">{money(displayedDailyLimit)} ج</p></div>
            <div><p className="text-xs text-gray-500">النسبة</p><p className={`text-lg font-bold ${dailyExceeded ? "text-red-600" : dailyLimitPercent >= 80 ? "text-amber-600" : "text-emerald-600"}`}>{dailyLimitPercent}%</p></div>
            <div><p className="text-xs text-gray-500">{dailyExceeded ? "تجاوز الحد" : "المتبقي"}</p><p className={`text-lg font-bold ${dailyExceeded ? "text-red-600" : "text-gray-800"}`}>{money(Math.abs(dailyRemaining))} ج</p></div>
          </div>
          {isAdmin && <Button variant="outline" size="sm" onClick={openDailyLimitEditor}><Pencil className="ml-1 h-4 w-4" /> تعديل الحد</Button>}
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-white"><div className={`h-full rounded-full transition-all ${dailyExceeded ? "bg-red-500" : dailyLimitPercent >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(dailyLimitPercent, 100)}%` }} /></div>
      </Card>

      {editingDailyLimit && <Card className="space-y-3 p-4">
        <p className="font-semibold text-gray-700">تعديل حد المشتريات اليومي</p>
        <p className="text-xs text-gray-500">الحد الافتراضي 20,000 جنيه لكل فرع، ويمكن تغييره في أي وقت.</p>
        <div className="grid gap-3 md:grid-cols-2">{selectedBranches.map((branchName) => <div key={branchName}><label className="mb-1 block text-xs text-gray-500">{branchName}</label><Input type="number" min="0" step="100" value={dailyLimitInputs[branchName]} onChange={(e) => setDailyLimitInputs((old) => ({ ...old, [branchName]: e.target.value }))} /></div>)}</div>
        <div className="flex gap-2"><Button onClick={submitDailyLimits} disabled={saveDailyLimitMutation.isPending}>حفظ الحد</Button><Button variant="outline" onClick={() => setEditingDailyLimit(false)}>إلغاء</Button></div>
      </Card>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((item) => <Card key={item.label} className={`flex items-center gap-3 p-4 ${item.label === "إجمالي قيمة المدفوعات" ? "col-span-2 md:col-span-1" : ""}`}>
          <div className={`rounded-lg p-2 ${item.bg}`}><item.icon className={`h-5 w-5 ${item.color}`} /></div>
          <div className="min-w-0 flex-1"><p className="text-xs text-gray-500">{item.label}</p><p className="text-lg font-bold text-gray-800">{item.value}</p>
            {item.label === "إجمالي قيمة المدفوعات" && <div className="mt-1.5">
              {targetError ? <p className="text-xs text-red-600">تعذر تحميل التارجت</p> : displayedTarget > 0 ? <>
                <div className="mb-0.5 flex justify-between text-xs"><span className="text-gray-400">المستهدف: {money(displayedTarget)} ج</span><span className={targetPercent >= 100 ? "font-bold text-red-600" : targetPercent >= 80 ? "font-bold text-orange-500" : "font-semibold text-green-600"}>{targetPercent}%</span></div>
                <DailyProgressIndicator startDate={monthStart} endDate={monthEnd} currentAmount={totalPayments} targetAmount={displayedTarget} height="h-3" />
              </> : <p className="text-xs text-gray-400">لم يحدد هدف شهري</p>}
              {isAdmin && !editingTarget && <button type="button" onClick={openTargetEditor} className="mt-1 flex items-center gap-1 text-xs text-teal-600 hover:underline"><Pencil className="h-3 w-3" /> {branch === "all" ? "تعديل أهداف الفروع" : "تعديل هدف الفرع"}</button>}
            </div>}
          </div>
        </Card>)}
      </div>

      {editingTarget && <Card className="space-y-3 p-4">
        <p className="font-semibold text-gray-700">تعديل التارجت الشهري</p>
        <div className="grid gap-3 md:grid-cols-2">{selectedBranches.map((branchName) => <div key={branchName}><label className="mb-1 block text-xs text-gray-500">{branchName}</label><Input type="number" min="0" value={targetInputs[branchName]} onChange={(e) => setTargetInputs((old) => ({ ...old, [branchName]: e.target.value }))} /></div>)}</div>
        <div className="flex gap-2"><Button onClick={submitTargets} disabled={saveTargetMutation.isPending}>حفظ</Button><Button variant="outline" onClick={() => setEditingTarget(false)}>إلغاء</Button></div>
      </Card>}

      <BudgetAlert budgets={budgets} invoices={branchMonthInvoices} expenses={branchMonthExpenses} suppliers={suppliers} />
      <LowStockAlert />
      <PurchaseDashboard invoices={branchMonthInvoices} suppliers={suppliers} branch={branch} onBranchChange={setBranch} dateFilter={safeDates} isLoading={invoicesLoading} pendingCount={pending} />
      <BranchBudgetCard budgets={budgets} invoices={branchMonthInvoices} expenses={branchMonthExpenses} suppliers={suppliers} startDate={monthStart} endDate={monthEnd} />
    </div>
  );
}
