import { useMemo } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Activity, CheckCircle2, Database, RefreshCw, Server, TriangleAlert, Users, Receipt, Target } from 'lucide-react';
import { base44, performanceApi, errorText } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const CHECKS = [
  { key: 'dashboard', label: 'ملخص المشتريات', icon: Database, query: () => performanceApi.dashboard({ branch: 'all' }), count: (data) => Number(data?.invoice_count || 0) },
  { key: 'invoices', label: 'فواتير المشتريات', icon: Database, query: () => performanceApi.invoices({ branch: 'all', page: 1, page_size: 1 }), count: (data) => Number(data?.total_count || data?.count || data?.rows?.length || 0) },
  { key: 'expenses', label: 'المصروفات', icon: Receipt, query: () => base44.entities.Expense.list('-expense_date', 5000, 0), count: (data) => Array.isArray(data) ? data.length : 0 },
  { key: 'orders', label: 'طلبات العملاء', icon: Activity, query: () => base44.entities.CustomerOrder.list('-created_at', 5000, 0), count: (data) => Array.isArray(data) ? data.length : 0 },
  { key: 'targets', label: 'الأهداف والحدود', icon: Target, query: () => base44.entities.TargetGoal.list('-created_at', 5000, 0), count: (data) => Array.isArray(data) ? data.length : 0 },
  { key: 'session', label: 'جلسة المستخدم', icon: Users, query: () => base44.auth.me(), count: (data) => data ? 1 : 0 },
];

export default function SystemStatus() {
  const qc = useQueryClient();
  const queries = useQueries({ queries: CHECKS.map((item) => ({ queryKey: ['system-status', item.key], queryFn: item.query, staleTime: 30000, retry: 1 })) });
  const cards = useMemo(() => CHECKS.map((item, index) => ({ ...item, count: queries[index]?.data ? item.count(queries[index].data) : null, error: queries[index]?.isError ? errorText(queries[index]?.error) : null, loading: queries[index]?.isLoading || queries[index]?.isFetching })), [queries]);
  const isLoading = cards.some((item) => item.loading); const hasError = cards.some((item) => item.error); const healthy = !isLoading && !hasError;
  return <div dir="rtl" className="space-y-5 p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">حالة النظام</h1><p className="mt-1 text-sm text-slate-500">فحص المسارات الأساسية المستخدمة فعليًا داخل التطبيق.</p></div><Button onClick={() => qc.invalidateQueries({ queryKey: ['system-status'] })} disabled={isLoading} variant="outline" className="gap-2"><RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> تحديث الفحص</Button></div>
    <Card className={`border p-5 ${healthy ? 'border-emerald-200 bg-emerald-50' : hasError ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}><div className="flex items-center gap-3">{healthy ? <CheckCircle2 className="h-8 w-8 text-emerald-600"/> : hasError ? <TriangleAlert className="h-8 w-8 text-red-600"/> : <Server className="h-8 w-8 text-amber-600"/>}<div><p className="font-bold text-slate-900">{healthy ? 'المسارات الأساسية تعمل بنجاح' : hasError ? 'توجد مسارات تحتاج مراجعة' : 'جاري فحص النظام'}</p><p className="mt-1 text-sm text-slate-600">آخر فحص: {new Date().toLocaleString('ar-EG')}</p></div></div></Card>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map((item) => { const Icon = item.icon; return <Card key={item.key} className={`p-5 ${item.error ? 'border-red-200' : 'border-slate-200'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 text-3xl font-bold text-slate-900">{item.loading ? '...' : item.error ? 'خطأ' : Number(item.count || 0).toLocaleString('ar-EG')}</p>{item.error ? <p className="mt-2 break-words text-xs text-red-600">{item.error}</p> : <p className="mt-2 text-xs text-emerald-600">تمت القراءة بنجاح</p>}</div><div className="rounded-xl bg-teal-50 p-3"><Icon className="h-5 w-5 text-teal-700"/></div></div></Card>; })}</div>
  </div>;
}