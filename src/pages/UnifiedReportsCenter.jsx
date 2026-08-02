import { Link } from 'react-router-dom';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Building2, FileSpreadsheet, RefreshCw, Scale, TrendingUp, WalletCards, Receipt, CheckCircle2, AlertTriangle } from 'lucide-react';
import { performanceApi, errorText } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const fmt = (value) => Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 });

const REPORT_LINKS = [
  { path: '/reports', title: 'التقارير الإجمالية', description: 'ملخص المشتريات والفواتير والمؤشرات الرئيسية.', icon: FileSpreadsheet },
  { path: '/reports-branch', title: 'تقارير الفروع', description: 'تفاصيل كل فرع بصورة منفصلة.', icon: Building2 },
  { path: '/branch-performance', title: 'مقارنة وكفاءة الفروع', description: 'مقارنة الأداء والكفاءة بين الفروع.', icon: TrendingUp },
  { path: '/sales-purchases-report', title: 'المبيعات مقابل المشتريات', description: 'مقارنة حركة المبيعات بالمشتريات.', icon: Scale },
  { path: '/supplier-balances', title: 'أرصدة الموردين', description: 'متابعة الرصيد والحركة لكل مورد.', icon: WalletCards },
  { path: '/expenses', title: 'تقرير المصروفات', description: 'مراجعة المصروفات والحركات التشغيلية.', icon: Receipt },
];

export default function UnifiedReportsCenter() {
  const qc = useQueryClient();
  const queries = useQueries({ queries: [
    { queryKey: ['reports-center', 'all'], queryFn: () => performanceApi.dashboard({ branch: 'all' }), staleTime: 30000, retry: 1 },
    { queryKey: ['reports-center', 'shamy'], queryFn: () => performanceApi.dashboard({ branch: 'دواء الشامي' }), staleTime: 30000, retry: 1 },
    { queryKey: ['reports-center', 'shokry'], queryFn: () => performanceApi.dashboard({ branch: 'دواء شكري' }), staleTime: 30000, retry: 1 },
  ] });

  const all = queries[0].data || {};
  const shamy = queries[1].data || {};
  const shokry = queries[2].data || {};
  const loading = queries.some((item) => item.isFetching);
  const error = queries.find((item) => item.isError)?.error;
  const allCount = Number(all.invoice_count || 0);
  const branchesCount = Number(shamy.invoice_count || 0) + Number(shokry.invoice_count || 0);
  const countMatched = !loading && !error && allCount === branchesCount;
  const allValue = Number(all.total_value || all.total_purchases || 0);
  const branchesValue = Number(shamy.total_value || shamy.total_purchases || 0) + Number(shokry.total_value || shokry.total_purchases || 0);
  const valueMatched = !loading && !error && Math.abs(allValue - branchesValue) < 0.01;

  return <div dir="rtl" className="space-y-5 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-slate-900">مركز التقارير ومقارنة الفروع</h1><p className="mt-1 text-sm text-slate-500">واجهة موحدة للوصول إلى التقارير الحالية مع فحص اتساق بيانات الفروع، بدون تعديل البيانات.</p></div>
      <Button variant="outline" className="gap-2" disabled={loading} onClick={() => qc.invalidateQueries({ queryKey: ['reports-center'] })}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تحديث</Button>
    </div>

    {error && <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">تعذر تحميل أحد ملخصات الفروع: {errorText(error)}</Card>}

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card className="p-5"><p className="text-xs text-slate-500">إجمالي الفواتير</p><p className="mt-2 text-3xl font-bold">{loading ? '…' : fmt(allCount)}</p></Card>
      <Card className="p-5"><p className="text-xs text-slate-500">إجمالي المشتريات</p><p className="mt-2 text-3xl font-bold">{loading ? '…' : `${fmt(allValue)} ج`}</p></Card>
      <Card className={`p-5 ${countMatched ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}><div className="flex items-center gap-3">{countMatched ? <CheckCircle2 className="h-6 w-6 text-emerald-600" /> : <AlertTriangle className="h-6 w-6 text-amber-600" />}<div><p className="text-xs text-slate-500">اتساق عدد الفواتير</p><p className="mt-1 font-bold">{loading ? 'جاري الفحص' : countMatched ? 'متطابق' : `فرق ${fmt(allCount - branchesCount)}`}</p></div></div></Card>
      <Card className={`p-5 ${valueMatched ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}><div className="flex items-center gap-3">{valueMatched ? <CheckCircle2 className="h-6 w-6 text-emerald-600" /> : <AlertTriangle className="h-6 w-6 text-amber-600" />}<div><p className="text-xs text-slate-500">اتساق قيمة المشتريات</p><p className="mt-1 font-bold">{loading ? 'جاري الفحص' : valueMatched ? 'متطابق' : `فرق ${fmt(allValue - branchesValue)} ج`}</p></div></div></Card>
    </div>

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {REPORT_LINKS.map((item) => { const Icon = item.icon; return <Card key={item.path} className="p-5"><div className="flex items-start gap-3"><div className="rounded-xl bg-teal-50 p-3"><Icon className="h-5 w-5 text-teal-700" /></div><div><h2 className="font-bold text-slate-900">{item.title}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p></div></div><Button asChild variant="outline" className="mt-4 w-full"><Link to={item.path}>فتح التقرير</Link></Button></Card>; })}
    </div>

    <Card className="p-4 text-sm text-slate-600"><div className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-teal-700" /><p>كل التقارير القديمة ما زالت موجودة وتعمل؛ المركز يجمعها فقط ويكشف اختلاف إجمالي الفروع مبكرًا.</p></div></Card>
  </div>;
}
