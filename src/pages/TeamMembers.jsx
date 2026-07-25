import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { useUserRole } from "@/lib/useUserRole";
import { logActivity } from "@/lib/activityLogger";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortControls } from "@/components/table/SortControls";
import { normalizeText } from "@/lib/dataIntegrity";
import { canonicalMemberPayload, EMPLOYMENT_STATUSES, isActiveMember } from "@/lib/teamMemberIntegrity";

const TEAM_SORT_COLUMNS = [
  { field: "name", label: "الاسم", type: "text" },
  { field: "role", label: "الدور", type: "text" },
  { field: "phone", label: "الهاتف", type: "text" },
];

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const branchColor = {
  "دواء شكري": "bg-blue-50 border-blue-200",
  "دواء الشامي": "bg-purple-50 border-purple-200",
};
const branchBadgeColor = {
  "دواء شكري": "bg-blue-100 text-blue-700",
  "دواء الشامي": "bg-purple-100 text-purple-700",
};

const emptyForm = { name: "", branches: [], primary_branch: "", role: "", phone: "", employment_status: "نشط", joined_at: "", notes: "" };

export default function TeamMembers() {
  const qc = useQueryClient();
  const { canManageTeam } = useUserRole();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["team-members"],
    queryFn: () => base44.entities.TeamMember.list("name"),
  });
  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({
    columns: TEAM_SORT_COLUMNS,
    defaultSort: { field: "name", direction: "asc" },
    paramPrefix: "team",
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.TeamMember.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team-members"] }); setDialogOpen(false); },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TeamMember.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team-members"] }); setDialogOpen(false); setEditingMember(null); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.TeamMember.delete(id),
    onSuccess: (_data, id) => {
      const member = members.find(m => m.id === id);
      logActivity({
        action_type: "delete",
        entity_type: "supplier",
        entity_id: id,
        entity_label: member ? `عضو فريق: ${member.name}` : id,
        details: "حذف عضو من فريق العمل",
      });
      qc.invalidateQueries({ queryKey: ["team-members"] });
    },
  });

  const openAdd = () => { setEditingMember(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (m) => {
    setEditingMember(m);
    setForm({ name: m.name, branches: m.branches || [], primary_branch: m.primary_branch || (m.branches || [])[0] || "", role: m.role || "", phone: m.phone || "", employment_status: m.employment_status || (m.is_active === false ? "مؤرشف" : "نشط"), joined_at: m.joined_at || "", notes: m.notes || "" });
    setDialogOpen(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.role.trim()) return;
    const duplicate = members.find((member) =>
      member.id !== editingMember?.id && normalizeText(member.name) === normalizeText(form.name)
    );
    if (duplicate) {
      window.alert(`يوجد عضو مسجل بنفس الاسم: ${duplicate.name}. راجع السجل الحالي بدل إنشاء سجل مكرر.`);
      return;
    }
    if (form.branches.length === 0) {
      window.alert("يرجى اختيار فرع واحد على الأقل.");
      return;
    }
    const normalizedForm = canonicalMemberPayload(form);
    if (editingMember) updateMutation.mutate({ id: editingMember.id, data: normalizedForm });
    else createMutation.mutate(normalizedForm);
  };

  const toggleBranch = (b) => {
    setForm((prev) => ({
      ...prev,
      branches: prev.branches.includes(b) ? prev.branches.filter((x) => x !== b) : [...prev.branches, b],
    }));
  };

  // Group by branch (member can appear in multiple) — مع الترتيب الموحد
  const activeMembers = useMemo(() => members.filter(isActiveMember), [members]);
  const inactiveMembers = useMemo(() => members.filter((m) => !isActiveMember(m)), [members]);
  const byBranch = useMemo(() => BRANCHES.map((b) => ({
    branch: b,
    members: sortData(activeMembers.filter((m) => (m.branches || []).includes(b))),
  })), [activeMembers, sortData]);

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">فريق العمل</h1>
          <p className="text-gray-500 text-sm mt-0.5">{activeMembers.length} نشط • {inactiveMembers.length} غير نشط</p>
        </div>
        <div className="flex items-center gap-2">
          <SortControls
            columns={TEAM_SORT_COLUMNS}
            sortField={sortField}
            sortDirection={sortDirection}
            onToggle={toggleSort}
            onSet={setSort}
            onReset={resetSort}
            cardMode
          />
          {canManageTeam && (
            <Button onClick={openAdd} className="bg-teal-600 hover:bg-teal-700 text-white gap-2">
              <Plus className="w-4 h-4" /> إضافة عضو
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <Card className="p-8 text-center text-gray-400">
          <div className="w-8 h-8 border-4 border-gray-200 border-t-teal-600 rounded-full animate-spin mx-auto mb-3" />
          جاري التحميل...
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {byBranch.map(({ branch, members: bm }) => (
            <div key={branch}>
              <div className={`rounded-xl border-2 ${branchColor[branch]} overflow-hidden`}>
                <div className="px-4 py-3 border-b flex items-center gap-2">
                  <Users className="w-4 h-4 text-gray-500" />
                  <h2 className="font-bold text-gray-700">{branch}</h2>
                  <span className="mr-auto text-xs bg-white rounded-full px-2 py-0.5 border text-gray-500">{bm.length} عضو</span>
                </div>
                <div className="p-3 space-y-2">
                  {bm.length === 0 ? (
                    <p className="text-center text-gray-400 text-sm py-4">لا يوجد أعضاء بعد</p>
                  ) : (
                    bm.map((m) => (
                      <div key={m.id} className="bg-white rounded-lg p-3 border flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-gray-800 text-sm">{m.name}</p>
                          {m.role && <p className="text-xs text-gray-500">{m.role}</p>}
                          {m.primary_branch && <p className="text-[11px] text-teal-700">الفرع الأساسي: {m.primary_branch}</p>}
                          {m.phone && <p className="text-xs text-gray-400">{m.phone}</p>}
                          {(m.branches || []).length > 1 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {(m.branches || []).map((b) => (
                                <span key={b} className={`text-xs rounded-full px-2 py-0.5 ${branchBadgeColor[b]}`}>{b}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        {canManageTeam && (
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(m)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:bg-red-50" onClick={() => window.alert("تم إيقاف الحذف المباشر لحماية السجلات المرتبطة. استخدم التعطيل أو الدمج بعد مراجعة العلاقات.")}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditingMember(null); }}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingMember ? "تعديل بيانات العضو" : "إضافة عضو جديد"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label>الاسم *</Label>
              <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="اسم العضو" required />
            </div>
            <div className="space-y-1">
              <Label>الفروع * (يمكن اختيار أكثر من فرع)</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {BRANCHES.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => toggleBranch(b)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${form.branches.includes(b) ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-600 border-gray-200 hover:border-teal-300"}`}
                  >
                    {b}
                  </button>
                ))}
              </div>
              {form.branches.length === 0 && <p className="text-xs text-red-500 mt-1">يرجى اختيار فرع واحد على الأقل</p>}
            </div>
            <div className="space-y-1">
              <Label>الدور / المنصب *</Label>
              <Input value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))} placeholder="مثل: صيدلي، مساعد صيدلي، مسؤول مخزن..." required />
            </div>
            <div className="space-y-1">
              <Label>الفرع الأساسي *</Label>
              <select className="w-full h-10 rounded-md border px-3 text-sm" value={form.primary_branch} onChange={(e) => setForm((p) => ({ ...p, primary_branch: e.target.value }))} required>
                <option value="">اختر الفرع الأساسي</option>
                {form.branches.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>حالة الموظف</Label>
              <select className="w-full h-10 rounded-md border px-3 text-sm" value={form.employment_status} onChange={(e) => setForm((p) => ({ ...p, employment_status: e.target.value }))}>
                {EMPLOYMENT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>تاريخ التعيين</Label>
              <Input type="date" value={form.joined_at} onChange={(e) => setForm((p) => ({ ...p, joined_at: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>رقم الهاتف</Label>
              <Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="01xxxxxxxxx" />
            </div>
            <DialogFooter className="gap-2 flex-row-reverse">
              <Button type="submit" className="bg-teal-600 hover:bg-teal-700" disabled={form.branches.length === 0 || !form.role.trim() || createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending ? "جاري الحفظ..." : editingMember ? "تحديث" : "حفظ"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}