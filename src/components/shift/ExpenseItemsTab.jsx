import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Check, X, Loader2, Sparkles, Search, Trash2, Settings2, Tag } from "lucide-react";

const DEFAULT_ITEMS = ["كهرباء", "مياه", "إنترنت", "نظافة", "صيانة", "انتقالات", "مستلزمات تشغيل", "ضيافة", "عجز خزنة", "مصروف طارئ", "سلفة", "توك توك", "نواقص", "أدوية هالك", "أخرى"];
const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
const toTemplate = (goal) => ({ id: goal.id, name: goal.label || "", is_active: Number(goal.target_amount || 0) !== 0, raw: goal });

export default function ExpenseItemsTab() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const goalsQuery = useQuery({ queryKey: ["expense-template-goals"], queryFn: () => base44.entities.TargetGoal.list(), staleTime: 30000 });
  const deliveriesQuery = useQuery({ queryKey: ["shift-deliveries", "template-usage"], queryFn: () => base44.entities.ShiftDelivery.list("-shift_date", 5000), staleTime: 60000 });
  const items = useMemo(() => (goalsQuery.data || []).filter((g) => g.goal_type === "expense_template").map(toTemplate).sort((a,b)=>a.name.localeCompare(b.name,"ar")), [goalsQuery.data]);
  const existingNames = useMemo(() => new Set(items.map((item) => normalize(item.name))), [items]);
  const visibleItems = useMemo(() => items.filter((item)=>normalize(item.name).includes(normalize(search))), [items, search]);
  const usedNames = useMemo(() => {
    const set = new Set();
    (deliveriesQuery.data || []).forEach((delivery) => (Array.isArray(delivery.expenses) ? delivery.expenses : []).forEach((expense) => set.add(normalize(expense.category || expense.name || expense.description))));
    return set;
  }, [deliveriesQuery.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["expense-template-goals"] });
  const createMutation = useMutation({
    mutationFn: async (names) => {
      const unique = [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))].filter((name) => !existingNames.has(normalize(name)));
      for (const name of unique) await base44.entities.TargetGoal.create({ month: "global", label: name, target_amount: 1, branch: "all", goal_type: "expense_template" });
      return unique.length;
    },
    onSuccess: (count) => { refresh(); setNewName(""); setError(""); setMessage(count ? `تمت إضافة ${count} بند` : "البند موجود بالفعل"); },
    onError: (e) => setError(e.message || "تعذر إضافة البند"),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TargetGoal.update(id, data),
    onSuccess: () => { refresh(); setEditingId(null); setMessage("تم حفظ التعديل"); setError(""); },
    onError: (e) => setError(e.message || "تعذر حفظ التعديل"),
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.TargetGoal.delete(id),
    onSuccess: () => { refresh(); setMessage("تم حذف البند غير المستخدم"); setError(""); },
    onError: (e) => setError(e.message || "تعذر حذف البند"),
  });

  const handleAdd = () => { if (!newName.trim()) return; if (existingNames.has(normalize(newName))) return setError("البند موجود بالفعل"); createMutation.mutate([newName]); };
  const saveEdit = (item) => { const name = editName.trim(); if (!name) return; if (items.some((x)=>x.id!==item.id&&normalize(x.name)===normalize(name))) return setError("يوجد بند آخر بنفس الاسم"); updateMutation.mutate({ id:item.id, data:{ label:name } }); };
  const deleteItem = (item) => { if (usedNames.has(normalize(item.name))) return setError("لا يمكن حذف بند مستخدم في تسليمات قديمة. عطّله بدلًا من الحذف."); if (window.confirm(`حذف البند «${item.name}»؟`)) deleteMutation.mutate(item.id); };

  return <div className="mx-auto max-w-4xl space-y-4" dir="rtl">
    <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600"><Settings2 className="h-5 w-5 text-white" /></div><div><h2 className="text-xl font-bold text-gray-900">إدارة بنود المصروفات</h2><p className="text-sm text-gray-500">قائمة موحّدة تُستخدم في تسليم الشيفت وتحسين التقارير الشهرية</p></div></div>

    <Card className="space-y-4 p-4"><div className="flex flex-wrap items-end gap-2"><div className="min-w-[240px] flex-1 space-y-1.5"><Label>إضافة بند جديد</Label><Input placeholder="اسم البند الجديد، مثال: صيانة أو سلفة" value={newName} onChange={(e)=>setNewName(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&handleAdd()} /></div><Button onClick={handleAdd} disabled={createMutation.isPending||!newName.trim()} className="bg-violet-600 hover:bg-violet-700">{createMutation.isPending?<Loader2 className="h-4 w-4 animate-spin"/>:<Plus className="h-4 w-4"/>}إضافة</Button></div><div className="border-t pt-4"><div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-amber-500"/>بنود جاهزة</div><div className="flex flex-wrap gap-2">{DEFAULT_ITEMS.map((name)=>{const exists=existingNames.has(normalize(name));return <Button key={name} size="sm" variant="outline" disabled={exists||createMutation.isPending} onClick={()=>createMutation.mutate([name])}>{exists?"مضاف: ":"+ "}{name}</Button>;})}</div></div></Card>

    <Card className="p-4"><div className="relative"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"/><Input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="بحث في البنود..." className="pr-10"/></div></Card>
    {message&&<div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}{error&&<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

    <Card className="overflow-hidden">{goalsQuery.isLoading?<div className="p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin"/></div>:visibleItems.length===0?<div className="p-10 text-center text-gray-400">لا توجد بنود مطابقة</div>:<Table><TableHeader><TableRow><TableHead>اسم البند</TableHead><TableHead className="text-center">الحالة</TableHead><TableHead className="text-center">مستخدم تاريخيًا</TableHead><TableHead className="text-left">إجراءات</TableHead></TableRow></TableHeader><TableBody>{visibleItems.map((item)=>{const used=usedNames.has(normalize(item.name));return <TableRow key={item.id}><TableCell><div className="flex items-center gap-2"><div className="rounded-lg bg-violet-50 p-2"><Tag className="h-4 w-4 text-violet-600"/></div>{editingId===item.id?<Input value={editName} onChange={(e)=>setEditName(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&saveEdit(item)} className="max-w-sm" autoFocus/>:<span className={`font-medium ${item.is_active?"text-gray-800":"text-gray-400 line-through"}`}>{item.name}</span>}</div></TableCell><TableCell className="text-center"><div className="flex items-center justify-center gap-2"><Switch checked={item.is_active} onCheckedChange={()=>updateMutation.mutate({id:item.id,data:{target_amount:item.is_active?0:1}})}/><span className="text-xs">{item.is_active?"نشط":"موقوف"}</span></div></TableCell><TableCell className="text-center text-xs">{used?<span className="text-amber-700">نعم</span>:<span className="text-gray-400">لا</span>}</TableCell><TableCell><div className="flex justify-end gap-1">{editingId===item.id?<><button onClick={()=>saveEdit(item)} className="rounded p-2 text-emerald-600 hover:bg-emerald-50"><Check className="h-4 w-4"/></button><button onClick={()=>setEditingId(null)} className="rounded p-2 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4"/></button></>:<button onClick={()=>{setEditingId(item.id);setEditName(item.name);setError("");}} className="rounded p-2 text-blue-600 hover:bg-blue-50"><Pencil className="h-4 w-4"/></button>}<button onClick={()=>deleteItem(item)} className={`rounded p-2 ${used?"cursor-not-allowed text-gray-300":"text-red-500 hover:bg-red-50"}`} title={used?"مستخدم في بيانات قديمة؛ يمكن تعطيله فقط":"حذف"}><Trash2 className="h-4 w-4"/></button></div></TableCell></TableRow>;})}</TableBody></Table>}</Card>
    <Card className="border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">البنود محفوظة مركزيًا لكل المستخدمين. البند المستخدم في تسليم قديم لا يُحذف حفاظًا على التقرير التاريخي، ويمكن تعطيله لمنع استخدامه مستقبلًا.</Card>
  </div>;
}