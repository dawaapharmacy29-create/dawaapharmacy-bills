import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Users, Plus, Trash2 } from "lucide-react";

const defaultForm = (branch) => ({
  branch,
  assignments: [],
  items_per_day: 20,
});

export default function WeeklyScheduleForm({ branch, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(defaultForm(branch));

  const { data: schedules = [] } = useQuery({
    queryKey: ["weekly-schedule", branch],
    queryFn: () => base44.entities.WeeklySchedule.filter({ branch }),
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ["team-members"],
    queryFn: () => base44.entities.TeamMember.list(),
    staleTime: 60000,
  });

  const branchMembers = teamMembers.filter(m => m.branches && m.branches.includes(branch));
  const existing = schedules[0];

  useEffect(() => {
    if (existing) setForm({ ...defaultForm(branch), ...existing, assignments: existing.assignments || [] });
  }, [existing, branch]);

  const saveMutation = useMutation({
    mutationFn: (data) =>
      existing
        ? base44.entities.WeeklySchedule.update(existing.id, data)
        : base44.entities.WeeklySchedule.create(data),
    onSuccess: () => {
      qc.invalidateQueries(["weekly-schedule", branch]);
      onClose?.();
    },
  });

  const addRow = () => {
    setForm(p => ({
      ...p,
      assignments: [...p.assignments, { employee_name: "", scheduled_date: "" }]
    }));
  };

  const updateRow = (idx, field, val) => {
    setForm(p => {
      const updated = [...p.assignments];
      updated[idx] = { ...updated[idx], [field]: val };
      return { ...p, assignments: updated };
    });
  };

  const removeRow = (idx) => {
    setForm(p => ({ ...p, assignments: p.assignments.filter((_, i) => i !== idx) }));
  };

  // Sort assignments by date for display
  const sorted = [...form.assignments].sort((a, b) => (a.scheduled_date || "").localeCompare(b.scheduled_date || ""));

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex items-center gap-2 text-teal-700">
        <Users className="w-5 h-5" />
        <h3 className="font-bold text-base">جدول الجرد الأسبوعي — {branch}</h3>
      </div>

      {branchMembers.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
          لا يوجد أعضاء فريق عمل مسجلون لهذا الفرع.
        </div>
      )}

      <div className="space-y-1">
        <Label>عدد الأصناف اليومي</Label>
        <Input
          type="number" min={1} max={200} className="w-32"
          value={form.items_per_day}
          onChange={e => setForm(p => ({ ...p, items_per_day: Number(e.target.value) }))}
        />
      </div>

      {/* Table header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>مواعيد الموظفين</Label>
          <Button size="sm" variant="outline" className="gap-1 text-xs h-7" onClick={addRow}>
            <Plus className="w-3 h-3" /> إضافة صف
          </Button>
        </div>

        {form.assignments.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-4 border rounded-lg border-dashed">
            لا توجد مواعيد — اضغط "إضافة صف" لإضافة موعد
          </p>
        )}

        <div className="space-y-2 max-h-72 overflow-y-auto">
          {form.assignments.map((row, idx) => (
            <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
              <Select
                value={row.employee_name || "none"}
                onValueChange={val => updateRow(idx, "employee_name", val === "none" ? "" : val)}
              >
                <SelectTrigger className="flex-1 h-8 text-sm bg-white">
                  <SelectValue placeholder="الموظف" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">اختر موظفاً</SelectItem>
                  {branchMembers.map(m => (
                    <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                className="w-38 h-8 text-sm bg-white"
                value={row.scheduled_date || ""}
                onChange={e => updateRow(idx, "scheduled_date", e.target.value)}
              />
              <button onClick={() => removeRow(idx)} className="text-red-400 hover:text-red-600 shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <Button
        className="w-full gap-2 bg-teal-600 hover:bg-teal-700"
        onClick={() => saveMutation.mutate(form)}
        disabled={saveMutation.isPending}
      >
        <Save className="w-4 h-4" />
        {saveMutation.isPending ? "جاري الحفظ..." : "حفظ الجدول"}
      </Button>
    </div>
  );
}