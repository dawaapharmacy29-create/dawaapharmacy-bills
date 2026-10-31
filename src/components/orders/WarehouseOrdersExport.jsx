import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { buildWarehouseOrderReport } from './warehouseOrderReport';

export default function WarehouseOrdersExport({ orders = [] }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [branch, setBranch] = useState('all');
  const report = useMemo(() => buildWarehouseOrderReport(orders, { from, to, branch }), [orders, from, to, branch]);
  const exportWorkbook = () => {
    if (!report.summary.length && !report.review.length) return;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.summary.length ? report.summary : [{ 'ملاحظة': 'لا توجد نواقص مؤكدة ضمن الفلاتر المختارة' }]), 'النواقص المؤكدة');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.review.length ? report.review : [{ 'ملاحظة': 'لا توجد طلبات تحتاج مراجعة' }]), 'تحتاج مراجعة');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.detail), 'تفاصيل الطلبات');
    XLSX.writeFile(workbook, `نواقص-العملاء-${from || 'الكل'}-${to || 'الكل'}.xlsx`);
  };
  return <section className="rounded-2xl border bg-white p-4 space-y-3" dir="rtl">
    <div className="flex flex-wrap justify-between gap-2 items-center">
      <div><h3 className="font-bold text-teal-800">تجميع نواقص العملاء للمخزن</h3><p className="text-xs text-slate-500">الملف يجمع الكميات المتبقية للصنف والوحدة، ويستبعد الطلبات الملغاة والبدائل المقبولة.</p></div>
      <Button type="button" className="bg-teal-600 gap-2" disabled={!report.summary.length && !report.review.length} onClick={exportWorkbook}><Download className="h-4 w-4"/> تحميل Excel</Button>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <label className="text-xs font-semibold">من موعد<input type="date" className="mt-1 w-full h-10 border rounded-lg px-2" value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label className="text-xs font-semibold">حتى موعد<input type="date" className="mt-1 w-full h-10 border rounded-lg px-2" value={to} onChange={e=>setTo(e.target.value)}/></label>
      <label className="text-xs font-semibold">الفرع<select value={branch} onChange={e=>setBranch(e.target.value)} className="mt-1 w-full h-10 border rounded-lg px-2"><option value="all">كل الفروع المتاحة لحسابك</option><option value="دواء شكري">شكري</option><option value="دواء الشامي">الشامي</option></select></label>
    </div>
    <p className="text-sm">{report.summary.length} صنف مؤكد · {report.detail.length} طلب جاهز · {report.review.length} طلب يحتاج مراجعة</p>
    {report.missingQuantity.length > 0 && <p role="alert" className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">يوجد {report.missingQuantity.length} طلب يحتاج مراجعة. يمكن تنزيل Excel الآن: النواقص المؤكدة فقط صالحة للتجهيز، والطلبات غير المكتملة في صفحة منفصلة، ولا تُضاف كمياتها للمجموع. التقرير جزئي حتى استكمال المراجعة.</p>}
    {report.summary.length === 0 && report.missingQuantity.length === 0 && <p className="text-xs text-slate-500">لا توجد طلبات قابلة للتجميع في هذه الفترة.</p>}
  </section>;
}
