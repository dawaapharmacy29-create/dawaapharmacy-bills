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
import { Plus, Pencil, Trash2, BarChart2, List } from "lucide-react";
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

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">المصروفات</h1>
          <p className="text-gray-500 text-sm mt-0.5">إجمالي: {total.toLocaleString("ar-EG")} ج</p>
        </div>
        {isManager && (
          <Button onClick={openNew} className="bg-teal-600 hover:bg-teal-700 text-white gap-2">
            <Plus className="w-4 h-4" /> إضافة مصروف
          </Button>
        )}
      </div>

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
                    <TableCell className="text-gray-600 text-sm">{e.category || "—"}</TableCell>
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