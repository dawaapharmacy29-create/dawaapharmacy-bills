import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { smartPurchaseReceivingApi } from '@/api/smartPurchaseReceivingApi';
import { AlertTriangle, Download, FileSpreadsheet, PackageCheck, RefreshCw, Upload } from 'lucide-react';

const aliases = {
  product_code: ['كود الصنف','كود','code','item code','product code'],
  product_name: ['اسم الصنف','الصنف','name','item name','product name'],
  received_quantity: ['الكمية المستلمة','المستلم','received','received qty'],
  invoiced_quantity: ['الكمية المفوترة','المفوتر','invoiced','invoice qty'],
  bonus_quantity: ['البونص','bonus','free qty'],
  actual_unit_cost: ['سعر الوحدة الفعلي','السعر الفعلي','actual unit cost','unit cost'],
  actual_discount: ['الخصم الفعلي','actual discount','discount'],
  actual_total: ['الإجمالي الفعلي','actual total','total'],
  notes: ['ملاحظات','notes'],
};
const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const num = (v) => { const n = Number(String(v ?? '').replace(/[,٪%جنيه]/g, '').trim()); return Number.isFinite(n) ? n : 0; };
function findValue(row, key) { const keys = Object.keys(row); const found = keys.find((k) => (aliases[key] || [key]).some((a) => norm(k) === norm(a))); return found ? row[found] : ''; }
function money(v) { return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(v || 0)); }
function download(rows, name, sheet='البيانات') { const ws=XLSX.utils.json_to_sheet(rows); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,sheet); XLSX.writeFile(wb,name); }

export default function SmartPurchaseReceiving() {
  const [orders,setOrders]=useState([]); const [selectedOrder,setSelectedOrder]=useState(null); const [preview,setPreview]=useState([]);
  const [fileName,setFileName]=useState(''); const [supplierName,setSupplierName]=useState(''); const [invoiceNumber,setInvoiceNumber]=useState('');
  const [receiptDate,setReceiptDate]=useState(new Date().toISOString().slice(0,10)); const [receipt,setReceipt]=useState(null);
  const [loading,setLoading]=useState(false); const [error,setError]=useState(''); const [message,setMessage]=useState('');

  async function refresh(){ try{ setOrders(await smartPurchaseReceivingApi.listOrders() || []);}catch(e){setError(e.message);} }
  useEffect(()=>{refresh();},[]);
  async function chooseOrder(id){ setLoading(true); setError(''); try{ setSelectedOrder(await smartPurchaseReceivingApi.getOrder(id)); setReceipt(null); setPreview([]);}catch(e){setError(e.message);} finally{setLoading(false);} }

  function exportTemplate(){
    if(!selectedOrder?.items?.length) return;
    const rows=selectedOrder.items.map(x=>({
      'كود الصنف':x.product_code||'', 'اسم الصنف':x.product_name, 'المورد':x.supplier_name||'',
      'الكمية المطلوبة':x.approved_quantity||x.requested_quantity||0, 'الكمية المستلمة':'', 'الكمية المفوترة':'',
      'البونص':'', 'سعر الوحدة المتوقع':x.expected_unit_cost||0, 'سعر الوحدة الفعلي':'', 'الخصم الفعلي':'', 'الإجمالي الفعلي':'', 'ملاحظات':''
    }));
    download(rows,`${selectedOrder.order.order_number}_قالب_الاستلام.xlsx`,'الاستلام');
  }

  async function readFile(file){
    setError(''); setMessage(''); setFileName(file.name);
    const buf=await file.arrayBuffer(); const wb=XLSX.read(buf,{type:'array'}); const ws=wb.Sheets[wb.SheetNames[0]];
    const raw=XLSX.utils.sheet_to_json(ws,{defval:''});
    const rows=raw.map(r=>({
      product_code:String(findValue(r,'product_code')||'').trim(), product_name:String(findValue(r,'product_name')||'').trim(),
      received_quantity:num(findValue(r,'received_quantity')), invoiced_quantity:num(findValue(r,'invoiced_quantity')) || num(findValue(r,'received_quantity')),
      bonus_quantity:num(findValue(r,'bonus_quantity')), actual_unit_cost:num(findValue(r,'actual_unit_cost')),
      actual_discount:num(findValue(r,'actual_discount')), actual_total:num(findValue(r,'actual_total')), notes:String(findValue(r,'notes')||'').trim(),
    })).filter(r=>r.product_name||r.product_code);
    setPreview(rows); setMessage(`تمت قراءة ${rows.length} صنف من ملف الاستلام.`);
  }

  async function importReceipt(){
    if(!selectedOrder?.order?.id) return setError('اختر طلبية أولًا.'); if(!preview.length) return setError('ارفع ملف الاستلام أولًا.');
    setLoading(true); setError('');
    try{
      const r=await smartPurchaseReceivingApi.importReceipt({order_id:selectedOrder.order.id,supplier_name:supplierName,supplier_invoice_number:invoiceNumber,receipt_date:receiptDate,file_name:fileName,rows:preview});
      const full=await smartPurchaseReceivingApi.getReceipt(r.receipt_id); setReceipt(full); setPreview([]); setFileName('');
      setMessage('تم تسجيل الاستلام والمطابقة وتقييم السعر بنجاح.'); await refresh(); setSelectedOrder(await smartPurchaseReceivingApi.getOrder(selectedOrder.order.id));
    }catch(e){setError(e.message);} finally{setLoading(false);}
  }

  function exportReport(){
    if(!receipt) return;
    const rows=(receipt.items||[]).map(x=>({
      'كود الصنف':x.product_code,'اسم الصنف':x.product_name,'المطلوب':x.ordered_quantity,'المستلم':x.received_quantity,'المفوتر':x.invoiced_quantity,
      'البونص':x.bonus_quantity,'السعر المتوقع':x.expected_unit_cost,'السعر الفعلي':x.actual_unit_cost,'التكلفة الفعلية بعد البونص':x.effective_unit_cost,
      'فرق الكمية':x.quantity_variance,'فرق كمية الفاتورة':x.invoice_quantity_variance,'فرق السعر':x.price_variance,'فرق القيمة':x.value_variance,'النتيجة':x.match_status,'ملاحظات':x.notes||''
    }));
    const customers=(receipt.customers||[]).map(x=>({'الصنف':x.product_name,'العميل':x.customer_name,'كود العميل':x.customer_code,'الهاتف':x.phone,'الفرع':x.branch,'تاريخ الطلب':x.request_date,'الحالة':x.status}));
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'مطابقة الطلبية'); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(customers),'عملاء للتواصل');
    XLSX.writeFile(wb,`تقرير_مطابقة_${selectedOrder?.order?.order_number||'طلبية'}.xlsx`);
  }

  const stats=useMemo(()=>{ const items=receipt?.items||[]; return {
    count:items.length, ok:items.filter(x=>x.match_status==='سليم').length, missing:items.filter(x=>['ناقص','لم يصل'].includes(x.match_status)).length,
    issues:items.filter(x=>!['سليم'].includes(x.match_status)).length, customers:(receipt?.customers||[]).length
  };},[receipt]);

  return <div dir="rtl" className="p-4 md:p-6 space-y-5">
    <div><h1 className="text-2xl font-bold text-slate-900">استلام ومطابقة طلبيات المشتريات</h1><p className="text-sm text-slate-500 mt-1">مقارنة المطلوب بالمستلم والمفوتر، تقييم السعر، ومعرفة العملاء المنتظرين.</p></div>
    {error&&<div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5"/>{error}</div>}
    {message&&<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">{message}</div>}

    <div className="grid lg:grid-cols-[320px_1fr] gap-4">
      <aside className="rounded-2xl border bg-white p-3 shadow-sm h-fit">
        <div className="flex justify-between items-center mb-3"><h2 className="font-bold">الطلبيات</h2><button onClick={refresh}><RefreshCw className="w-4 h-4"/></button></div>
        <div className="space-y-2 max-h-[650px] overflow-auto">{orders.map(o=><button key={o.id} onClick={()=>chooseOrder(o.id)} className="w-full rounded-xl border p-3 text-right hover:bg-emerald-50">
          <div className="font-semibold text-sm">{o.order_number}</div><div className="text-xs text-slate-500 mt-1">{o.branch} • {o.items_count} صنف</div><div className="text-xs mt-1">المتوقع: {money(o.expected_total)} ج • المستلم: {money(o.received_total)} ج</div>
        </button>)}{!orders.length&&<p className="text-sm text-slate-400 p-3">لا توجد طلبيات بعد.</p>}</div>
      </aside>

      <main className="space-y-4">
        {selectedOrder ? <>
          <section className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap justify-between gap-3 items-center"><div><h2 className="font-bold">{selectedOrder.order.order_number}</h2><p className="text-sm text-slate-500">{selectedOrder.order.branch} • الحالة: {selectedOrder.order.status}</p></div>
              <button onClick={exportTemplate} className="rounded-lg border px-4 py-2 font-semibold flex gap-2"><Download className="w-4 h-4"/>تنزيل قالب الاستلام Excel</button></div>
            <div className="grid md:grid-cols-4 gap-3 mt-4">
              <label className="text-sm">المورد<input value={supplierName} onChange={e=>setSupplierName(e.target.value)} className="mt-1 w-full rounded-lg border p-2"/></label>
              <label className="text-sm">رقم فاتورة المورد<input value={invoiceNumber} onChange={e=>setInvoiceNumber(e.target.value)} className="mt-1 w-full rounded-lg border p-2"/></label>
              <label className="text-sm">تاريخ الاستلام<input type="date" value={receiptDate} onChange={e=>setReceiptDate(e.target.value)} className="mt-1 w-full rounded-lg border p-2"/></label>
              <label className="text-sm">ملف Excel<input type="file" accept=".xlsx,.xls,.csv" onChange={e=>e.target.files?.[0]&&readFile(e.target.files[0])} className="mt-1 block w-full text-sm"/></label>
            </div>
            {preview.length>0&&<div className="mt-4 flex flex-wrap justify-between gap-3 rounded-xl bg-slate-50 p-3"><span className="text-sm">{fileName} — {preview.length} صنف</span><button disabled={loading} onClick={importReceipt} className="rounded-lg bg-emerald-600 px-4 py-2 text-white font-semibold flex gap-2"><Upload className="w-4 h-4"/>تسجيل الاستلام والمطابقة</button></div>}
          </section>

          {receipt&&<>
            <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">{[['عدد البنود',stats.count],['سليم',stats.ok],['ناقص أو لم يصل',stats.missing],['يحتاج مراجعة',stats.issues],['عملاء للتواصل',stats.customers]].map(([l,v])=><div key={l} className="rounded-2xl border bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">{l}</div><div className="mt-2 text-xl font-bold">{v}</div></div>)}</div>
            <section className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-bold">تقييم الاستلام والسعر</h3><p className="text-sm text-slate-500 mt-1">اكتمال {receipt.receipt.completion_rate}% • تقييم السعر {Number(receipt.receipt.price_score||0).toFixed(1)}/100 • تقييم المورد {Number(receipt.receipt.supplier_score||0).toFixed(1)}/100</p></div><button onClick={exportReport} className="rounded-lg bg-slate-900 px-4 py-2 text-white font-semibold flex gap-2"><FileSpreadsheet className="w-4 h-4"/>تصدير تقرير Excel</button></div>
              <div className="grid md:grid-cols-4 gap-3 mt-4 text-sm"><div>المتوقع: <b>{money(receipt.receipt.expected_total)} ج</b></div><div>المفوتر: <b>{money(receipt.receipt.invoiced_total)} ج</b></div><div>فرق القيمة: <b>{money(receipt.receipt.value_variance)} ج</b></div><div>فرق السعر: <b>{money(receipt.receipt.price_variance)} ج</b></div></div>
            </section>
            <div className="rounded-2xl border bg-white overflow-auto shadow-sm"><table className="min-w-full text-sm"><thead className="bg-slate-50"><tr>{['الصنف','المطلوب','المستلم','المفوتر','السعر المتوقع','السعر الفعلي','فرق القيمة','النتيجة'].map(h=><th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody>{receipt.items.map(x=><tr key={x.id} className="border-t"><td className="p-3 font-medium">{x.product_name}<div className="text-xs text-slate-400">{x.product_code}</div></td><td className="p-3">{x.ordered_quantity}</td><td className="p-3">{x.received_quantity}</td><td className="p-3">{x.invoiced_quantity}</td><td className="p-3">{money(x.expected_unit_cost)}</td><td className="p-3">{money(x.actual_unit_cost)}</td><td className="p-3">{money(x.value_variance)}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${x.match_status==='سليم'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-800'}`}>{x.match_status}</span></td></tr>)}</tbody></table></div>
          </>}
        </> : <div className="rounded-2xl border border-dashed bg-white p-12 text-center text-slate-400"><PackageCheck className="w-10 h-10 mx-auto mb-3"/>اختر طلبية لبدء الاستلام والمطابقة.</div>}
      </main>
    </div>
  </div>;
}
