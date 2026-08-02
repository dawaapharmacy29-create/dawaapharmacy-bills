import { Link } from 'react-router-dom';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Clock, Landmark, Receipt, RefreshCw, RotateCcw, ArrowLeftRight, ShieldCheck, AlertTriangle } from 'lucide-react';
import { base44, errorText } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUserRole } from '@/lib/useUserRole';

const fmt = (value) => Number(value || 0).toLocaleString('ar-EG');

const LINKS = [
  { path: '/shift-delivery', title: 'تسجيل وتسليم الشيفت', description: 'تسجيل النقدية والحركات وتسليم الشيفت.', icon: Clock },
  { path: '/treasury/shift-review', title: 'مراجعة واعتماد الشيفتات', description: 'مراجعة التسليمات المعلقة والمرتجعة.', icon: BadgeCheck, managerOnly: true },
  { path: '/treasury', title: 'الخزنة اليومية', description: 'متابعة حركة الخزنة اليومية.', icon: Landmark },
  { path: '/expenses', title: 'المصروفات', description: 'عرض وتسجيل مصروفات التشغيل.', icon: Receipt },
  { path: '/returns', title: 'المرتجعات', description: 'متابعة المرتجعات وتأثيرها المالي.', icon: RotateCcw },
  { path: '/branch-settlements', title: 'تسويات الفروع', description: 'مراجعة التسويات والتحويلات بين الفروع.', icon: ArrowLeftRight, adminOnly: true },
  { path: '/treasury-operations', title: 'الرقابة والإقفال', description: 'الرقابة المالية والإقفال الإداري.', icon: ShieldCheck, adminOnly: true },
];

export default function OperationsTreasuryCenter() {
  const qc = useQueryClient();
  const { isAdmin, isManager } = useUserRole();
  const canManage = isAdmin || isManager;
  const queries = useQueries({ queries: [
    { queryKey: ['operations-center', 'shifts'], queryFn: () => base44.entities.ShiftDelivery.list('-shift_date', 1000, 0), staleTime: 30000, retry: 1 },
    { queryKey: ['operations-center', 'expenses'], queryFn: () => base44.entities.Expense.list('-expense_date', 1000, 0), staleTime: 30000, retry: 1 },
    { queryKey: ['operations-center', 'returns'], queryFn: () => base44.entities.Return.list('-created_at', 1000, 0), staleTime: 30000, retry: 1 },
  ] });
  const shifts = Array.isArray(queries[0].data) ? queries[0].data : [];
  const expenses = Array.isArray(queries[1].data) ? queries[1].data : [];
  const returns = Array.isArray(queries[2].data) ? queries[2].data : [];
  const pendingShifts = shifts.filter((row) => ['pending', 'pending_review', 'returned'].includes(row.treasury_status || 'pending')).length;
  const today = new Date().toISOString().slice(0, 10);
  const expensesToday = expenses.filter((row) => String(row.expense_date || row.created_at || '').slice(0, 10) === today).length;
  const returnsToday = returns.filter((row) => String(row.return_date || row.created_at || '').slice(0, 10) === today).length;
  const loading = queries.some((item) => item.isFetching);
  const errors = queries.filter((item) => item.isError);
  const visibleLinks = LINKS.filter((item) => (!item.adminOnly || isAdmin) && (!item.managerOnly || canManage));

  return <div dir="rtl" className="space-y-5 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-slate-900">مركز التشغيل والخزنة</h1><p className="mt-1 text-sm text-slate-500">دورة تشغيل موحدة للشيفتات والخزنة والمصروفات والتسويات، بدون تغيير البيانات.</p></div>
      <Button variant="outline" className="gap-2" disabled={loading} onClick={() => qc.invalidateQueries({ queryKey: ['operations-center'] })}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تحديث</Button>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card className={`p-5 ${pendingShifts ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}><p className="text-xs text-slate-500">شيفتات تحتاج مراجعة</p><p className="mt-1 text-3xl font-bold">{fmt(pendingShifts)}</p></Card>
      <Card className="p-5"><p className="text-xs text-slate-500">إجمالي تسليمات الشيفت</p><p className="mt-1 text-3xl font-bold">{fmt(shifts.length)}</p></Card>
      <Card className="p-5"><p className="text-xs text-slate-500">مصروفات اليوم</p><p className="mt-1 text-3xl font-bold">{fmt(expensesToday)}</p></Card>
      <Card className="p-5"><p className="text-xs text-slate-500">مرتجعات اليوم</p><p className="mt-1 text-3xl font-bold">{fmt(returnsToday)}</p></Card>
    </div>

    {pendingShifts > 0 && canManage && <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><div className="flex gap-2"><AlertTriangle className="h-5 w-5 shrink-0"/><p>يوجد {fmt(pendingShifts)} شيفت يحتاج مراجعة أو إعادة اعتماد قبل الإقفال.</p></div></Card>}
    {errors.length > 0 && <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">تعذر تحميل بعض المؤشرات، لكن روابط التشغيل ما زالت متاحة. {errors.map((item) => errorText(item.error)).join(' — ')}</Card>}

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visibleLinks.map((item) => <Card key={item.path} className="p-5"><div className="flex items-start gap-3"><div className="rounded-xl bg-teal-50 p-3"><item.icon className="h-5 w-5 text-teal-700"/></div><div><h3 className="font-bold text-slate-900">{item.title}</h3><p className="mt-1 text-sm text-slate-500">{item.description}</p></div></div><Button asChild variant="outline" className="mt-4 w-full"><Link to={item.path}>فتح الصفحة</Link></Button></Card>)}</div>
  </div>;
}
