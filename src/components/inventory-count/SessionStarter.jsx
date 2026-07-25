import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlayCircle, Clock, User, Calendar, Package, AlertTriangle, Lock } from "lucide-react";

const TODAY = new Date().toISOString().split("T")[0];

const STATUS_BADGE = {
  "مجدول": "bg-yellow-100 text-yellow-800",
  "جاري": "bg-blue-100 text-blue-800",
  "مكتمل": "bg-green-100 text-green-800",
  "متأخر": "bg-red-100 text-red-800",
};

function isExpired() {
  return false; // No expiry — sessions can be started at any time
}

export default function SessionStarter({ task, onStarted }) {
  const qc = useQueryClient();

  const startMutation = useMutation({
    mutationFn: () =>
      base44.entities.InventoryCountTask.update(task.id, {
        status: "جاري",
        started_at: new Date().toISOString(),
      }),
    onSuccess: () => {
      qc.invalidateQueries(["inventory-tasks"]);
      onStarted?.();
    },
  });

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Clock className="w-12 h-12 text-gray-300 mb-3" />
        <p className="text-gray-500 font-medium">لا توجد مهمة جرد مجدولة لك اليوم</p>
        <p className="text-gray-400 text-sm mt-1">راجع لوحة المواعيد لمعرفة موعدك القادم</p>
      </div>
    );
  }

  const expired = isExpired();
  const isOverdue = task.status === "متأخر" || expired;

  return (
    <div dir="rtl" className="flex flex-col items-center justify-center py-8 px-4 space-y-5">
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${isOverdue ? "bg-red-100" : "bg-teal-100"}`}>
        <Package className={`w-8 h-8 ${isOverdue ? "text-red-500" : "text-teal-600"}`} />
      </div>

      <div className="text-center space-y-1">
        <h2 className="text-xl font-bold text-gray-800">مهمة الجرد</h2>
        <p className="text-gray-500 text-sm">{task.task_date}</p>
        {task.task_date > TODAY && (
          <p className="text-yellow-600 text-xs font-medium bg-yellow-50 px-3 py-1 rounded-full inline-block">
            ⚠️ الموعد المجدول في المستقبل — يمكنك البدء الآن
          </p>
        )}
      </div>

      <div className="bg-white border rounded-xl p-4 w-full max-w-sm space-y-3">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <User className="w-4 h-4 text-teal-500" />
          <span className="font-medium">الموظف المكلف:</span>
          <span>{task.assigned_employee || "—"}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Package className="w-4 h-4 text-teal-500" />
          <span className="font-medium">عدد الأصناف:</span>
          <span>{task.items_count}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Calendar className="w-4 h-4 text-teal-500" />
          <span className="font-medium">الفرع:</span>
          <span>{task.branch}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-gray-600">الحالة:</span>
          <Badge className={STATUS_BADGE[task.status] || "bg-gray-100 text-gray-700"}>{task.status}</Badge>
        </div>
      </div>

      {/* Expired — locked */}
      {(isOverdue && task.status !== "مكتمل") && (
        <div className="w-full max-w-sm bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <Lock className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-red-700 font-semibold text-sm">انتهت مدة الجرد</p>
            <p className="text-red-500 text-xs mt-0.5">لا يمكن بدء الجرد بعد مرور 24 ساعة على الموعد المحدد</p>
          </div>
        </div>
      )}

      {/* Can start — مجدول at any time before expiry */}
      {task.status === "مجدول" && !isOverdue && (
        <Button
          className="w-full max-w-sm gap-2 bg-teal-600 hover:bg-teal-700 h-12 text-base"
          onClick={() => startMutation.mutate()}
          disabled={startMutation.isPending}
        >
          <PlayCircle className="w-5 h-5" />
          {startMutation.isPending ? "جاري البدء..." : "بدء الجرد"}
        </Button>
      )}

      {/* Already in progress */}
      {task.status === "جاري" && (
        <Button
          className="w-full max-w-sm gap-2 bg-blue-600 hover:bg-blue-700 h-12 text-base"
          onClick={onStarted}
        >
          <PlayCircle className="w-5 h-5" />
          متابعة الجرد
        </Button>
      )}

      {task.status === "مكتمل" && (
        <div className="text-center text-green-600 font-semibold">✓ تم إنهاء هذه المهمة بنجاح</div>
      )}
    </div>
  );
}