import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { useUserRole } from '@/lib/useUserRole';
import { staffAccountsApi } from '@/api/base44Client';
import { KeyRound, Lock, RefreshCw, Search, ShieldCheck, UserPlus, UsersRound } from 'lucide-react';

const BRANCHES = ['دواء الشامي', 'دواء شكري'];
const ROLE_CONFIG = {
  general_manager: { label: 'المدير العام', className: 'bg-red-100 text-red-700', desc: 'كل الصلاحيات واعتماد وإعادة فتح الفواتير.' },
  branch_manager: { label: 'مدير فرع', className: 'bg-blue-100 text-blue-700', desc: 'متابعة فواتير الفرع والمراجعة وإعادة التصحيح.' },
  invoice_entry: { label: 'دكتور إدخال فواتير', className: 'bg-teal-100 text-teal-700', desc: 'إدخال وتعديل المسودات وإرسالها للمراجعة.' },
  invoice_reviewer: { label: 'دكتور مراجعة فواتير', className: 'bg-amber-100 text-amber-800', desc: 'مراجعة الفواتير أو إعادتها للتصحيح.' },
  purchasing: { label: 'مسؤول مشتريات', className: 'bg-cyan-100 text-cyan-800', desc: 'إدخال الفواتير ومتابعة الموردين والمشتريات.' },
  accountant: { label: 'محاسب واعتماد مالي', className: 'bg-violet-100 text-violet-700', desc: 'الاعتماد المالي بعد إتمام المراجعة.' },
  viewer: { label: 'مشاهد فقط', className: 'bg-gray-100 text-gray-700', desc: 'عرض البيانات دون تعديل أو اعتماد.' },
};

const EMPTY_FORM = { username: '', display_name: '', pin: '9493', role: 'viewer', branch_ids: [] };
const ERROR_MESSAGES = {
  invalid_username: 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل ويحتوي على حروف إنجليزية أو أرقام أو نقطة فقط.',
  invalid_display_name: 'اكتب الاسم الظاهر بصورة صحيحة.',
  invalid_pin: 'الرقم السري يجب أن يكون من 4 إلى 12 رقمًا.',
  invalid_role: 'الدور المختار غير صحيح.',
  username_exists: 'اسم المستخدم موجود بالفعل.',
  cannot_disable_self: 'لا يمكن تعطيل حسابك الحالي.',
  cannot_demote_self: 'لا يمكن إزالة صلاحية المدير العام من حسابك الحالي.',
  forbidden: 'هذه العملية متاحة للمدير العام فقط.',
};

function BranchPicker({ value, onChange }) {
  const toggle = (branch) => onChange(value.includes(branch) ? value.filter((item) => item !== branch) : [...value, branch]);
  return <div className="flex flex-wrap gap-2">{BRANCHES.map((branch) => <button key={branch} type="button" onClick={() => toggle(branch)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${value.includes(branch) ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-gray-200 bg-white text-gray-500'}`}>{branch}</button>)}</div>;
}

function AccountForm({ form, setForm, showUsername = false, showPin = false }) {
  const role = ROLE_CONFIG[form.role] || ROLE_CONFIG.viewer;
  return (
    <div className="space-y-4">
      {showUsername && <div className="space-y-1.5"><Label>اسم المستخدم</Label><Input dir="ltr" value={form.username} onChange={(e) => setForm((old) => ({ ...old, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') }))} placeholder="مثال: dr.eslam" /></div>}
      <div className="space-y-1.5"><Label>الاسم الظاهر</Label><Input value={form.display_name} onChange={(e) => setForm((old) => ({ ...old, display_name: e.target.value }))} placeholder="مثال: د/ إسلام" /></div>
      {showPin && <div className="space-y-1.5"><Label>الرقم السري الافتراضي</Label><Input dir="ltr" inputMode="numeric" value={form.pin} onChange={(e) => setForm((old) => ({ ...old, pin: e.target.value.replace(/\D/g, '').slice(0, 12) }))} /></div>}
      <div className="space-y-1.5">
        <Label>الدور</Label>
        <Select value={form.role} onValueChange={(roleValue) => setForm((old) => ({ ...old, role: roleValue }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(ROLE_CONFIG).map(([key, cfg]) => <SelectItem key={key} value={key}>{cfg.label}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-xs text-gray-500">{role.desc}</p>
      </div>
      <div className="space-y-1.5"><Label>الفروع المتاحة</Label><BranchPicker value={form.branch_ids || []} onChange={(branch_ids) => setForm((old) => ({ ...old, branch_ids }))} /></div>
    </div>
  );
}

export default function UserManagement() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isAdmin, user: currentUser } = useUserRole();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editAccount, setEditAccount] = useState(null);
  const [pinAccount, setPinAccount] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [newPin, setNewPin] = useState('9493');

  const accountsQuery = useQuery({ queryKey: ['staff-accounts'], queryFn: staffAccountsApi.list, enabled: isAdmin, staleTime: 15000, retry: 1 });
  const accounts = accountsQuery.data || [];
  const filteredAccounts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return accounts;
    return accounts.filter((account) => [account.username, account.display_name, ROLE_CONFIG[account.role]?.label, ...(account.branch_ids || [])].some((value) => String(value || '').toLowerCase().includes(term)));
  }, [accounts, search]);

  const showResult = (title) => { qc.invalidateQueries({ queryKey: ['staff-accounts'] }); toast({ title }); };
  const showError = (error) => toast({ title: 'تعذر تنفيذ العملية', description: ERROR_MESSAGES[error?.message] || error?.message || 'حدث خطأ غير متوقع.', variant: 'destructive' });
  const createMutation = useMutation({ mutationFn: staffAccountsApi.create, onSuccess: () => { showResult('تم إنشاء الحساب بنجاح'); setCreateOpen(false); setForm(EMPTY_FORM); }, onError: showError });
  const updateMutation = useMutation({ mutationFn: staffAccountsApi.update, onSuccess: () => { showResult('تم تحديث الحساب'); setEditAccount(null); }, onError: showError });
  const statusMutation = useMutation({ mutationFn: ({ id, status }) => staffAccountsApi.setStatus(id, status), onSuccess: () => showResult('تم تحديث حالة الحساب'), onError: showError });
  const pinMutation = useMutation({ mutationFn: ({ id, pin }) => staffAccountsApi.resetPin(id, pin), onSuccess: () => { showResult('تم تغيير الرقم السري وإغلاق الجلسات القديمة'); setPinAccount(null); setNewPin('9493'); }, onError: showError });

  if (!isAdmin) return <div dir="rtl" className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-gray-400"><Lock className="h-12 w-12" /><p className="text-lg font-medium">هذه الصفحة للمدير العام فقط</p></div>;

  const openEdit = (account) => { setEditAccount(account); setForm({ username: account.username, display_name: account.display_name, pin: '', role: account.role, branch_ids: account.branch_ids || [] }); };

  return (
    <div dir="rtl" className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-teal-50 p-3"><ShieldCheck className="h-6 w-6 text-teal-700" /></div><div><h1 className="text-2xl font-bold text-gray-900">إدارة الحسابات والأدوار</h1><p className="mt-1 text-sm text-gray-500">حدد هل الدكتور مسؤول إدخال أم مراجعة، وحدد فرعه بدقة.</p></div></div>
        <div className="flex gap-2"><Button variant="outline" onClick={() => accountsQuery.refetch()} disabled={accountsQuery.isFetching} className="gap-2"><RefreshCw className={`h-4 w-4 ${accountsQuery.isFetching ? 'animate-spin' : ''}`} /> تحديث</Button><Button onClick={() => { setForm(EMPTY_FORM); setCreateOpen(true); }} className="gap-2 bg-teal-600 hover:bg-teal-700"><UserPlus className="h-4 w-4" /> حساب جديد</Button></div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{Object.entries(ROLE_CONFIG).map(([key, cfg]) => <Card key={key} className="p-4"><Badge className={`${cfg.className} border-0`}>{cfg.label}</Badge><p className="mt-2 text-xs leading-5 text-gray-500">{cfg.desc}</p><p className="mt-2 text-xl font-bold">{accounts.filter((account) => account.role === key).length}</p></Card>)}</div>

      <Card className="p-4"><div className="relative max-w-md"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم أو اسم المستخدم أو الدور أو الفرع..." className="pr-10" /></div></Card>

      {accountsQuery.isLoading ? <Card className="p-10 text-center text-gray-500">جاري تحميل الحسابات...</Card> : accountsQuery.isError ? <Card className="border-red-200 p-6 text-center text-red-700">{accountsQuery.error?.message}</Card> : (
        <div className="space-y-3">{filteredAccounts.map((account) => {
          const role = ROLE_CONFIG[account.role] || ROLE_CONFIG.viewer;
          const isSelf = account.id === currentUser?.id;
          const active = account.status === 'active';
          return <Card key={account.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-gray-900">{account.display_name}</p>{isSelf && <Badge variant="outline">حسابك</Badge>}<Badge className={`${role.className} border-0`}>{role.label}</Badge></div><p dir="ltr" className="mt-1 text-left text-sm font-semibold text-gray-600">{account.username}</p><div className="mt-2 flex flex-wrap gap-1">{(account.branch_ids || []).length ? account.branch_ids.map((branch) => <Badge key={branch} variant="secondary">{branch}</Badge>) : <span className="text-xs text-gray-400">بدون فرع محدد</span>}</div><p className="mt-2 text-xs text-gray-500">{role.desc}</p></div><div className="text-left text-xs text-gray-500"><p className={active ? 'font-semibold text-emerald-700' : 'font-semibold text-red-700'}>{active ? 'نشط' : account.status === 'locked' ? 'مقفل' : 'متوقف'}</p><p className="mt-1">آخر دخول: {account.last_login_at ? new Date(account.last_login_at).toLocaleString('ar-EG') : 'لم يسجل دخولًا'}</p>{account.failed_attempts > 0 && <p className="mt-1 text-amber-700">محاولات خاطئة: {account.failed_attempts}</p>}</div></div><div className="mt-4 flex flex-wrap gap-2 border-t pt-3"><Button size="sm" variant="outline" onClick={() => openEdit(account)}>تعديل الحساب</Button><Button size="sm" variant="outline" className="gap-1" onClick={() => { setPinAccount(account); setNewPin('9493'); }}><KeyRound className="h-3.5 w-3.5" /> تغيير PIN</Button><Button size="sm" variant={active ? 'destructive' : 'default'} disabled={isSelf || statusMutation.isPending} onClick={() => statusMutation.mutate({ id: account.id, status: active ? 'disabled' : 'active' })}>{active ? 'تعطيل الحساب' : 'تفعيل الحساب'}</Button></div></Card>;
        })}{!filteredAccounts.length && <Card className="p-10 text-center text-gray-400"><UsersRound className="mx-auto mb-3 h-10 w-10" />لا توجد حسابات مطابقة.</Card>}</div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent dir="rtl" className="max-w-md"><DialogHeader><DialogTitle>إنشاء حساب جديد</DialogTitle></DialogHeader><AccountForm form={form} setForm={setForm} showUsername showPin /><DialogFooter className="gap-2"><Button variant="outline" onClick={() => setCreateOpen(false)}>إلغاء</Button><Button className="bg-teal-600 hover:bg-teal-700" disabled={createMutation.isPending} onClick={() => createMutation.mutate(form)}>{createMutation.isPending ? 'جاري الإنشاء...' : 'إنشاء الحساب'}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={!!editAccount} onOpenChange={(open) => !open && setEditAccount(null)}><DialogContent dir="rtl" className="max-w-md"><DialogHeader><DialogTitle>تعديل حساب {editAccount?.username}</DialogTitle></DialogHeader><AccountForm form={form} setForm={setForm} /><DialogFooter className="gap-2"><Button variant="outline" onClick={() => setEditAccount(null)}>إلغاء</Button><Button className="bg-teal-600 hover:bg-teal-700" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ id: editAccount.id, display_name: form.display_name, role: form.role, branch_ids: form.branch_ids })}>حفظ التعديلات</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={!!pinAccount} onOpenChange={(open) => !open && setPinAccount(null)}><DialogContent dir="rtl" className="max-w-sm"><DialogHeader><DialogTitle>تغيير PIN لحساب {pinAccount?.username}</DialogTitle></DialogHeader><div className="space-y-2"><Label>الرقم السري الجديد</Label><Input dir="ltr" inputMode="numeric" value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 12))} /><p className="text-xs text-gray-500">سيتم إغلاق كل الجلسات القديمة للحساب بعد التغيير.</p></div><DialogFooter className="gap-2"><Button variant="outline" onClick={() => setPinAccount(null)}>إلغاء</Button><Button disabled={pinMutation.isPending || newPin.length < 4} onClick={() => pinMutation.mutate({ id: pinAccount.id, pin: newPin })}>تغيير الرقم السري</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
