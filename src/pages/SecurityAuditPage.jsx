import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, Search, Download, AlertTriangle, CheckCircle, XCircle, Lock } from "lucide-react";
import { useUserRole } from "@/lib/useUserRole";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortableHeader } from "@/components/table/SortableHeader";
import { SortControls } from "@/components/table/SortControls";
import * as XLSX from "xlsx";

const AUDIT_SORT_COLUMNS = [
  { field: "created_date", label: "التاريخ", type: "date" },
  { field: "user_name", label: "المستخدم", type: "text" },
  { field: "action_type", label: "العملية", type: "text" },
  { field: "entity_label", label: "الوصف", type: "text" },
  { field: "status", label: "الحالة", type: "text" },
];

const ACTION_LABELS = {
  create: { label: "إنشاء", color: "bg-green-100 text-green-700" },
  update: { label: "تعديل", color: "bg-blue-100 text-blue-700" },
  delete: { label: "حذف", color: "bg-red-100 text-red-700" },
  payment: { label: "دفعة", color: "bg-purple-100 text-purple-700" },
  bulk_update: { label: "تعديل جماعي", color: "bg-orange-100 text-orange-700" },
  import: { label: "استيراد", color: "bg-cyan-100 text-cyan-700" },
  export: { label: "تصدير", color: "bg-teal-100 text-teal-700" },
  permission_change: { label: "تغيير صلاحية", color: "bg-pink-100 text-pink-700" },
  status_change: { label: "تغيير حالة", color: "bg-indigo-100 text-indigo-700" },
  exclusion_change: { label: "استثناء", color: "bg-amber-100 text-amber-700" },
  category_change: { label: "تغيير تصنيف", color: "bg-violet-100 text-violet-700" },
  role_change: { label: "تغيير دور", color: "bg-rose-100 text-rose-700" },
};

export default function SecurityAuditPage() {
  const { isAdmin } = useUserRole();
  const [search, setSearch] = useState("");
  const [filterAction, setFilterAction] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterEntityType, setFilterEntityType] = useState("all");

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["security-audit-logs"],
    queryFn: () => base44.entities.ActivityLog.list("-created_date", 500),
  });

  const filtered = useMemo(() => {
    return logs.filter((log) => {
      if (filterAction !== "all" && log.action_type !== filterAction) return false;
      if (filterStatus !== "all" && log.status !== filterStatus) return false;
      if (filterEntityType !== "all" && log.entity_type !== filterEntityType) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${log.user_email} ${log.user_name} ${log.entity_label} ${log.details} ${log.old_value} ${log.new_value} ${log.batch_id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, search, filterAction, filterStatus, filterEntityType]);

  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({
    columns: AUDIT_SORT_COLUMNS,
    defaultSort: { field: "created_date", direction: "desc" },
    paramPrefix: "aud",
  });
  const sortedLogs = useMemo(() => sortData(filtered), [filtered, sortData]);

  const stats = useMemo(() => {
    const total = logs.length;
    const failed = logs.filter((l) => l.status === "failed").length;
    const deletes = logs.filter((l) => l.action_type === "delete").length;
    const bulkOps = logs.filter((l) => l.batch_id).length;
    const permChanges = logs.filter((l) => l.action_type === "permission_change" || l.action_type === "role_change").length;
    return { total, failed, deletes, bulkOps, permChanges };
  }, [logs]);

  const handleExport = () => {
    const rows = filtered.map((l) => ({
      "التاريخ": l.created_date ? new Date(l.created_date).toLocaleString("ar-EG") : "",
      "المستخدم": l.user_name || "",
      "البريد": l.user_email || "",
      "الدور": l.user_role || "",
      "الفرع": l.user_branch || "",
      "العملية": ACTION_LABELS[l.action_type]?.label || l.action_type,
      "النوع": l.entity_type,
      "الوصف": l.entity_label || "",
      "القيمة القديمة": l.old_value || "",
      "القيمة الجديدة": l.new_value || "",
      "الحالة": l.status === "success" ? "ناجح" : "فاشل",
      "معرف الدفعة": l.batch_id || "",
      "السبب": l.reason || "",
      "التفاصيل": l.details || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!dir"] = "rtl";
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "سجل الأمان");
    XLSX.writeFile(wb, `سجل_الأمان_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  if (!isAdmin) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-gray-400">
        <Lock className="w-12 h-12" />
        <p className="text-lg font-medium">هذه الصفحة للمدير العام فقط</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-teal-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-800">سجل الأمان والعمليات الحساسة</h1>
            <p className="text-gray-500 text-sm mt-0.5">مراقبة العمليات الناجحة والمحاولات المرفوضة والتعديلات الحساسة</p>
          </div>
        </div>
        <button onClick={handleExport} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100">
          <Download className="w-4 h-4" /> تصدير
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="إجمالي العمليات" value={stats.total} color="text-gray-700" bg="bg-gray-50" />
        <StatCard label="عمليات فاشلة" value={stats.failed} icon={<XCircle className="w-4 h-4" />} color="text-red-600" bg="bg-red-50" />
        <StatCard label="عمليات حذف" value={stats.deletes} icon={<AlertTriangle className="w-4 h-4" />} color="text-orange-600" bg="bg-orange-50" />
        <StatCard label="عمليات جماعية" value={stats.bulkOps} color="text-blue-600" bg="bg-blue-50" />
        <StatCard label="تغييرات صلاحيات" value={stats.permChanges} color="text-pink-600" bg="bg-pink-50" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالمستخدم، الوصف، القيم..." className="pr-9 h-9" />
        </div>
        <Select value={filterAction} onValueChange={setFilterAction}>
          <SelectTrigger className="w-40 h-9"><SelectValue placeholder="العملية" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل العمليات</SelectItem>
            {Object.entries(ACTION_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-32 h-9"><SelectValue placeholder="الحالة" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            <SelectItem value="success">ناجح</SelectItem>
            <SelectItem value="failed">فاشل</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterEntityType} onValueChange={setFilterEntityType}>
          <SelectTrigger className="w-36 h-9"><SelectValue placeholder="النوع" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الأنواع</SelectItem>
            <SelectItem value="invoice">فواتير</SelectItem>
            <SelectItem value="supplier">موردين</SelectItem>
            <SelectItem value="user">مستخدمين</SelectItem>
            <SelectItem value="expense">مصروفات</SelectItem>
            <SelectItem value="return">مرتجعات</SelectItem>
            <SelectItem value="inventory">مخزون</SelectItem>
            <SelectItem value="order">طلبات</SelectItem>
          </SelectContent>
        </Select>
        <SortControls
          columns={AUDIT_SORT_COLUMNS}
          sortField={sortField}
          sortDirection={sortDirection}
          onToggle={toggleSort}
          onSet={setSort}
          onReset={resetSort}
        />
      </div>

      {/* Logs Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-right text-xs text-gray-500">
                <SortableHeader field="created_date" label="التاريخ" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="p-3" />
                <SortableHeader field="user_name" label="المستخدم" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="p-3" />
                <SortableHeader field="action_type" label="العملية" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="p-3" />
                <SortableHeader field="entity_label" label="الوصف" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="p-3" />
                <th className="p-3 font-medium">القيمة القديمة</th>
                <th className="p-3 font-medium">القيمة الجديدة</th>
                <SortableHeader field="status" label="الحالة" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} className="p-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="p-8 text-center text-gray-400">جاري التحميل...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-gray-400">لا توجد سجلات</td></tr>
              ) : (
                sortedLogs.slice(0, 100).map((log) => (
                  <tr key={log.id} className="border-b hover:bg-gray-50">
                    <td className="p-3 text-xs text-gray-500 whitespace-nowrap">
                      {log.created_date ? new Date(log.created_date).toLocaleString("ar-EG") : "—"}
                    </td>
                    <td className="p-3">
                      <div className="font-medium text-gray-800 text-xs">{log.user_name || "—"}</div>
                      <div className="text-xs text-gray-400">{log.user_email}</div>
                      {log.user_role && <Badge className="text-[10px] mt-0.5 bg-gray-100 text-gray-600 border-0">{log.user_role}</Badge>}
                    </td>
                    <td className="p-3">
                      <Badge className={`${ACTION_LABELS[log.action_type]?.color || "bg-gray-100 text-gray-600"} border-0 text-xs`}>
                        {ACTION_LABELS[log.action_type]?.label || log.action_type}
                      </Badge>
                      {log.batch_id && <div className="text-[10px] text-gray-400 mt-0.5">دفعة</div>}
                    </td>
                    <td className="p-3 text-xs text-gray-700 max-w-[200px]">
                      <div className="font-medium">{log.entity_label || "—"}</div>
                      {log.details && <div className="text-gray-500 truncate">{log.details}</div>}
                      {log.reason && <div className="text-gray-400 text-[10px]">السبب: {log.reason}</div>}
                    </td>
                    <td className="p-3 text-xs text-red-600 max-w-[150px]">
                      {log.old_value ? <div className="truncate" title={log.old_value}>{log.old_value}</div> : "—"}
                    </td>
                    <td className="p-3 text-xs text-green-600 max-w-[150px]">
                      {log.new_value ? <div className="truncate" title={log.new_value}>{log.new_value}</div> : "—"}
                    </td>
                    <td className="p-3">
                      {log.status === "failed" ? (
                        <span className="flex items-center gap-1 text-red-600 text-xs"><XCircle className="w-3.5 h-3.5" /> فاشل</span>
                      ) : (
                        <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle className="w-3.5 h-3.5" /> ناجح</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 100 && (
          <div className="p-3 text-center text-xs text-gray-400">
            عرض 100 من {filtered.length} سجل — استخدم الفلاتر أو التصدير لعرض الباقي
          </div>
        )}
      </Card>
    </div>
  );
}

function StatCard({ label, value, icon, color, bg }) {
  return (
    <Card className={`p-3 ${bg}`}>
      <div className="flex items-center gap-2">
        {icon}
        <div>
          <div className={`text-xl font-bold ${color}`}>{value}</div>
          <div className="text-xs text-gray-500">{label}</div>
        </div>
      </div>
    </Card>
  );
}