import { useMemo } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, CheckCircle2, Database, RefreshCw, Server, TriangleAlert, Users, Receipt, Target, Lock, DatabaseZap, FileWarning, Clock3 } from 'lucide-react';
import { base44, performanceApi, systemHealthApi, errorText } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUserRole } from '@/lib/useUserRole';

const CHECKS = [
  { key: 'dashboard', label: 'ملخص المشتريات', icon: Database, query: () => performanceApi.dashboard({ branch: 'all' }), count: (data) => Number(data?.invoice_count || 0) },
  { key: 'invoices', label: 'فواتير المشتريات', icon: Database, query: () => performanceApi.invoices({ branch: 'all', page: 1, page_size: 1 }), count: (data) => Number(data?.total_count || data?.count || data?.rows?.length || 0) },
  { key: 'expenses', label: 'المصروفات', icon: Receipt, query: () => base44.entities.Expense.list('-expense_date', 5000, 0), count: (data) => Array.isArray(data) ? data.length : 0 },
  { key: 'orders', label: 'طلبات العملاء', icon: Activity, query: () => base44.entities.CustomerOrder.list('-created_at', 5000, 0), count: (data) => Array.isArray(data) ? data.length : 0 },
  { key: 'targets', label: 'الأهداف والحدود', icon: Target, query: () => base44.entities.TargetGoal.list('-created_at', 5000, 0), count: (data) => Array.isArray(data) ? data.length : 0 },
  { key: 'session', label: 'جلسة المستخدم', icon: Users, query: () => base44.auth.me(), count: (data) => data ? 1 : 0 },
];

const fmt = (value) => Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 });
const when = (value) => value ? new Date(value).toLocaleString('ar-EG') : 'غير متاح';

function Metric({ label, value, note, icon: Icon, danger = false, warning = false }) {
  return <Card className={`p-4 ${danger ? 'border-red-200 bg-red-50' : warning ? 'border-amber-200 bg-amber-50' : 'border-slate-200'}`}>
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>{note && <p className="mt-1 text-xs text-slate-500">{note}</p>}</div><div className="rounded-xl bg-white/80 p-2.5"><Icon className={`h-5 w-5 ${danger ? 'text-red-600' : warning ? 'text-amber-600' : 'text-teal-700'}`} /></div></div>
  </Card>;
}

export default function SystemStatus() {
  const qc = useQueryClient();
  const { isAdmin } = useUserRole();
  const queries = useQueries({ queries: CHECKS.map((item) => ({ queryKey: ['system-status', item.key], queryFn: item.query, staleTime: 30000, retry: 1, enabled: isAdmin })) });
  const syncQuery = useQuery({ queryKey: ['system-status', 'base44-sync-health'], queryFn: () => systemHealthApi.sync(), enabled: isAdmin, staleTime: 30000, retry: 0 });
  const cards = useMemo(() => CHECKS.map((item, index) => ({ ...item, count: queries[index]?.data ? item.count(queries[index].data) : null, error: queries[index]?.isError ? errorText(queries[index]?.error) : null, loading: queries[index]?.isLoading || queries[index]?.isFetching })), [queries]);
  const isLoading = cards.some((item) => item.loading) || syncQuery.isFetching;
  const hasCoreError = cards.some((item) => item.error);
  const sync = syncQuery.data || null;
  const mismatch = sync?.difference && !sync.difference.is_matched;
  const healthy = !isLoading && !hasCoreError && !mismatch && !Number(sync?.incoming?.failed || 0);

  if (!isAdmin) return <div dir="rtl" className="min-h-[60vh] flex flex-col items-center justify-center gap-3 text-gray-400"><Lock className="w-12 h-12" /><p>هذه الصفحة للمدير العام فقط</p></div>;

  const refresh = () => qc.invalidateQueries({ queryKey: ['system-status'] });

  return <div dir="rtl" className="space-y-5 p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">حالة النظام والمزامنة</h1><p className="mt-1 text-sm text-slate-500">فحص المسارات الأساسية وتطابق فواتير Base44 مع Supabase بدون تعديل البيانات.</p></div><Button onClick={refresh} disabled={isLoading} variant="outline" className="gap-2"><RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> تحديث الفحص</Button></div>

    <Card className={`border p-5 ${healthy ? 'border-emerald-200 bg-emerald-50' : hasCoreError || mismatch || Number(sync?.incoming?.failed || 0) ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
      <div className="flex items-center gap-3">{healthy ? <CheckCircle2 className="h-8 w-8 text-emerald-600"/> : hasCoreError || mismatch ? <TriangleAlert className="h-8 w-8 text-red-600"/> : <Server className="h-8 w-8 text-amber-600"/>}<div><p className="font-bold text-slate-900">{healthy ? 'النظام والمزامنة متطابقان' : mismatch ? 'يوجد فرق بين Base44 وSupabase' : hasCoreError ? 'توجد مسارات تحتاج مراجعة' : 'جاري فحص النظام'}</p><p className="mt-1 text-sm text-slate-600">آخر فحص: {new Date().toLocaleString('ar-EG')}</p></div></div>
    </Card>

    {syncQuery.isError && <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><p className="font-bold">مقارنة المزامنة التفصيلية غير مفعلة بعد.</p><p className="mt-1">المسارات الأساسية ما زالت تعمل. يلزم تطبيق Migration: <span dir="ltr" className="font-mono">20260802052500_app_system_sync_health_readonly.sql</span>. الخطأ: {errorText(syncQuery.error)}</p></Card>}

    {sync && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="فواتير Base44 المعاد بناؤها" value={fmt(sync.base44_reconstructed?.invoice_count)} note={`انتظار المراجعة: ${fmt(sync.base44_reconstructed?.pending_count)}`} icon={DatabaseZap} />
        <Metric label="الفواتير النشطة في Supabase" value={fmt(sync.supabase_current?.invoice_count)} note={`انتظار المراجعة: ${fmt(sync.supabase_current?.pending_count)}`} icon={Database} danger={Number(sync.difference?.invoice_count) !== 0} />
        <Metric label="فرق عدد الفواتير" value={fmt(sync.difference?.invoice_count)} note={`فرق انتظار المراجعة: ${fmt(sync.difference?.pending_count)}`} icon={FileWarning} danger={Number(sync.difference?.invoice_count) !== 0 || Number(sync.difference?.pending_count) !== 0} />
        <Metric label="فرق القيمة" value={`${fmt(sync.difference?.total_value)} ج`} note={sync.difference?.is_matched ? 'متطابق' : 'يحتاج مراجعة'} icon={Receipt} danger={!sync.difference?.is_matched} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="أحداث مطبقة" value={fmt(sync.incoming?.applied)} icon={CheckCircle2} />
        <Metric label="أحداث فاشلة" value={fmt(sync.incoming?.failed)} icon={TriangleAlert} danger={Number(sync.incoming?.failed) > 0} />
        <Metric label="حذف يحتاج مراجعة" value={fmt(sync.incoming?.delete_requires_review)} icon={FileWarning} warning={Number(sync.incoming?.delete_requires_review) > 0} />
        <Metric label="آخر حدث Base44" value={when(sync.incoming?.last_event_at)} note={`آخر تطبيق: ${when(sync.incoming?.last_applied_at)}`} icon={Clock3} />
      </div>
      <Card className="p-4 text-sm text-slate-600"><p><span className="font-bold">اتجاه المزامنة:</span> Base44 → Supabase/Vercel فقط.</p><p className="mt-1"><span className="font-bold">آخر Snapshot كامل:</span> {when(sync.snapshot?.received_at)}</p></Card>
    </>}

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map((item) => { const Icon = item.icon; return <Card key={item.key} className={`p-5 ${item.error ? 'border-red-200' : 'border-slate-200'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 text-3xl font-bold text-slate-900">{item.loading ? '...' : item.error ? 'خطأ' : fmt(item.count)}</p>{item.error ? <p className="mt-2 break-words text-xs text-red-600">{item.error}</p> : <p className="mt-2 text-xs text-emerald-600">تمت القراءة بنجاح</p>}</div><div className="rounded-xl bg-teal-50 p-3"><Icon className="h-5 w-5 text-teal-700"/></div></div></Card>; })}</div>
  </div>;
}
