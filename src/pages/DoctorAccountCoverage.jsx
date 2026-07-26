import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { base44, staffAccountsApi } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useUserRole } from '@/lib/useUserRole';

function normalizeName(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/^(د|دكتور|د\/|د\.)\s*/i, '')
    .replace(/[^\u0600-\u06ffa-z0-9]/gi, '');
}

function suggestedUsername(name, index) {
  const translit = {
    'احمد': 'ahmed', 'اسلام': 'eslam', 'اميره': 'amira', 'اميرة': 'amira', 'بسنت': 'basant',
    'حسن': 'hassan', 'دنيا': 'donia', 'رضا': 'reda', 'ساره': 'sara', 'سارة': 'sara',
    'ضحي': 'doha', 'ضحى': 'doha', 'علا': 'ola', 'علياء': 'aliaa', 'عمر': 'omar',
    'محمد': 'mohamed', 'ندي': 'nada', 'ندى': 'nada', 'هدي': 'hoda', 'هدى': 'hoda',
    'وليد': 'walid', 'يوسف': 'youssef', 'معاذ': 'moaz'
  };
  const clean = String(name).replace(/^(د|دكتور|د\/|د\.)\s*/i, '').trim();
  const first = clean.split(/\s+/)[0];
  return `dr.${translit[first] || `doctor${index + 1}`}`;
}

export default function DoctorAccountCoverage() {
  const { isAdmin } = useUserRole();
  const accountsQuery = useQuery({ queryKey: ['staff-accounts'], queryFn: staffAccountsApi.list, enabled: isAdmin, staleTime: 15000 });
  const membersQuery = useQuery({ queryKey: ['team-members-account-coverage'], queryFn: () => base44.entities.TeamMember.list('name', 1000), enabled: isAdmin, staleTime: 30000 });

  const result = useMemo(() => {
    const accounts = accountsQuery.data || [];
    const members = membersQuery.data || [];
    const accountNames = new Set(accounts.map((a) => normalizeName(a.display_name)));
    const doctors = members.filter((m) => {
      if (m.is_active === false || m.merged_into_id) return false;
      const role = String(m.role || '');
      return /صيدلي|طبيب|مشرف|دكتور/.test(role) || /^د\s|^د\/|^دكتور/.test(String(m.name || ''));
    });
    const missing = doctors.filter((m) => !accountNames.has(normalizeName(m.name)));
    const covered = doctors.filter((m) => accountNames.has(normalizeName(m.name)));
    return { accounts, doctors, missing, covered };
  }, [accountsQuery.data, membersQuery.data]);

  if (!isAdmin) return <div dir="rtl" className="p-10 text-center text-gray-500">هذه الصفحة للمدير العام فقط.</div>;
  const loading = accountsQuery.isLoading || membersQuery.isLoading;
  const failed = accountsQuery.isError || membersQuery.isError;

  return (
    <div dir="rtl" className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-teal-50 p-3"><ShieldCheck className="h-6 w-6 text-teal-700" /></div>
          <div><h1 className="text-2xl font-bold text-gray-900">تغطية حسابات الدكاترة</h1><p className="mt-1 text-sm text-gray-500">مقارنة فريق العمل بحسابات الدخول الفعلية.</p></div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { accountsQuery.refetch(); membersQuery.refetch(); }} className="gap-2"><RefreshCw className="h-4 w-4" /> تحديث</Button>
          <Button asChild className="gap-2 bg-teal-600 hover:bg-teal-700"><Link to="/user-management"><UserPlus className="h-4 w-4" /> إدارة الحسابات</Link></Button>
        </div>
      </div>

      {loading ? <Card className="p-10 text-center text-gray-500">جاري فحص الحسابات...</Card> : failed ? <Card className="border-red-200 p-6 text-center text-red-700">تعذر تحميل بيانات الحسابات أو فريق العمل.</Card> : <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4"><p className="text-sm text-gray-500">الدكاترة النشطون</p><p className="mt-2 text-3xl font-bold">{result.doctors.length}</p></Card>
          <Card className="p-4"><p className="text-sm text-gray-500">لديهم حساب</p><p className="mt-2 text-3xl font-bold text-emerald-700">{result.covered.length}</p></Card>
          <Card className="p-4"><p className="text-sm text-gray-500">بدون حساب</p><p className="mt-2 text-3xl font-bold text-red-700">{result.missing.length}</p></Card>
          <Card className="p-4"><p className="text-sm text-gray-500">إجمالي حسابات الدخول</p><p className="mt-2 text-3xl font-bold text-blue-700">{result.accounts.length}</p></Card>
        </div>

        {result.missing.length === 0 ? <Card className="flex items-center gap-3 border-emerald-200 bg-emerald-50 p-5 text-emerald-800"><CheckCircle2 className="h-7 w-7" /><div><p className="font-bold">كل الدكاترة لديهم حسابات دخول</p><p className="text-sm">راجع الأدوار والفروع دوريًا من إدارة الحسابات.</p></div></Card> : <Card className="overflow-hidden">
          <div className="flex items-center gap-3 border-b bg-amber-50 p-4 text-amber-900"><AlertTriangle className="h-5 w-5" /><div><p className="font-bold">يوجد {result.missing.length} دكتور بدون حساب</p><p className="text-xs">لا يتم إنشاء الحساب تلقائيًا حتى تحدد هل دوره إدخال أو مراجعة أو إدارة فرع.</p></div></div>
          <div className="divide-y">
            {result.missing.map((member, index) => <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div><p className="font-bold text-gray-900">{member.name}</p><div className="mt-1 flex flex-wrap gap-1"><Badge variant="secondary">{member.role || 'الدور غير محدد'}</Badge>{(member.branches || []).map((b) => <Badge key={b} variant="outline">{b}</Badge>)}</div></div>
              <div className="text-left"><p className="text-xs text-gray-500">اسم مستخدم مقترح</p><code dir="ltr" className="text-sm font-bold text-teal-700">{suggestedUsername(member.name, index)}</code></div>
            </div>)}
          </div>
        </Card>}

        <Card className="p-4 text-sm text-gray-600"><div className="flex items-start gap-2"><Users className="mt-0.5 h-4 w-4 text-blue-600" /><p>بعد إنشاء الحساب، حدد الدور بدقة: <strong>دكتور إدخال فواتير</strong> أو <strong>دكتور مراجعة فواتير</strong>، وحدد الفروع التي يعمل بها. الرقم السري الافتراضي المقترح 9493 ويُفضّل تغييره عند التسليم.</p></div></Card>
      </>}
    </div>
  );
}
