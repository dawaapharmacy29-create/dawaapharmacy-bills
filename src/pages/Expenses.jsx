import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, BarChart2, List, Wallet, Printer, Zap, Droplet, Users, Wrench, Wifi, Package, Sparkles, MoreHorizontal, Receipt, TrendingDown } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { logActivity } from "@/lib/activityLogger";
import { useUserRole } from "@/lib/useUserRole";
import ExpensesReport from "@/components/expenses/ExpensesReport";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortableHeader } from "@/components/table/SortableHeader";
import { SortControls } from "@/components/table/SortControls";

const EXPENSE_SORT_COLUMNS = [
  { field: "description", label: "الوصف", type: "text" },
  { field: "amount", label: "المبلغ", type: "currency" },
  { field: "branch", label: "الفرع", type: "text" },
  { field: "category", label: "النوع", type: "text" },
  { field: "date", label: "التاريخ", type: "date" },
  { field: "payment_method", label: "الدفع", type: "text" },
  { field: "team_member_name", label: "العضو", type: "text" },
  { field: "created_date", label: "وقت الإضافة", type: "date" },
];

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const CATEGORIES = ["طباعة", "كهرباء", "مياه", "رواتب", "صيانة", "نت", "نثريات", "نظافة", "أخرى"];

const branchColor = {
  "دواء شكري": "bg-blue-100 text-blue-800",
  "دواء الشامي": "bg-purple-100 text-purple-800",
};

const PAYMENT_METHODS = ["كاش", "انستا/فودافون"];

const CATEGORY_META = {
  "طباعة": { icon: Printer, color: "#6366f1" },
  "كهرباء": { icon: Zap, color: "#f59e0b" },
  "مياه": { icon: Droplet, color: "#0ea5e9" },
  "رواتب": { icon: Users, color: "#8b5cf6" },
  "صيانة": { icon: Wrench, color: "#f97316" },
  "نت": { icon: Wifi, color: "#14b8a6" },
  "نثريات": { icon: Package, color: "#84cc16" },
  "نظافة": { icon: Sparkles, color: "#ec4899" },
  "أخرى": { icon: MoreHorizontal, color: "#94a3b8" },
};
const categoryMeta = (cat) => CATEGORY_META[cat] || CATEGORY_META["أخرى"];

const emptyForm = { description: "", amount: "", branch: "", category: "", payment_method: "", date: new Date().toISOString().split("T")[0], team_member_name: "", notes: "" };

export default function Expenses() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [filterBranch, setFilterBranch] = useState("الكل");
  const [activeTab, setActiveTab] = useState("list");
  const queryClient = useQueryClient();
  const { isManager } = useUserRole();
  const { data: teamMembers = [] } = useQuery({
    queryKey: ["team-members"],
    queryFn: () => base44.entities.TeamMember.list("name"),
    staleTime: 60000,
  });

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ["expenses"],
    queryFn: () => base44.entities.Expense.list("-created_date", 500),
    staleTime: 15000,
  });

  // Real-time: تحديث تلقائي عند أي تغيير
  useEffect(() => {
    const unsub = base44.entities.Expense.subscribe(() => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    });
    return unsub;
  }, []);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Expense.create(data),
    onSuccess: (_, data) => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setDialogOpen(false);
      logActivity({ action_type: "create", entity_type: "expense", entity_label: data.description, details: `إضافة مصروف: ${data.description} - ${data.amount} ج` });
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Expense.update(id, data),
    onSuccess: (_, { data }) => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setDialogOpen(false);
      setEditing(null);
      logActivity({ action_type: "update", entity_type: "expense", entity_label: data.description, details: `تعديل مصروف: ${data.description}` });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Expense.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      logActivity({ action_type: "delete", entity_type: "expense", entity_id: id, details: `حذف مصروف` });
    },
  });

  const openNew = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (e) => {
    setEditing(e);
    setForm({ description: e.description, amount: e.amount ?? "", branch: e.branch || "", category: e.category || "", payment_method: e.payment_method || "", date: e.date || new Date().toISOString().split("T")[0], team_member_name: e.team_member_name || "", notes: e.notes || "" });
    setDialogOpen(true);
  };
  const set = (f, v) => setForm((p) => ({ ...p, [f]: v }));

  const handleSubmit = (ev) => {
    ev.preventDefault();
    const data = { ...form, amount: parseFloat(form.amount) || 0 };
    if (editing) updateMutation.mutate({ id: editing.id, data });
    else createMutation.mutate(data);
  };

  const filteredRaw = filterBranch === "الكل" ? expenses : expenses.filter((e) => e.branch === filterBranch);
  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({
    columns: EXPENSE_SORT_COLUMNS,
    defaultSort: { field: "created_date", direction: "desc" },
    paramPrefix: "exp",
  });
  const filtered = useMemo(() => sortData(filteredRaw), [filteredRaw, sortData]);
  const total = filtered.reduce((s, e) => s + (e.amount || 0), 0);
  const avgExpense = filtered.length ? total / filtered.length : 0;

  const categoryBreakdown = useMemo(() => {
    const map = {};
    filtered.forEach((e) => {
      const cat = e.category || "أخرى";
      map[cat] = (map[cat] || 0) + (e.amount || 0);
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value, color: categoryMeta(name).color }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);
  const topCategory = categoryBreakdown[0];

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-red-50 p-2.5"><Wallet className="h-6 w-6 text-red-600" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">المصروفات</h1>
            <p className="text-gray-500 text-sm mt-0.5">إجمالي: <span className="font-bold text-red-600">{total.toLocaleString("ar-EG")} ج</span></p>
          </div>
        </div>
        {isManager && (
          <Button onClick={openNew} className="bg-teal-600 hover:bg-teal-700 text-white gap-2">
            <Plus className="w-4 h-4" /> إضافة مصروف
          </Button>
        )}
      </div>

      {activeTab === "list" && filtered.length > 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          <Card className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-red-50 p-2"><TrendingDown className="h-5 w-5 text-red-600" /></div>
            <div><p className="text-xs text-gray-500">إجمالي المصروفات</p><p className="text-lg font-bold text-gray-800">{total.toLocaleString("ar-EG")} ج</p></div>
          </Card>
          <Card className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-teal-50 p-2"><Receipt className="h-5 w-5 text-teal-600" /></div>
            <div><p className="text-xs text-gray-500">عدد المصروفات · متوسط القيمة</p><p className="text-lg font-bold text-gray-800">{filtered.length} <span className="text-sm font-normal text-gray-400">· {avgExpense.toLocaleString("ar-EG", { maximumFractionDigits: 0 })} ج</span></p></div>
          </Card>
          {topCategory && (
            <Card className="flex items-center gap-3 p-4">
              <div className="rounded-lg p-2" style={{ backgroundColor: `${topCategory.color}1a` }}>
                {(() => { const Icon = categoryMeta(topCategory.name).icon; return <Icon className="h-5 w-5" style={{ color: topCategory.color }} />; })()}
              </div>
              <div><p className="text-xs text-gray-500">أكبر بند مصروفات</p><p className="text-lg font-bold text-gray-800">{topCategory.name} <span className="text-sm font-normal text-gray-400">· {topCategory.value.toLocaleString("ar-EG")} ج</span></p></div>
            </Card>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        <button onClick={() => setActiveTab("list")}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === "list" ? "bg-white shadow text-teal-700" : "text-gray-500 hover:text-gray-700"}`}>
          <List className="w-4 h-4" /> قائمة المصروفات
        </button>
        <button onClick={() => setActiveTab("report")}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === "report" ? "bg-white shadow text-teal-700" : "text-gray-500 hover:text-gray-700"}`}>
          <BarChart2 className="w-4 h-4" /> تقرير المصروفات
        </button>
      </div>

      {activeTab === "report" && <ExpensesReport expenses={filtered} />}

      {activeTab === "list" && <>
      {/* Branch Filter */}
      <div className="flex gap-2 flex-wrap">
        {["الكل", ...BRANCHES].map((b) => (
          <button key={b} onClick={() => setFilterBranch(b)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${filterBranch === b ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-600 border-gray-200 hover:border-teal-300"}`}>
            {b}
          </button>
        ))}
      </div>

      <SortControls
        columns={EXPENSE_SORT_COLUMNS}
        sortField={sortField}
        sortDirection={sortDirection}
        onToggle={toggleSort}
        onSet={setSort}
        onReset={resetSort}
      />

      {categoryBreakdown.length > 1 && (
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">توزيع المصروفات حسب النوع</h2>
          <div className="flex flex-col items-center gap-4 md:flex-row">
            <div className="h-48 w-48 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categoryBreakdown} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                    {categoryBreakdown.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(v) => `${Number(v).toLocaleString("ar-EG")} ج`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid w-full flex-1 grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
              {categoryBreakdown.map((c) => {
                const Icon = categoryMeta(c.name).icon;
                const pct = total > 0 ? (c.value / total) * 100 : 0;
                return (
                  <div key={c.name} className="flex items-center gap-1.5 text-xs">
                    <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: c.color }} />
                    <span className="truncate text-gray-600">{c.name}</span>
                    <span className="mr-auto font-semibold text-gray-800">{pct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="text-center py-12 text-gray-400">جاري التحميل...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">لا توجد مصروفات</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <SortableHeader field="description" label="الوصف" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} />
                  <SortableHeader field="amount" label="المبلغ" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} />
                  <SortableHeader field="branch" label="الفرع" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} />
                  <SortableHeader field="category" label="النوع" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} />
                  <SortableHeader field="date" label="التاريخ" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} />
                  <SortableHeader field="payment_method" label="الدفع" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} />
                  <SortableHeader field="team_member_name" label="العضو" sortField={sortField} sortDirection={sortDirection} onToggle={toggleSort} />
                  <TableHead className="text-right">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => (
                  <TableRow key={e.id} className="hover:bg-gray-50">
                    <TableCell className="font-medium">{e.description}</TableCell>
                    <TableCell className="font-semibold text-red-600">{(e.amount || 0).toLocaleString("ar-EG")} ج</TableCell>
                    <TableCell><Badge className={`${branchColor[e.branch]} border-0 text-xs`}>{e.branch}</Badge></TableCell>
                    <TableCell className="text-gray-600 text-sm">
                      {e.category ? (
                        <span className="flex items-center gap-1.5">
                          {(() => { const Icon = categoryMeta(e.category).icon; return <Icon className="h-3.5 w-3.5" style={{ color: categoryMeta(e.category).color }} />; })()}
                          {e.category}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-gray-500 text-sm">{e.date || "—"}</TableCell>
                    <TableCell className="text-gray-600 text-sm">{e.payment_method || "—"}</TableCell>
                    <TableCell className="text-gray-600 text-sm">{e.team_member_name || "—"}</TableCell>
                     <TableCell>
                      <div className="flex gap-1">
                        {isManager && <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-500" onClick={() => openEdit(e)}><Pencil className="w-3.5 h-3.5" /></Button>}
                        {isManager && <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => deleteMutation.mutate(e.id)}><Trash2 className="w-3.5 h-3.5" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      </>}

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader><DialogTitle className="text-right">{editing ? "تعديل مصروف" : "إضافة مصروف"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1"><Label>الوصف *</Label><Input value={form.description} onChange={(e) => set("description", e.target.value)} required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>المبلغ *</Label><Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} required /></div>
              <div className="space-y-1"><Label>التاريخ *</Label><Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} required /></div>
            </div>
            <div className="space-y-1">
              <Label>الفرع *</Label>
              <Select value={form.branch} onValueChange={(v) => set("branch", v)} required>
                <SelectTrigger><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
                <SelectContent>{BRANCHES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>نوع المصروف</Label>
              <Select value={form.category} onValueChange={(v) => set("category", v)}>
                <SelectTrigger><SelectValue placeholder="اختر النوع" /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>طريقة الدفع</Label>
              <Select value={form.payment_method} onValueChange={(v) => set("payment_method", v)}>
                <SelectTrigger><SelectValue placeholder="اختر طريقة الدفع" /></SelectTrigger>
                <SelectContent>{PAYMENT_METHODS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>عضو فريق العمل</Label>
              <Select value={form.team_member_name} onValueChange={(v) => set("team_member_name", v)}>
                <SelectTrigger><SelectValue placeholder="اختر العضو (اختياري)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>— بدون تحديد —</SelectItem>
                  {teamMembers.map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>ملاحظات</Label><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} /></div>
            <DialogFooter className="gap-2 flex-row-reverse">
              <Button type="submit" className="bg-teal-600 hover:bg-teal-700" disabled={createMutation.isPending || updateMutation.isPending}>
                {editing ? "تحديث" : "حفظ"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}