import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ClipboardList, Eye, XCircle } from "lucide-react";
import { useUserRole } from "@/lib/useUserRole";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortControls } from "@/components/table/SortControls";

const LOG_SORT_COLUMNS = [
  { field: "created_date", label: "التاريخ", type: "date" },
  { field: "action_type", label: "نوع العملية", type: "text" },
  { field: "entity_type", label: "النوع", type: "text" },
  { field: "entity_label", label: "السجل", type: "text" },
  { field: "user_name", label: "المستخدم", type: "text" },
];

const ACTION_LABELS = {
  create: { label: "إضافة", color: "bg-green-100 text-green-700" },
  update: { label: "تعديل", color: "bg-blue-100 text-blue-700" },
  delete: { label: "حذف", color: "bg-red-100 text-red-700" },
  payment: { label: "دفعة", color: "bg-purple-100 text-purple-700" },
  cancelled: { label: "ملغى", color: "bg-gray-100 text-gray-500" },
};

const ENTITY_LABELS = {
  invoice: "فاتورة",
  expense: "مصروف",
  supplier: "مورد",
  payment: "سداد",
};

export default function ActivityLog() {
  const queryClient = useQueryClient();
  const { isManager } = useUserRole();
  const [selected, setSelected] = useState(null);
  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({
    columns: LOG_SORT_COLUMNS,
    defaultSort: { field: "created_date", direction: "desc" },
    paramPrefix: "log",
  });

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["activity-logs"],
    queryFn: () => base44.entities.ActivityLog.list("-created_date", 200),
    staleTime: 5000,
  });

  useEffect(() => {
    const unsub = base44.entities.ActivityLog.subscribe(() => {
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    });
    return unsub;
  }, []);

  const cancelLog = useMutation({
    mutationFn: async (log) => {
      await base44.entities.ActivityLog.update(log.id, {
        action_type: "cancelled",
        details: (log.details || "") + ` | ⚠️ تم الإلغاء بواسطة المدير`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
      setSelected(null);
    },
  });

  const fmt = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleDateString("ar-EG") + " " + d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
  };

  // Try to parse details as key:value lines or JSON for better display
  const parseDetails = (details) => {
    if (!details) return null;
    // Try JSON
    try {
      const obj = JSON.parse(details);
      return Object.entries(obj).map(([k, v]) => ({ key: k, value: String(v) }));
    } catch {}
    // Try "key: value" lines
    const lines = details.split(/[,\n|]+/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 1) return lines.map(l => {
      const idx = l.indexOf(":");
      if (idx > 0) return { key: l.slice(0, idx).trim(), value: l.slice(idx + 1).trim() };
      return { key: null, value: l };
    });
    return [{ key: null, value: details }];
  };

  const sortedLogs = useMemo(() => sortData(logs), [logs, sortData]);

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-6 h-6 text-teal-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-800">سجل العمليات</h1>
            <p className="text-gray-500 text-sm mt-0.5">جميع العمليات المنفذة في النظام</p>
          </div>
        </div>
        <SortControls
          columns={LOG_SORT_COLUMNS}
          sortField={sortField}
          sortDirection={sortDirection}
          onToggle={toggleSort}
          onSet={setSort}
          onReset={resetSort}
          cardMode
        />
      </div>

      {isLoading ? (
        <Card className="p-8 text-center text-gray-400">
          <div className="w-8 h-8 border-4 border-gray-200 border-t-teal-600 rounded-full animate-spin mx-auto mb-3" />
          جاري التحميل...
        </Card>
      ) : logs.length === 0 ? (
        <Card className="p-12 text-center text-gray-400">لا توجد عمليات مسجلة بعد</Card>
      ) : (
        <div className="space-y-2">
          {sortedLogs.map((log) => {
            const action = ACTION_LABELS[log.action_type] || { label: log.action_type, color: "bg-gray-100 text-gray-700" };
            const isCancelled = log.action_type === "cancelled";
            return (
              <Card key={log.id} className={`p-4 flex items-start justify-between gap-3 hover:bg-gray-50 transition-colors ${isCancelled ? "opacity-60" : ""}`}>
                <div className="flex items-start gap-3 min-w-0">
                  <Badge className={`${action.color} border-0 shrink-0 mt-0.5`}>{action.label}</Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800">
                      {ENTITY_LABELS[log.entity_type] || log.entity_type}
                      {log.entity_label ? `: ${log.entity_label}` : ""}
                    </p>
                    {log.details && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{log.details}</p>}
                    <p className="text-xs text-gray-400 mt-1">{log.user_name || log.user_email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-gray-400 text-left">{fmt(log.created_date)}</span>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-gray-400 hover:text-teal-600" onClick={() => setSelected(log)}>
                    <Eye className="w-4 h-4" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selected && (() => {
                const action = ACTION_LABELS[selected.action_type] || { label: selected.action_type, color: "bg-gray-100 text-gray-700" };
                return <><Badge className={`${action.color} border-0`}>{action.label}</Badge> تفاصيل العملية</>;
              })()}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">النوع</p>
                  <p className="font-semibold mt-0.5">{ENTITY_LABELS[selected.entity_type] || selected.entity_type}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">السجل</p>
                  <p className="font-semibold mt-0.5">{selected.entity_label || "—"}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">المستخدم</p>
                  <p className="font-semibold mt-0.5">{selected.user_name || selected.user_email || "—"}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">التاريخ</p>
                  <p className="font-semibold mt-0.5">{fmt(selected.created_date)}</p>
                </div>
              </div>

              {selected.details && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">تفاصيل التغييرات</p>
                  <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
                    {parseDetails(selected.details).map((row, i) => (
                      <div key={i} className="text-sm flex gap-2">
                        {row.key && <span className="text-gray-500 shrink-0">{row.key}:</span>}
                        <span className="text-gray-800">{row.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSelected(null)}>إغلاق</Button>
            {isManager && selected?.action_type === "update" && (
              <Button
                variant="outline"
                className="border-red-300 text-red-600 hover:bg-red-50 gap-1"
                disabled={cancelLog.isPending}
                onClick={() => cancelLog.mutate(selected)}
              >
                <XCircle className="w-4 h-4" />
                {cancelLog.isPending ? "جاري الإلغاء..." : "تسجيل كملغى"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}