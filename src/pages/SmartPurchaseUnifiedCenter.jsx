import {useEffect,useMemo,useState} from 'react';
import * as XLSX from 'xlsx';
import {smartPurchaseUnifiedApi as unified} from '@/api/smartPurchaseUnifiedApi';
import {smartPurchaseOrderManagementApi as management} from '@/api/smartPurchaseOrderManagementApi';
import {AlertTriangle,CheckCircle2,Download,FileSpreadsheet,RefreshCw,Send,Sparkles} from 'lucide-react';

const money=v=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(Number(v||0));
const STATUS_STEPS=['مسودة','تم التحليل','معتمدة','تم الإرسال للمورد','وصلت جزئيًا','وصلت بالكامل','تمت مطابقة الفاتورة','مغلقة'];
const normStatus=s=>s==='draft'?'مسودة':s||'مسودة';
function workbookBySupplier(order){
  const groups={};
  (order.items||[]).forEach(x=>{const supplier=x.supplier_name||'بدون مورد';(groups[supplier]??=[]).push({'كود الصنف':x.product_code||'','اسم الصنف':x.product_name,'الكمية':Number(x.approved_quantity||0),'سعر الوحدة المتوقع':Number(x.expected_unit_cost||0),'الإجمالي':Number(x.approved_quantity||0)*Number(x.expected_unit_cost||0),'ملاحظات':x.notes||''});});
  const wb=XLSX.utils.book_new(); Object.entries(groups).forEach(([name,rows])=>XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),name.slice(0,31))); XLSX.writeFile(wb,`${order.order.order_number}_حسب_المورد.xlsx`);
}

export default function SmartPurchaseUnifiedCenter(){
  const [data,setData]=useState({orders:[],treasuries:[],pending_actions:{}}); const [selected,setSelected]=useState(null);
  const [loading,setLoading]=useState(false); const [error,setError]=useState(''); const [message,setMessage]=useState('');
  async function refresh(){setLoading(true);setError('');try{const d=await unified.dashboard();setData(d||{orders:[],treasuries:[],pending_actions:{}});if(selected?.order?.id)setSelected(await unified.getOrder(selected.order.id));}catch(e){setError(e.message);}finally{setLoading(false);}}
  useEffect(()=>{refresh();},[]);
  async function openOrder(id){setLoading(true);setError('');setMessage('');try{setSelected(await unified.getOrder(id));}catch(e){setError(e.message);}finally{setLoading(false);}}
  async function run(fn,msg){setLoading(true);setError('');setMessage('');try{await fn();setMessage(msg);await refresh();}catch(e){setError(e.message);}finally{setLoading(false);}}
  async function optimize(){if(!selected)return;await run(()=>management.optimizeSuppliers(selected.order.id),'تم اختيار أفضل مورد متاح لكل صنف.');}
  async function approve(){if(!selected)return;await run(()=>unified.approveOrder(selected.order.id),'تم اعتماد الطلبية بنجاح. لا يوجد حجز أو فحص لرصيد الخزنة.');}
  async function returnToReview(){if(!selected)return;await run(()=>unified.returnToReview(selected.order.id),'تمت إعادة الطلبية للمراجعة.');}
  async function markSent(){if(!selected)return;await run(()=>unified.markSent(selected.order.id),'تم تسجيل إرسال الطلبية للموردين.');}

  const totals=useMemo(()=>{const items=selected?.items||[];return{items:items.length,suppliers:new Set(items.map(x=>x.supplier_name).filter(Boolean)).size,missing:items.filter(x=>Number(x.approved_quantity||0)>0&&!x.supplier_name).length,total:items.reduce((s,x)=>s+Number(x.approved_quantity||0)*Number(x.expected_unit_cost||0),0),customers:items.reduce((s,x)=>s+Number(x.customer_requests_count||0),0)};},[selected]);
  const status=normStatus(selected?.order?.status); const stepIndex=Math.max(0,STATUS_STEPS.indexOf(status));

  return <div dir="rtl" className="p-4 md:p-6 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold">مركز الطلبية السريع</h1><p className="text-sm text-slate-500 mt-1">مراجعة الأصناف، اختيار المورد، الاعتماد والتصدير من شاشة واحدة.</p></div><button onClick={refresh} className="rounded-lg border bg-white px-4 py-2 flex gap-2"><RefreshCw className="w-4 h-4"/>تحديث</button></div>
    {error&&<div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5"/>{error}</div>}{message&&<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">{message}</div>}
    <div className="grid md:grid-cols-3 gap-3">{[['مسودات تحتاج مراجعة',data.pending_actions?.draft||0],['طلبيات بها أصناف بدون مورد',data.pending_actions?.needs_supplier||0],['طلبيات تنتظر الاستلام',data.pending_actions?.pending_receiving||0]].map(([l,v])=><div key={l} className="rounded-2xl border bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">{l}</div><div className="text-2xl font-bold mt-2">{v}</div></div>)}</div>
    <div className="grid lg:grid-cols-[310px_1fr] gap-4">
      <aside className="rounded-2xl border bg-white p-3 shadow-sm h-fit"><h2 className="font-bold mb-3">الطلبيات</h2><div className="space-y-2 max-h-[650px] overflow-auto">{(data.orders||[]).map(o=><button key={o.id} onClick={()=>openOrder(o.id)} className={`w-full text-right rounded-xl border p-3 hover:bg-emerald-50 ${selected?.order?.id===o.id?'border-emerald-500 bg-emerald-50':''}`}><div className="font-semibold">{o.order_number}</div><div className="text-xs text-slate-500 mt-1">{o.branch} • {normStatus(o.status)}</div><div className="font-bold mt-1">{money(o.approved_total||o.expected_total)} ج</div></button>)}{!data.orders?.length&&<p className="text-sm text-slate-400 p-3">لا توجد طلبيات بعد.</p>}</div></aside>
      <main className="space-y-4">{selected?<>
        <section className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-bold">{selected.order.order_number}</h2><p className="text-sm text-slate-500">{selected.order.branch} • {status}</p></div><div className="flex gap-2"><button onClick={()=>workbookBySupplier(selected)} className="rounded-lg border px-3 py-2 flex gap-2"><Download className="w-4 h-4"/>Excel حسب المورد</button>{status==='معتمدة'&&<button onClick={markSent} disabled={loading} className="rounded-lg bg-blue-600 text-white px-3 py-2 flex gap-2"><Send className="w-4 h-4"/>تم الإرسال</button>}</div></div><div className="mt-4 flex overflow-x-auto">{STATUS_STEPS.map((s,i)=><div key={s} className="min-w-[125px] flex-1"><div className={`h-2 ${i<=stepIndex?'bg-emerald-500':'bg-slate-200'}`}/><div className={`text-[11px] mt-2 ${i<=stepIndex?'font-bold text-emerald-700':'text-slate-400'}`}>{s}</div></div>)}</div></section>
        <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">{[['الأصناف',totals.items],['الموردون',totals.suppliers],['بدون مورد',totals.missing],['طلبات العملاء',totals.customers],['إجمالي الطلبية',`${money(totals.total)} ج`]].map(([l,v])=><div key={l} className="rounded-2xl border bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">{l}</div><div className="text-xl font-bold mt-2">{v}</div></div>)}</div>
        <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4"><div className="font-bold text-blue-900">الخزنة مرنة</div><p className="text-sm text-blue-800 mt-1">اعتماد الطلبية لا يحجز أي مبلغ ولا يتوقف على رصيد الخزنة. يمكن أن يصبح رصيد الخزنة سالبًا، مع استمرار تسجيل كل الحركات المالية والتوقيت والتفاصيل.</p></section>
        <div className="flex flex-wrap gap-2"><button onClick={optimize} disabled={loading||['معتمدة','تم الإرسال للمورد'].includes(status)} className="rounded-lg bg-violet-600 text-white px-4 py-2 font-semibold flex gap-2"><Sparkles className="w-4 h-4"/>اختيار أفضل الموردين</button>{!['معتمدة','تم الإرسال للمورد'].includes(status)&&<button onClick={approve} disabled={loading||totals.missing>0||totals.total<=0} className="rounded-lg bg-emerald-600 text-white px-4 py-2 font-semibold flex gap-2"><CheckCircle2 className="w-4 h-4"/>اعتماد الطلبية</button>}{['معتمدة','تم الإرسال للمورد'].includes(status)&&<button onClick={returnToReview} disabled={loading} className="rounded-lg border border-amber-300 text-amber-800 px-4 py-2 font-semibold">إعادة للمراجعة</button>}</div>
        <section className="rounded-2xl border bg-white shadow-sm overflow-auto"><table className="min-w-[1050px] w-full text-sm"><thead className="bg-slate-50"><tr>{['الصنف','المطلوب','المعتمد','المورد','سعر الوحدة','الإجمالي','الأولوية','طلبات العملاء'].map(h=><th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody>{selected.items.map(x=><tr key={x.id} className="border-t"><td className="p-3"><div className="font-semibold">{x.product_name}</div><div className="text-xs text-slate-400">{x.product_code||'بدون كود'}</div></td><td className="p-3">{x.requested_quantity}</td><td className="p-3 font-bold">{x.approved_quantity}</td><td className="p-3">{x.supplier_name||<span className="text-red-600">لم يحدد</span>}</td><td className="p-3">{money(x.expected_unit_cost)}</td><td className="p-3 font-bold">{money(Number(x.approved_quantity||0)*Number(x.expected_unit_cost||0))}</td><td className="p-3">{x.priority_score}</td><td className="p-3">{x.customer_requests_count||0}</td></tr>)}</tbody></table></section>
      </>:<section className="rounded-2xl border border-dashed bg-white p-12 text-center text-slate-400"><FileSpreadsheet className="w-10 h-10 mx-auto mb-3"/>اختر طلبية لبدء المراجعة السريعة.</section>}</main>
    </div>
  </div>;
}
