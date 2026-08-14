import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const STATUSES = ["طلب جديد", "جاري البحث", "تم الطلب", "النواقص", "تم توفير الصنف", "تم التوصيل", "الصنف غير متوفر حاليا", "تم الإلغاء"];
const PRIORITIES = ["عاجل", "متوسط", "عادي"];
const SOURCES = ["واتساب", "مكالمة هاتفية", "داخل الصيدلية"];

export default function OrderWorkspaceFilters({ state, setState, isManager, teamMembers = [] }) {
  const { search, branch, status, priority, source, employee, dateFrom, dateTo, advancedOpen } = state;
  const activeCount = [branch !== "all", status !== "all", priority !== "all", source !== "all", employee !== "all", !!dateFrom, !!dateTo].filter(Boolean).length;
  const patch = (key, value) => setState((s) => ({ ...s, [key]: value }));
  const clear = () => setState((s) => ({ ...s, search: "", branch: "all", status: "all", priority: "all", source: "all", employee: "all", dateFrom: "", dateTo: "" }));

  return <div className="bg-white border rounded-2xl p-3 space-y-3">
    <div className="flex flex-col lg:flex-row gap-2">
      <div className="relative flex-1">
        <Search className="absolute right-3 top-2.5 w-4 h-4 text-gray-400" />
        <Input value={search} onChange={(e) => patch("search", e.target.value)} placeholder="بحث بالعميل، الكود، الهاتف، الصنف أو رقم الطلب..." className="pr-9 h-9" />
      </div>
      {isManager && <Select value={branch} onValueChange={(v) => patch("branch", v)}><SelectTrigger className="h-9 lg:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل الفروع</SelectItem>{BRANCHES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select>}
      <Button variant={advancedOpen ? "secondary" : "outline"} size="sm" className="h-9 gap-2" onClick={() => patch("advancedOpen", !advancedOpen)}><SlidersHorizontal className="w-4 h-4" /> فلاتر{activeCount > 0 && <span className="bg-teal-600 text-white rounded-full px-1.5 text-[10px]">{activeCount}</span>}</Button>
      {(activeCount > 0 || search) && <Button variant="ghost" size="sm" className="h-9 gap-1 text-gray-500" onClick={clear}><X className="w-4 h-4" /> مسح</Button>}
    </div>
    {advancedOpen && <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2 p-3 bg-gray-50 border rounded-xl">
      <Select value={status} onValueChange={(v) => patch("status", v)}><SelectTrigger className="h-9"><SelectValue placeholder="الحالة" /></SelectTrigger><SelectContent><SelectItem value="all">كل الحالات</SelectItem>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
      <Select value={priority} onValueChange={(v) => patch("priority", v)}><SelectTrigger className="h-9"><SelectValue placeholder="الأولوية" /></SelectTrigger><SelectContent><SelectItem value="all">كل الأولويات</SelectItem>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select>
      <Select value={source} onValueChange={(v) => patch("source", v)}><SelectTrigger className="h-9"><SelectValue placeholder="المصدر" /></SelectTrigger><SelectContent><SelectItem value="all">كل المصادر</SelectItem>{SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
      <Select value={employee} onValueChange={(v) => patch("employee", v)}><SelectTrigger className="h-9"><SelectValue placeholder="الموظف" /></SelectTrigger><SelectContent><SelectItem value="all">كل الموظفين</SelectItem>{teamMembers.map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent></Select>
      <Input type="date" value={dateFrom} onChange={(e) => patch("dateFrom", e.target.value)} className="h-9" title="من تاريخ" />
      <Input type="date" value={dateTo} onChange={(e) => patch("dateTo", e.target.value)} className="h-9" title="إلى تاريخ" />
    </div>}
  </div>;
}
