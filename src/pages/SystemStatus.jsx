import { useMemo } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Activity, CheckCircle2, Database, RefreshCw, Server, TriangleAlert, Users } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const CHECKS = [
  { key: 'PurchaseInvoice', label: 'فواتير المشتريات', expected: 3686, icon: Database },
  { key: 'Supplier', label: 'الموردون', expected: 31, icon: Users },
  { key: 'PharmacyOrder', label: 'طلبات الصيدليات', expected: 232, icon: Activity },
  { key: 'Return', label: 'المرتجعات', expected: 24, icon: Activity },
  { key: 'ReplenishmentOrder', label: 'طلبات إعادة التوريد', expected: 53, icon: Activity },
  { key: 'ShiftDelivery', label: 'تسليمات الشيفت', expected: 50, icon: Activity },
];

export default function SystemStatus() {
  const qc = useQueryClient();
  const queries = useQueries({
    queries: CHECKS.map((item) => ({
      queryKey: ['system-status', item.key],
      queryFn: () => base44.entities[item.key].list(undefined, 10000, 0),
      staleTime: 30000,
      retry: 1,
    })),
  });

  const isLoading = queries.some((query) => query.isLoading || query.isFetching);
  const hasError = queries.some((query) => query.isError);
  const cards = useMemo(() => CHECKS.map((item, index) => ({
    ...item,
    count: queries[index]?.data?.length ?? null,
    error: queries[index]?.error?.message || null,
    loading: queries[index]?.isLoading || queries[index]?.isFetching,
  })), [queries]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['system-status'] });
  const healthy = !isLoading && !hasError && cards.every((item) => Number.isFinite(item.count));

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">حالة النظام</h1>
          <p className="mt-1 text-sm text-slate-500">فحص مباشر لاتصال التطبيق وقواعد البيانات الأساسية.</p>
        </div>
        <Button onClick={refresh} disabled={isLoading} variant="outline" className="gap-2">
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> تحديث الفحص
        </Button>
      </div>

      <Card className={`p-5 border ${healthy ? 'border-emerald-200 bg-emerald-50' : hasError ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
        <div className="flex items-center gap-3">
          {healthy ? <CheckCircle2 className="h-8 w-8 text-emerald-600" /> : hasError ? <TriangleAlert className="h-8 w-8 text-red-600" /> : <Server className="h-8 w-8 text-amber-600" />}
          <div>
            <p className="font-bold text-slate-900">{healthy ? 'النظام متصل ويقرأ البيانات بنجاح' : hasError ? 'يوجد خطأ في قراءة بعض البيانات' : 'جاري فحص النظام'}</p>
            <p className="mt-1 text-sm text-slate-600">آخر فحص: {new Date().toLocaleString('ar-EG')}</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((item) => {
          const Icon = item.icon;
          const suspicious = item.count === 0 && item.expected > 0;
          return (
            <Card key={item.key} className={`p-5 ${item.error || suspicious ? 'border-red-200' : 'border-slate-200'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-500">{item.label}</p>
                  <p className="mt-2 text-3xl font-bold text-slate-900">{item.loading ? '...' : item.error ? 'خطأ' : item.count?.toLocaleString('ar-EG')}</p>
                  {item.error ? <p dir="ltr" className="mt-2 break-words text-xs text-red-600">{item.error}</p> : suspicious ? <p className="mt-2 text-xs font-semibold text-red-600">العدد صفر بشكل غير متوقع</p> : <p className="mt-2 text-xs text-slate-400">العدد المرجعي عند النقل: {item.expected.toLocaleString('ar-EG')}</p>}
                </div>
                <div className="rounded-xl bg-teal-50 p-3"><Icon className="h-5 w-5 text-teal-700" /></div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
