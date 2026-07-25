import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, User, Package, PlayCircle, ArrowRight, Loader2 } from "lucide-react";
import DailyCountScreen from "./DailyCountScreen";

const TODAY = new Date().toISOString().split("T")[0];

function getStatusForDate(date) {
  if (!date) return null;
  const diff = Math.floor((new Date(date) - new Date(TODAY)) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { label: "انتهى الموعد", color: "bg-gray-100 text-gray-500" };
  if (diff === 0) return { label: "اليوم", color: "bg-green-100 text-green-700" };
  if (diff === 1) return { label: "غداً", color: "bg-blue-100 text-blue-700" };
  return { label: `بعد ${diff} أيام`, color: "bg-yellow-100 text-yellow-700" };
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("ar-EG", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

export default function EmployeeScheduleView() {
  const qc = useQueryClient();
  const [activeTask, setActiveTask] = useState(null);
  const [generatingKey, setGeneratingKey] = useState(null); // "date|branch|emp"

  const { data: allSchedules = [], isLoading } = useQuery({
    queryKey: ["weekly-schedule-all"],
    queryFn: () => base44.entities.WeeklySchedule.list(),
    staleTime: 30000,
  });

  const { data: tasks = [], refetch: refetchTasks } = useQuery({
    queryKey: ["inventory-tasks-all"],
    queryFn: () => base44.entities.InventoryCountTask.list("-task_date", 200),
    staleTime: 15000,
  });

  const { data: allProducts = [] } = useQuery({
    queryKey: ["inventory-products-all"],
    queryFn: () => base44.entities.InventoryProduct.list(),
    staleTime: 60000,
  });

  const startMutation = useMutation({
    mutationFn: (taskId) =>
      base44.entities.InventoryCountTask.update(taskId, {
        status: "جاري",
        started_at: new Date().toISOString(),
      }),
    onSuccess: (updatedTask, taskId) => {
      qc.invalidateQueries(["inventory-tasks-all"]);
      const task = tasks.find(t => t.id === taskId);
      if (task) setActiveTask({ ...task, status: "جاري" });
    },
  });

  // Generate task on-the-fly then start it
  const handleStartOrGenerate = async (a, emp, schedule) => {
    const key = `${a.scheduled_date}|${a.branch}|${emp}`;
    const relatedTask = tasks.find(t => t.task_date === a.scheduled_date && t.branch === a.branch && t.assigned_employee === emp);

    if (relatedTask) {
      if (relatedTask.status === "مكتمل") return;
      if (relatedTask.status === "جاري") { setActiveTask(relatedTask); return; }
      startMutation.mutate(relatedTask.id);
      return;
    }

    // No task yet — generate it automatically
    setGeneratingKey(key);
    const branchProducts = allProducts.filter(p => p.branch === a.branch && p.is_active !== false);
    const itemsPerDay = schedule?.items_per_day || 20;
    const selected = [...branchProducts].sort(() => Math.random() - 0.5).slice(0, itemsPerDay);

    const task = await base44.entities.InventoryCountTask.create({
      task_date: a.scheduled_date,
      branch: a.branch,
      assigned_employee: emp,
      product_ids: selected.map(p => p.id),
      status: "جاري",
      started_at: new Date().toISOString(),
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
      count_date: a.scheduled_date,
      expected_quantity: p.stock_quantity || 0,
      actual_quantity: null,
      difference: null,
      status: "لم يُجرد",
    }));

    const BATCH = 20;
    for (let i = 0; i < entries.length; i += BATCH) {
      await base44.entities.InventoryCountEntry.bulkCreate(entries.slice(i, i + BATCH));
      if (i + BATCH < entries.length) await new Promise(r => setTimeout(r, 300));
    }

    qc.invalidateQueries(["inventory-tasks-all"]);
    setGeneratingKey(null);
    setActiveTask(task);
  };

  // If a session is active, show the counting screen
  if (activeTask) {
    return (
      <div dir="rtl">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 gap-1 text-gray-500"
          onClick={() => setActiveTask(null)}
        >
          <ArrowRight className="w-4 h-4" /> العودة للمواعيد
        </Button>
        <DailyCountScreen task={activeTask} />
      </div>
    );
  }

  // Flatten all assignments across all branches, sorted by date
  const allAssignments = allSchedules.flatMap(s =>
    (s.assignments || []).map(a => ({ ...a, branch: s.branch }))
  ).filter(a => a.scheduled_date)
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));

  // Group by employee
  const byEmployee = {};
  allAssignments.forEach(a => {
    if (!byEmployee[a.employee_name]) byEmployee[a.employee_name] = [];
    byEmployee[a.employee_name].push(a);
  });

  const employees = Object.keys(byEmployee).sort();

  if (isLoading) return <div className="text-center text-gray-400 py-8">جاري التحميل...</div>;

  if (employees.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <Calendar className="w-10 h-10 mx-auto mb-2 opacity-40" />
        <p>لا توجد مواعيد جرد مجدولة</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-4">
      <h3 className="font-bold text-gray-700 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-teal-600" />
        مواعيد الجرد القادمة لكل موظف
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {employees.map(emp => {
          const schedule = allSchedules.find(s => byEmployee[emp]?.some(a => a.branch === s.branch));
          return (
            <div key={emp} className="bg-white border rounded-xl overflow-hidden">
              <div className="bg-teal-50 border-b px-4 py-2 flex items-center gap-2">
                <User className="w-4 h-4 text-teal-600" />
                <span className="font-semibold text-teal-800">{emp}</span>
                <Badge className="mr-auto bg-teal-100 text-teal-700 text-xs">{byEmployee[emp].length} موعد</Badge>
              </div>
              <div className="divide-y">
                {byEmployee[emp].map((a, i) => {
                  const key = `${a.scheduled_date}|${a.branch}|${emp}`;
                  const relatedTask = tasks.find(t => t.task_date === a.scheduled_date && t.branch === a.branch && t.assigned_employee === emp);
                  const isCompleted = relatedTask?.status === "مكتمل";
                  const isRunning = relatedTask?.status === "جاري";
                  const isGenerating = generatingKey === key;
                  const isStarting = startMutation.isPending && startMutation.variables === relatedTask?.id;

                  return (
                    <div key={i} className="px-4 py-3 flex items-center gap-3">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-700">{formatDate(a.scheduled_date)}</p>
                        <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                          <Package className="w-3 h-3" />{a.branch}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        {isCompleted ? (
                          <Badge className="bg-green-100 text-green-700 text-xs">مكتمل ✓</Badge>
                        ) : (
                          <Button
                            size="sm"
                            className={`text-xs h-7 gap-1 ${isRunning ? "bg-blue-600 hover:bg-blue-700" : "bg-teal-600 hover:bg-teal-700"}`}
                            onClick={() => handleStartOrGenerate(a, emp, schedule)}
                            disabled={isGenerating || isStarting}
                          >
                            {isGenerating || isStarting ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <PlayCircle className="w-3.5 h-3.5" />
                            )}
                            {isGenerating ? "جاري التحضير..." : isRunning ? "متابعة الجرد" : "بدء الجرد"}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}