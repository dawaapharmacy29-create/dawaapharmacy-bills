import { Link } from 'react-router-dom';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ClipboardList, Clock, FileText, RefreshCw, Receipt, RotateCcw, ShoppingBag, WalletCards } from 'lucide-react';
import { base44, performanceApi, errorText } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUserRole } from '@/lib/useUserRole';

const fmt = (value) => Number(value || 0).toLocaleString('ar-EG');

const TASKS = [
  {
    key: 'pendingInvoices',
    title: 'فواتير انتظار المراجعة',
    description: 'فواتير لم تُراجع بعد.',
    path: '/pending-invoices',
    icon: FileText,
    query: () => performanceApi.invoices({ branch: 'all', workflow_status: 'submitted', page: 1, page_size: 1 }),
    count: (data) => Number(data?.total || data?.total_count || data?.count || 0),
    priority: 'high',
  },
  {
    key: 'returnedInvoices',
    title: 'فواتير مرتجعة للتصحيح',
    description: 'تحتاج تعديلًا وإعادة إرسال.',
    path: '/invoices?workflow_status=returned',
    icon: RotateCcw,
    query: () => performanceApi.invoices({ branch: 'all', workflow_status: 'returned', page: 1, page_size: 1 }),
    count: (data) => Number(data?.total || data?.total_count || data?.count || 0),
    priority: 'high',
  },
  {
    key: 'pendingShifts',
    title: 'شيفتات تحتاج مراجعة',
    description: 'تسليمات خزنة معلقة أو مرتجعة.',
    path: '/treasury/shift-review',
    icon: Clock,
    managersOnly: true,
    query: async () => {
      const rows = await base44.entities.ShiftDelivery.list('-shift_date', 500, 0);
      return rows.filter((row) => ['pending', 'pending_review', 'returned'].includes(row.treasury_status || 'pending'));
    },
    count: (data) => Array.isArray(data) ? data.length : 0,
    priority: 'high',
  },
  {
    key: 'customerOrders',
    title: 'طلبات عملاء مفتوحة',
    description: 'طلبات لم تُغلق أو تُلغَ بعد.',
    path: '/customer-orders',
    icon: ShoppingBag,
    query: async () => {
      const rows = await base44.entities.CustomerOrder.list('-created_at', 1000, 0);
      return rows.filter((row) => !['completed', 'delivered', 'cancelled', 'closed', 'تم', 'ملغي'].includes(String(row.status || '').toLowerCase()));
    },
    count: (data) => Array.isArray(data) ? data.length : 0,
    priority: 'normal',
  },
  {
    key: 'expensesToday',
    title: 'مصروفات اليوم',
    description: 'إجمالي عدد المصروفات المسجلة اليوم.',
    path: '/expenses',
    icon: Receipt,
    query: async () => {
      const rows = await base44.entities.Expense.list('-expense_date', 1000, 0);
      const today = new Date().toISOString().slice(0, 10);
      return rows.filter((row) => String(row.expense_date || row.created_at || '').slice(0, 10) === today);
    },
    count: (data) => Array.isArray(data) ? data.length : 0,
    priority: 'info',
  },
];

function TaskCard({ task, result }) {
  const Icon = task.icon;
  const count = result.data ? task.count(result.data) : 0;
  const classes = task.priority === 'high' && count > 0
    ? 'border-red-200 bg-red-50'
    : task.priority === 'normal' && count > 0
      ? 'border-amber-200 bg-amber-50'
      : 'border-slate-200 bg-white';
  return <Card className={`p-4 ${classes}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="rounded-xl bg-white p-2.5 shadow-sm"><Icon className="h-5 w-5 text-teal-700" /></div>
        <div className="min-w-0"><h3 className="font-bold text-slate-900">{task.title}</h3><p className="mt-1 text-xs text-slate-500">{task.description}</p></div>
      </div>
      <span className="text-2xl font-bold text-slate-900">{result.isLoading ? '…' : result.isError ? '!' : fmt(count)}</span>
    </div>
    {result.isError && <p className="mt-3 text-xs text-red-600">{errorText(result.error)}</p>}
    <Button asChild variant="outline" size="sm" className="mt-4 w-full"><Link to={task.path}>فتح المهمة</Link></Button>
  </Card>;
}

export default function DailyTasksCenter() {
  const qc = useQueryClient();
  const { isAdmin, isManager } = useUserRole();
  const allowedTasks = TASKS.filter((task) => !task.managersOnly || isAdmin || isManager);
  const results = useQueries({ queries: allowedTasks.map((task) => ({ queryKey: ['daily-tasks', task.key], queryFn: task.query, staleTime: 30000, retry: 1 })) });
  const consistency = useQueries({ queries: [
    { queryKey: ['daily-tasks', 'dashboard-consistency'], queryFn: () => performanceApi.dashboard({ branch: 'all' }), staleTime: 30000, retry: 1 },
    { queryKey: ['daily-tasks', 'invoice-consistency'], queryFn: () => performanceApi.invoices({ branch: 'all', page: 1, page_size: 1 }), staleTime: 30000, retry: 1 },
  ] });
  const dashboardCount = Number(consistency[0].data?.invoice_count || 0);
  const listCount = Number(consistency[1].data?.total || consistency[1].data?.total_count || consistency[1].data?.count || 0);
  const consistencyReady = !consistency.some((item) => item.isLoading || item.isError);
  const matched = consistencyReady && dashboardCount === listCount;
  const totalTasks = results.reduce((sum, result, index) => sum + (result.data ? allowedTasks[index].count(result.data) : 0), 0);
  const loading = results.some((item) => item.isFetching) || consistency.some((item) => item.isFetching);

  return <div dir="rtl" className="space-y-5 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-slate-900">مهام اليوم</h1><p className="mt-1 text-sm text-slate-500">تجميع للمهام التشغيلية المفتوحة حسب صلاحيات حسابك، بدون تعديل البيانات.</p></div>
      <Button variant="outline" className="gap-2" disabled={loading} onClick={() => qc.invalidateQueries({ queryKey: ['daily-tasks'] })}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تحديث</Button>
    </div>

    <div className="grid gap-3 md:grid-cols-3">
      <Card className="p-5"><div className="flex items-center gap-3"><ClipboardList className="h-7 w-7 text-teal-700" /><div><p className="text-xs text-slate-500">إجمالي المهام المفتوحة</p><p className="text-3xl font-bold">{fmt(totalTasks)}</p></div></div></Card>
      <Card className={`p-5 ${consistencyReady && !matched ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}><div className="flex items-center gap-3">{matched ? <CheckCircle2 className="h-7 w-7 text-emerald-600" /> : <AlertTriangle className="h-7 w-7 text-red-600" />}<div><p className="text-xs text-slate-500">اتساق عدد الفواتير</p><p className="text-lg font-bold">{!consistencyReady ? 'جاري الفحص' : matched ? 'متطابق' : `فرق ${fmt(dashboardCount - listCount)}`}</p></div></div></Card>
      <Card className="p-5"><div className="flex items-center gap-3"><WalletCards className="h-7 w-7 text-teal-700" /><div><p className="text-xs text-slate-500">عدد الداشبورد / القائمة</p><p className="text-lg font-bold">{fmt(dashboardCount)} / {fmt(listCount)}</p></div></div></Card>
    </div>

    {!matched && consistencyReady && <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">تم اكتشاف اختلاف بين ملخص الداشبورد وقائمة الفواتير. لم يتم تعديل أي بيانات؛ راجع صفحة حالة النظام ومزامنة Base44.</Card>}

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{allowedTasks.map((task, index) => <TaskCard key={task.key} task={task} result={results[index]} />)}</div>
  </div>;
}
