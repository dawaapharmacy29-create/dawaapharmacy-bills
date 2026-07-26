import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { smartPurchaseApi } from '@/api/smartPurchaseApi';
import { Upload, Download, ShoppingCart, RefreshCw, FileSpreadsheet, AlertTriangle, PackageCheck } from 'lucide-react';

const aliases = {
  product_code: ['كود الصنف','كود','code','item code','product code'],
  product_name: ['اسم الصنف','الصنف','name','item name','product name'],
  current_stock: ['الرصيد الحالي','الرصيد','stock','current stock','balance'],
  sales_30: ['مبيعات 30 يوم','مبيعات 30','sales 30','sales_30','qty sold'],
  sales_60: ['مبيعات 60 يوم','مبيعات 60','sales 60','sales_60'],
  sales_90: ['مبيعات 90 يوم','مبيعات 90','sales 90','sales_90'],
  avg_daily_usage: ['متوسط الاستهلاك اليومي','متوسط الاستهلاك','avg daily usage','daily average'],
  old_discount: ['الخصم السابق','نسبة الخصم','discount','old discount'],
  last_purchase_price: ['آخر سعر شراء','سعر الشراء','purchase price','last purchase price'],
  preferred_supplier: ['المورد','المورد السابق','supplier','preferred supplier'],
  pending_incoming: ['كمية منتظر وصولها','منتظر وصول','pending incoming','incoming qty'],
};

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const number = (v) => {
  const n = Number(String(v ?? '').replace(/[,٪%جنيه]/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};
function findValue(row, key) {
  const keys = Object.keys(row);
  const candidates = aliases[key] || [key];
  const found = keys.find((k) => candidates.some((a) => norm(k) === norm(a)));
  return found ? row[found] : '';
}
function money(v) { return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(v || 0)); }

export default function SmartPurchaseCenter() {
  const [branch, setBranch] = useState('دواء الشامي');
  const [coverageDays, setCoverageDays] = useState(21);
  const [safetyDays, setSafetyDays] = useState(5);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState([]);
  const [imports, setImports] = useState([]);
  const [orders, setOrders] = useState([]);
  const [selectedImport, setSelectedImport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const [i, o] = await Promise.all([smartPurchaseApi.listImports(), smartPurchaseApi.listOrders()]);
      setImports(i || []); setOrders(o || []);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { refresh(); }, []);

  async function readFile(file) {
    setError(''); setMessage(''); setFileName(file.name);
    const buf = await file.arrayBuffer();
    const workbook = XLSX.read(buf, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const rows = raw.map((r) => ({
      product_code: String(findValue(r, 'product_code') || '').trim(),
      product_name: String(findValue(r, 'product_name') || '').trim(),
      current_stock: number(findValue(r, 'current_stock')),
      sales_30: number(findValue(r, 'sales_30')),
      sales_60: number(findValue(r, 'sales_60')),
      sales_90: number(findValue(r, 'sales_90')),
      avg_daily_usage: number(findValue(r, 'avg_daily_usage')),
      old_discount: number(findValue(r, 'old_discount')),
      last_purchase_price: number(findValue(r, 'last_purchase_price')),
      preferred_supplier: String(findValue(r, 'preferred_supplier') || '').trim(),
      pending_incoming: number(findValue(r, 'pending_incoming')),
    }));
    setPreview(rows);
    const valid = rows.filter((r) => r.product_name).length;
    setMessage(`تمت قراءة ${rows.length} صف، منها ${valid} صف صالح مبدئيًا.`);
  }

  async function importFile() {
    if (!preview.length) return setError('ارفع ملف Excel أولًا.');
    setLoading(true); setError('');
    try {
      const result = await smartPurchaseApi.importRows({ file_name: fileName, branch, coverage_days: coverageDays, safety_days: safetyDays, rows: preview });
      setMessage(`تم الاستيراد بنجاح: ${result.valid_count} صنف صالح، و${result.error_count} صف يحتاج مراجعة.`);
      setPreview([]); setFileName(''); await refresh();
      const full = await smartPurchaseApi.getImport(result.id); setSelectedImport(full);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function openImport(id) {
    setLoading(true); setError('');
    try { setSelectedImport(await smartPurchaseApi.getImport(id)); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function createOrder() {
    if (!selectedImport?.import?.id) return;
    setLoading(true); setError('');
    try {
      const r = await smartPurchaseApi.createOrder({ import_id: selectedImport.import.id, branch: selectedImport.import.branch, title: `طلبية ${selectedImport.import.branch}` });
      setMessage('تم إنشاء الطلبية وحفظها بنجاح.'); await refresh();
      const order = await smartPurchaseApi.getOrder(r.id); exportOrder(order);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function exportAnalysis() {
    if (!selectedImport?.items?.length) return;
    const rows = selectedImport.items.map((x) => ({
      'كود الصنف': x.product_code, 'اسم الصنف': x.product_name, 'الفرع': x.branch,
      'الرصيد الحالي': x.current_stock, 'مبيعات 30 يوم': x.sales_30, 'متوسط الاستهلاك اليومي': x.avg_daily_usage,
      'أيام التغطية الحالية': Number(x.coverage_days || 0).toFixed(1), 'طلبات العملاء': x.customer_requests_count,
      'الكمية المقترحة': x.recommended_quantity, 'الأولوية': x.priority_label, 'درجة الأولوية': x.priority_score,
      'المورد المقترح': x.preferred_supplier, 'تكلفة الوحدة المتوقعة': x.expected_unit_cost,
      'إجمالي متوقع': x.expected_total, 'سبب الاقتراح': x.reason,
    }));
    download(rows, `تحليل_طلبية_${selectedImport.import.branch}.xlsx`);
  }
  function exportOrder(order) {
    const rows = (order?.items || []).map((x) => ({
      'كود الصنف': x.product_code, 'اسم الصنف': x.product_name, 'المورد': x.supplier_name,
      'الكمية المطلوبة': x.requested_quantity, 'الكمية المعتمدة': x.approved_quantity,
      'سعر الوحدة المتوقع': x.expected_unit_cost, 'الخصم المتوقع %': x.expected_discount,
      'الإجمالي المتوقع': x.expected_total, 'طلبات العملاء': x.customer_requests_count,
      'درجة الأولوية': x.priority_score, 'ملاحظات': x.notes || '',
    }));
    download(rows, `${order?.order?.order_number || 'طلبية_مشتريات'}.xlsx`);
  }
  function download(rows, name) {
    const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الطلبية'); XLSX.writeFile(wb, name);
  }

  const stats = useMemo(() => {
    const items = selectedImport?.items || [];
    return {
      count: items.length,
      urgent: items.filter((x) => Number(x.priority_score) >= 50 || x.priority_label === 'عاجل جدًا').length,
      customers: items.reduce((s, x) => s + Number(x.customer_requests_count || 0), 0),
      total: items.reduce((s, x) => s + Number(x.expected_total || 0), 0),
    };
  }, [selectedImport]);

  return <div dir="rtl" className="p-4 md:p-6 space-y-5">
    <div>
      <h1 className="text-2xl font-bold text-slate-900">طلبيات المشتريات الذكية</h1>
      <p className="text-sm text-slate-500 mt-1">استيراد Excel، تحليل الاستهلاك، ربط طلبات العملاء، اقتراح الكمية وتصدير الطلبية.</p>
    </div>

    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5" />{error}</div>}
    {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">{message}</div>}

    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-4"><FileSpreadsheet className="w-5 h-5 text-emerald-600"/><h2 className="font-bold">استيراد ملف المبيعات والمخزون</h2></div>
      <div className="grid md:grid-cols-4 gap-3">
        <label className="text-sm">الفرع<select value={branch} onChange={(e)=>setBranch(e.target.value)} className="mt-1 w-full rounded-lg border p-2"><option>دواء الشامي</option><option>دواء شكري</option></select></label>
        <label className="text-sm">فترة التغطية بالأيام<input type="number" value={coverageDays} onChange={(e)=>setCoverageDays(Number(e.target.value))} className="mt-1 w-full rounded-lg border p-2"/></label>
        <label className="text-sm">مخزون الأمان بالأيام<input type="number" value={safetyDays} onChange={(e)=>setSafetyDays(Number(e.target.value))} className="mt-1 w-full rounded-lg border p-2"/></label>
        <label className="text-sm">ملف Excel<input type="file" accept=".xlsx,.xls,.csv" onChange={(e)=>e.target.files?.[0]&&readFile(e.target.files[0])} className="mt-1 block w-full text-sm"/></label>
      </div>
      {preview.length > 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
        <span className="text-sm">{fileName} — {preview.length} صف</span>
        <button disabled={loading} onClick={importFile} className="rounded-lg bg-emerald-600 px-4 py-2 text-white font-semibold flex items-center gap-2"><Upload className="w-4 h-4"/>استيراد وتحليل</button>
      </div>}
    </section>

    <div className="grid lg:grid-cols-[320px_1fr] gap-4">
      <aside className="rounded-2xl border bg-white p-3 shadow-sm h-fit">
        <div className="flex justify-between items-center mb-3"><h2 className="font-bold">دفعات التحليل</h2><button onClick={refresh}><RefreshCw className="w-4 h-4"/></button></div>
        <div className="space-y-2 max-h-[520px] overflow-auto">
          {imports.map((x)=><button key={x.id} onClick={()=>openImport(x.id)} className="w-full text-right rounded-xl border p-3 hover:bg-emerald-50">
            <div className="font-semibold text-sm">{x.file_name}</div><div className="text-xs text-slate-500 mt-1">{x.branch} • {x.valid_count} صنف</div>
          </button>)}
          {!imports.length && <p className="text-sm text-slate-400 p-3">لا توجد دفعات بعد.</p>}
        </div>
      </aside>

      <main className="space-y-4">
        {selectedImport ? <>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {[['عدد الأصناف',stats.count],['أصناف عاجلة',stats.urgent],['طلبات عملاء مرتبطة',stats.customers],['قيمة الطلبية المتوقعة',`${money(stats.total)} ج`]].map(([l,v])=><div key={l} className="rounded-2xl border bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">{l}</div><div className="mt-2 text-xl font-bold">{v}</div></div>)}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={exportAnalysis} className="rounded-lg border bg-white px-4 py-2 font-semibold flex gap-2"><Download className="w-4 h-4"/>تصدير التحليل Excel</button>
            <button onClick={createOrder} disabled={loading} className="rounded-lg bg-emerald-600 px-4 py-2 text-white font-semibold flex gap-2"><ShoppingCart className="w-4 h-4"/>إنشاء الطلبية وتصديرها</button>
          </div>
          <div className="rounded-2xl border bg-white overflow-hidden shadow-sm">
            <div className="overflow-auto max-h-[620px]"><table className="w-full text-sm min-w-[1050px]"><thead className="sticky top-0 bg-slate-100"><tr>{['الكود','الصنف','الرصيد','مبيعات 30','متوسط يومي','أيام تغطية','طلبات عملاء','المقترح','الأولوية','المورد','سعر متوقع','الإجمالي'].map(h=><th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody>
              {selectedImport.items.map((x)=><tr key={x.id} className="border-t hover:bg-slate-50"><td className="p-3">{x.product_code||'-'}</td><td className="p-3 font-semibold">{x.product_name}</td><td className="p-3">{x.current_stock}</td><td className="p-3">{x.sales_30}</td><td className="p-3">{Number(x.avg_daily_usage||0).toFixed(2)}</td><td className="p-3">{Number(x.coverage_days||0).toFixed(1)}</td><td className="p-3">{x.customer_requests_count}</td><td className="p-3 font-bold text-emerald-700">{x.recommended_quantity}</td><td className="p-3"><span className="rounded-full bg-amber-100 px-2 py-1 text-xs">{x.priority_label}</span></td><td className="p-3">{x.preferred_supplier||'غير محدد'}</td><td className="p-3">{money(x.expected_unit_cost)}</td><td className="p-3 font-semibold">{money(x.expected_total)}</td></tr>)}
            </tbody></table></div>
          </div>
        </> : <div className="rounded-2xl border bg-white p-12 text-center text-slate-500"><PackageCheck className="mx-auto mb-3 w-10 h-10"/>ارفع ملفًا جديدًا أو اختر دفعة تحليل سابقة.</div>}
      </main>
    </div>

    {orders.length > 0 && <section className="rounded-2xl border bg-white p-4 shadow-sm"><h2 className="font-bold mb-3">آخر الطلبيات المحفوظة</h2><div className="grid md:grid-cols-3 gap-3">{orders.slice(0,6).map(o=><div key={o.id} className="rounded-xl border p-3"><div className="font-bold">{o.order_number}</div><div className="text-sm text-slate-500 mt-1">{o.branch} • {o.status}</div><div className="font-semibold mt-2">{money(o.approved_total)} ج</div></div>)}</div></section>}
  </div>;
}
