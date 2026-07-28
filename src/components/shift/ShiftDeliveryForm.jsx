import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Wallet, Plus, Trash2, Save, Loader2, ShieldCheck } from "lucide-react";
import { useUserRole } from "@/lib/useUserRole";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const SHIFT_TYPES = ["صباحي", "مسائي", "ليلي"];
const DEFAULT_EXPENSE_ITEMS = ["كهرباء", "مياه", "إنترنت", "نظافة", "صيانة", "انتقالات", "مستلزمات تشغيل", "ضيافة", "عجز خزنة", "مصروف طارئ", "سلفة", "توك توك", "نواقص", "أدوية هالك", "أخرى"];
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

export default function ShiftDeliveryForm({ onSaved }) {
  const qc = useQueryClient();
  const { user } = useUserRole();
  const today = localDate();

  const { data: teamMembers = [] } = useQuery({ queryKey: ["team-members"], queryFn: async () => { try { return await base44.entities.TeamMember.list(); } catch { return []; } }, staleTime: 60000 });
  const { data: existingDeliveries = [] } = useQuery({ queryKey: ["shift-deliveries", "duplicate-check"], queryFn: () => base44.entities.ShiftDelivery.list("-shift_date", 5000), staleTime: 30000 });
  const { data: targetGoals = [] } = useQuery({ queryKey: ["expense-template-goals"], queryFn: () => base44.entities.TargetGoal.list(), staleTime: 60000 });
  const activeExpenseItems = useMemo(() => {
    const stored = targetGoals.filter((g) => g.goal_type === "expense_template" && Number(g.target_amount || 0) !== 0).map((g) => g.label).filter(Boolean);
    return stored.length ? stored : DEFAULT_EXPENSE_ITEMS;
  }, [targetGoals]);

  const [form, setForm] = useState({ branch: "", shift_type: "", shift_date: today, submitted_by: user?.full_name || user?.display_name || user?.username || "", total_sales: "", notes: "" });
  const [expenses, setExpenses] = useState([{ description: "", amount: "", category: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const totalExpenses = useMemo(() => expenses.reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0), [expenses]);
  const netAmount = (parseFloat(form.total_sales) || 0) - totalExpenses;
  const updateExpense = (index, field, value) => setExpenses((previous) => previous.map((expense, i) => (i === index ? { ...expense, [field]: value } : expense)));

  const handleSave = async () => {
    setError("");
    if (!form.branch) return setError("الرجاء اختيار الفرع");
    if (!form.shift_type) return setError("الرجاء اختيار نوع الشيفت");
    if (!form.submitted_by) return setError("الرجاء اختيار الموظف المسؤول");
    if (!form.total_sales || parseFloat(form.total_sales) <= 0) return setError("الرجاء إدخال إجمالي مبيعات الشيفت");
    if (netAmount < 0) return setError("إجمالي المصروفات أكبر من مبيعات الشيفت");
    const duplicateShift = existingDeliveries.some((item) => item.branch === form.branch && item.shift_type === form.shift_type && item.shift_date === form.shift_date);
    if (duplicateShift) return setError("تم تسجيل تسليم لهذا الفرع والشيفت في نفس اليوم بالفعل");

    const validExpenses = expenses.filter((expense) => expense.category || parseFloat(expense.amount) > 0).map((expense) => ({ description: expense.description || "", amount: parseFloat(expense.amount) || 0, category: expense.category || "أخرى" }));
    setSaving(true);
    try {
      await base44.entities.ShiftDelivery.create({ branch: form.branch, shift_type: form.shift_type, shift_date: form.shift_date, submitted_by: form.submitted_by, total_sales: parseFloat(form.total_sales) || 0, expenses: validExpenses, total_expenses: totalExpenses, net_amount: netAmount, status: "انتظار مراجعة الخزنة", treasury_status: "pending_review", notes: form.notes });
      qc.invalidateQueries({ queryKey: ["shift-deliveries"] });
      setForm({ branch: "", shift_type: "", shift_date: today, submitted_by: user?.full_name || user?.display_name || user?.username || "", total_sales: "", notes: "" });
      setExpenses([{ description: "", amount: "", category: "" }]);
      onSaved?.();
    } catch (saveError) { setError(saveError.message || "حدث خطأ أثناء الحفظ"); }
    finally { setSaving(false); }
  };

  const fmt = (value) => Number(value || 0).toLocaleString("ar-EG");
  const staffOptions = teamMembers.length ? teamMembers.map((m) => ({ id:m.id, name:m.name || m.display_name })).filter((m)=>m.name) : [{ id:"current", name:form.submitted_by || "المستخدم الحالي" }];

  return <div className="mx-auto max-w-3xl" dir="rtl">
    <div className="mb-6 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100"><Wallet className="h-5 w-5 text-indigo-600" /></div><div><h2 className="text-xl font-bold text-gray-800">تسليم شيفت جديد</h2><p className="text-sm text-gray-500">يُحفظ أولًا للمراجعة، ولا يؤثر على الخزنة قبل الاعتماد.</p></div></div>
    <Card className="space-y-6 p-6">
      <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><ShieldCheck className="h-5 w-5 shrink-0" />بعد الحفظ سيظهر الشيفت في صفحة الخزنة بانتظار اعتماد مدير الفرع أو الحسابات.</div>
      <div><h3 className="mb-4 border-b pb-2 text-sm font-semibold text-gray-700">بيانات الشيفت</h3><div className="grid grid-cols-1 gap-4 md:grid-cols-2"><label className="space-y-1.5"><Label>الفرع *</Label><Select value={form.branch} onValueChange={(value)=>setForm({...form,branch:value})}><SelectTrigger><SelectValue placeholder="اختر الفرع" /></SelectTrigger><SelectContent>{BRANCHES.map((branch)=><SelectItem key={branch} value={branch}>{branch}</SelectItem>)}</SelectContent></Select></label><label className="space-y-1.5"><Label>نوع الشيفت *</Label><Select value={form.shift_type} onValueChange={(value)=>setForm({...form,shift_type:value})}><SelectTrigger><SelectValue placeholder="اختر النوع" /></SelectTrigger><SelectContent>{SHIFT_TYPES.map((shift)=><SelectItem key={shift} value={shift}>{shift}</SelectItem>)}</SelectContent></Select></label><label className="space-y-1.5"><Label>التاريخ</Label><Input type="date" value={form.shift_date} onChange={(e)=>setForm({...form,shift_date:e.target.value})}/></label><label className="space-y-1.5"><Label>الموظف المسؤول *</Label><Select value={form.submitted_by} onValueChange={(value)=>setForm({...form,submitted_by:value})}><SelectTrigger><SelectValue placeholder="اختر الموظف" /></SelectTrigger><SelectContent>{staffOptions.map((member)=><SelectItem key={member.id} value={member.name}>{member.name}</SelectItem>)}</SelectContent></Select></label></div><div className="mt-4 space-y-1.5"><Label>إجمالي مبيعات الشيفت (ج.م) *</Label><Input type="number" min="0" value={form.total_sales} onChange={(e)=>setForm({...form,total_sales:e.target.value})} className="text-lg font-semibold"/></div></div>
      <div><div className="mb-4 flex items-center justify-between border-b pb-2"><h3 className="text-sm font-semibold text-gray-700">بنود الخصم وطرق التحصيل</h3><Button type="button" variant="outline" size="sm" onClick={()=>setExpenses((previous)=>[...previous,{description:"",amount:"",category:""}])}><Plus className="h-4 w-4"/>إضافة بند</Button></div><div className="space-y-3">{expenses.map((expense,index)=><div key={index} className="space-y-2 rounded-lg border p-3"><div className="flex items-center gap-2"><button type="button" onClick={()=>setExpenses((previous)=>previous.filter((_,i)=>i!==index))} disabled={expenses.length===1} className="p-2 text-red-500 disabled:opacity-30"><Trash2 className="h-4 w-4"/></button><Select value={expense.category} onValueChange={(value)=>updateExpense(index,"category",value)}><SelectTrigger className="flex-1"><SelectValue placeholder="اختر البند"/></SelectTrigger><SelectContent>{activeExpenseItems.map((name)=><SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select><Input type="number" min="0" placeholder="القيمة" value={expense.amount} onChange={(e)=>updateExpense(index,"amount",e.target.value)} className="flex-1"/></div><Input placeholder="ملاحظة" value={expense.description} onChange={(e)=>updateExpense(index,"description",e.target.value)}/></div>)}</div></div>
      <div className="space-y-2 rounded-lg bg-gray-50 p-4"><div className="flex justify-between"><span className="text-sm text-gray-600">إجمالي البنود</span><span className="font-bold">{fmt(totalExpenses)} ج.م</span></div><div className="flex justify-between border-t pt-2"><span className="font-semibold">صافي النقدي</span><span className="text-2xl font-bold text-indigo-600">{fmt(netAmount)} ج.م</span></div></div>
      <div className="space-y-1.5"><Label>ملاحظات الشيفت</Label><textarea value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})} className="w-full rounded-md border p-3 text-sm" rows={3}/></div>
      {error&&<p className="text-center text-sm text-red-600">{error}</p>}<Button onClick={handleSave} disabled={saving} className="h-11 w-full bg-indigo-600 text-white hover:bg-indigo-700">{saving?<Loader2 className="h-4 w-4 animate-spin"/>:<Save className="h-4 w-4"/>}حفظ وإرسال للمراجعة</Button>
    </Card>
  </div>;
}