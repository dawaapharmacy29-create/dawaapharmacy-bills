import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ArrowLeftRight, CheckCircle2, Lock, Search, Users } from "lucide-react";
import { useUserRole } from "@/lib/useUserRole";
import { duplicateMemberGroups, TEAM_REFERENCE_SOURCES } from "@/lib/teamMemberIntegrity";
import { normalizeText } from "@/lib/dataIntegrity";
import { logActivity } from "@/lib/activityLogger";

async function safeList(entityName) {
  try {
    return await base44.entities[entityName].list("-created_date", 5000);
  } catch {
    return [];
  }
}

export default function TeamMergeCenter() {
  const { isAdmin } = useUserRole();
  const qc = useQueryClient();
  const [selectedGroup, setSelectedGroup] = useState("");
  const [canonicalId, setCanonicalId] = useState("");
  const [preview, setPreview] = useState(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["team-merge-members"],
    queryFn: () => base44.entities.TeamMember.list("name", 1000),
  });

  const groups = useMemo(() => duplicateMemberGroups(members), [members]);
  const group = groups.find((g) => normalizeText(g[0]?.name) === selectedGroup) || groups[0] || [];
  const canonical = group.find((m) => m.id === canonicalId) || group[0];
  const duplicates = group.filter((m) => m.id !== canonical?.id);

  const buildPreview = async () => {
    if (!canonical || duplicates.length === 0) return;
    setWorking(true);
    setMessage("");
    const duplicateNames = new Set(duplicates.map((m) => normalizeText(m.name)));
    const sourceResults = [];
    for (const source of TEAM_REFERENCE_SOURCES) {
      const rows = await safeList(source.entity);
      const matched = rows.filter((row) => duplicateNames.has(normalizeText(row[source.field])));
      sourceResults.push({ ...source, rows: matched });
    }
    setPreview({ canonical, duplicates, sources: sourceResults, total: sourceResults.reduce((sum, x) => sum + x.rows.length, 0) });
    setWorking(false);
  };

  const executeMerge = async () => {
    if (!preview || !canonical) return;
    const ok = window.confirm(`سيتم نقل ${preview.total} سجلًا إلى ${canonical.name} ثم أرشفة ${duplicates.length} سجل مكرر. لا يتم الحذف. هل تريد الاستمرار؟`);
    if (!ok) return;
    setWorking(true);
    setMessage("");
    try {
      for (const source of preview.sources) {
        for (const row of source.rows) {
          await base44.entities[source.entity].update(row.id, { [source.field]: canonical.name });
        }
      }
      for (const duplicate of duplicates) {
        await base44.entities.TeamMember.update(duplicate.id, {
          employment_status: "مؤرشف",
          is_active: false,
          merged_into_id: canonical.id,
          merged_into_name: canonical.name,
          merged_at: new Date().toISOString(),
        });
      }
      await base44.entities.TeamMember.update(canonical.id, {
        employment_status: canonical.employment_status || "نشط",
        is_active: true,
      });
      await logActivity({
        action_type: "merge",
        entity_type: "team_member",
        entity_id: canonical.id,
        entity_label: canonical.name,
        details: `دمج ${duplicates.map((m) => m.name).join("، ")} في ${canonical.name} ونقل ${preview.total} مرجعًا دون حذف`,
      });
      setMessage(`تم نقل ${preview.total} سجلًا وأرشفة ${duplicates.length} سجل مكرر بنجاح.`);
      setPreview(null);
      setCanonicalId("");
      qc.invalidateQueries({ queryKey: ["team-merge-members"] });
      qc.invalidateQueries({ queryKey: ["team-members"] });
    } catch (error) {
      setMessage(`تعذر إكمال الدمج: ${error?.message || "خطأ غير معروف"}. راجع سجل العمليات قبل إعادة المحاولة.`);
    } finally {
      setWorking(false);
    }
  };

  if (!isAdmin) {
    return <div dir="rtl" className="min-h-[60vh] flex flex-col items-center justify-center gap-3 text-gray-400"><Lock className="w-12 h-12" /><p>هذه الصفحة للمدير فقط</p></div>;
  }

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><ArrowLeftRight className="w-6 h-6 text-teal-600" />دمج وتنظيف فريق العمل</h1>
        <p className="text-sm text-gray-500 mt-1">معاينة العلاقات ثم نقلها إلى سجل أساسي وأرشفة النسخ المكررة بدون حذف.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="p-4"><p className="text-xs text-gray-500">إجمالي الموظفين</p><p className="text-2xl font-bold">{members.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">مجموعات التكرار</p><p className="text-2xl font-bold text-amber-600">{groups.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">سجلات زائدة محتملة</p><p className="text-2xl font-bold text-red-600">{groups.reduce((s, g) => s + g.length - 1, 0)}</p></Card>
      </div>

      {isLoading ? <Card className="p-8 text-center">جاري التحميل...</Card> : groups.length === 0 ? (
        <Card className="p-8 text-center text-emerald-700"><CheckCircle2 className="w-10 h-10 mx-auto mb-2" />لا توجد أسماء موظفين مكررة حاليًا.</Card>
      ) : (
        <Card className="p-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium mb-2">مجموعة التكرار</p>
              <Select value={selectedGroup || normalizeText(groups[0]?.[0]?.name)} onValueChange={(v) => { setSelectedGroup(v); setCanonicalId(""); setPreview(null); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{groups.map((g) => <SelectItem key={normalizeText(g[0].name)} value={normalizeText(g[0].name)}>{g[0].name} — {g.length} سجلات</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">السجل الأساسي الذي سيبقى</p>
              <Select value={canonical?.id || ""} onValueChange={(v) => { setCanonicalId(v); setPreview(null); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{group.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} — {m.role || "بدون وظيفة"} — {(m.branches || []).join("، ") || "بدون فرع"}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            {group.map((m) => <div key={m.id} className={`border rounded-lg p-3 flex justify-between gap-3 ${m.id === canonical?.id ? "border-emerald-400 bg-emerald-50" : "bg-white"}`}><div><p className="font-semibold">{m.name}</p><p className="text-xs text-gray-500">{m.role || "بدون وظيفة"} | {(m.branches || []).join("، ") || "بدون فرع"}</p><p className="text-[11px] text-gray-400">ID: {m.id}</p></div>{m.id === canonical?.id ? <Badge className="bg-emerald-100 text-emerald-700">السجل الأساسي</Badge> : <Badge variant="outline">سيتم أرشفته</Badge>}</div>)}
          </div>

          <Button onClick={buildPreview} disabled={working || !canonical} className="gap-2"><Search className="w-4 h-4" />معاينة السجلات المرتبطة</Button>

          {preview && <div className="border rounded-xl p-4 space-y-3 bg-slate-50"><div className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-600" /><p className="font-bold">سيتم تحديث {preview.total} سجل مرتبط</p></div>{preview.sources.map((s) => <div key={`${s.entity}-${s.field}`} className="flex justify-between text-sm"><span>{s.label}</span><Badge variant="outline">{s.rows.length}</Badge></div>)}<Button onClick={executeMerge} disabled={working} className="w-full bg-red-600 hover:bg-red-700">تنفيذ النقل والأرشفة الآمنة</Button></div>}
          {message && <p className={`text-sm p-3 rounded-lg ${message.startsWith("تم") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{message}</p>}
        </Card>
      )}
    </div>
  );
}
