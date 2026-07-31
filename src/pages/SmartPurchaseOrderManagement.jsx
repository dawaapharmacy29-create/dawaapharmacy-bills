import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, FileSpreadsheet, Save, Sparkles, CheckCircle2, AlertTriangle, ClipboardCheck } from 'lucide-react';
import { smartPurchaseOrderManagementApi as api } from '@/api/smartPurchaseOrderManagementApi';

const aliases = {
  product_code: ['كود الصنف','كود','product code','item code'],
  product_name: ['اسم الصنف','الصنف','product name','item name'],
  supplier_name: ['اسم المورد','المورد','supplier'],
  list_price: ['السعر قبل الخصم','السعر','list price'],
  discount_percent: ['الخصم %','نسبة الخصم','discount'],
  extra_discount_percent: ['خصم اضافي %','الخصم الاضافي','extra discount'],
  bonus_quantity: ['كمية البونص','البونص','bonus quantity'],
  bonus_base_quantity: ['كمية اساس البونص','البونص لكل','bonus base quantity'],
  available_quantity: ['الكمية المتاحة','متاح','available quantity'],
  minimum_order_quantity: ['اقل كمية طلب','الحد الادنى','minimum order quantity'],
  lead_time_days: ['مدة التوريد','ايام التوريد','lead time'],
  payment_type: ['طريقة الدفع','الدفع','payment type'],
  valid_until: ['ساري حتى','تاريخ انتهاء العرض','valid until'],
};
const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g,' ');
const num = (v) => { const n = Number(String(v ?? '').replace(/[,٪%جنيه]/g,'').trim()); return Number.isFinite(n) ? n : 0; };
function get(row,key){ const found=Object.keys(row).find(k=>(aliases[key]||[key]).some(a=>norm(a)===norm(k))); return found?row[found]:''; }
function money(v){ return new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(Number(v||0)); }
function downloadWorkbook(sheets,name){ const wb=XLSX.utils.book_new(); Object.entries(sheets).forEach(([sheet,rows])=>XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),sheet.slice(0,31))); XLSX.writeFile(wb,name); }

export default function SmartPurchaseOrderManagement(){
  const [orders,setOrders]=useState([]); const [selected,setSelected]=useState(null); const [offersPreview,setOffersPreview]=useState([]);
  const [fileName,setFileName]=useState(''); const [loading,setLoading]=useState(false); const [message,setMessage]=useState(''); const [error,setError]=useState('');

  async function refresh(){ try{setOrders(await api.listOrders()||[]);}catch(e){setError(e.message);} }
  useEffect(()=>{refresh();},[]);
  async function openOrder(id){setLoading(true);setError('');try{setSelected(await api.getOrder(id));}catch(e){setError(e.message);}finally{setLoading(false);} }

  async function readOffers(file){
    setFileName(file.name); setError('');
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}); const raw=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
    setOffersPreview(raw.map(r=>({product_code:String(get(r,'product_code')||'').trim(),product_name:String(get(r,'product_name')||'').trim(),supplier_name:String(get(r,'supplier_name')||'').trim(),list_price:num(get(r,'list_price')),discount_percent:num(get(r,'discount_percent')),extra_discount_percent:num(get(r,'extra_discount_percent')),bonus_quantity:num(get(r,'bonus_quantity')),bonus_base_quantity:num(get(r,'bonus_base_quantity')),available_quantity:get(r,'available_quantity')===''?null:num(get(r,'available_quantity')),minimum_order_quantity:num(get(r,'minimum_order_quantity')),lead_time_days:num(get(r,'lead_time_days')),payment_type:String(get(r,'payment_type')||'').trim(),valid_until:String(get(r,'valid_until')||'').slice(0,10),is_available:true})));
  }
  async function importOffers(){ if(!offersPreview.length)return;setLoading(true);try{await api.importOffers({file_name:fileName,rows:offersPreview});setOffersPreview([]);setFileName('');setMessage('تم استيراد عروض الموردين بنجاح.');}catch(e){setError(e.message);}finally{setLoading(false);} }
  async function saveItem(item){setLoading(true);try{await api.updateItem({id:item.id,approved_quantity:item.approved_quantity,supplier_name:item.supplier_name,expected_unit_cost:item.expected_unit_cost,expected_discount:item.expected_discount,supplier_reason:item.supplier_reason,notes:item.notes});await openOrder(selected.order.id);setMessage('تم حفظ تعديل الصنف.');}catch(e){setError(e.message);}finally{setLoading(false);} }
  async function optimize(){setLoading(true);try{await api.optimizeSuppliers(selected.order.id);await openOrder(selected.order.id);setMessage('تم اختيار أفضل مورد متاح لكل صنف حسب التكلفة الصافية.');}catch(e){setError(e.message);}finally{setLoading(false);} }
  async function approve(){setLoading(true);try{await api.approveOrder(selected.order.id);await openOrder(selected.order.id);await refresh();setMessage('تم اعتماد الطلبية.');}catch(e){setError(e.message);}finally{setLoading(false);} }

  function updateLocal(id,key,value){setSelected(s=>({...s,items:s.items.map(x=>x.id===id?{...x,[key]:value}:x)}));}
  function exportAll(){if(!selected)return;const rows=selected.items.map(x=>({'كود الصنف':x.product_code,'اسم الصنف':x.product_name,'المورد':x.supplier_name||'','الكمية المعتمدة':x.approved_quantity,'السعر الصافي':x.expected_unit_cost,'الخصم %':x.expected_discount,'الإجمالي':Number(x.approved_quantity||0)*Number(x.expected_unit_cost||0),'سبب اختيار المورد':x.supplier_reason||'','ملاحظات':x.notes||''}));downloadWorkbook({'الطلبية':rows},`${selected.order.order_number}.xlsx`);}
  function exportBySupplier(){if(!selected)return;const groups={};selected.items.forEach(x=>{const k=x.supplier_name||'بدون مورد';(groups[k]??=[]).push({'كود الصنف':x.product_code,'اسم الصنف':x.product_name,'الكمية':x.approved_quantity,'سعر الوحدة المتوقع':x.expected_unit_cost,'الإجمالي':Number(x.approved_quantity||0)*Number(x.expected_unit_cost||0),'ملاحظات':x.notes||''});});downloadWorkbook(groups,`${selected.order.order_number}_حسب_المورد.xlsx`);}
  function downloadOfferTemplate(){downloadWorkbook({'عروض الموردين':[{'كود الصنف':'','اسم الصنف':'','اسم المورد':'','السعر قبل الخصم':0,'الخصم %':0,'خصم اضافي %':0,'كمية البونص':0,'كمية اساس البونص':0,'الكمية المتاحة':'','اقل كمية طلب':0,'مدة التوريد':0,'طريقة الدفع':'','ساري حتى':''}]},'قالب_عروض_الموردين.xlsx');}

  const totals=useMemo(()=>{const items=selected?.items||[];return{count:items.length,total:items.reduce((s,x)=>s+Number(x.approved_quantity||0)*Number(x.expected_unit_cost||0),0),suppliers:new Set(items.map(x=>x.supplier_name).filter(Boolean)).size,unassigned:items.filter(x=>!x.supplier_name).length};},[selected]);

  return <div dir="rtl" className="p-4 md:p-6 space-y-5">
    <div className="flex items-center gap-3"><div className="rounded-xl bg-teal-50 p-2.5"><ClipboardCheck className="h-6 w-6 text-teal-600" /></div><div><h1 className="text-2xl font-bold">إدارة واعتماد طلبيات المشتريات</h1><p className="text-sm text-slate-500 mt-1">عروض الموردين، تعديل الكميات والأسعار، التحسين التلقائي، الاعتماد والتصدير لكل مورد.</p></div></div>
    {error&&<div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5"/>{error}</div>}
    {message&&<div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-teal-700">{message}</div>}

    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4"><h2 className="font-bold flex gap-2"><FileSpreadsheet className="w-5 h-5 text-teal-600"/>عروض الموردين</h2><button onClick={downloadOfferTemplate} className="rounded-lg border px-3 py-2 text-sm font-semibold">تنزيل قالب Excel</button></div>
      <div className="flex flex-wrap gap-3 items-center"><input type="file" accept=".xlsx,.xls,.csv" onChange={e=>e.target.files?.[0]&&readOffers(e.target.files[0])}/>{offersPreview.length>0&&<button disabled={loading} onClick={importOffers} className="rounded-lg bg-teal-600 text-white px-4 py-2 font-semibold">استيراد {offersPreview.length} عرض</button>}</div>
    </section>

    <div className="grid lg:grid-cols-[300px_1fr] gap-4">
      <aside className="rounded-2xl border bg-white p-3 shadow-sm h-fit"><h2 className="font-bold mb-3">الطلبيات</h2><div className="space-y-2 max-h-[600px] overflow-auto">{orders.map(o=><button key={o.id} onClick={()=>openOrder(o.id)} className="w-full text-right rounded-xl border p-3 hover:bg-teal-50"><div className="font-semibold">{o.order_number}</div><div className="text-xs text-slate-500 mt-1">{o.branch} • {o.status}</div><div className="text-sm font-bold mt-1">{money(o.approved_total)} ج</div></button>)}</div></aside>
      <main className="space-y-4">{selected&&<>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">{[['عدد الأصناف',totals.count],['عدد الموردين',totals.suppliers],['بدون مورد',totals.unassigned],['إجمالي الطلبية',`${money(totals.total)} ج`]].map(([l,v])=><div key={l} className="rounded-2xl border bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">{l}</div><div className="mt-2 text-xl font-bold">{v}</div></div>)}</div>
        <div className="flex flex-wrap gap-2"><button onClick={optimize} disabled={loading||selected.order.status==='معتمدة'} className="rounded-lg bg-violet-600 text-white px-4 py-2 font-semibold flex gap-2"><Sparkles className="w-4 h-4"/>اختيار أفضل الموردين</button><button onClick={approve} disabled={loading||selected.order.status==='معتمدة'} className="rounded-lg bg-teal-600 text-white px-4 py-2 font-semibold flex gap-2"><CheckCircle2 className="w-4 h-4"/>اعتماد الطلبية</button><button onClick={exportAll} className="rounded-lg border bg-white px-4 py-2 font-semibold flex gap-2"><Download className="w-4 h-4"/>تصدير إجمالي</button><button onClick={exportBySupplier} className="rounded-lg border bg-white px-4 py-2 font-semibold flex gap-2"><Download className="w-4 h-4"/>تصدير حسب المورد</button></div>
        <div className="rounded-2xl border bg-white shadow-sm overflow-auto"><table className="min-w-[1150px] w-full text-sm"><thead className="bg-slate-50"><tr>{['الصنف','المطلوب','المعتمد','المورد','سعر الوحدة','الخصم %','الإجمالي','سبب الاختيار','حفظ'].map(h=><th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody>{selected.items.map(x=><tr key={x.id} className="border-t"><td className="p-3"><div className="font-semibold">{x.product_name}</div><div className="text-xs text-slate-400">{x.product_code}</div></td><td className="p-3">{x.requested_quantity}</td><td className="p-3"><input type="number" value={x.approved_quantity??0} onChange={e=>updateLocal(x.id,'approved_quantity',num(e.target.value))} className="w-24 rounded border p-2"/></td><td className="p-3"><input value={x.supplier_name||''} onChange={e=>updateLocal(x.id,'supplier_name',e.target.value)} className="w-44 rounded border p-2"/></td><td className="p-3"><input type="number" value={x.expected_unit_cost??0} onChange={e=>updateLocal(x.id,'expected_unit_cost',num(e.target.value))} className="w-28 rounded border p-2"/></td><td className="p-3"><input type="number" value={x.expected_discount??0} onChange={e=>updateLocal(x.id,'expected_discount',num(e.target.value))} className="w-20 rounded border p-2"/></td><td className="p-3 font-bold">{money(Number(x.approved_quantity||0)*Number(x.expected_unit_cost||0))}</td><td className="p-3"><input value={x.supplier_reason||''} onChange={e=>updateLocal(x.id,'supplier_reason',e.target.value)} className="w-52 rounded border p-2"/></td><td className="p-3"><button disabled={loading||selected.order.status==='معتمدة'} onClick={()=>saveItem(x)} className="rounded bg-slate-800 text-white p-2"><Save className="w-4 h-4"/></button></td></tr>)}</tbody></table></div>
      </>}</main>
    </div>
  </div>;
}
