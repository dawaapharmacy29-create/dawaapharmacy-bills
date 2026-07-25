import { useState, useMemo } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, Save, Loader2 } from "lucide-react";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const SHIFT_TYPES = ["صباحي", "مسائي", "ليلي"];

export default function ShiftDeliveryEditDialog({ item, onClose }) {
  const qc = useQueryClient();

  const { data: teamMembers = [] } = useQuery({
    queryKey: ["team-members"],
    queryFn: () => base44.entities.TeamMember.list(),
    staleTime: 60000,
  });
  const { data: expenseItems = [] } = useQuery({
    queryKey: ["expense-items"],
    queryFn: () => base44.entities.ExpenseItem.list(),
    staleTime: 60000,
  });
  const activeExpenseItems = expenseItems.filter((i) => i.is_active !== false);

  const [form, setForm] = useState({
    branch: item.branch || "",
    shift_type: item.shift_type || "",
    shift_date: item.shift_date || "",
    submitted_by: item.submitted_by || "",
    total_sales: item.total_sales || "",
    notes: item.notes || "",
  });
  const [expenses, setExpenses] = useState(
    (item.expenses && item.expenses.length > 0)
      ? item.expenses.map((e) => ({ description: e.description || "", amount: e.amount || "", category: e.category || "" }))
      : [{ description: "", amount: "", category: "" }]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const totalExpenses = useMemo(
    () => expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0),
    [expenses]
  );
  const netAmount = (parseFloat(form.total_sales) || 0) - totalExpenses;

  const updateExpense = (idx, field, value) => {
    setExpenses((prev) => prev.map((e, i) => (i === idx ? { ...e, [field]: value } : e)));
  };

  const addExpense = () => setExpenses((prev) => [...prev, { description: "", amount: "", category: "" }]);

  const removeExpense = (idx) => setExpenses((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    setError("");
    if (!form.branch) return setError("الرجاء اختيار الفرع");
    if (!form.shift_type) return setError("الرجاء اختيار نوع الشيفت");
    if (!form.submitted_by) return setError("الرجاء اختيار الموظف المسؤول");
    if (!form.total_sales || parseFloat(form.total_sales) <= 0) return setError("الرجاء إدخال إجمالي مبيعات الشيفت");

    const validExpenses = expenses
      .filter((e) => e.category || parseFloat(e.amount) > 0)
      .map((e) => ({
        description: e.description || "",
        amount: parseFloat(e.amount) || 0,
        category: e.category || "أخرى",
      }));

    setSaving(true);
    try {
      await base44.entities.ShiftDelivery.update(item.id, {
        branch: form.branch,
        shift_type: form.shift_type,
        shift_date: form.shift_date,
        submitted_by: form.submitted_by,
        total_sales: parseFloat(form.total_sales) || 0,
        expenses: validExpenses,
        total_expenses: totalExpenses,
        net_amount: netAmount,
        notes: form.notes,
      });
      qc.invalidateQueries({ queryKey: ["shift-deliveries"] });
      onClose();
    } catch (e) {
      setError(e.message || "حدث خطأ أثناء الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const fmt = (n) => Number(n || 0).toLocaleString("ar-EG");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تعديل تسليم الشيفت</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Shift Details */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b">بيانات الشفت</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm text-gray-600">الفرع <span className="text-red-500">*</span></Label>
                <Select value={form.branch} onValueChange={(v) => setForm({ ...form, branch: v })}>
                  <SelectTrigger><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
                  <SelectContent>
                    {BRANCHES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm text-gray-600">نوع الشيفت <span className="text-red-500">*</span></Label>
                <Select value={form.shift_type} onValueChange={(v) => setForm({ ...form, shift_type: v })}>
                  <SelectTrigger><SelectValue placeholder="اختر النوع" /></SelectTrigger>
                  <SelectContent>
                    {SHIFT_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm text-gray-600">تاريخ الإنشاء</Label>
                <Input type="date" value={form.shift_date} onChange={(e) => setForm({ ...form, shift_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm text-gray-600">الموظف المسؤول <span className="text-red-500">*</span></Label>
                <Select value={form.submitted_by} onValueChange={(v) => setForm({ ...form, submitted_by: v })}>
                  <SelectTrigger><SelectValue placeholder="اختر الموظف" /></SelectTrigger>
                  <SelectContent>
                    {teamMembers.map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-4 space-y-1.5">
              <Label className="text-sm text-gray-600">إجمالي مبيعات الشيفت (ج.م) <span className="text-red-500">*</span></Label>
              <Input
                type="number"
                placeholder="0"
                value={form.total_sales}
                onChange={(e) => setForm({ ...form, total_sales: e.target.value })}
                className="text-lg font-semibold"
              />
            </div>
          </div>

          {/* Expenses */}
          <div>
            <div className="flex items-center justify-between mb-4 pb-2 border-b">
              <h3 className="text-sm font-semibold text-gray-700">مصروفات الشفت</h3>
              <Button type="button" variant="outline" size="sm" onClick={addExpense} className="text-blue-600 border-blue-200 hover:bg-blue-50">
                <Plus className="w-4 h-4" /> إضافة بند
              </Button>
            </div>
            <div className="space-y-3">
              {expenses.map((exp, idx) => (
                <div key={idx} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => removeExpense(idx)}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg flex-shrink-0"
                      disabled={expenses.length === 1}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <Select value={exp.category} onValueChange={(v) => updateExpense(idx, "category", v)}>
                      <SelectTrigger className="flex-1 w-1/2"><SelectValue placeholder="اختر بند المصروف" /></SelectTrigger>
                      <SelectContent>
                        {activeExpenseItems.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      placeholder="القيمة"
                      value={exp.amount}
                      onChange={(e) => updateExpense(idx, "amount", e.target.value)}
                      className="flex-1 w-1/2"
                    />
                  </div>
                  <Input
                    placeholder="تسجيل ملاحظة"
                    value={exp.description}
                    onChange={(e) => updateExpense(idx, "description", e.target.value)}
                    className="flex-1"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">إجمالي المصروفات</span>
              <span className="text-lg font-bold text-gray-800">{fmt(totalExpenses)} ج.م</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t">
              <span className="text-sm font-semibold text-gray-700">صافي التسليم</span>
              <span className="text-2xl font-bold text-indigo-600">{fmt(netAmount)} ج.م</span>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-sm text-gray-600">ملاحظات</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات إضافية" />
          </div>

          {error && <p className="text-sm text-red-600 text-center">{error}</p>}

          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1">إلغاء</Button>
            <Button onClick={handleSave} disabled={saving} className="flex-1 bg-indigo-600 hover:bg-indigo-700">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              حفظ التعديلات
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}