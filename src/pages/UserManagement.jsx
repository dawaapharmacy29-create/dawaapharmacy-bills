import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ShieldCheck, UserPlus, Mail, Check, X, Lock } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useUserRole } from "@/lib/useUserRole";
import { logActivity } from "@/lib/activityLogger";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortControls } from "@/components/table/SortControls";
import { USER_ROLE_ORDER } from "@/lib/sortUtils";

const USER_SORT_COLUMNS = [
  { field: "full_name", label: "الاسم", type: "text" },
  { field: "email", label: "البريد", type: "text" },
  { field: "role", label: "الدور", type: "status", statusMap: USER_ROLE_ORDER },
  { field: "created_date", label: "تاريخ الإضافة", type: "date" },
];

const ROLE_CONFIG = {
  admin: { label: "مدير", color: "bg-red-100 text-red-700", desc: "صلاحيات كاملة تلقائياً" },
  manager: { label: "محاسب / مشرف", color: "bg-blue-100 text-blue-700", desc: "إضافة وتعديل وعرض" },
  viewer: { label: "مشاهد", color: "bg-gray-100 text-gray-700", desc: "عرض فقط (يمكن تخصيص صلاحيات إضافية)" },
};

const PERMISSIONS = [
  { key: "can_save_invoice", label: "إضافة وتعديل الفواتير" },
  { key: "can_delete_invoice", label: "حذف الفواتير" },
  { key: "can_manage_team", label: "إدارة فريق العمل" },
  { key: "can_set_budget", label: "تحديد الحد الأقصى للمشتريات" },
];

export default function UserManagement() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isAdmin, user: currentUser } = useUserRole();
  const [inviteDialog, setInviteDialog] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "viewer" });

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => base44.entities.User.list(),
  });
  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({
    columns: USER_SORT_COLUMNS,
    defaultSort: { field: "full_name", direction: "asc" },
    paramPrefix: "usr",
  });
  const sortedUsers = useMemo(() => sortData(users), [users, sortData]);

  const updateRole = useMutation({
    mutationFn: async ({ id, role, oldRole, userEmail }) => {
      await base44.entities.User.update(id, { role });
      await logActivity({
        action_type: "role_change",
        entity_type: "user",
        entity_id: id,
        record_id: id,
        entity_label: userEmail,
        old_value: oldRole,
        new_value: role,
        reason: "تغيير دور المستخدم",
        details: `تغيير دور ${userEmail} من ${oldRole} إلى ${role}`,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const updatePerm = useMutation({
    mutationFn: async ({ id, perm, value, oldValue, userEmail }) => {
      await base44.entities.User.update(id, { [perm]: value });
      await logActivity({
        action_type: "permission_change",
        entity_type: "user",
        entity_id: id,
        record_id: id,
        entity_label: userEmail,
        old_value: `${perm}: ${oldValue}`,
        new_value: `${perm}: ${value}`,
        reason: "تغيير صلاحية",
        details: `تغيير صلاحية ${perm} لـ ${userEmail}: ${oldValue} → ${value}`,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  if (!isAdmin) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-gray-400">
        <Lock className="w-12 h-12" />
        <p className="text-lg font-medium">هذه الصفحة للمدير فقط</p>
      </div>
    );
  }

  const handleInvite = async () => {
    await base44.users.inviteUser(inviteForm.email, inviteForm.role === "admin" ? "admin" : "user");
    toast({ title: "تم إرسال الدعوة", description: `تم إرسال دعوة إلى ${inviteForm.email}` });
    setInviteDialog(false);
    setInviteForm({ email: "", role: "viewer" });
    qc.invalidateQueries({ queryKey: ["users"] });
  };

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-teal-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-800">إدارة المستخدمين والصلاحيات</h1>
            <p className="text-gray-500 text-sm mt-0.5">تحديد أدوار وصلاحيات المستخدمين</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SortControls
            columns={USER_SORT_COLUMNS}
            sortField={sortField}
            sortDirection={sortDirection}
            onToggle={toggleSort}
            onSet={setSort}
            onReset={resetSort}
            cardMode
          />
          <Button onClick={() => setInviteDialog(true)} className="bg-teal-600 hover:bg-teal-700 gap-2">
            <UserPlus className="w-4 h-4" /> دعوة مستخدم
          </Button>
        </div>
      </div>

      {/* Roles Legend */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {Object.entries(ROLE_CONFIG).map(([key, cfg]) => (
          <Card key={key} className="p-4 border-r-4 border-r-gray-300">
            <div className="flex items-center gap-2 mb-1">
              <Badge className={`${cfg.color} border-0`}>{cfg.label}</Badge>
            </div>
            <p className="text-xs text-gray-500">{cfg.desc}</p>
          </Card>
        ))}
      </div>

      {/* Users List */}
      {isLoading ? (
        <Card className="p-8 text-center text-gray-400">
          <div className="w-8 h-8 border-4 border-gray-200 border-t-teal-600 rounded-full animate-spin mx-auto mb-3" />
        </Card>
      ) : (
        <div className="space-y-2">
          {sortedUsers.map((user) => {
            const role = user.role || "viewer";
            const cfg = ROLE_CONFIG[role] || ROLE_CONFIG.viewer;
            return (
              <Card key={user.id} className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-bold text-sm shrink-0">
                    {(user.full_name || user.email || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800 text-sm">{user.full_name || "—"}</p>
                    <p className="text-xs text-gray-500 flex items-center gap-1"><Mail className="w-3 h-3" />{user.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                  <Badge className={`${cfg.color} border-0 hidden sm:inline-flex`}>{cfg.label}</Badge>
                  <Select
                    value={role}
                    disabled={user.id === currentUser?.id}
                    onValueChange={(v) => updateRole.mutate({ id: user.id, role: v, oldRole: role, userEmail: user.email })}
                  >
                    <SelectTrigger className="w-36 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">مدير</SelectItem>
                      <SelectItem value="manager">محاسب / مشرف</SelectItem>
                      <SelectItem value="viewer">مشاهد</SelectItem>
                    </SelectContent>
                  </Select>
                  {user.id === currentUser?.id && (
                    <span className="text-[10px] text-gray-400">لا يمكن تغيير دورك</span>
                  )}
                </div>
                {/* Permissions row - only show for non-admin */}
                {role !== "admin" && (
                  <div className="mt-3 pt-3 border-t flex flex-wrap gap-2">
                    {PERMISSIONS.map((p) => {
                      const val = !!user[p.key];
                      return (
                        <button
                          key={p.key}
                          disabled={user.id === currentUser?.id}
                          onClick={() => updatePerm.mutate({ id: user.id, perm: p.key, value: !val, oldValue: val, userEmail: user.email })}
                          className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                            val ? "bg-teal-50 border-teal-300 text-teal-700" : "bg-gray-50 border-gray-200 text-gray-500 hover:border-teal-200"
                          }`}
                        >
                          {val ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Invite Dialog */}
      <Dialog open={inviteDialog} onOpenChange={setInviteDialog}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>دعوة مستخدم جديد</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>البريد الإلكتروني</Label>
              <Input type="email" placeholder="example@email.com" value={inviteForm.email} onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>الدور</Label>
              <Select value={inviteForm.role} onValueChange={(v) => setInviteForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">مدير</SelectItem>
                  <SelectItem value="manager">محاسب / مشرف</SelectItem>
                  <SelectItem value="viewer">مشاهد</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setInviteDialog(false)}>إلغاء</Button>
            <Button disabled={!inviteForm.email} onClick={handleInvite} className="bg-teal-600 hover:bg-teal-700">
              إرسال الدعوة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}