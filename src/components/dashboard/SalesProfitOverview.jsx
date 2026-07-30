import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Wallet, PiggyBank, Percent } from 'lucide-react';
import { base44, performanceApi } from '@/api/base44Client';
import { Card } from '@/components/ui/card';

const BRANCHES = ['دواء شكري', 'دواء الشامي'];
const money = (value) => Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 0 });

function marginColor(margin) {
  if (margin >= 25) return 'text-emerald-600';
  if (margin >= 10) return 'text-amber-600';
  return 'text-red-600';
}

/**
 * Sales vs purchases vs estimated profit, per branch and combined.
 * Sales come from ShiftDelivery.total_sales (already the source of truth used
 * elsewhere in the app, e.g. SalesPurchasesReport). Purchases/expenses reuse
 * the same backend dashboard summary as the rest of the home page so the
 * numbers always match.
 *
 * Profit here is an ESTIMATE: sales - net purchases - expenses. There is no
 * per-item cost of goods in the data model, so this is a cash-flow proxy,
 * not a true margin. We label it accordingly in the UI.
 */
export default function SalesProfitOverview({ dateFrom, dateTo, branch = 'all' }) {
  const shiftsQuery = useQuery({
    queryKey: ['sales-overview-shifts', dateFrom, dateTo],
    queryFn: () => base44.entities.ShiftDelivery.list('-shift_date', 5000),
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const perBranchQuery = useQuery({
    queryKey: ['sales-overview-per-branch-purchases', dateFrom, dateTo],
    queryFn: async () => {
      const [shokri, shami] = await Promise.all([
        performanceApi.dashboard({ branch: 'دواء شكري', date_from: dateFrom, date_to: dateTo }),
        performanceApi.dashboard({ branch: 'دواء الشامي', date_from: dateFrom, date_to: dateTo }),
      ]);
      return { 'دواء شكري': shokri, 'دواء الشامي': shami };
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const rows = useMemo(() => {
    const shifts = shiftsQuery.data || [];
    const perBranch = perBranchQuery.data || {};
    return BRANCHES.map((name) => {
      const branchShifts = shifts.filter((s) => s.branch === name && s.shift_date >= dateFrom && s.shift_date <= dateTo);
      const sales = branchShifts.reduce((sum, s) => sum + Number(s.total_sales || 0), 0);
      const summary = perBranch[name] || {};
      const purchases = Number(summary.net_purchases || 0);
      const expenses = Number(summary.expenses || 0);
      const profit = sales - purchases - expenses;
      const margin = sales > 0 ? (profit / sales) * 100 : 0;
      return { name, sales, purchases, expenses, profit, margin, shiftsCount: branchShifts.length };
    });
  }, [shiftsQuery.data, perBranchQuery.data, dateFrom, dateTo]);

  const visible = branch === 'all' ? rows : rows.filter((r) => r.name === branch);
  const totals = visible.reduce((a, r) => ({
    sales: a.sales + r.sales,
    purchases: a.purchases + r.purchases,
    expenses: a.expenses + r.expenses,
    profit: a.profit + r.profit,
  }), { sales: 0, purchases: 0, expenses: 0, profit: 0 });
  const totalMargin = totals.sales > 0 ? (totals.profit / totals.sales) * 100 : 0;
  const isLoading = shiftsQuery.isLoading || perBranchQuery.isLoading;
  const isError = shiftsQuery.isError || perBranchQuery.isError;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold text-gray-800">المبيعات والربحية التقديرية</h2>
          <p className="text-xs text-gray-500">المبيعات من تسليمات الشيفت — الربح تقديري (مبيعات − صافي مشتريات − مصروفات)، وليس هامشًا محاسبيًا دقيقًا لعدم توفر تكلفة الصنف.</p>
        </div>
      </div>

      {isError && <p className="text-sm text-red-600">تعذر تحميل بيانات المبيعات، حاول تحديث الصفحة.</p>}

      {isLoading ? (
        <p className="p-6 text-center text-sm text-gray-500">جاري تحميل المبيعات...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl bg-green-50 p-3">
              <div className="flex items-center gap-2 text-green-700"><TrendingUp className="h-4 w-4" /><span className="text-xs">المبيعات</span></div>
              <p className="mt-1 text-lg font-bold text-green-800">{money(totals.sales)} ج</p>
            </div>
            <div className="rounded-xl bg-blue-50 p-3">
              <div className="flex items-center gap-2 text-blue-700"><Wallet className="h-4 w-4" /><span className="text-xs">المشتريات + المصروفات</span></div>
              <p className="mt-1 text-lg font-bold text-blue-800">{money(totals.purchases + totals.expenses)} ج</p>
            </div>
            <div className="rounded-xl bg-teal-50 p-3">
              <div className="flex items-center gap-2 text-teal-700"><PiggyBank className="h-4 w-4" /><span className="text-xs">الربح التقديري</span></div>
              <p className={`mt-1 text-lg font-bold ${totals.profit >= 0 ? 'text-teal-800' : 'text-red-600'}`}>{money(totals.profit)} ج</p>
            </div>
            <div className="rounded-xl bg-purple-50 p-3">
              <div className="flex items-center gap-2 text-purple-700"><Percent className="h-4 w-4" /><span className="text-xs">هامش الربح التقديري</span></div>
              <p className={`mt-1 text-lg font-bold ${marginColor(totalMargin)}`}>{totalMargin.toFixed(1)}%</p>
            </div>
          </div>

          {branch === 'all' && (
            <div className="grid gap-3 md:grid-cols-2">
              {rows.map((row) => (
                <div key={row.name} className="rounded-xl border p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-semibold text-gray-800">{row.name}</p>
                    <span className={`text-sm font-bold ${marginColor(row.margin)}`}>{row.margin.toFixed(1)}% هامش</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div><p className="text-gray-500">مبيعات</p><p className="font-bold text-green-700">{money(row.sales)} ج</p></div>
                    <div><p className="text-gray-500">مشتريات</p><p className="font-bold text-blue-700">{money(row.purchases)} ج</p></div>
                    <div><p className="text-gray-500">ربح تقديري</p><p className={`font-bold ${row.profit >= 0 ? 'text-teal-700' : 'text-red-600'}`}>{money(row.profit)} ج</p></div>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full bg-green-500" style={{ width: `${row.sales > 0 ? Math.min((row.purchases / row.sales) * 100, 100) : 0}%` }} />
                  </div>
                  {row.shiftsCount === 0 && <p className="mt-1 text-xs text-amber-600">لا توجد تسليمات شيفت مسجلة في هذه الفترة لهذا الفرع.</p>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
