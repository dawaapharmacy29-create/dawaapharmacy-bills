import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { base44, performanceApi } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { getInvoiceNetAmount } from '@/lib/purchaseCalculations';

const BRANCHES = ['دواء شكري', 'دواء الشامي'];
const money = (value) => Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 0 });

async function loadAllInvoices({ branch, from, to }) {
  const pageSize = 200;
  const first = await performanceApi.invoices({ branch, date_from: from, date_to: to, page: 1, page_size: pageSize, sort_by: 'invoice_date', sort_direction: 'desc' });
  const rows = [...(first?.rows || [])];
  const totalPages = Number(first?.total_pages || 1);
  for (let page = 2; page <= totalPages; page += 1) {
    const result = await performanceApi.invoices({ branch, date_from: from, date_to: to, page, page_size: pageSize, sort_by: 'invoice_date', sort_direction: 'desc' });
    rows.push(...(result?.rows || []));
  }
  return rows;
}

function dayKey(value) {
  return typeof value === 'string' ? value.slice(0, 10) : '';
}

function shortLabel(value) {
  const parts = String(value || '').split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : value;
}

/**
 * Daily sales-vs-purchases trend for the selected period/branch.
 * Sales: ShiftDelivery.total_sales grouped by shift_date.
 * Purchases: purchase invoices net amount (after exclusions) grouped by invoice_date,
 * using the same getInvoiceNetAmount used across the app so totals match other pages.
 */
export default function SalesTrendChart({ dateFrom, dateTo, branch = 'all' }) {
  const invoicesQuery = useQuery({
    queryKey: ['sales-trend-invoices', branch, dateFrom, dateTo],
    queryFn: () => loadAllInvoices({ branch, from: dateFrom, to: dateTo }),
    staleTime: 30000,
  });
  const suppliersQuery = useQuery({ queryKey: ['suppliers'], queryFn: () => base44.entities.Supplier.list(), staleTime: 60000 });
  const shiftsQuery = useQuery({
    queryKey: ['sales-trend-shifts', dateFrom, dateTo],
    queryFn: () => base44.entities.ShiftDelivery.list('-shift_date', 5000),
    staleTime: 30000,
  });

  const chartData = useMemo(() => {
    const invoices = invoicesQuery.data || [];
    const suppliers = suppliersQuery.data || [];
    const shifts = shiftsQuery.data || [];
    const branches = branch === 'all' ? BRANCHES : [branch];

    const byDay = new Map();
    let cursor = dateFrom;
    while (cursor <= dateTo) {
      byDay.set(cursor, { date: cursor, sales: 0, purchases: 0 });
      const [y, m, d] = cursor.split('-').map(Number);
      const next = new Date(y, m - 1, d + 1);
      cursor = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    }

    invoices.forEach((invoice) => {
      const key = dayKey(invoice.invoice_date);
      const row = byDay.get(key);
      if (row) row.purchases += getInvoiceNetAmount(invoice, suppliers);
    });

    shifts.filter((s) => branches.includes(s.branch) && s.shift_date >= dateFrom && s.shift_date <= dateTo).forEach((s) => {
      const row = byDay.get(dayKey(s.shift_date));
      if (row) row.sales += Number(s.total_sales || 0);
    });

    return Array.from(byDay.values()).map((row) => ({ ...row, label: shortLabel(row.date) }));
  }, [invoicesQuery.data, suppliersQuery.data, shiftsQuery.data, dateFrom, dateTo, branch]);

  const isLoading = invoicesQuery.isLoading || shiftsQuery.isLoading;
  const isError = invoicesQuery.isError || shiftsQuery.isError;
  const tooManyDays = chartData.length > 62;

  return (
    <Card className="space-y-3 p-5">
      <div>
        <h2 className="font-bold text-gray-800">اتجاه المبيعات والمشتريات اليومي</h2>
        <p className="text-xs text-gray-500">{branch === 'all' ? 'كل الفروع مجمّعة' : branch} — من {dateFrom} إلى {dateTo}</p>
      </div>
      {isError && <p className="text-sm text-red-600">تعذر تحميل بيانات الاتجاه.</p>}
      {isLoading ? (
        <p className="p-10 text-center text-sm text-gray-500">جاري رسم الاتجاه...</p>
      ) : tooManyDays ? (
        <p className="p-6 text-center text-sm text-gray-500">الفترة طويلة جدًا لعرض اتجاه يومي واضح (أكثر من 62 يوم). اختر فترة أقصر لعرض الرسم البياني.</p>
      ) : (
        <div className="h-72 w-full" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} reversed />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => `${money(value)} ج`} labelFormatter={(label, payload) => payload?.[0]?.payload?.date || label} />
              <Legend formatter={(value) => (value === 'sales' ? 'المبيعات' : 'المشتريات')} />
              <Area type="monotone" dataKey="sales" fill="#10b98122" stroke="#10b981" strokeWidth={2} name="sales" />
              <Line type="monotone" dataKey="purchases" stroke="#2563eb" strokeWidth={2} dot={false} name="purchases" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
