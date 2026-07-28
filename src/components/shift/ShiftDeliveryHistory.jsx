import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Pencil, Eye, Plus, Download, Printer, CalendarDays, Search } from "lucide-react";
import ShiftDeliveryDetail from "./ShiftDeliveryDetail";
import ShiftDeliveryEditDialog from "./ShiftDeliveryEditDialog";
import { useUserRole } from "@/lib/useUserRole";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortControls } from "@/components/table/SortControls";
import { SHIFT_TYPE_ORDER } from "@/lib/sortUtils";

const SHIFT_SORT_COLUMNS = [
  { field: "shift_type", label: "نوع الشفت", type: "status", statusMap: SHIFT_TYPE_ORDER },
  { field: "submitted_by", label: "الموظف", type: "text" },
  { field: "total_sales", label: "المبيعات", type: "number" },
  { field: "total_expenses", label: "المصروفات", type: "number" },
  { field: "net_amount", label: "الصافي", type: "number" },
];

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const SHIFT_TYPES = ["صباحي", "مسائي", "ليلي"];
const BRANCH_COLORS = {
  "دواء شكري": { dot: "bg-teal-500", text: "text-teal-700", bg: "bg-teal-50", border: "border-teal-200" },
  "دواء الشامي": { dot: "bg-orange-500", text: "text-orange-700", bg: "bg-orange-50", border: "border-orange-200" },
};
const SHIFT_BADGE = {
  صباحي: "bg-amber-100 text-amber-700",
  مسائي: "bg-blue-100 text-blue-700",
  ليلي: "bg-indigo-100 text-indigo-700",
};
const TREASURY_BADGE = {
  approved: "bg-emerald-100 text-emerald-700",
  reviewed: "bg-emerald-100 text-emerald-700",
  pending_review: "bg-amber-100 text-amber-700",
  pending: "bg-amber-100 text-amber-700",
};

const fmt = (n) => Number(n || 0).toLocaleString("ar-EG");
const localDate = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export default function ShiftDeliveryHistory({ deliveries, onNewShift }) {
  const qc = useQueryClient();
  const { isAdmin } = useUserRole();
  const [detailItem, setDetailItem] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [branch, setBranch] = useState("all");
  const [shiftType, setShiftType] = useState("all");
  const [employee, setEmployee] = useState("");

  const applyPreset = (preset) => {
    const today = new Date();
    if (preset === "today") {
      const value = localDate(today); setFromDate(value); setToDate(value); return;
    }
    if (preset === "month") {
      setFromDate(localDate(new Date(today.getFullYear(), today.getMonth(), 1)));
      setToDate(localDate(today)); return;
    }
    setFromDate(""); setToDate("");
  };

  const dateFilteredRaw = useMemo(() => {
    const term = employee.trim().toLowerCase();
    return deliveries.filter((d) => {
      if (!d.shift_date) return false;
      if (fromDate && d.shift_date < fromDate) return false;
      if (toDate && d.shift_date > toDate) return false;
      if (branch !== "all" && d.branch !== branch) return false;
      if (shiftType !== "all" && d.shift_type !== shiftType) return false;
      if (term && !String(d.submitted_by || d.employee_name || "").toLowerCase().includes(term)) return false;
      return true;
    });
  }, [deliveries, fromDate, toDate, branch, shiftType, employee]);

  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({
    columns: SHIFT_SORT_COLUMNS,
    defaultSort: { field: "shift_type", direction: "asc" },
    paramPrefix: "shift",
  });
  const dateFiltered = useMemo(() => sortData(dateFilteredRaw), [dateFilteredRaw, sortData]);

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ShiftDelivery.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shift-deliveries"] }),
  });

  const grouped = useMemo(() => {
    const map = {};
    for (const d of dateFiltered) (map[d.shift_date || "—"] ||= []).push(d);
    return Object.entries(map).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [dateFiltered]);

  const totalSummary = useMemo(() => ({
    count: dateFiltered.length,
    sales: dateFiltered.reduce((s, d) => s + Number(d.total_sales || 0), 0),
    expenses: dateFiltered.reduce((s, d) => s + Number(d.total_expenses || 0), 0),
    net: dateFiltered.reduce((s, d) => s + Number(d.net_amount || 0), 0),
  }), [dateFiltered]);

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const rows = dateFiltered.map((d) => ({
      التاريخ: d.shift_date || "", الفرع: d.branch || "", الشيفت: d.shift_type || "",
      الموظف: d.submitted_by || d.employee_name || "", المبيعات: Number(d.total_sales || 0),
      المصروفات: Number(d.total_expenses || 0), الصافي: Number(d.net_amount || 0),
      "حالة الخزنة": d.treasury_status || d.status || "", ملاحظات: d.notes || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تسليمات الشيفت");
    XLSX.writeFile(wb, `تسليمات_الشيفت_${localDate()}.xlsx`);
  };

  const dateLabel = (dateStr) => {
    if (!dateStr || dateStr === "—") return "تسليمات بدون تاريخ";
    const d = new Date(`${dateStr}T00:00:00`);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    if (d.getTime() === today.getTime()) return "تسليمات اليوم";
    if (d.getTime() === yesterday.getTime()) return "تسليمات الأمس";
    return `تسليمات ${d.toLocaleDateString("ar-EG", { weekday: "long" })}`;
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-xl font-bold text-gray-900">التسليمات</h2><p className="text-sm text-gray-500">متابعة يومية مجمعة حسب التاريخ والفرع والشيفت</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportExcel}><Download className="h-4 w-4" /> Excel</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> طباعة</Button>
          <Button onClick={onNewShift} size="sm" className="bg-indigo-600 hover:bg-indigo-700"><Plus className="h-4 w-4" /> تسليم جديد</Button>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-3 print:hidden">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => applyPreset("today")}><CalendarDays className="h-4 w-4" /> اليوم</Button>
          <Button size="sm" variant="outline" onClick={() => applyPreset("month")}>الشهر الحالي</Button>
          <Button size="sm" variant="ghost" onClick={() => applyPreset("all")}>كل الفترات</Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Select value={branch} onValueChange={setBranch}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل الفروع</SelectItem>{BRANCHES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select>
          <div className="relative"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"/><Input value={employee} onChange={(e) => setEmployee(e.target.value)} placeholder="اسم الموظف" className="pr-9"/></div>
          <Select value={shiftType} onValueChange={setShiftType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل الشيفتات</SelectItem>{SHIFT_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <SortControls columns={SHIFT_SORT_COLUMNS} sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} onSet={setSort} onReset={resetSort} cardMode />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['عدد التسليمات', totalSummary.count, 'text-gray-900'], ['إجمالي المبيعات', `${fmt(totalSummary.sales)} ج`, 'text-blue-700'], ['إجمالي المصروفات', `${fmt(totalSummary.expenses)} ج`, 'text-red-600'], ['الصافي', `${fmt(totalSummary.net)} ج`, 'text-emerald-700']].map(([label, value, cls]) => <div key={label} className="rounded-xl border bg-white p-4 text-center"><p className="text-xs text-gray-500">{label}</p><p className={`mt-2 text-xl font-bold ${cls}`}>{value}</p></div>)}
      </div>

      {!dateFiltered.length && <div className="rounded-xl border bg-white py-16 text-center text-sm text-gray-400">لا توجد تسليمات مطابقة للفلاتر</div>}

      {grouped.map(([date, items]) => {
        const totalSales = items.reduce((s, d) => s + Number(d.total_sales || 0), 0);
        const totalExpenses = items.reduce((s, d) => s + Number(d.total_expenses || 0), 0);
        const totalNet = items.reduce((s, d) => s + Number(d.net_amount || 0), 0);
        return <section key={date} className="space-y-3">
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-teal-600"/><span className="font-bold">{dateLabel(date)}</span><span className="text-xs text-gray-400">{date}</span><span className="rounded-full bg-gray-100 px-2 py-1 text-xs">{items.length} تسليم</span></div>
              <div className="flex gap-5 text-center text-xs"><div><p className="text-gray-400">المبيعات</p><p className="font-bold text-blue-700">{fmt(totalSales)}</p></div><div><p className="text-gray-400">المصروفات</p><p className="font-bold text-red-600">{fmt(totalExpenses)}</p></div><div><p className="text-gray-400">الصافي</p><p className="font-bold text-emerald-700">{fmt(totalNet)}</p></div></div>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {BRANCHES.map((branchName) => {
              const branchItems = items.filter((d) => d.branch === branchName);
              const colors = BRANCH_COLORS[branchName];
              if (!branchItems.length) return <div key={branchName} className={`rounded-xl border-2 border-dashed ${colors.border} p-6 text-center text-sm text-gray-400`}>{branchName}: لا توجد تسليمات</div>;
              const branchNet = branchItems.reduce((s, d) => s + Number(d.net_amount || 0), 0);
              return <div key={branchName} className={`rounded-xl border ${colors.border} ${colors.bg} p-3 space-y-2`}>
                <div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${colors.dot}`}/><span className={`font-bold ${colors.text}`}>{branchName}</span></div><span className="text-xs text-gray-500">{branchItems.length} تسليم</span></div>
                {branchItems.map((item) => {
                  const treasury = item.treasury_status || item.status || 'pending';
                  return <div key={item.id} className="rounded-xl border bg-white p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2"><div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SHIFT_BADGE[item.shift_type] || 'bg-gray-100 text-gray-600'}`}>{item.shift_type || 'غير محدد'}</span><span className="text-sm font-semibold">{item.submitted_by || item.employee_name || '—'}</span><span className={`rounded-full px-2 py-0.5 text-[10px] ${TREASURY_BADGE[treasury] || 'bg-gray-100 text-gray-600'}`}>{['approved','reviewed'].includes(treasury) ? 'تمت مراجعة الخزنة' : 'بانتظار الخزنة'}</span></div>{item.notes && <p className="mt-1 line-clamp-1 text-xs text-gray-400">{item.notes}</p>}</div><div className="flex gap-1 print:hidden"><button onClick={() => setDetailItem(item)} className="rounded p-1 text-gray-400 hover:bg-blue-50 hover:text-blue-600"><Eye className="h-4 w-4"/></button>{isAdmin && <button onClick={() => setEditItem(item)} className="rounded p-1 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600"><Pencil className="h-4 w-4"/></button>}{isAdmin && <button onClick={() => window.confirm('هل تريد حذف هذا التسليم؟') && deleteMutation.mutate(item.id)} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4"/></button>}</div></div>
                    <div className="mt-3 grid grid-cols-3 gap-2 border-t pt-3 text-center text-xs"><div><p className="text-gray-400">المبيعات</p><p className="font-bold text-blue-700">{fmt(item.total_sales)}</p></div><div><p className="text-gray-400">المصروفات</p><p className="font-bold text-red-600">{fmt(item.total_expenses)}</p></div><div><p className="text-gray-400">الصافي</p><p className="font-bold text-emerald-700">{fmt(item.net_amount)}</p></div></div>
                  </div>;
                })}
                <div className="flex justify-between border-t pt-2 text-sm"><span className="text-gray-500">صافي الفرع</span><span className="font-bold">{fmt(branchNet)} ج</span></div>
              </div>;
            })}
          </div>
        </section>;
      })}

      {detailItem && <ShiftDeliveryDetail item={detailItem} onClose={() => setDetailItem(null)} />}
      {editItem && <ShiftDeliveryEditDialog item={editItem} onClose={() => setEditItem(null)} />}
    </div>
  );
}
