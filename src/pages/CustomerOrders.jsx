import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useUserRole } from "@/lib/useUserRole";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, ShoppingBag, Download, SlidersHorizontal, X, BarChart3, ListFilter } from "lucide-react";
import * as XLSX from "xlsx";
import OrderTable from "@/components/orders/OrderTable";
import OrderFormDialog from "@/components/orders/OrderFormDialog";
import OrderDetailDialog from "@/components/orders/OrderDetailDialog";
import OrderAnalytics from "@/components/orders/OrderAnalytics";
import OrderAlerts from "@/components/orders/OrderAlerts";
import BranchEfficiencyCard from "@/components/orders/BranchEfficiencyCard";
import { logActivity } from "@/lib/activityLogger";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const STATUSES = ["طلب جديد", "جاري البحث", "تم الطلب", "النواقص", "تم توفير الصنف", "تم التوصيل", "الصنف غير متوفر حاليا", "تم الإلغاء"];
const PRIORITIES = ["عاجل", "متوسط", "عادي"];
const SOURCES = ["واتساب", "مكالمة هاتفية", "داخل الصيدلية"];
const WORKFLOW_TABS = [
  { id: "active", label: "يحتاج إجراء", statuses: ["طلب جديد", "جاري البحث", "الصنف غير متوفر حاليا"] },
  { id: "ordered", label: "تم الطلب", statuses: ["تم الطلب", "النواقص"] },
  { id: "ready", label: "تم التوفير", statuses: ["تم توفير الصنف"] },
  { id: "done", label: "مكتمل", statuses: ["تم التوصيل"] },
  { id: "cancelled", label: "ملغي", statuses: ["تم الإلغاء"] },
  { id: "all", label: "الكل", statuses: null },
];

function exportOrdersToExcel(orders) {
  const rows = orders.map((o) => ({
    "رقم الطلب": o.order_number || o.id?.slice(-6) || "", "اسم العميل": o.customer_name || "", "رقم الهاتف": o.phone || "", "كود العميل": o.customer_code || "", "الفرع": o.branch || "", "الصنف": o.product_name || "", "المصدر": o.request_source || "", "الأولوية": o.priority || "", "الموظف المسؤول": o.assigned_employee || "", "تاريخ الطلب": o.request_date || "", "الحالة": o.status || "", "المورد": o.supplier_found || "", "سعر الشراء": o.purchase_price || "", "سعر البيع": o.selling_price || "", "ملاحظات": o.notes || "", "ملاحظات البحث": o.search_notes || "", "ملاحظات المتابعة": o.followup_notes || "", "سبب الإلغاء": o.cancellation_reason || "", "تاريخ الإضافة": o.created_date ? new Date(o.created_date).toLocaleString("ar-EG") : "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows); ws["!dir"] = "rtl"; ws["!cols"] = Object.keys(rows[0] || {}).map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "طلبات العملاء"); XLSX.writeFile(wb, `طلبات_العملاء_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
const normalizeDate = (value) => value ? String(value).slice(0, 10) : "";

export default function CustomerOrders() {
  const { isManager, user } = useUserRole();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [workflowTab, setWorkflowTab] = useState("active");
  const [filterBranch, setFilterBranch] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [filterEmployee, setFilterEmployee] = useState("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [view, setView] = useState("operations");
  const [showForm, setShowForm] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);

  const { data: orders = [], isLoading } = useQuery({ queryKey: ["customer-orders"], queryFn: () => base44.entities.CustomerOrder.list("-created_date", 500) });
  const { data: teamMembers = [] } = useQuery({ queryKey: ["team-members"], queryFn: () => base44.entities.TeamMember.list() });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.CustomerOrder.delete(id),
    onSuccess: (_data, id) => {
      const order = orders.find((o) => o.id === id);
      logActivity({ action_type: "delete", entity_type: "invoice", entity_id: id, entity_label: order ? `طلب عميل: ${order.customer_name} - ${order.product_name}` : id, details: "حذف طلب عميل" });
      qc.invalidateQueries({ queryKey: ["customer-orders"] });
    },
  });

  const userBranch = user?.branch;
  const visibleOrders = useMemo(() => orders.filter((o) => isManager || !userBranch || o.branch === userBranch), [orders, isManager, userBranch]);
  const tabCounts = useMemo(() => Object.fromEntries(WORKFLOW_TABS.map((tab) => [tab.id, tab.statuses ? visibleOrders.filter((o) => tab.statuses.includes(o.status)).length : visibleOrders.length])), [visibleOrders]);
  const filteredOrders = useMemo(() => {
    const tab = WORKFLOW_TABS.find((item) => item.id === workflowTab);
    return visibleOrders.filter((o) => {
      if (tab?.statuses && !tab.statuses.includes(o.status)) return false;
      if (filterBranch !== "all" && o.branch !== filterBranch) return false;
      if (filterStatus !== "all" && o.status !== filterStatus) return false;
      if (filterPriority !== "all" && o.priority !== filterPriority) return false;
      if (filterSource !== "all" && o.request_source !== filterSource) return false;
      if (filterEmployee !== "all" && o.assigned_employee !== filterEmployee) return false;
      const date = normalizeDate(o.request_date || o.created_date);
      if (filterDateFrom && date && date < filterDateFrom) return false;
      if (filterDateTo && date && date > filterDateTo) return false;
      if (search) {
        const q = search.trim().toLowerCase();
        const haystack = [o.customer_name, o.phone, o.product_name, o.order_number, o.customer_code, o.assigned_employee].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [visibleOrders, workflowTab, filterBranch, filterStatus, filterPriority, filterSource, filterEmployee, filterDateFrom, filterDateTo, search]);

  const activeAdvancedCount = [filterStatus !== "all", filterPriority !== "all", filterSource !== "all", filterEmployee !== "all", !!filterDateFrom, !!filterDateTo].filter(Boolean).length;
  const hasFilters = search || filterBranch !== "all" || activeAdvancedCount > 0;
  const clearFilters = () => { setSearch(""); setFilterBranch("all"); setFilterStatus("all"); setFilterPriority("all"); setFilterSource("all"); setFilterEmployee("all"); setFilterDateFrom(""); setFilterDateTo(""); };

  return <div dir="rtl" className="p-3 md:p-5 space-y-4 max-w-[1500px] mx-auto">
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center shrink-0"><ShoppingBag className="w-5 h-5 text-white" /></div><div><h1 className="text-lg md:text-xl font-bold text-gray-900">طلبات العملاء</h1><p className="text-xs text-gray-500">مركز تنفيذ سريع — التفاصيل الكاملة تظهر عند فتح الطلب</p></div></div>
      <div className="flex items-center gap-2 w-full sm:w-auto"><OrderAlerts orders={visibleOrders} /><Button variant="outline" size="sm" onClick={() => exportOrdersToExcel(filteredOrders)} className="gap-2 flex-1 sm:flex-none"><Download className="w-4 h-4" /><span className="hidden md:inline">تصدير</span></Button><Button size="sm" onClick={() => setShowForm(true)} className="bg-teal-600 hover:bg-teal-700 gap-2 flex-1 sm:flex-none"><Plus className="w-4 h-4" /> طلب جديد</Button></div>
    </div>

    <div className="inline-flex rounded-xl bg-gray-100 p-1 gap-1">
      <button onClick={() => setView("operations")} className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${view === "operations" ? "bg-white shadow-sm text-teal-700" : "text-gray-500"}`}><span className="inline-flex items-center gap-1.5"><ListFilter className="w-4 h-4" /> التشغيل</span></button>
      <button onClick={() => setView("analytics")} className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${view === "analytics" ? "bg-white shadow-sm text-teal-700" : "text-gray-500"}`}><span className="inline-flex items-center gap-1.5"><BarChart3 className="w-4 h-4" /> التحليلات</span></button>
    </div>

    {view === "analytics" ? <div className="space-y-4"><BranchEfficiencyCard orders={visibleOrders} /><OrderAnalytics orders={visibleOrders} /></div> : <>
      <div className="bg-white border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto border-b"><div className="flex min-w-max px-2 pt-2 gap-1">{WORKFLOW_TABS.map((tab) => <button key={tab.id} onClick={() => { setWorkflowTab(tab.id); setFilterStatus("all"); }} className={`px-3 py-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${workflowTab === tab.id ? "border-teal-600 text-teal-700 bg-teal-50/50" : "border-transparent text-gray-500 hover:text-gray-800"}`}>{tab.label}<span className={`min-w-6 h-5 px-1.5 rounded-full text-[11px] flex items-center justify-center ${workflowTab === tab.id ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-500"}`}>{tabCounts[tab.id] || 0}</span></button>)}</div></div>
        <div className="p-3 space-y-3">
          <div className="flex flex-col lg:flex-row gap-2">
            <div className="relative flex-1"><Search className="absolute right-3 top-2.5 w-4 h-4 text-gray-400" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالعميل، الكود، الهاتف، الصنف أو رقم الطلب..." className="pr-9 h-9" /></div>
            {isManager && <Select value={filterBranch} onValueChange={setFilterBranch}><SelectTrigger className="h-9 lg:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل الفروع</SelectItem>{BRANCHES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select>}
            <Button variant={advancedOpen ? "secondary" : "outline"} size="sm" className="h-9 gap-2" onClick={() => setAdvancedOpen((v) => !v)}><SlidersHorizontal className="w-4 h-4" /> فلاتر إضافية{activeAdvancedCount > 0 && <span className="bg-teal-600 text-white rounded-full px-1.5 text-[10px]">{activeAdvancedCount}</span>}</Button>
            {hasFilters && <Button variant="ghost" size="sm" className="h-9 text-gray-500 gap-1" onClick={clearFilters}><X className="w-4 h-4" /> مسح</Button>}
          </div>
          {advancedOpen && <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2 p-3 rounded-xl bg-gray-50 border">
            <Select value={filterStatus} onValueChange={setFilterStatus}><SelectTrigger className="h-9"><SelectValue placeholder="الحالة الدقيقة" /></SelectTrigger><SelectContent><SelectItem value="all">كل الحالات</SelectItem>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            <Select value={filterPriority} onValueChange={setFilterPriority}><SelectTrigger className="h-9"><SelectValue placeholder="الأولوية" /></SelectTrigger><SelectContent><SelectItem value="all">كل الأولويات</SelectItem>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select>
            <Select value={filterSource} onValueChange={setFilterSource}><SelectTrigger className="h-9"><SelectValue placeholder="المصدر" /></SelectTrigger><SelectContent><SelectItem value="all">كل المصادر</SelectItem>{SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            <Select value={filterEmployee} onValueChange={setFilterEmployee}><SelectTrigger className="h-9"><SelectValue placeholder="الموظف" /></SelectTrigger><SelectContent><SelectItem value="all">كل الموظفين</SelectItem>{teamMembers.map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent></Select>
            <Input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="h-9" title="من تاريخ" /><Input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="h-9" title="إلى تاريخ" />
          </div>}
          <div className="flex items-center justify-between text-xs text-gray-500 px-1"><span>ظاهر الآن <strong className="text-gray-800">{filteredOrders.length}</strong> طلب</span>{workflowTab === "active" && <span className="text-amber-700 font-medium">الأولوية للطلبات التي تحتاج إجراء فعلي</span>}</div>
        </div>
      </div>
      <OrderTable key={`${workflowTab}-${filterBranch}-${filterStatus}-${filterPriority}-${filterSource}-${filterEmployee}-${filterDateFrom}-${filterDateTo}-${search}`} orders={filteredOrders} isLoading={isLoading} onSelect={setSelectedOrder} onDelete={(id) => deleteMutation.mutate(id)} isManager={isManager} />
    </>}

    {showForm && <OrderFormDialog open={showForm} onOpenChange={setShowForm} teamMembers={teamMembers} onSaved={() => qc.invalidateQueries({ queryKey: ["customer-orders"] })} />}
    {selectedOrder && <OrderDetailDialog open={!!selectedOrder} onOpenChange={(v) => !v && setSelectedOrder(null)} order={selectedOrder} teamMembers={teamMembers} isManager={isManager} onUpdated={(updated) => { setSelectedOrder(updated); qc.invalidateQueries({ queryKey: ["customer-orders"] }); }} />}
  </div>;
}
