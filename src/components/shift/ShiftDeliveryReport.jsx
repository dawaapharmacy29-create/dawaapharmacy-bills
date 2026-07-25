import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download } from "lucide-react";
import ExpenseCategoryBreakdown from "./ExpenseCategoryBreakdown";
import DateRangeFilter from "./DateRangeFilter";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const SHIFT_TYPES = ["صباحي", "مسائي", "ليلي"];

const fmt = (n) => Number(n || 0).toLocaleString("ar-EG");

export default function ShiftDeliveryReport({ deliveries }) {
  const [filterBranch, setFilterBranch] = useState("الكل");
  const [filterShift, setFilterShift] = useState("الكل");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filtered = useMemo(() => {
    return deliveries
      .filter((d) => filterBranch === "الكل" || d.branch === filterBranch)
      .filter((d) => filterShift === "الكل" || d.shift_type === filterShift)
      .filter((d) => {
        if (!d.shift_date) return false;
        if (fromDate && d.shift_date < fromDate) return false;
        if (toDate && d.shift_date > toDate) return false;
        return true;
      })
      .sort((a, b) => (a.shift_date < b.shift_date ? 1 : -1));
  }, [deliveries, filterBranch, filterShift, fromDate, toDate]);

  const totals = useMemo(() => {
    return {
      sales: filtered.reduce((s, d) => s + (d.total_sales || 0), 0),
      expenses: filtered.reduce((s, d) => s + (d.total_expenses || 0), 0),
      net: filtered.reduce((s, d) => s + (d.net_amount || 0), 0),
      count: filtered.length,
    };
  }, [filtered]);

  const exportExcel = () => {
    import("xlsx").then((XLSX) => {
      const rows = filtered.map((d) => ({
        "التاريخ": d.shift_date || "",
        "الفرع": d.branch || "",
        "نوع الشيفت": d.shift_type || "",
        "الموظف": d.submitted_by || "",
        "إجمالي المبيعات": d.total_sales || 0,
        "إجمالي المصروفات": d.total_expenses || 0,
        "الصافي": d.net_amount || 0,
        "ملاحظات": d.notes || "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "تسليمات الشيفت");
      XLSX.writeFile(wb, "تسليمات_الشيفت.xlsx");
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-lg font-bold text-gray-800">تقرير التسليمات</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToDateChange={setToDate} />
          <Select value={filterBranch} onValueChange={setFilterBranch}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="الكل">كل الفروع</SelectItem>
              {BRANCHES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterShift} onValueChange={setFilterShift}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="الكل">كل الأنواع</SelectItem>
              {SHIFT_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={exportExcel} variant="outline" size="sm" className="border-green-200 text-green-700 hover:bg-green-50">
            <Download className="w-4 h-4" /> تصدير Excel
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card className="p-3 text-center">
          <p className="text-xs text-gray-500">عدد التسليمات</p>
          <p className="text-lg font-bold text-gray-800">{totals.count}</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xs text-gray-500">إجمالي المبيعات</p>
          <p className="text-lg font-bold text-blue-700">{fmt(totals.sales)}</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xs text-gray-500">إجمالي المصروفات</p>
          <p className="text-lg font-bold text-red-600">{fmt(totals.expenses)}</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xs text-gray-500">الصافي</p>
          <p className="text-lg font-bold text-green-600">{fmt(totals.net)}</p>
        </Card>
      </div>

      {/* Expense Category Breakdown */}
      <ExpenseCategoryBreakdown deliveries={filtered} title="تفصيل المصروفات حسب البند" />

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>الفرع</TableHead>
                <TableHead>الشيفت</TableHead>
                <TableHead>الموظف</TableHead>
                <TableHead className="text-left">المبيعات</TableHead>
                <TableHead className="text-left">المصروفات</TableHead>
                <TableHead className="text-left">الصافي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-gray-400 py-8">لا توجد بيانات</TableCell>
                </TableRow>
              ) : (
                filtered.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-sm">{d.shift_date || "—"}</TableCell>
                    <TableCell className="text-sm">{d.branch || "—"}</TableCell>
                    <TableCell className="text-sm">{d.shift_type || "—"}</TableCell>
                    <TableCell className="text-sm">{d.submitted_by || "—"}</TableCell>
                    <TableCell className="text-sm font-medium text-blue-700">{fmt(d.total_sales)}</TableCell>
                    <TableCell className="text-sm font-medium text-red-600">{fmt(d.total_expenses)}</TableCell>
                    <TableCell className="text-sm font-bold text-green-600">{fmt(d.net_amount)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}