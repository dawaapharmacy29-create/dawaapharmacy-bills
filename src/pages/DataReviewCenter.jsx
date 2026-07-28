import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Database, Download, Receipt, RotateCcw, Users, Wallet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { normalizeText } from '@/lib/dataIntegrity';

const SOURCES = [
  { key: 'suppliers', entity: 'Supplier', label: 'الموردون' },
  { key: 'invoices', entity: 'PurchaseInvoice', label: 'فواتير الشراء' },
  { key: 'returns', entity: 'Return', label: 'المرتجعات' },
  { key: 'shifts', entity: 'ShiftDelivery', label: 'تسليمات الشيفت' },
  { key: 'expenses', entity: 'Expense', label: 'المصروفات' },
  { key: 'orders', entity: 'PharmacyOrder', label: 'طلبات الصيدليات' },
];

function IssueCard({ title, count, icon: Icon, text, danger = false }) {
  return <Card className={`border p-4 ${danger && count ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
    <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Icon className="h-5 w-5 text-teal-700"/><h3 className="font-bold">{title}</h3></div><Badge variant="outline">{count}</Badge></div>
    <p className="mt-2 text-xs leading-6 text-slate-500">{text}</p>
  </Card>;
}

export default function DataReviewCenter() {
  const results = useQueries({ queries: SOURCES.map((source) => ({ queryKey: ['data-review', source.entity], queryFn: () => base44.entities[source.entity].list('-created_date', 5000, 0), staleTime: 60000, retry: 1 })) });
  const loading = results.some((q) => q.isLoading);
  const available = Object.fromEntries(SOURCES.map((source, index) => [source.key, results[index]?.data || []]));
  const failedSources = SOURCES.filter((source, index) => results[index]?.isError).map((source) => source.label);

  const audit = useMemo(() => {
    const invoiceGroups = Object.values((available.invoices || []).reduce((acc, invoice) => {
      const number = normalizeText(invoice.supplier_invoice_number);
      if (!number) return acc;
      const key = [normalizeText(invoice.supplier_name), normalizeText(invoice.branch), number].join('|');
      (acc[key] ||= []).push(invoice);
      return acc;
    }, {})).filter((group) => group.length > 1);

    const supplierIssues = (available.suppliers || []).filter((x) => !x.name || !x.supplier_type || !x.default_purchase_category || x.default_purchase_category === 'none');
    const invoiceIssues = (available.invoices || []).filter((x) => !x.invoice_date || !x.branch || !x.supplier_name || Number(x.total_value || 0) <= 0);
    const pendingReturns = (available.returns || []).filter((x) => ['pending','under review','approved','قيد المراجعة'].includes(String(x.status || '').toLowerCase()));
    const shiftIssues = (available.shifts || []).filter((x) => !x.branch || !x.shift_date || !x.shift_type || !x.submitted_by || Number(x.total_sales || 0) <= 0);
    const expenseIssues = (available.expenses || []).filter((x) => !x.branch || !x.expense_date || !x.category || Number(x.amount || 0) <= 0);
    const orderIssues = (available.orders || []).filter((x) => !x.branch || !(x.product_name || x.item_name || x.name));

    const rows = [
      ...invoiceGroups.flatMap((group) => group.map((x) => ({ category: 'فاتورة محتملة التكرار', id: x.id, name: x.supplier_name, details: `${x.supplier_invoice_number || ''} | ${x.branch || ''}` }))),
      ...supplierIssues.map((x) => ({ category: 'بيانات مورد ناقصة', id: x.id, name: x.name, details: 'نوع المورد أو تصنيف الشراء غير مكتمل' })),
      ...invoiceIssues.map((x) => ({ category: 'فاتورة ناقصة البيانات', id: x.id, name: x.supplier_name, details: `${x.branch || 'بدون فرع'} | ${x.invoice_date || 'بدون تاريخ'}` })),
      ...pendingReturns.map((x) => ({ category: 'مرتجع مفتوح', id: x.id, name: x.supplier_name, details: `${x.return_number || ''} | ${x.status || ''}` })),
      ...shiftIssues.map((x) => ({ category: 'تسليم شيفت ناقص', id: x.id, name: x.submitted_by, details: `${x.branch || 'بدون فرع'} | ${x.shift_date || 'بدون تاريخ'}` })),
      ...expenseIssues.map((x) => ({ category: 'مصروف ناقص البيانات', id: x.id, name: x.category, details: `${x.branch || 'بدون فرع'} | ${x.amount || 0}` })),
      ...orderIssues.map((x) => ({ category: 'طلب ناقص البيانات', id: x.id, name: x.product_name || x.item_name, details: x.branch || 'بدون فرع' })),
    ];
    return { invoiceGroups, supplierIssues, invoiceIssues, pendingReturns, shiftIssues, expenseIssues, orderIssues, rows };
  }, [available.expenses, available.invoices, available.orders, available.returns, available.shifts, available.suppliers]);

  const exportAudit = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(audit.rows), 'مراجعة البيانات');
    XLSX.writeFile(wb, `مراجعة-بيانات-دواء-${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  if (loading) return <div dir="rtl" className="p-10 text-center text-slate-500">جاري فحص البيانات الحالية...</div>;
  return <div dir="rtl" className="space-y-5 p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">مركز مراجعة البيانات</h1><p className="mt-1 text-sm text-slate-500">فحص آمن للبيانات المتاحة في Supabase بدون حذف أو تعديل تلقائي.</p></div><Button onClick={exportAudit} disabled={!audit.rows.length} className="gap-2"><Download className="h-4 w-4"/>تصدير نتائج المراجعة</Button></div>
    {failedSources.length > 0 && <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><div className="flex gap-2"><AlertTriangle className="h-5 w-5 shrink-0"/><div><p className="font-bold">تم تحميل جزء من البيانات بنجاح</p><p className="mt-1">المصادر غير المتاحة حاليًا: {failedSources.join('، ')}. باقي الفحص مستمر بدل إيقاف الصفحة بالكامل.</p></div></div></Card>}
    <Card className="p-5"><div className="flex items-center gap-3">{audit.rows.length ? <AlertTriangle className="h-9 w-9 text-amber-500"/> : <CheckCircle2 className="h-9 w-9 text-emerald-500"/>}<div><p className="text-lg font-bold">{audit.rows.length ? `${audit.rows.length} سجل يحتاج مراجعة` : 'لا توجد مشاكل ظاهرة في البيانات المتاحة'}</p><p className="text-sm text-slate-500">قد يظهر السجل أكثر من مرة إذا كان يحمل أكثر من مشكلة.</p></div></div></Card>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <IssueCard title="فواتير محتملة التكرار" count={audit.invoiceGroups.length} icon={Receipt} text="نفس المورد والفرع ورقم فاتورة المورد." danger />
      <IssueCard title="فواتير ناقصة البيانات" count={audit.invoiceIssues.length} icon={Receipt} text="فاتورة بدون تاريخ أو فرع أو مورد أو قيمة صحيحة." danger />
      <IssueCard title="موردون يحتاجون استكمال" count={audit.supplierIssues.length} icon={Database} text="نوع المورد أو تصنيف الشراء غير مكتمل." />
      <IssueCard title="مرتجعات مفتوحة" count={audit.pendingReturns.length} icon={RotateCcw} text="مرتجعات ما زالت قيد المراجعة أو لم تغلق." />
      <IssueCard title="تسليمات شيفت ناقصة" count={audit.shiftIssues.length} icon={Users} text="فرع أو تاريخ أو نوع شيفت أو مبيعات أو اسم المسلّم ناقص." danger />
      <IssueCard title="مصروفات ناقصة البيانات" count={audit.expenseIssues.length} icon={Wallet} text="مصروف بدون فرع أو تاريخ أو بند أو قيمة صحيحة." />
    </div>
  </div>;
}