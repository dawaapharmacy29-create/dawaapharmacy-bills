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

export default function ShiftDeliveryForm({ onSaved }) {
  const qc = useQueryClient();
  const { user } = useUserRole();
  const today = new Date().toISOString().split("T")[0];

  const { data: teamMembers = [] } = useQuery({
    queryKey: ["team-members"],
    queryFn: () => base44.entities.TeamMember.list(),
    staleTime: 60000,
  });
  const { data: existingDeliveries = [] } = useQuery({
    queryKey: ["shift-deliveries", "duplicate-check"],
    queryFn: () => base44.entities.ShiftDelivery.list("-shift_date", 500),
    staleTime: 30000,
  });
  const { data: expenseItems = [] } = useQuery({
    queryKey: ["expense-items"],
    queryFn: () => base44.entities.ExpenseItem.list(),
    staleTime: 60000,
  });
  const activeExpenseItems = expenseItems.filter((item) => item.is_active !== false);

  const [form, setForm] = useState({
    branch: "",
    shift_type: "",
    shift_date: today,
    submitted_by: user?.full_name || user?.email || "",
    total_sales: "",
    notes: "",
  });
  const [expenses, setExpenses] = useState([{ description: "", amount: "", category: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const totalExpenses = useMemo(
    () => expenses.reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0),
    [expenses],
  );
  const netAmount = (parseFloat(form.total_sales) || 0) - totalExpenses;

  const updateExpense = (index, field, value) => {
    setExpenses((previous) => previous.map((expense, i) => (i === index ? { ...expense, [field]: value } : expense)));
  };

  const handleSave = async () => {
    setError("");
    if (!form.branch) return setError("الرجاء اختيار الفرع");
    if (!form.shift_type) return setError("الرجاء اختيار نوع الشيفت");
    if (!form.submitted_by) return setError("الرجاء اختيار الموظف المسؤول");
    if (!form.total_sales || parseFloat(form.total_sales) <= 0) return setError("الرجاء إدخال إجمالي مبيعات الشيفت");
    if (netAmount < 0) return setError("إجمالي المصروفات أكبر من مبيعات الشيفت");

    const duplicateShift = existingDeliveries.some(
      (item) => item.branch === form.branch && item.shift_type === form.shift_type && item.shift_date === form.shift_date,
    );
    if (duplicateShift) return setError("تم تسجيل تسليم لهذا الفرع والشيفت في نفس اليوم بالفعل");

    const validExpenses = expenses
      .filter((expense) => expense.category || parseFloat(expense.amount) > 0)
      .map((expense) => ({
        description: expense.description || "",
        amount: parseFloat(expense.amount) || 0,
        category: expense.category || "أخرى",
      }));

    setSaving(true);
    try {
      await base44.entities.ShiftDelivery.create({
        branch: form.branch,
        shift_type: form.shift_type,
        shift_date: form.shift_date,
        submitted_by: form.submitted_by,
        total_sales: parseFloat(form.total_sales) || 0,
        expenses: validExpenses,
        total_expenses: totalExpenses,
        net_amount: netAmount,
        status: "انتظار مراجعة الخزنة",
        treasury_status: "pending_review",
        notes: form.notes,
      });
      qc.invalidateQueries({ queryKey: ["shift-deliveries"] });
      setForm({ branch: "", shift_type: "", shift_date: today, submitted_by: user?.full_name || user?.email || "", total_sales: "", notes: "" });
      setExpenses([{ description: "", amount: "", category: "" }]);
      onSaved?.();
    } catch (saveError) {
      setError(saveError.message || "حدث خطأ أثناء الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const fmt = (value) => Number(value || 0).toLocaleString("ar-EG");

  return (
    <div className="max-w-3xl mx-auto" dir="rtl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center"><Wallet className="w-5 h-5 text-indigo-600" /></div>
        <div><h2 className="text-xl font-bold text-gray-800">تسليم شيفت جديد</h2><p className="text-sm text-gray-500">يُحفظ أولًا للمراجعة، ولا يؤثر على الخزنة قبل الاعتماد.</p></div>
      </div>

      <Card className="p-6 space-y-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex gap-2 text-sm text-amber-800">
          <ShieldCheck className="w-5 h-5 shrink-0" />
          بعد الحفظ سيظهر الشيفت في صفحة الخزنة بانتظار اعتماد مدير الفرع أو الحسابات.
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b">بيانات الشيفت</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1.5"><Label>الفرع *</Label><Select value={form.branch} onValueChange={(value) => setForm({ ...form, branch: value })}><SelectTrigger><SelectValue placeholder="اختر الفرع" /></SelectTrigger><SelectContent>{BRANCHES.map((branch) => <SelectItem key={branch} value={branch}>{branch}</SelectItem>)}</SelectContent></Select></label>
            <label className="space-y-1.5"><Label>نوع الشيفت *</Label><Select value={form.shift_type} onValueChange={(value) => setForm({ ...form, shift_type: value })}><SelectTrigger><SelectValue placeholder="اختر النوع" /></SelectTrigger><SelectContent>{SHIFT_TYPES.map((shift) => <SelectItem key={shift} value={shift}>{shift}</SelectItem>)}</SelectContent></Select></label>
            <label className="space-y-1.5"><Label>التاريخ</Label><Input type="date" value={form.shift_date} onChange={(event) => setForm({ ...form, shift_date: event.target.value })} /></label>
            <label className="space-y-1.5"><Label>الموظف المسؤول *</Label><Select value={form.submitted_by} onValueChange={(value) => setForm({ ...form, submitted_by: value })}><SelectTrigger><SelectValue placeholder="اختر الموظف" /></SelectTrigger><SelectContent>{teamMembers.map((member) => <SelectItem key={member.id} value={member.name}>{member.name}</SelectItem>)}</SelectContent></Select></label>
          </div>
          <div className="mt-4 space-y-1.5"><Label>إجمالي مبيعات الشيفت (ج.م) *</Label><Input type="number" min="0" value={form.total_sales} onChange={(event) => setForm({ ...form, total_sales: event.target.value })} className="text-lg font-semibold" /></div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4 pb-2 border-b"><h3 className="text-sm font-semibold text-gray-700">بنود الخصم وطرق التحصيل</h3><Button type="button" variant="outline" size="sm" onClick={() => setExpenses((previous) => [...previous, { description: "", amount: "", category: "" }])}><Plus className="w-4 h-4" /> إضافة بند</Button></div>
          <div className="space-y-3">
            {expenses.map((expense, index) => (
              <div key={index} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setExpenses((previous) => previous.filter((_, i) => i !== index))} disabled={expenses.length === 1} className="p-2 text-red-500 disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>
                  <Select value={expense.category} onValueChange={(value) => updateExpense(index, "category", value)}><SelectTrigger className="flex-1"><SelectValue placeholder="اختر البند" /></SelectTrigger><SelectContent>{activeExpenseItems.map((item) => <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>)}</SelectContent></Select>
                  <Input type="number" min="0" placeholder="القيمة" value={expense.amount} onChange={(event) => updateExpense(index, "amount", event.target.value)} className="flex-1" />
                </div>
                <Input placeholder="ملاحظة" value={expense.description} onChange={(event) => updateExpense(index, "description", event.target.value)} />
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 space-y-2">
          <div className="flex justify-between"><span className="text-sm text-gray-600">إجمالي البنود</span><span className="font-bold">{fmt(totalExpenses)} ج.م</span></div>
          <div className="flex justify-between pt-2 border-t"><span className="font-semibold">صافي النقدي</span><span className="text-2xl font-bold text-indigo-600">{fmt(netAmount)} ج.م</span></div>
        </div>

        <div className="space-y-1.5"><Label>ملاحظات الشيفت</Label><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="w-full rounded-md border p-3 text-sm" rows={3} /></div>
        {error && <p className="text-sm text-red-600 text-center">{error}</p>}
        <Button onClick={handleSave} disabled={saving} className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} حفظ وإرسال للمراجعة</Button>
      </Card>
    </div>
  );
}
