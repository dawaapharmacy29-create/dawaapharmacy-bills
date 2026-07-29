import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Banknote, CreditCard, Landmark, Loader2, Plus, Save, ShieldCheck, Trash2, Wallet } from "lucide-react";
import { useUserRole } from "@/lib/useUserRole";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const SHIFT_TYPES = ["صباحي", "مسائي", "ليلي"];
const DEFAULT_EXPENSE_ITEMS = ["كهرباء", "مياه", "إنترنت", "نظافة", "صيانة", "انتقالات", "مستلزمات تشغيل", "ضيافة", "عجز خزنة", "مصروف طارئ", "سلفة", "توك توك", "نواقص", "أدوية هالك", "أخرى"];
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const numberValue = (value) => Math.max(0, Number(value || 0));
const fmt = (value) => Number(value || 0).toLocaleString("ar-EG");

function MoneyField({ label, icon: Icon, value, onChange, hint }) {
  return <label className="space-y-1.5 rounded-xl border bg-white p-3">
    <span className="flex items-center gap-2 text-sm font-semibold text-gray-700"><Icon className="h-4 w-4 text-indigo-600" />{label}</span>
    <Input type="number" min="0" step="0.01" value={value} onChange={(event) => onChange(event.target.value)} className="text-lg font-bold" />
    {hint && <span className="block text-xs text-gray-400">{hint}</span>}
  </label>;
}

export default function ShiftDeliveryForm({ onSaved }) {
  const qc = useQueryClient();
  const { user } = useUserRole();
  const today = localDate();
  const currentUserName = user?.full_name || user?.display_name || user?.username || "";

  const { data: teamMembers = [] } = useQuery({ queryKey: ["team-members"], queryFn: async () => { try { return await base44.entities.TeamMember.list(); } catch { return []; } }, staleTime: 60000 });
  const { data: existingDeliveries = [] } = useQuery({ queryKey: ["shift-deliveries", "duplicate-check"], queryFn: () => base44.entities.ShiftDelivery.list("-shift_date", 5000), staleTime: 30000 });
  const { data: targetGoals = [] } = useQuery({ queryKey: ["expense-template-goals"], queryFn: () => base44.entities.TargetGoal.list(), staleTime: 60000 });
  const activeExpenseItems = useMemo(() => {
    const stored = targetGoals.filter((goal) => goal.goal_type === "expense_template" && Number(goal.target_amount || 0) !== 0).map((goal) => goal.label).filter(Boolean);
    return stored.length ? stored : DEFAULT_EXPENSE_ITEMS;
  }, [targetGoals]);

  const [form, setForm] = useState({ branch: "", shift_type: "", shift_date: today, submitted_by: currentUserName, cash_sales: "", card_sales: "", transfer_sales: "", opening_cash: "", actual_cash: "", notes: "" });
  const [expenses, setExpenses] = useState([{ description: "", amount: "", category: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const cashSales = numberValue(form.cash_sales);
  const cardSales = numberValue(form.card_sales);
  const transferSales = numberValue(form.transfer_sales);
  const totalSales = cashSales + cardSales + transferSales;
  const totalExpenses = useMemo(() => expenses.reduce((sum, expense) => sum + numberValue(expense.amount), 0), [expenses]);
  const expectedCash = numberValue(form.opening_cash) + cashSales - totalExpenses;
  const actualCash = numberValue(form.actual_cash);
  const cashDifference = actualCash - expectedCash;
  const netAmount = totalSales - totalExpenses;
  const updateExpense = (index, field, value) => setExpenses((previous) => previous.map((expense, itemIndex) => itemIndex === index ? { ...expense, [field]: value } : expense));

  const handleSave = async () => {
    setError("");
    if (!form.branch) return setError("الرجاء اختيار الفرع");
    if (!form.shift_type) return setError("الرجاء اختيار نوع الشيفت");
    if (!form.submitted_by) return setError("الرجاء اختيار الموظف المسؤول");
    if (totalSales <= 0) return setError("الرجاء تسجيل مبيعات الشيفت حسب طريقة التحصيل");
    if (netAmount < 0) return setError("إجمالي المصروفات أكبر من مبيعات الشيفت");
    const duplicateShift = existingDeliveries.some((item) => item.branch === form.branch && item.shift_type === form.shift_type && item.shift_date === form.shift_date);
    if (duplicateShift) return setError("تم تسجيل تسليم لهذا الفرع والشيفت في نفس اليوم بالفعل");

    const validExpenses = expenses.filter((expense) => expense.category || numberValue(expense.amount) > 0).map((expense) => ({ entry_type: "expense", description: expense.description || "", amount: numberValue(expense.amount), category: expense.category || "أخرى" }));
    const auditDetails = [
      { entry_type: "collection", category: "نقدي", description: "مبيعات نقدية", amount: cashSales },
      { entry_type: "collection", category: "فيزا", description: "مبيعات بطاقات", amount: cardSales },
      { entry_type: "collection", category: "تحويل", description: "تحويلات ومحافظ", amount: transferSales },
      { entry_type: "cash_control", category: "رصيد افتتاحي", description: "رصيد بداية الشيفت", amount: numberValue(form.opening_cash) },
      { entry_type: "cash_control", category: "نقدية متوقعة", description: "الافتتاحي + النقدي - المصروفات", amount: expectedCash },
      { entry_type: "cash_control", category: "نقدية فعلية", description: "المبلغ الموجود عند التسليم", amount: actualCash },
      { entry_type: "cash_control", category: "فرق الخزنة", description: cashDifference === 0 ? "مطابق" : cashDifference > 0 ? "زيادة" : "عجز", amount: cashDifference },
    ];

    setSaving(true);
    try {
      await base44.entities.ShiftDelivery.create({
        branch: form.branch,
        shift_type: form.shift_type,
        shift_date: form.shift_date,
        submitted_by: form.submitted_by,
        total_sales: totalSales,
        expenses: [...auditDetails, ...validExpenses],
        total_expenses: totalExpenses,
        net_amount: netAmount,
        status: "انتظار مراجعة الخزنة",
        treasury_status: "pending_review",
        notes: form.notes,
      });
      qc.invalidateQueries({ queryKey: ["shift-deliveries"] });
      qc.invalidateQueries({ queryKey: ["treasury"] });
      setForm({ branch: "", shift_type: "", shift_date: today, submitted_by: currentUserName, cash_sales: "", card_sales: "", transfer_sales: "", opening_cash: "", actual_cash: "", notes: "" });
      setExpenses([{ description: "", amount: "", category: "" }]);
      onSaved?.();
    } catch (saveError) { setError(saveError.message || "حدث خطأ أثناء الحفظ"); }
    finally { setSaving(false); }
  };

  const staffOptions = teamMembers.length ? teamMembers.map((member) => ({ id: member.id, name: member.name || member.display_name })).filter((member) => member.name) : [{ id: "current", name: form.submitted_by || "المستخدم الحالي" }];

  return <div className="mx-auto max-w-5xl" dir="rtl">
    <div className="mb-5 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-100"><Wallet className="h-5 w-5 text-indigo-600" /></div><div><h2 className="text-xl font-bold text-gray-900">تسليم شيفت متكامل</h2><p className="text-sm text-gray-500">سجل طرق التحصيل، المصروفات، والنقدية الفعلية ليظهر فرق الخزنة بوضوح قبل الاعتماد.</p></div></div>
    <Card className="space-y-6 p-4 md:p-6">
      <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><ShieldCheck className="h-5 w-5 shrink-0" /><span>الحفظ ينشئ تسليمًا بانتظار المراجعة. لن يُعتبر الشيفت مقفلًا ماليًا قبل اعتماد الخزنة.</span></div>

      <section><h3 className="mb-4 border-b pb-2 text-sm font-bold text-gray-800">1. بيانات الشيفت</h3><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1.5"><Label>الفرع *</Label><Select value={form.branch} onValueChange={(value) => setForm({ ...form, branch: value })}><SelectTrigger><SelectValue placeholder="اختر الفرع" /></SelectTrigger><SelectContent>{BRANCHES.map((branch) => <SelectItem key={branch} value={branch}>{branch}</SelectItem>)}</SelectContent></Select></label>
        <label className="space-y-1.5"><Label>نوع الشيفت *</Label><Select value={form.shift_type} onValueChange={(value) => setForm({ ...form, shift_type: value })}><SelectTrigger><SelectValue placeholder="اختر النوع" /></SelectTrigger><SelectContent>{SHIFT_TYPES.map((shift) => <SelectItem key={shift} value={shift}>{shift}</SelectItem>)}</SelectContent></Select></label>
        <label className="space-y-1.5"><Label>التاريخ</Label><Input type="date" value={form.shift_date} onChange={(event) => setForm({ ...form, shift_date: event.target.value })} /></label>
        <label className="space-y-1.5"><Label>الموظف المسؤول *</Label><Select value={form.submitted_by} onValueChange={(value) => setForm({ ...form, submitted_by: value })}><SelectTrigger><SelectValue placeholder="اختر الموظف" /></SelectTrigger><SelectContent>{staffOptions.map((member) => <SelectItem key={member.id} value={member.name}>{member.name}</SelectItem>)}</SelectContent></Select></label>
      </div></section>

      <section><h3 className="mb-4 border-b pb-2 text-sm font-bold text-gray-800">2. طرق تحصيل المبيعات</h3><div className="grid gap-3 md:grid-cols-3">
        <MoneyField label="مبيعات نقدي" icon={Banknote} value={form.cash_sales} onChange={(value) => setForm({ ...form, cash_sales: value })} />
        <MoneyField label="مبيعات فيزا" icon={CreditCard} value={form.card_sales} onChange={(value) => setForm({ ...form, card_sales: value })} />
        <MoneyField label="تحويلات ومحافظ" icon={Landmark} value={form.transfer_sales} onChange={(value) => setForm({ ...form, transfer_sales: value })} />
      </div><div className="mt-3 rounded-xl bg-blue-50 p-3 text-center"><p className="text-xs text-blue-600">إجمالي مبيعات الشيفت</p><p className="text-2xl font-bold text-blue-800">{fmt(totalSales)} ج.م</p></div></section>

      <section><div className="mb-4 flex items-center justify-between border-b pb-2"><h3 className="text-sm font-bold text-gray-800">3. المصروفات والخصومات النقدية</h3><Button type="button" variant="outline" size="sm" onClick={() => setExpenses((previous) => [...previous, { description: "", amount: "", category: "" }])}><Plus className="h-4 w-4" />إضافة بند</Button></div><div className="space-y-3">{expenses.map((expense, index) => <div key={index} className="grid gap-2 rounded-xl border bg-gray-50 p-3 md:grid-cols-[auto_1fr_1fr_1fr]"><button type="button" onClick={() => setExpenses((previous) => previous.filter((_, itemIndex) => itemIndex !== index))} disabled={expenses.length === 1} className="self-center p-2 text-red-500 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button><Select value={expense.category} onValueChange={(value) => updateExpense(index, "category", value)}><SelectTrigger><SelectValue placeholder="اختر البند" /></SelectTrigger><SelectContent>{activeExpenseItems.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select><Input type="number" min="0" placeholder="القيمة" value={expense.amount} onChange={(event) => updateExpense(index, "amount", event.target.value)} /><Input placeholder="البيان أو رقم الإيصال" value={expense.description} onChange={(event) => updateExpense(index, "description", event.target.value)} /></div>)}</div></section>

      <section><h3 className="mb-4 border-b pb-2 text-sm font-bold text-gray-800">4. مطابقة الخزنة</h3><div className="grid gap-3 md:grid-cols-2">
        <MoneyField label="رصيد بداية الشيفت" icon={Wallet} value={form.opening_cash} onChange={(value) => setForm({ ...form, opening_cash: value })} hint="العهدة أو النقدية المستلمة من الشيفت السابق" />
        <MoneyField label="النقدية الفعلية عند التسليم" icon={Banknote} value={form.actual_cash} onChange={(value) => setForm({ ...form, actual_cash: value })} hint="المبلغ الذي تم عده فعليًا" />
      </div><div className="mt-3 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-gray-50 p-3 text-center"><p className="text-xs text-gray-500">إجمالي المصروفات</p><p className="font-bold text-red-600">{fmt(totalExpenses)} ج.م</p></div><div className="rounded-xl bg-indigo-50 p-3 text-center"><p className="text-xs text-indigo-600">النقدية المتوقعة</p><p className="font-bold text-indigo-800">{fmt(expectedCash)} ج.م</p></div><div className={`rounded-xl p-3 text-center ${cashDifference === 0 ? "bg-emerald-50" : cashDifference > 0 ? "bg-blue-50" : "bg-red-50"}`}><p className="text-xs text-gray-500">فرق الخزنة</p><p className={`font-bold ${cashDifference === 0 ? "text-emerald-700" : cashDifference > 0 ? "text-blue-700" : "text-red-700"}`}>{fmt(cashDifference)} ج.م</p><p className="text-[11px] text-gray-400">{cashDifference === 0 ? "مطابق" : cashDifference > 0 ? "زيادة" : "عجز"}</p></div></div></section>

      <label className="block space-y-1.5"><Label>ملاحظات الشيفت والتسليم</Label><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="w-full rounded-md border p-3 text-sm" rows={4} placeholder="أي ملاحظات عن الخزنة، الفيزا، المصروفات أو الشيفت التالي" /></label>
      {error && <p className="rounded-lg bg-red-50 p-3 text-center text-sm font-medium text-red-700">{error}</p>}
      <Button onClick={handleSave} disabled={saving} className="h-12 w-full bg-indigo-600 text-white hover:bg-indigo-700">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}حفظ وإرسال لمراجعة الخزنة</Button>
    </Card>
  </div>;
}
