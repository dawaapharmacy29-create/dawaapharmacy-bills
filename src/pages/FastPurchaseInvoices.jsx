import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, FilePlus2, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import { performanceApi } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

const BRANCHES = ['دواء الشامي', 'دواء شكري'];
const fmt = (value) => Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 });
const statusLabels = { draft: 'مسودة', submitted: 'بانتظار المراجعة', reviewed: 'تمت المراجعة', returned: 'مرتجعة للتصحيح', approved: 'معتمدة' };

export default function FastPurchaseInvoices() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState('50');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [branch, setBranch] = useState('all');
  const [workflow, setWorkflow] = useState('all');
  const [payment, setPayment] = useState('all');
  const [category, setCategory] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');

  const params = useMemo(() => ({
    page,
    page_size: Number(pageSize),
    search,
    branch,
    workflow_status: workflow,
    payment_type: payment,
    purchase_category: category,
    date_from: dateFrom,
    date_to: dateTo,
    sort_by: sortBy,
    sort_direction: sortDirection,
  }), [page, pageSize, search, branch, workflow, payment, category, dateFrom, dateTo, sortBy, sortDirection]);

  const query = useQuery({
    queryKey: ['fast-purchase-invoices', params],
    queryFn: () => performanceApi.invoices(params),
    placeholderData: (previous) => previous,
    staleTime: 30000,
    retry: 1,
  });

  const result = query.data || { rows: [], total: 0, total_pages: 1 };
  const rows = result.rows || [];

  const applySearch = (event) => {
    event?.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const resetFilters = () => {
    setPage(1); setSearch(''); setSearchInput(''); setBranch('all'); setWorkflow('all'); setPayment('all'); setCategory('all'); setDateFrom(''); setDateTo(''); setSortBy('created_at'); setSortDirection('desc');
  };

  const toggleNumberSort = () => {
    setPage(1);
    if (sortBy === 'system_invoice_number') setSortDirection((old) => old === 'asc' ? 'desc' : 'asc');
    else { setSortBy('system_invoice_number'); setSortDirection('asc'); }
  };

  return (
    <div dir="rtl" className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">فواتير الشراء</h1>
          <p className="mt-1 text-sm text-gray-500">قائمة سريعة من الخادم — يتم تحميل الصفحة المطلوبة فقط.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching} className="gap-2"><RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} /> تحديث</Button>
          <Button asChild variant="outline"><Link to="/invoices/manage">الإدارة المتقدمة</Link></Button>
          <Button asChild className="gap-2 bg-teal-600 hover:bg-teal-700"><Link to="/invoices/new"><FilePlus2 className="h-4 w-4" /> فاتورة جديدة</Link></Button>
        </div>
      </div>

      <Card className="space-y-3 p-4">
        <form onSubmit={applySearch} className="flex flex-col gap-2 md:flex-row">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="رقم الفاتورة، رقم المورد، المورد أو اسم الدكتور..." className="pr-10" />
          </div>
          <Button type="submit" className="bg-teal-600 hover:bg-teal-700">بحث</Button>
          <Button type="button" variant="outline" onClick={resetFilters}>مسح الفلاتر</Button>
        </form>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          <Select value={branch} onValueChange={(value) => { setBranch(value); setPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل الفروع</SelectItem>{BRANCHES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
          <Select value={workflow} onValueChange={(value) => { setWorkflow(value); setPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل حالات الدورة</SelectItem><SelectItem value="draft">مسودة</SelectItem><SelectItem value="submitted">بانتظار المراجعة</SelectItem><SelectItem value="reviewed">تمت المراجعة</SelectItem><SelectItem value="returned">مرتجعة</SelectItem><SelectItem value="approved">معتمدة</SelectItem></SelectContent></Select>
          <Select value={payment} onValueChange={(value) => { setPayment(value); setPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل طرق الدفع</SelectItem><SelectItem value="كاش">كاش</SelectItem><SelectItem value="آجل">آجل</SelectItem><SelectItem value="مختلط">مختلط</SelectItem><SelectItem value="انستا">انستا</SelectItem><SelectItem value="فودافون">فودافون</SelectItem></SelectContent></Select>
          <Select value={category} onValueChange={(value) => { setCategory(value); setPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل التصنيفات</SelectItem><SelectItem value="medicines">أدوية</SelectItem><SelectItem value="supplies_accessories">مستلزمات وإكسسوار</SelectItem><SelectItem value="unclassified">غير مصنفة</SelectItem></SelectContent></Select>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} aria-label="من تاريخ" />
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} aria-label="إلى تاريخ" />
          <Select value={pageSize} onValueChange={(value) => { setPageSize(value); setPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="25">25 في الصفحة</SelectItem><SelectItem value="50">50 في الصفحة</SelectItem><SelectItem value="100">100 في الصفحة</SelectItem><SelectItem value="200">200 في الصفحة</SelectItem></SelectContent></Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-gray-50 px-4 py-3 text-sm">
          <div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-gray-500" /><span>إجمالي النتائج: <strong>{Number(result.total || 0).toLocaleString('ar-EG')}</strong></span></div>
          <span className="text-xs text-gray-500">الصفحة {result.page || page} من {result.total_pages || 1}</span>
        </div>

        {query.isLoading ? <div className="p-12 text-center text-gray-500">جاري تحميل الفواتير...</div> : query.isError ? <div className="p-8 text-center text-red-700"><p>تعذر تحميل الفواتير: {query.error?.message}</p><Button className="mt-3" onClick={() => query.refetch()}>إعادة المحاولة</Button></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[950px] text-sm">
              <thead className="bg-white text-xs text-gray-500">
                <tr className="border-b">
                  <th className="p-3 text-right"><button onClick={toggleNumberSort} className="inline-flex items-center gap-1 font-semibold hover:text-teal-700">رقم الفاتورة {sortBy === 'system_invoice_number' && (sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />)}</button></th>
                  <th className="p-3 text-right">رقم المورد</th><th className="p-3 text-right">المورد</th><th className="p-3 text-right">الفرع</th><th className="p-3 text-right">التاريخ</th><th className="p-3 text-right">الإجمالي</th><th className="p-3 text-right">المرتجع</th><th className="p-3 text-right">الدفع</th><th className="p-3 text-right">مدخل الفاتورة</th><th className="p-3 text-right">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((invoice) => <tr key={invoice.id} className="border-b hover:bg-teal-50/40">
                  <td className="p-3 font-mono font-bold">{invoice.system_invoice_number || '—'}</td><td className="p-3 font-mono text-xs">{invoice.supplier_invoice_number || '—'}</td><td className="p-3 font-semibold">{invoice.supplier_name || 'بدون مورد'}</td><td className="p-3">{invoice.branch || '—'}</td><td className="p-3 whitespace-nowrap">{invoice.invoice_date || '—'}</td><td className="p-3 font-bold">{fmt(invoice.total_value)} ج</td><td className="p-3">{fmt(invoice.returned_value)} ج</td><td className="p-3">{invoice.payment_type || '—'}</td><td className="p-3">{invoice.entered_by_name || invoice.entered_by || '—'}</td><td className="p-3"><Badge variant="outline">{statusLabels[invoice.workflow_status] || invoice.status || '—'}</Badge></td>
                </tr>)}
                {!rows.length && <tr><td colSpan={10} className="p-12 text-center text-gray-400">لا توجد فواتير مطابقة للفلاتر الحالية.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t p-3">
          <Button variant="outline" disabled={page <= 1 || query.isFetching} onClick={() => setPage((old) => Math.max(1, old - 1))} className="gap-1"><ChevronRight className="h-4 w-4" /> السابق</Button>
          <span className="text-sm font-semibold">{page} / {result.total_pages || 1}</span>
          <Button variant="outline" disabled={page >= (result.total_pages || 1) || query.isFetching} onClick={() => setPage((old) => old + 1)} className="gap-1">التالي <ChevronLeft className="h-4 w-4" /></Button>
        </div>
      </Card>
    </div>
  );
}