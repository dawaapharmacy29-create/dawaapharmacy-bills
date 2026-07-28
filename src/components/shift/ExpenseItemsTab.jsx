import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Check, X, Loader2, Sparkles } from "lucide-react";

const DEFAULT_ITEMS = ["كهرباء", "مياه", "إنترنت", "نظافة", "صيانة", "انتقالات", "مستلزمات تشغيل", "ضيافة", "عجز خزنة", "مصروف طارئ"];
const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();

export default function ExpenseItemsTab() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");

  const { data: items = [], isLoading } = useQuery({ queryKey: ["expense-items"], queryFn: () => base44.entities.ExpenseItem.list(), staleTime: 30000 });
  const existingNames = useMemo(() => new Set(items.map((item) => normalize(item.name))), [items]);

  const createMutation = useMutation({
    mutationFn: async (names) => {
      const unique = [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))]
        .filter((name) => !existingNames.has(normalize(name)));
      for (const name of unique) await base44.entities.ExpenseItem.create({ name, is_active: true });
      return unique.length;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expense-items"] }); setNewName(""); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ExpenseItem.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expense-items"] }); setEditingId(null); },
  });

  const handleAdd = () => {
    if (!newName.trim() || existingNames.has(normalize(newName))) return;
    createMutation.mutate([newName]);
  };

  const handleSaveEdit = (id) => {
    if (!editName.trim()) return;
    const duplicate = items.some((item) => item.id !== id && normalize(item.name) === normalize(editName));
    if (duplicate) return;
    updateMutation.mutate({ id, data: { name: editName.trim() } });
  };

  return <div className="space-y-4">
    <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100"><Plus className="h-5 w-5 text-indigo-600"/></div><div><h2 className="text-xl font-bold text-gray-800">قوالب مصروفات الشيفت</h2><p className="text-sm text-gray-500">بنود موحدة تقلل اختلاف الكتابة وتحسن التحليل الشهري</p></div></div>

    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-end gap-2"><div className="min-w-[220px] flex-1 space-y-1.5"><Label>إضافة بند موحد</Label><Input placeholder="مثال: كهرباء أو صيانة" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAdd()}/></div><Button onClick={handleAdd} disabled={createMutation.isPending || !newName.trim() || existingNames.has(normalize(newName))}>{createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin"/> : <Plus className="h-4 w-4"/>}إضافة</Button></div>
      <div className="border-t pt-4"><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700"><Sparkles className="h-4 w-4 text-amber-500"/>قوالب مقترحة جاهزة</div><div className="flex flex-wrap gap-2">{DEFAULT_ITEMS.map((name) => { const exists = existingNames.has(normalize(name)); return <Button key={name} size="sm" variant="outline" disabled={exists || createMutation.isPending} onClick={() => createMutation.mutate([name])}>{exists ? "مضاف: " : "+ "}{name}</Button>; })}</div></div>
    </Card>

    <Card className="overflow-hidden">{isLoading ? <div className="p-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin"/></div> : items.length === 0 ? <div className="p-8 text-center text-sm text-gray-400">لا توجد بنود مصروفات بعد</div> : <Table><TableHeader><TableRow><TableHead>اسم البند الموحد</TableHead><TableHead className="text-center">نشط</TableHead><TableHead className="text-left">إجراءات</TableHead></TableRow></TableHeader><TableBody>{items.map((item) => <TableRow key={item.id}><TableCell>{editingId === item.id ? <Input value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSaveEdit(item.id)} className="max-w-xs" autoFocus/> : <span className="text-sm font-medium text-gray-700">{item.name}</span>}</TableCell><TableCell className="text-center"><Switch checked={item.is_active} onCheckedChange={() => updateMutation.mutate({ id: item.id, data: { is_active: !item.is_active } })}/></TableCell><TableCell><div className="flex justify-end gap-1">{editingId === item.id ? <><button onClick={() => handleSaveEdit(item.id)} className="rounded p-1.5 text-green-600 hover:bg-green-50"><Check className="h-4 w-4"/></button><button onClick={() => setEditingId(null)} className="rounded p-1.5 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4"/></button></> : <button onClick={() => { setEditingId(item.id); setEditName(item.name); }} className="rounded p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600"><Pencil className="h-4 w-4"/></button>}</div></TableCell></TableRow>)}</TableBody></Table>}</Card>
    <Card className="border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">حفاظًا على التقارير القديمة لا يتم حذف البنود المستخدمة؛ يمكن تعطيل البند بدل حذفه، وتظل البيانات التاريخية كما هي.</Card>
  </div>;
}
