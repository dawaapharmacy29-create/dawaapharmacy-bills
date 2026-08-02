import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ClipboardList, FilePlus2, FileSearch, FileText, ListChecks, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { performanceApi, errorText } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUserRole } from '@/lib/useUserRole';

const fmt = (value) => Number(value || 0).toLocaleString('ar-EG');

const STATUS_CARDS = [
  { key: 'all', label: 'كل الفواتير', status: 'all', icon: FileText, path: '/invoices' },
  { key: 'submitted', label: 'انتظار المراجعة', status: 'submitted', icon: ClipboardList, path: '/pending-invoices', danger: true },
  { key: 'reviewed', label: 'تمت المراجعة', status: 'reviewed', icon: CheckCircle2, path: '/invoices?workflow_status=reviewed' },
  { key: 'returned', label: 'مرتجعة للتصحيح', status: 'returned', icon: RotateCcw, path: '/invoices?workflow_status=returned', warning: true },
  { key: 'approved', label: 'معتمدة ماليًا', status: 'approved', icon: ShieldCheck, path: '/invoices?workflow_status=approved' },
];

const PAGE_LINKS = [
  { path: '/invoices/new', label: 'إدخال فاتورة جديدة', description: 'إضافة فاتورة شراء من النموذج السريع.', icon: FilePlus2 },
  { path: '/invoices', label: 'العرض السريع', description: 'قائمة سريعة للبحث والفتح والمتابعة.', icon: FileText },
  { path: '/invoices/manage', label: 'العرض التفصيلي والفلاتر', description: 'فلاتر متقدمة وتفاصيل وتصدير.', icon: FileSearch },
  { path: '/pending-invoices', label: 'مراجعة الفواتير', description: 'الفواتير التي تنتظر المراجعة والاعتماد.', icon: ClipboardList },
  { path: '/invoices/quality', label: 'جودة وأخطاء الفواتير', description: 'اكتشاف الأخطاء والتكرارات والبيانات الناقصة.', icon: ListChecks },
  { path: '/review-needed-invoices', label: 'فواتير تحتاج تدخلًا', description: 'حالات استثنائية تحتاج قرارًا أو مراجعة إضافية.', icon: AlertTriangle },
];

export default function UnifiedInvoiceCenter() {
  const qc = useQueryClient();
  const { canEnterInvoice } = useUserRole();
  const queries = useQueries({
    queries: STATUS_CARDS.map((item) => ({
      queryKey: ['invoice-center', item.key],
      queryFn: () => performanceApi.invoices({ branch: 'all', workflow_status: item.status, page: 1, page_size: 1 }),
      staleTime: 30000,
      retry: 1,
    })),
  });

  const values = useMemo(() => STATUS_CARDS.map((item, index) => {
    const result = queries[index];
    const data = result.data || {};
    return {
      ...item,
      count: Number(data.total_count || data.total || data.count || 0),
      error: result.isError ? errorText(result.error) : null,
      loading: result.isLoading || result.isFetching,
    };
  }), [queries]);

  const allCount = values.find((item) => item.key === 'all')?.count || 0;
  const statusTotal = values.filter((item) => item.key !== 'all').reduce((sum, item) => sum + item.count, 0);
  const consistencyReady = values.every((item) => !item.loading && !item.error);
  const consistent = consistencyReady && allCount === statusTotal;
  const loading = values.some((item) => item.loading);

  return <div dir="rtl" className="space-y-5 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">مركز الفواتير الموحد</h1>
        <p className="mt-1 text-sm text-slate-500">بوابة واحدة لكل صفحات الفواتير الحالية، مع عدادات موحدة من نفس مصدر البيانات.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="gap-2" disabled={loading} onClick={() => qc.invalidateQueries({ queryKey: ['invoice-center'] })}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تحديث
        </Button>
        {canEnterInvoice && <Button asChild><Link to="/invoices/new"><FilePlus2 className="ml-2 h-4 w-4" /> فاتورة جديدة</Link></Button>}
      </div>
    </div>

    <Card className={`border p-4 ${!consistencyReady ? 'border-amber-200 bg-amber-50' : consistent ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
      <div className="flex items-center gap-3">
        {!consistencyReady ? <RefreshCw className="h-6 w-6 animate-spin text-amber-600" /> : consistent ? <CheckCircle2 className="h-6 w-6 text-emerald-600" /> : <AlertTriangle className="h-6 w-6 text-red-600" />}
        <div>
          <p className="font-bold text-slate-900">{!consistencyReady ? 'جاري فحص اتساق الحالات' : consistent ? 'إجمالي الفواتير متطابق مع مجموع الحالات' : 'يوجد فرق بين الإجمالي ومجموع الحالات'}</p>
          <p className="mt-1 text-xs text-slate-600">الإجمالي: {fmt(allCount)} — مجموع الحالات: {fmt(statusTotal)}{consistent ? '' : ` — الفرق: ${fmt(allCount - statusTotal)}`}</p>
        </div>
      </div>
    </Card>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {values.map((item) => {
        const Icon = item.icon;
        return <Link key={item.key} to={item.path} className="block">
          <Card className={`h-full p-4 transition hover:-translate-y-0.5 hover:shadow-md ${item.error ? 'border-red-200' : item.danger && item.count ? 'border-amber-200 bg-amber-50/40' : item.warning && item.count ? 'border-orange-200 bg-orange-50/40' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-sm font-semibold text-slate-600">{item.label}</p><p className="mt-2 text-3xl font-bold text-slate-900">{item.loading ? '…' : item.error ? '!' : fmt(item.count)}</p>{item.error && <p className="mt-2 text-xs text-red-600">{item.error}</p>}</div>
              <div className="rounded-xl bg-white p-2.5 shadow-sm"><Icon className="h-5 w-5 text-teal-700" /></div>
            </div>
          </Card>
        </Link>;
      })}
    </div>

    <div>
      <h2 className="mb-3 text-lg font-bold text-slate-900">صفحات وأدوات الفواتير</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {PAGE_LINKS.filter((item) => item.path !== '/invoices/new' || canEnterInvoice).map((item) => {
          const Icon = item.icon;
          return <Card key={item.path} className="p-4">
            <div className="flex items-start gap-3"><div className="rounded-xl bg-teal-50 p-2.5"><Icon className="h-5 w-5 text-teal-700" /></div><div><h3 className="font-bold text-slate-900">{item.label}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p></div></div>
            <Button asChild variant="outline" size="sm" className="mt-4 w-full"><Link to={item.path}>فتح الصفحة</Link></Button>
          </Card>;
        })}
      </div>
    </div>
  </div>;
}
