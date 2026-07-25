import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Zap, Calendar, CheckCircle2 } from "lucide-react";

const TODAY = new Date().toISOString().split("T")[0];

export default function TaskGenerator({ branch, products, onDone }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(TODAY);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const { data: schedules = [] } = useQuery({
    queryKey: ["weekly-schedule", branch],
    queryFn: () => base44.entities.WeeklySchedule.filter({ branch }),
    staleTime: 60000,
  });

  const schedule = schedules[0];
  // Find employee assigned to selected date from assignments array
  const assignment = (schedule?.assignments || []).find(a => a.scheduled_date === date);
  const employeeForDay = assignment?.employee_name || "";
  const itemsPerDay = schedule?.items_per_day || 20;

  const handleGenerate = async () => {
    setLoading(true);
    const branchProducts = products.filter(p => p.branch === branch && p.is_active !== false);

    // Shuffle randomly for daily selection
    const shuffled = [...branchProducts].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, itemsPerDay);

    const task = await base44.entities.InventoryCountTask.create({
      task_date: date,
      branch,
      assigned_employee: employeeForDay,
      product_ids: selected.map(p => p.id),
      status: "مجدول",
      items_count: selected.length,
      completed_count: 0,
      matched_count: 0,
      diff_count: 0,
    });

    const entries = selected.map(p => ({
      task_id: task.id,
      product_id: p.id,
      product_code: p.product_code || "",
      product_name: p.product_name,
      branch: p.branch,
      count_date: date,
      expected_quantity: p.stock_quantity || 0,
      actual_quantity: null,
      difference: null,
      status: "لم يُجرد",
    }));

    const BATCH = 20;
    for (let i = 0; i < entries.length; i += BATCH) {
      await base44.entities.InventoryCountEntry.bulkCreate(entries.slice(i, i + BATCH));
      if (i + BATCH < entries.length) await new Promise(r => setTimeout(r, 500));
    }

    qc.invalidateQueries(["inventory-tasks"]);
    qc.invalidateQueries(["inventory-entries"]);
    setResult({ count: selected.length, employee: employeeForDay });
    setLoading(false);
  };

  if (result) {
    return (
      <div dir="rtl" className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle2 className="w-12 h-12 text-green-500" />
        <p className="text-lg font-bold text-gray-700">تم توليد مهمة الجرد!</p>
        <p className="text-sm text-gray-500">{result.count} صنف — الموظف: {result.employee || "لم يُحدد"}</p>
        <Button className="bg-teal-600 hover:bg-teal-700" onClick={onDone}>إغلاق</Button>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex items-center gap-2 text-teal-700">
        <Zap className="w-5 h-5" />
        <h3 className="font-bold text-base">توليد مهمة جرد — {branch}</h3>
      </div>

      <div className="space-y-1">
        <Label>تاريخ المهمة</Label>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-44" />
        </div>
      </div>

      {schedule ? (
        <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 text-sm text-teal-800 space-y-1">
          <p>الموظف المكلف: <strong>{employeeForDay || "لم يُحدد لهذا التاريخ"}</strong></p>
          <p>عدد الأصناف: <strong>{itemsPerDay}</strong></p>
          <p>الأصناف المتاحة: <strong>{products.filter(p => p.branch === branch && p.is_active !== false).length}</strong></p>
        </div>
      ) : (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
          يرجى إعداد جدول الموظفين الأسبوعي أولاً
        </div>
      )}

      {schedule?.assignments?.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500">المواعيد المجدولة للفرع</div>
          <div className="divide-y max-h-36 overflow-y-auto">
            {[...schedule.assignments]
              .sort((a, b) => a.scheduled_date?.localeCompare(b.scheduled_date))
              .map((a, i) => (
                <button
                  key={i}
                  onClick={() => setDate(a.scheduled_date)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-teal-50 transition-colors ${date === a.scheduled_date ? "bg-teal-50 font-semibold text-teal-700" : "text-gray-700"}`}
                >
                  <span>{a.scheduled_date}</span>
                  <span className="text-gray-500">{a.employee_name}</span>
                </button>
              ))}
          </div>
        </div>
      )}

      <Button
        className="w-full gap-2 bg-teal-600 hover:bg-teal-700"
        onClick={handleGenerate}
        disabled={!schedule || loading || products.filter(p => p.branch === branch).length === 0}
      >
        <Zap className="w-4 h-4" />
        {loading ? "جاري التوليد..." : "توليد مهمة الجرد"}
      </Button>
    </div>
  );
}