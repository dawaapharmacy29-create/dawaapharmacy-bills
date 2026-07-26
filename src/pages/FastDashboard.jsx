import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Ban, Calendar, FileText, GitBranch, Package, Pencil, Receipt, RefreshCw, Stethoscope, TrendingUp, Wallet } from 'lucide-react';
import { base44, performanceApi } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { useUserRole } from '@/lib/useUserRole';
import BranchSelector from '@/components/dashboard/BranchSelector';
import DailyProgressIndicator from '@/components/dashboard/DailyProgressIndicator';

const BRANCHES = ['دواء الشامي', 'دواء شكري'];
const fmt = (value) => Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 0 });

function cycleDates(reference = new Date()) {
  const y = reference.getFullYear();
  const m = reference.getMonth();
  const day = reference.getDate();
  const start = day >= 26 ? new Date(y, m, 26) : new Date(y, m - 1, 26);
  const end = day >= 26 ? new Date(y, m + 1, 25) : new Date(y, m, 25);
  const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { from: iso(start), to: iso(end) };
}

function Stat({ label, value, suffix = 'ج', icon: Icon, className = '' }) {
  return <Card className={`p-4 ${className}`}><div className="flex items-center gap-3"><div className="rounded-xl bg-gray-50 p-2.5"><Icon className="h-5 w-5 text-teal-700" /></div><div><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-xl font-bold text-gray-900">{value}{suffix && ` ${suffix}`}</p></div></div></Card>;
}

export default function FastDashboard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isAdmin } = useUserRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const branch = searchParams.get('branch') || 'all';
  const initialCycle = useMemo(() => cycleDates(), []);
  const [dateFrom, setDateFrom] = useState(initialCycle.from);
  const [dateTo, setDateTo] = useState(initialCycle.to);
  const [editingTargets, setEditingTargets] = useState(false);
  const [targetInputs, setTargetInputs] = useState({ 'دواء الشامي': '', 'دواء شكري': '' });
  const month = dateTo.slice(0, 7);

  const setBranch = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value === 'all') next.delete('branch'); else next.set('branch', value);
    setSearchParams(next, { replace: true });
  };

  const query = useQuery({
    queryKey: ['fast-dashboard-summary', branch, dateFrom, dateTo, month],
    queryFn: () => performanceApi.dashboard({ branch, date_from: dateFrom, date_to: dateTo, month }),
    staleTime: 30000,
    retry: 1,
  });
  const data = query.data || {};
  const targetPercent = Number(data.target_amount || 0) > 0 ? Math.round((Number(data.total_payments || 0) / Number(data.target_amount)) * 100) : 0;

  const openTargetEditor = () => {
    setTargetInputs({
      'دواء الشامي': String(data.branch_targets?.['دواء الشامي'] || ''),
      'دواء شكري': String(data.branch_targets?.['دواء شكري'] || ''),
    });
    setEditingTargets(true);
  };

  const saveTargets = useMutation({
    mutationFn: async () => {
      const all = await base44.entities.TargetGoal.list();
      const branchesToSave = branch === 'all' ? BRANCHES : [branch];
      for (const item of branchesToSave) {
        const amount = Number(targetInputs[item]);
        if (!Number.isFinite(amount) || amount < 0) throw new Error(`قيمة هدف ${item} غير صحيحة`);
        const existing = all.find((goal) => goal.month === month && goal.branch === item && (goal.goal_type || 'sales') === 'sales');
        const payload = { label: `الهدف الشهري - ${item}`, target_amount: amount, month, branch: item, goal_type: 'sales', cycle_start: dateFrom, cycle_end: dateTo };
        if (existing) await base44.entities.TargetGoal.update(existing.id, payload); else await base44.entities.TargetGoal.create(payload);
      }
    },
    onSuccess: () => {
      setEditingTargets(false);
      qc.invalidateQueries({ queryKey: ['fast-dashboard-summary'] });
      qc.invalidateQueries({ queryKey: ['target-goals'] });
      toast({ title: 'تم حفظ التارجت بنجاح' });
    },
    onError: (error) => toast({ title: 'تعذر حفظ التارجت', description: error.message, variant: 'destructive' }),
  });

  return (
    <div dir="rtl" className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-gray-900">الصفحة الرئيسية</h1><p className="mt-1 text-sm text-gray-500">داشبورد سريع محسوب داخل Supabase — الدورة الافتراضية من 26 إلى 25.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching} className="gap-2"><RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} /> تحديث</Button><Button asChild variant="outline"><Link to="/dashboard/advanced">التحليل التفصيلي</Link></Button></div>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1"><BranchSelector value={branch} onChange={setBranch} /></div>
          <div><label className="mb-1 block text-xs text-gray-500">من</label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
          <div><label className="mb-1 block text-xs text-gray-500">إلى</label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
          <Button variant="outline" onClick={() => { const cycle = cycleDates(); setDateFrom(cycle.from); setDateTo(cycle.to); }} className="gap-2"><Calendar className="h-4 w-4" /> دورة 26–25</Button>
        </div>
      </Card>

      {query.isLoading ? <Card className="p-16 text-center text-gray-500">جاري تحميل ملخص الداشبورد...</Card> : query.isError ? <Card className="border-red-200 p-8 text-center text-red-700"><p>تعذر تحميل الداشبورد: {query.error?.message}</p><Button className="mt-3" onClick={() => query.refetch()}>إعادة المحاولة</Button></Card> : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="عدد الفواتير" value={fmt(data.invoice_count)} suffix="فاتورة" icon={FileText} />
          <Stat label="إجمالي المشتريات" value={fmt(data.gross_purchases)} icon={TrendingUp} />
          <Stat label="صافي المشتريات" value={fmt(data.net_purchases)} icon={Package} />
          <Stat label="إجمالي المستثنى" value={fmt(data.excluded_purchases)} icon={Ban} className={Number(data.excluded_purchases) ? 'border-red-200' : ''} />
          <Stat label="مشتريات الكاش" value={fmt(data.cash_purchases)} icon={Wallet} />
          <Stat label="المصروفات" value={fmt(data.expenses)} icon={Receipt} />
          <Stat label="المرتجعات" value={fmt(data.returned_value)} icon={GitBranch} />
          <Stat label="انتظار المراجعة" value={fmt(data.pending_count)} suffix="فاتورة" icon={AlertTriangle} className={Number(data.pending_count) ? 'border-amber-200 bg-amber-50/30' : ''} />
        </div>

        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-sm font-semibold text-gray-500">التارجت {branch === 'all' ? 'الكلي' : branch}</p><p className="mt-1 text-3xl font-bold">{fmt(data.target_amount)} ج</p><p className="mt-1 text-sm text-gray-500">المنفذ: {fmt(data.total_payments)} ج — النسبة: {targetPercent}%</p></div>
            {isAdmin && !editingTargets && <Button variant="outline" onClick={openTargetEditor} className="gap-2"><Pencil className="h-4 w-4" /> تعديل التارجت</Button>}
          </div>
          <div className="mt-4"><DailyProgressIndicator startDate={dateFrom} endDate={dateTo} currentAmount={Number(data.total_payments || 0)} targetAmount={Number(data.target_amount || 0)} height="h-4" /></div>
          {branch === 'all' && <div className="mt-4 grid gap-2 md:grid-cols-2">{BRANCHES.map((item) => <div key={item} className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">{item}</p><p className="mt-1 font-bold">{fmt(data.branch_targets?.[item])} ج</p></div>)}</div>}
          {editingTargets && <div className="mt-4 space-y-3 rounded-xl border bg-gray-50 p-4"><div className="grid gap-3 md:grid-cols-2">{(branch === 'all' ? BRANCHES : [branch]).map((item) => <div key={item}><label className="mb-1 block text-xs font-semibold">هدف {item}</label><Input type="number" min="0" value={targetInputs[item]} onChange={(e) => setTargetInputs((old) => ({ ...old, [item]: e.target.value }))} /></div>)}</div>{branch === 'all' && <p className="text-sm font-semibold text-teal-700">الإجمالي المتوقع: {fmt(Number(targetInputs['دواء الشامي'] || 0) + Number(targetInputs['دواء شكري'] || 0))} ج</p>}<div className="flex gap-2"><Button onClick={() => saveTargets.mutate()} disabled={saveTargets.isPending} className="bg-teal-600 hover:bg-teal-700">{saveTargets.isPending ? 'جاري الحفظ...' : 'حفظ'}</Button><Button variant="outline" onClick={() => setEditingTargets(false)}>إلغاء</Button></div></div>}
        </Card>

        <div className="grid gap-3 md:grid-cols-3">
          <Stat label="مشتريات الأدوية" value={fmt(data.medicines_purchases)} icon={Stethoscope} />
          <Stat label="المستلزمات والإكسسوار" value={fmt(data.supplies_accessories_purchases)} icon={Package} />
          <Stat label="غير مصنفة" value={fmt(data.unclassified_purchases)} icon={AlertTriangle} className={Number(data.unclassified_purchases) ? 'border-amber-200' : ''} />
        </div>
      </>}
    </div>
  );
}