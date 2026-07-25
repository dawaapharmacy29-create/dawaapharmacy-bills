import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreditCard, ChevronDown, ChevronUp, Wallet, PlusCircle, Edit2, Loader2, Calendar, CalendarDays, FileText, Receipt } from "lucide-react";
import { useUserRole } from "@/lib/useUserRole";
import SupplierInvoiceStatement from "@/components/supplier/SupplierInvoiceStatement";
import PaymentsLog from "@/components/supplier/PaymentsLog";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortControls } from "@/components/table/SortControls";
import { buildLinkedPaymentsByInvoice, getEffectiveInvoicePaid, getInvoiceRemaining, scopedGeneralPayments, validateInvoicePayment } from "@/lib/supplierFinancialIntegrity";

const SBAL_SORT_COLUMNS = [
  { field: "name", label: "اسم المورد", type: "text" },
  { field: "totalNet", label: "الإجمالي", type: "number" },
  { field: "oldDebt", label: "مديونية قديمة", type: "number" },
  { field: "newDebt", label: "مديونية جديدة", type: "number" },
];

export default function SupplierBalances() {
  const qc = useQueryClient();
  const { isManager } = useUserRole();

  const [activeTab, setActiveTab] = useState("balances"); // balances | statement | payments
  const [expanded, setExpanded] = useState(null);
  const [payDialog, setPayDialog] = useState(null);
  const [payForm, setPayForm] = useState({ amount: "", payment_date: new Date().toISOString().split("T")[0], notes: "", branch: "" });
  const [debtDialog, setDebtDialog] = useState(null);
  const [debtForm, setDebtForm] = useState({ initial_debt: "", notes: "", branch: "" });
  const [savingDebt, setSavingDebt] = useState(false);
  const [generalPayDialog, setGeneralPayDialog] = useState(false);
  const [generalPayForm, setGeneralPayForm] = useState({ supplier_name: "", amount: "", payment_date: new Date().toISOString().split("T")[0], notes: "", branch: "" });
  const [monthStartDialog, setMonthStartDialog] = useState(null); // { supplier_name, existing? }
  const [monthStartForm, setMonthStartForm] = useState({ month_start_date: "", notes: "", branch: "" });
  const [savingMonthStart, setSavingMonthStart] = useState(false);

  const { data: invoices = [] } = useQuery({
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
    staleTime: 0,
    placeholderData: (prev) => prev,
  });

  const { data: payments = [] } = useQuery({ queryKey: ["supplier-payments"], queryFn: () => base44.entities.SupplierPayment.list("-payment_date", 2000), staleTime: 0 });
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: () => base44.entities.Supplier.list() });
  const { data: debts = [] } = useQuery({ queryKey: ["supplier-debts"], queryFn: () => base44.entities.SupplierDebt.list() });
  const { data: monthStarts = [] } = useQuery({ queryKey: ["supplier-month-starts"], queryFn: () => base44.entities.SupplierMonthStart.list() });
  const linkedPaymentsByInvoice = useMemo(() => buildLinkedPaymentsByInvoice(payments), [payments]);

  const fmt = (n) => Number(n || 0).toLocaleString("ar-EG");
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // ─── Mutations ───────────────────────────────────────────────────────────────
  const addPayment = useMutation({
    mutationFn: async ({ invoice, amount, payment_date, notes, branch }) => {
      const validationError = validateInvoicePayment({ invoice, amount, linkedPaymentsByInvoice });
      if (validationError) throw new Error(validationError);
      await base44.entities.SupplierPayment.create({
        supplier_name: invoice.supplier_name,
        invoice_id: invoice.id,
        invoice_number: invoice.system_invoice_number,
        amount: parseFloat(amount),
        payment_date,
        notes,
        branch: branch || invoice.branch || "",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-invoices"] });
      qc.invalidateQueries({ queryKey: ["supplier-payments"] });
      setPayDialog(null);
      setPayForm({ amount: "", payment_date: new Date().toISOString().split("T")[0], notes: "" });
    },
  });

  const addDebtPayment = useMutation({
    mutationFn: async ({ supplier_name, amount, payment_date, notes, branch }) => {
      if (!branch) throw new Error("يجب تحديد الفرع قبل تسجيل الدفعة");
      const supplier = suppliers.find((s) => s.name === supplier_name);
      if (supplier?.supplier_type === "internal_branch") throw new Error("لا يمكن تسجيل دفعة مورد لفرع داخلي. استخدم تسويات الفروع.");
      if (!branch) throw new Error("يجب تحديد الفرع قبل تسجيل الدفعة");
      await base44.entities.SupplierPayment.create({ supplier_name, amount: round2(parseFloat(amount)), payment_date, notes, branch });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier-payments"] });
      setPayDialog(null);
      setPayForm({ amount: "", payment_date: new Date().toISOString().split("T")[0], notes: "" });
    },
  });

  const addGeneralPayment = useMutation({
    mutationFn: async ({ supplier_name, amount, payment_date, notes, branch }) => {
      if (!branch) throw new Error("يجب تحديد الفرع قبل تسجيل الدفعة");
      const supplier = suppliers.find((s) => s.name === supplier_name);
      if (supplier?.supplier_type === "internal_branch") throw new Error("لا يمكن تسجيل دفعة مورد لفرع داخلي. استخدم تسويات الفروع.");
      if (!branch) throw new Error("يجب تحديد الفرع قبل تسجيل الدفعة");
      await base44.entities.SupplierPayment.create({ supplier_name, amount: round2(parseFloat(amount)), payment_date, notes: `[دفعة عامة غير موزعة] ${notes}`.trim(), branch });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier-payments"] });
      setGeneralPayDialog(false);
      setGeneralPayForm({ supplier_name: "", amount: "", payment_date: new Date().toISOString().split("T")[0], notes: "", branch: "" });
    },
  });

  const saveDebt = async () => {
    setSavingDebt(true);
    const data = { supplier_name: debtDialog.supplier_name, branch: debtForm.branch, initial_debt: round2(parseFloat(debtForm.initial_debt) || 0), notes: debtForm.notes };
    if (debtDialog.existing) await base44.entities.SupplierDebt.update(debtDialog.existing.id, data);
    else await base44.entities.SupplierDebt.create(data);
    await qc.invalidateQueries({ queryKey: ["supplier-debts"] });
    setSavingDebt(false);
    setDebtDialog(null);
  };

  const saveMonthStart = async () => {
    setSavingMonthStart(true);
    const data = { supplier_name: monthStartDialog.supplier_name, branch: monthStartForm.branch, month_start_date: monthStartForm.month_start_date, notes: monthStartForm.notes };
    if (monthStartDialog.existing) await base44.entities.SupplierMonthStart.update(monthStartDialog.existing.id, data);
    else await base44.entities.SupplierMonthStart.create(data);
    await qc.invalidateQueries({ queryKey: ["supplier-month-starts"] });
    setSavingMonthStart(false);
    setMonthStartDialog(null);
  };

  const openDebtDialog = (supplierName) => {
    setDebtForm({ initial_debt: "", notes: "", branch: "" });
    setDebtDialog({ supplier_name: supplierName });
  };

  const onDebtBranchChange = (branchName) => {
    const existing = debts.find(d => d.supplier_name === debtDialog.supplier_name && d.branch === branchName);
    setDebtForm(f => ({ ...f, branch: branchName, initial_debt: existing?.initial_debt?.toString() || "", notes: existing?.notes || "" }));
    setDebtDialog(d => ({ ...d, existing }));
  };

  const openMonthStartDialog = (supplierName) => {
    setMonthStartForm({ month_start_date: new Date().toISOString().split("T")[0], notes: "", branch: "" });
    setMonthStartDialog({ supplier_name: supplierName });
  };

  const onMonthStartBranchChange = (branchName) => {
    const existing = monthStarts.find(m => m.supplier_name === monthStartDialog.supplier_name && m.branch === branchName);
    setMonthStartForm(f => ({ ...f, branch: branchName, month_start_date: existing?.month_start_date || new Date().toISOString().split("T")[0], notes: existing?.notes || "" }));
    setMonthStartDialog(d => ({ ...d, existing }));
  };

  // ─── Data Aggregation ────────────────────────────────────────────────────────
  const allSupplierNames = useMemo(() => {
    const names = new Set([
      ...invoices.filter(i => i.payment_type === "آجل").map(i => i.supplier_name),
      ...debts.map(d => d.supplier_name),
    ]);
    const internalNames = new Set(suppliers.filter((s) => s.supplier_type === "internal_branch").map((s) => s.name));
    return [...names].filter((name) => name && !internalNames.has(name));
  }, [invoices, debts, suppliers]);

  const supplierGroups = useMemo(() => {
    const BRANCHES = ["دواء شكري", "دواء الشامي"];
    const calcRemaining = (inv) => getInvoiceRemaining(inv, linkedPaymentsByInvoice);

    // حساب بيانات مورد لفرع معين (نفس منطق صفحة الفرع)
    const calcBranchData = (name, branch, monthStartDate, initialDebt) => {
      const branchInvoices = invoices.filter(inv => inv.payment_type === "آجل" && inv.supplier_name === name && inv.branch === branch);

      const oldInvsRaw = monthStartDate
        ? branchInvoices.filter(inv => (inv.invoice_date || inv.created_date?.slice(0, 10) || "") < monthStartDate)
        : branchInvoices;
      const newInvs = monthStartDate
        ? branchInvoices.filter(inv => (inv.invoice_date || inv.created_date?.slice(0, 10) || "") >= monthStartDate)
        : [];

      const oldInvsWithRem = oldInvsRaw.map(inv => ({ ...inv, remaining: calcRemaining(inv) }));
      const newInvsWithRem = newInvs.map(inv => ({ ...inv, remaining: calcRemaining(inv) }));

      // الدفعات العامة لهذا الفرع فقط
      const genPayments = scopedGeneralPayments(payments, name, branch);
      let pool = round2(genPayments.reduce((s, p) => s + (p.amount || 0), 0));

      const debtPaid = round2(Math.min(pool, initialDebt));
      const remainingInitialDebt = round2(Math.max(0, initialDebt - debtPaid));
      pool = Math.max(0, pool - debtPaid);

      const oldSorted = [...oldInvsWithRem].sort((a, b) =>
        (a.invoice_date || a.created_date?.slice(0, 10) || "").localeCompare(b.invoice_date || b.created_date?.slice(0, 10) || "")
      );
      const oldAdjusted = oldSorted.map(inv => {
        const deduct = round2(Math.min(pool, inv.remaining));
        pool = Math.max(0, round2(pool - deduct));
        return { ...inv, remaining: round2(inv.remaining - deduct) };
      });

      // 3. ما تبقى يُخصم من الفواتير الجديدة بالترتيب (الأقدم أولاً)
      const newSorted = [...newInvsWithRem].sort((a, b) =>
        (a.invoice_date || a.created_date?.slice(0, 10) || "").localeCompare(b.invoice_date || b.created_date?.slice(0, 10) || "")
      );
      const newAdjusted = newSorted.map(inv => {
        const deduct = round2(Math.min(pool, inv.remaining));
        pool = Math.max(0, round2(pool - deduct));
        return { ...inv, remaining: round2(inv.remaining - deduct) };
      });

      const oldInvoicesRemaining = round2(oldAdjusted.reduce((s, inv) => s + inv.remaining, 0));
      const newDebt = round2(newAdjusted.reduce((s, inv) => s + inv.remaining, 0));
      const oldDebt = round2(remainingInitialDebt + oldInvoicesRemaining);

      return { oldInvoices: oldAdjusted, newInvoices: newAdjusted, initialDebt, monthStartDate, debtPaid, remainingInitialDebt, oldInvoicesRemaining, oldDebt, newDebt };
    };

    const map = {};

    allSupplierNames.forEach(name => {
      // احسب لكل فرع على حدة مع مديونية وتاريخ بداية شهر خاص بكل فرع
      const branchResults = BRANCHES.map(br => {
        const branchMonthStart = monthStarts.find(m => m.supplier_name === name && m.branch === br);
        const branchMonthStartDate = branchMonthStart?.month_start_date || null;
        const branchDebtRecord = debts.find(d => d.supplier_name === name && d.branch === br);
        const branchInitialDebt = branchDebtRecord?.initial_debt || 0;
        return calcBranchData(name, br, branchMonthStartDate, branchInitialDebt);
      });

      // دمج الفواتير من الفرعين
      const oldInvoicesAll = branchResults.flatMap(r => r.oldInvoices);
      const newInvoicesAll = branchResults.flatMap(r => r.newInvoices);

      // الإجمالي = مجموع الفرعين
      const oldDebt = round2(branchResults.reduce((s, r) => s + r.oldDebt, 0));
      const newDebt = round2(branchResults.reduce((s, r) => s + r.newDebt, 0));
      const totalNet = round2(oldDebt + newDebt);

      const allCreditInvoices = invoices.filter(inv => inv.payment_type === "آجل" && inv.supplier_name === name);
      if (totalNet <= 0 && allCreditInvoices.length === 0) return;

      // مجموع القيم عبر الفرعين (دقيقة لكل فرع)
      const initialDebt = round2(branchResults.reduce((s, r) => s + (r.initialDebt || 0), 0));
      const debtPaid = round2(branchResults.reduce((s, r) => s + r.debtPaid, 0));
      const remainingInitialDebt = round2(branchResults.reduce((s, r) => s + r.remainingInitialDebt, 0));
      const oldInvoicesRemaining = round2(branchResults.reduce((s, r) => s + r.oldInvoicesRemaining, 0));
      const monthStartDate = branchResults.map(r => r.monthStartDate).find(Boolean) || null;

      map[name] = {
        name,
        monthStartDate,
        oldInvoices: oldInvoicesAll,
        newInvoices: newInvoicesAll,
        initialDebt,
        debtPaid,
        remainingInitialDebt,
        oldInvoicesRemaining,
        oldDebt,
        newDebt,
        totalNet,
      };
    });

    return Object.values(map).sort((a, b) => b.totalNet - a.totalNet);
  }, [invoices, payments, debts, allSupplierNames, monthStarts, linkedPaymentsByInvoice]);

  const totalNet = supplierGroups.reduce((s, g) => s + g.totalNet, 0);

  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({
    columns: SBAL_SORT_COLUMNS,
    defaultSort: { field: "totalNet", direction: "desc" },
    paramPrefix: "sbal",
  });
  const sortedGroups = useMemo(() => sortData(supplierGroups), [supplierGroups, sortData]);

  const openPayDialog = (invoice) => {
    setPayForm({ amount: invoice.remaining?.toString() || "", payment_date: new Date().toISOString().split("T")[0], notes: "", branch: invoice.branch || "" });
    setPayDialog({ invoice });
  };

  const openDebtPayDialog = (supplierName, remaining) => {
    setPayForm({ amount: remaining?.toString() || "", payment_date: new Date().toISOString().split("T")[0], notes: "سداد مديونية قديمة", branch: "" });
    setPayDialog({ debtPayment: true, supplier_name: supplierName, remaining });
  };

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">أرصدة الموردين</h1>
          <p className="text-gray-500 text-sm mt-0.5">تتبع الحسابات الدائنة والمدفوعات</p>
        </div>
        <div className="flex items-center gap-2">
          <SortControls
            columns={SBAL_SORT_COLUMNS}
            sortField={sortField}
            sortDirection={sortDirection}
            onToggle={toggleSort}
            onSet={setSort}
            onReset={resetSort}
            cardMode
          />
          <Button onClick={() => setGeneralPayDialog(true)} className="bg-green-600 hover:bg-green-700 gap-2">
            <PlusCircle className="w-4 h-4" /> تسديد دفعة
          </Button>
        </div>
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2">
          <Wallet className="w-5 h-5 text-red-500" />
          <div>
            <p className="text-xs text-gray-500">إجمالي الصافي المتبقي</p>
            <p className="text-lg font-bold text-red-600">{fmt(totalNet)} ج</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg overflow-x-auto max-w-full">
        {[
          { key: "balances", label: "الأرصدة", icon: Wallet },
          { key: "statement", label: "كشف حساب", icon: FileText },
          { key: "payments", label: "سجل المدفوعات", icon: Receipt },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === key ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab: Statement */}
      {activeTab === "statement" && <SupplierInvoiceStatement />}

      {/* Tab: Payments Log */}
      {activeTab === "payments" && <PaymentsLog />}

      {/* Tab: Balances (original content below) */}
      {activeTab === "balances" && (<>

      {/* Supplier Cards */}
      {supplierGroups.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-gray-400 text-lg">لا توجد فواتير غير مسددة ✅</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {sortedGroups.map((group) => {
            const isExpanded = expanded === group.name;
            return (
              <Card key={group.name} className="overflow-hidden">
                {/* Supplier Header */}
                <div
                   className="flex items-center justify-between p-3 sm:p-4 cursor-pointer hover:bg-gray-50 transition-colors gap-2"
                   onClick={() => setExpanded(isExpanded ? null : group.name)}
                 >
                   <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                     <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm shrink-0">
                       {group.name.charAt(0)}
                     </div>
                     <div className="min-w-0">
                       <p className="font-semibold text-gray-800 truncate">{group.name}</p>
                       <div className="flex items-center gap-2 flex-wrap">
                         <p className="text-xs text-gray-500">
                           {group.oldInvoices.length + group.newInvoices.length} فاتورة
                         </p>
                         {group.monthStartDate && (
                           <span className="text-xs text-blue-500 flex items-center gap-1">
                             <CalendarDays className="w-3 h-3" />
                             {group.monthStartDate}
                           </span>
                         )}
                       </div>
                     </div>
                   </div>

                   <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end shrink-0">
                    {/* Summary mini-cards */}
                    {group.monthStartDate && (
                      <>
                        <div className="hidden sm:flex flex-col items-center bg-orange-50 border border-orange-100 rounded-lg px-3 py-1.5 min-w-[90px]">
                          <p className="text-xs text-gray-400">مديونية قديمة</p>
                          <p className="font-bold text-orange-600 text-sm">{fmt(group.oldDebt)} ج</p>
                        </div>
                        <div className="hidden sm:flex flex-col items-center bg-blue-50 border border-blue-100 rounded-lg px-3 py-1.5 min-w-[90px]">
                          <p className="text-xs text-gray-400">مديونية جديدة</p>
                          <p className="font-bold text-blue-600 text-sm">{fmt(group.newDebt)} ج</p>
                        </div>
                      </>
                    )}
                    <div className="hidden sm:flex flex-col items-center bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 min-w-[90px]">
                      <p className="text-xs text-gray-400">الإجمالي</p>
                      <p className="font-bold text-red-600 text-sm">{fmt(group.totalNet)} ج</p>
                    </div>

                    {/* Buttons */}
                    {isManager && (
                      <>
                        <Button
                          size="sm" variant="outline"
                          className="text-blue-600 border-blue-300 hover:bg-blue-50 h-7 text-xs gap-1"
                          onClick={(e) => { e.stopPropagation(); openMonthStartDialog(group.name); }}
                        >
                          <Calendar className="w-3 h-3" /> بداية شهر
                        </Button>
                        <Button
                          size="sm" variant="outline"
                          className="text-purple-600 border-purple-300 hover:bg-purple-50 h-7 text-xs gap-1"
                          onClick={(e) => { e.stopPropagation(); openDebtDialog(group.name); }}
                        >
                          <Edit2 className="w-3 h-3" /> مديونية قديمة
                        </Button>
                      </>
                    )}
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </div>
                </div>

                {/* ─── Expanded Details ─── */}
                {isExpanded && (
                  <div className="border-t">

                    {/* ── 3 Summary Cards ── */}
                    <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {/* Old Debt Card */}
                      <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-semibold text-orange-700">المديونية القديمة</p>
                          <span className="text-xs text-gray-400 bg-white rounded px-2 py-0.5 border">
                            {group.monthStartDate ? `قبل ${group.monthStartDate}` : "كل الفترة"}
                          </span>
                        </div>
                        <p className="text-2xl font-bold text-orange-600 mt-2">{fmt(group.oldDebt)} ج</p>
                        <div className="mt-3 space-y-1.5">
                          <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-orange-100">
                            <span className="text-xs text-gray-500">إجمالي المديونية القديمة</span>
                            <span className="text-sm font-bold text-orange-600">{fmt((group.initialDebt || 0) + (group.oldInvoicesRemaining || 0) + (group.debtPaid || 0))} ج</span>
                          </div>
                          <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-green-100">
                            <span className="text-xs text-gray-500">المسدّد منها</span>
                            <span className="text-sm font-bold text-green-600">- {fmt(group.debtPaid)} ج</span>
                          </div>
                          <div className="flex items-center justify-between bg-orange-100 rounded-lg px-3 py-2 border border-orange-200">
                            <span className="text-xs font-semibold text-orange-800">المتبقي</span>
                            <span className="text-sm font-bold text-orange-700">{fmt(group.oldDebt)} ج</span>
                          </div>
                        </div>
                      </div>

                      {/* New Debt Card */}
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-semibold text-blue-700">المديونية الجديدة</p>
                          <span className="text-xs text-gray-400 bg-white rounded px-2 py-0.5 border">
                            {group.monthStartDate ? `من ${group.monthStartDate}` : "—"}
                          </span>
                        </div>
                        <p className="text-2xl font-bold text-blue-600 mt-2">{fmt(group.newDebt)} ج</p>
                        <p className="text-xs text-gray-500 mt-2">{group.newInvoices.length} فاتورة جديدة</p>
                      </div>

                      {/* Total Card */}
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-semibold text-red-700">الإجمالي</p>
                          <span className="text-xs text-gray-400 bg-white rounded px-2 py-0.5 border">كل الفترات</span>
                        </div>
                        <p className="text-2xl font-bold text-red-600 mt-2">{fmt(group.totalNet)} ج</p>
                        <p className="text-xs text-gray-500 mt-2">
                          {group.oldInvoices.length + group.newInvoices.length} فاتورة إجمالي
                        </p>
                      </div>
                    </div>

                    {/* ── Old Invoices Table ── */}
                    {group.oldInvoices.length > 0 && (
                      <div className="border-t">
                        <div className="px-4 py-2 bg-orange-50 flex items-center gap-2">
                          <span className="text-xs font-semibold text-orange-700">📋 الفواتير القديمة ({group.oldInvoices.length})</span>
                          {group.monthStartDate && <span className="text-xs text-gray-400">قبل {group.monthStartDate}</span>}
                        </div>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-gray-50">
                                <TableHead className="text-right text-xs">رقم الفاتورة</TableHead>
                                <TableHead className="text-right text-xs">التاريخ</TableHead>
                                <TableHead className="text-right text-xs">الفرع</TableHead>
                                <TableHead className="text-right text-xs">القيمة</TableHead>
                                <TableHead className="text-right text-xs">المدفوع</TableHead>
                                <TableHead className="text-right text-xs">المتبقي</TableHead>
                                <TableHead className="text-right text-xs"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {group.oldInvoices.map((inv) => (
                                <TableRow key={inv.id} className="hover:bg-orange-50/30">
                                  <TableCell className="font-mono text-teal-700 text-sm">{inv.system_invoice_number}</TableCell>
                                  <TableCell className="text-xs text-gray-500">{inv.invoice_date || inv.created_date?.slice(0,10) || "—"}</TableCell>
                                  <TableCell className="text-xs text-gray-600">{inv.branch || "—"}</TableCell>
                                  <TableCell className="font-semibold text-sm">{fmt(inv.total_value)} ج</TableCell>
                                  <TableCell className="text-green-600 text-sm">{fmt(getEffectiveInvoicePaid(inv, linkedPaymentsByInvoice))} ج</TableCell>
                                  <TableCell className="text-red-600 font-semibold text-sm">{fmt(inv.remaining)} ج</TableCell>
                                  <TableCell>
                                    {inv.remaining > 0 && (
                                      <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-green-700 border-green-300"
                                        onClick={() => openPayDialog(inv)}>سداد</Button>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}

                    {/* ── New Invoices Table ── */}
                    {group.newInvoices.length > 0 && (
                      <div className="border-t">
                        <div className="px-4 py-2 bg-blue-50 flex items-center gap-2">
                          <span className="text-xs font-semibold text-blue-700">🆕 الفواتير الجديدة ({group.newInvoices.length})</span>
                          {group.monthStartDate && <span className="text-xs text-gray-400">من {group.monthStartDate}</span>}
                        </div>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-gray-50">
                                <TableHead className="text-right text-xs">رقم الفاتورة</TableHead>
                                <TableHead className="text-right text-xs">التاريخ</TableHead>
                                <TableHead className="text-right text-xs">الفرع</TableHead>
                                <TableHead className="text-right text-xs">القيمة</TableHead>
                                <TableHead className="text-right text-xs">المدفوع</TableHead>
                                <TableHead className="text-right text-xs">المتبقي</TableHead>
                                <TableHead className="text-right text-xs"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {group.newInvoices.map((inv) => (
                                <TableRow key={inv.id} className="hover:bg-blue-50/30">
                                  <TableCell className="font-mono text-teal-700 text-sm">{inv.system_invoice_number}</TableCell>
                                  <TableCell className="text-xs text-gray-500">{inv.invoice_date || inv.created_date?.slice(0,10) || "—"}</TableCell>
                                  <TableCell className="text-xs text-gray-600">{inv.branch || "—"}</TableCell>
                                  <TableCell className="font-semibold text-sm">{fmt(inv.total_value)} ج</TableCell>
                                  <TableCell className="text-green-600 text-sm">{fmt(getEffectiveInvoicePaid(inv, linkedPaymentsByInvoice))} ج</TableCell>
                                  <TableCell className="text-red-600 font-semibold text-sm">{fmt(inv.remaining)} ج</TableCell>
                                  <TableCell>
                                    {inv.remaining > 0 && (
                                      <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-green-700 border-green-300"
                                        onClick={() => openPayDialog(inv)}>سداد</Button>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}

                    {/* ── Payment History ── */}
                    {payments.filter((p) => p.supplier_name === group.name).length > 0 && (
                      <div className="p-4 border-t bg-green-50">
                        <p className="text-xs font-semibold text-green-700 mb-2">سجل المدفوعات</p>
                        <div className="space-y-1">
                          {payments.filter((p) => p.supplier_name === group.name).map((p) => (
                            <div key={p.id} className="flex items-center justify-between text-xs text-gray-600 bg-white rounded px-3 py-1.5 border border-green-100">
                              <span>
                                {p.payment_date} — {p.invoice_number ? `فاتورة ${p.invoice_number}` : p.notes || "مديونية قديمة"}
                                {p.branch && <span className="mr-1 text-blue-600 font-medium">({p.branch})</span>}
                              </span>
                              <span className="font-semibold text-green-700">{fmt(p.amount)} ج</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      </>)}

      {/* ─── Pay Dialog ─── */}
      <Dialog open={!!payDialog} onOpenChange={(o) => !o && setPayDialog(null)}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تسجيل دفعة</DialogTitle>
          </DialogHeader>
          {payDialog && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 text-sm">
                {payDialog.debtPayment ? (
                  <>
                    <p className="text-gray-500">المورد: <span className="font-semibold text-gray-800">{payDialog.supplier_name}</span></p>
                    <p className="text-gray-500">النوع: <span className="font-semibold text-orange-700">سداد المديونية القديمة</span></p>
                    <p className="text-gray-500">المتبقي: <span className="font-bold text-red-600">{fmt(payDialog.remaining)} ج</span></p>
                  </>
                ) : (
                  <>
                    <p className="text-gray-500">المورد: <span className="font-semibold text-gray-800">{payDialog.invoice?.supplier_name}</span></p>
                    <p className="text-gray-500">الفاتورة: <span className="font-mono font-semibold text-teal-700">{payDialog.invoice?.system_invoice_number}</span></p>
                    <p className="text-gray-500">المتبقي: <span className="font-bold text-red-600">{fmt(payDialog.invoice?.remaining)} ج</span></p>
                  </>
                )}
              </div>
              <div className="space-y-1">
                <Label>الفرع المسدد عليه</Label>
                <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={payForm.branch} onChange={(e) => setPayForm((f) => ({ ...f, branch: e.target.value }))}>
                  <option value="">-- اختر الفرع --</option>
                  <option value="دواء شكري">دواء شكري</option>
                  <option value="دواء الشامي">دواء الشامي</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>مبلغ الدفعة</Label>
                <Input type="number" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0" />
              </div>
              <div className="space-y-1">
                <Label>تاريخ السداد</Label>
                <Input type="date" value={payForm.payment_date} onChange={(e) => setPayForm((f) => ({ ...f, payment_date: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>ملاحظات (اختياري)</Label>
                <Textarea value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} rows={2} placeholder="مثل: تحويل بنكي، شيك..." />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPayDialog(null)}>إلغاء</Button>
            <Button
              disabled={!payForm.amount || addPayment.isPending || addDebtPayment.isPending}
              onClick={() => {
                if (payDialog?.debtPayment) addDebtPayment.mutate({ supplier_name: payDialog.supplier_name, ...payForm });
                else addPayment.mutate({ invoice: payDialog.invoice, ...payForm });
              }}
              className="bg-green-600 hover:bg-green-700"
            >
              {(addPayment.isPending || addDebtPayment.isPending) ? "جاري الحفظ..." : "تأكيد الدفعة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── General Payment Dialog ─── */}
      <Dialog open={generalPayDialog} onOpenChange={setGeneralPayDialog}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تسديد دفعة عامة لمورد</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>اسم المورد</Label>
              <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={generalPayForm.supplier_name}
                onChange={e => setGeneralPayForm(f => ({ ...f, supplier_name: e.target.value }))}>
                <option value="">-- اختر مورد --</option>
                {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>الفرع المسدد عليه</Label>
              <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={generalPayForm.branch}
                onChange={e => setGeneralPayForm(f => ({ ...f, branch: e.target.value }))}>
                <option value="">-- اختر الفرع --</option>
                <option value="دواء شكري">دواء شكري</option>
                <option value="دواء الشامي">دواء الشامي</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>المبلغ المسدد (جنيه)</Label>
              <Input type="number" value={generalPayForm.amount} onChange={e => setGeneralPayForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
            </div>
            <div className="space-y-1">
              <Label>تاريخ السداد</Label>
              <Input type="date" value={generalPayForm.payment_date} onChange={e => setGeneralPayForm(f => ({ ...f, payment_date: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>ملاحظات (اختياري)</Label>
              <Textarea value={generalPayForm.notes} onChange={e => setGeneralPayForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setGeneralPayDialog(false)}>إلغاء</Button>
            <Button disabled={!generalPayForm.supplier_name || !generalPayForm.amount || addGeneralPayment.isPending}
              onClick={() => addGeneralPayment.mutate(generalPayForm)} className="bg-green-600 hover:bg-green-700">
              {addGeneralPayment.isPending ? "جاري الحفظ..." : "تأكيد الدفعة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Debt Dialog ─── */}
      {isManager && (
        <Dialog open={!!debtDialog} onOpenChange={(o) => !o && setDebtDialog(null)}>
          <DialogContent dir="rtl" className="max-w-sm">
            <DialogHeader>
              <DialogTitle>المديونية القديمة — {debtDialog?.supplier_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-gray-500">سجّل المديونية التي كانت موجودة للمورد قبل استخدام التطبيق — اختر الفرع أولاً.</p>
              <div className="space-y-1">
                <Label>الفرع *</Label>
                <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={debtForm.branch} onChange={e => onDebtBranchChange(e.target.value)}>
                  <option value="">-- اختر الفرع --</option>
                  <option value="دواء شكري">دواء شكري</option>
                  <option value="دواء الشامي">دواء الشامي</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>المديونية القديمة (جنيه)</Label>
                <Input type="number" value={debtForm.initial_debt} onChange={e => setDebtForm(f => ({ ...f, initial_debt: e.target.value }))} placeholder="0" disabled={!debtForm.branch} />
              </div>
              <div className="space-y-1">
                <Label>ملاحظات</Label>
                <Textarea value={debtForm.notes} onChange={e => setDebtForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="اختياري..." disabled={!debtForm.branch} />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setDebtDialog(null)}>إلغاء</Button>
              <Button disabled={!debtForm.branch || savingDebt} onClick={saveDebt} className="bg-purple-600 hover:bg-purple-700">
                {savingDebt ? <Loader2 className="w-4 h-4 animate-spin" /> : "حفظ"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ─── Month Start Dialog (Manager only) ─── */}
      {isManager && (
        <Dialog open={!!monthStartDialog} onOpenChange={(o) => !o && setMonthStartDialog(null)}>
          <DialogContent dir="rtl" className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600" />
                بداية الشهر الجديد — {monthStartDialog?.supplier_name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
                <p>سيتم تصنيف الفواتير قبل هذا التاريخ كـ <strong>مديونية قديمة</strong> والفواتير بعده كـ <strong>مديونية جديدة</strong> — لكل فرع على حدة.</p>
                {monthStartDialog?.existing && (
                  <p className="mt-1 text-xs text-gray-500">التاريخ الحالي: <strong>{monthStartDialog.existing.month_start_date}</strong></p>
                )}
              </div>
              <div className="space-y-1">
                <Label>الفرع *</Label>
                <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={monthStartForm.branch} onChange={e => onMonthStartBranchChange(e.target.value)}>
                  <option value="">-- اختر الفرع --</option>
                  <option value="دواء شكري">دواء شكري</option>
                  <option value="دواء الشامي">دواء الشامي</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>تاريخ بداية الشهر الجديد *</Label>
                <Input type="date" value={monthStartForm.month_start_date}
                  onChange={e => setMonthStartForm(f => ({ ...f, month_start_date: e.target.value }))} disabled={!monthStartForm.branch} />
              </div>
              <div className="space-y-1">
                <Label>ملاحظات (اختياري)</Label>
                <Textarea value={monthStartForm.notes} onChange={e => setMonthStartForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="مثل: دورة شهر يونيو..." disabled={!monthStartForm.branch} />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setMonthStartDialog(null)}>إلغاء</Button>
              <Button disabled={!monthStartForm.branch || !monthStartForm.month_start_date || savingMonthStart} onClick={saveMonthStart} className="bg-blue-600 hover:bg-blue-700">
                {savingMonthStart ? <Loader2 className="w-4 h-4 animate-spin" /> : "تأكيد بداية الشهر"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}