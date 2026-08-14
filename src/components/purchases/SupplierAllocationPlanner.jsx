import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Layers3, PackageCheck, RefreshCw, WalletCards } from 'lucide-react';
import { smartPurchaseUnifiedApi as api } from '@/api/smartPurchaseUnifiedApi';

const money = (v) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(v || 0));
const num = (v) => Number(v || 0).toFixed(0);
const statusMeta = {
  single_supplier: ['مورد واحد','bg-emerald-100 text-emerald-800'],
  split: ['تقسيم بين موردين','bg-blue-100 text-blue-800'],
  partial: ['تغطية جزئية','bg-amber-100 text-amber-800'],
  no_feasible_offer: ['بدون عرض صالح','bg-red-100 text-red-800'],
};

export default function SupplierAllocationPlanner(){
  const [orders,setOrders]=useState([]);
  const [orderId,setOrderId]=useState('');
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');

  async function loadOrders(){
    try{
      const d=await api.dashboard();
      const rows=(d?.orders||[]).filter(o=>!['مغلقة','cancelled','ملغاة'].includes(String(o.status||'')));
      setOrders(rows); if(!orderId&&rows.length)setOrderId(rows[0].id);
    }catch(e){setError(e.message);}
  }
  async function analyze(id=orderId){
    if(!id)return;
    setLoading(true);setError('');
    try{setData(await api.supplierAllocationPlan(id));}
    catch(e){setError(e.message);setData(null);}
    finally{setLoading(false);}
  }
  useEffect(()=>{loadOrders();},[]);
  useEffect(()=>{if(orderId)analyze(orderId);},[orderId]);

  const rows=useMemo(()=>data?.items||[],[data]);
  const s=data?.summary||{};

  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h3 className="text-lg font-black flex items-center gap-2"><Layers3 className="h-5 w-5 text-violet-700"/>تقسيم الكميات بين الموردين</h3><p className="mt-1 text-xs text-slate-500">لو أفضل مورد لا يغطي الكمية المعلنة، النظام يكمل تلقائيًا من البديل التالي في Preview فقط، مع إظهار MOQ والبونص والتكلفة.</p></div>
      <div className="flex flex-wrap gap-2 items-end"><label className="text-xs font-bold">الطلبية<select value={orderId} onChange={e=>setOrderId(e.target.value)} className="mt-1 min-w-[260px] rounded-lg border bg-white p-2 text-sm"><option value="">اختر طلبية</option>{orders.map(o=><option key={o.id} value={o.id}>{o.title||o.order_number} — {o.branch}</option>)}</select></label><button onClick={()=>analyze()} disabled={!orderId||loading} className="rounded-lg border bg-white px-3 py-2 text-sm font-bold flex items-center gap-2"><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/>إعادة الحساب</button></div>
    </div>

    {error&&<div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><AlertTriangle className="h-5 w-5"/>{error}</div>}

    {data&&<div className="grid grid-cols-2 xl:grid-cols-6 gap-2">
      <Metric icon={PackageCheck} label="أصناف الطلبية" value={s.items||0}/>
      <Metric icon={PackageCheck} label="مغطاة بالكامل" value={s.fully_covered_items||0}/>
      <Metric icon={Layers3} label="تحتاج أكثر من مورد" value={s.split_items||0}/>
      <Metric icon={AlertTriangle} label="وحدات غير مغطاة" value={num(s.unresolved_units)}/>
      <Metric icon={WalletCards} label="تكلفة الخطة" value={`${money(s.planned_cash_cost)} ج`}/>
      <Metric icon={PackageCheck} label="بونص متوقع" value={`${num(s.bonus_units)} وحدة`}/>
    </div>}

    {data&&<div className="space-y-2">{rows.map(item=>{const meta=statusMeta[item.status]||statusMeta.no_feasible_offer;return <div key={item.item_id} className="rounded-xl border bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-black">{item.product_name}</div><div className="text-xs text-slate-500">الاحتياج {num(item.needed_qty)}{item.urgent?' • عاجل/طلب عميل':''}</div></div><span className={`rounded-full px-2 py-1 text-xs font-bold ${meta[1]}`}>{meta[0]}</span></div>
      <div className="mt-3 overflow-auto"><table className="min-w-[900px] w-full text-sm"><thead className="bg-slate-50"><tr>{['المورد','شراء','بونص','وصول متوقع','تكلفة','تكلفة فعالة/وحدة','المتاح','MOQ','توريد','Score','السبب'].map(h=><th key={h} className="p-2 text-right">{h}</th>)}</tr></thead><tbody>{(item.lines||[]).map((line,i)=><tr key={`${line.offer_id}-${i}`} className="border-t"><td className="p-2 font-bold">{line.supplier_name}</td><td className="p-2">{num(line.purchase_qty)}</td><td className="p-2">{num(line.bonus_units)}</td><td className="p-2 font-bold">{num(line.received_units)}</td><td className="p-2">{money(line.cash_cost)} ج</td><td className="p-2">{money(line.effective_unit_cost)}</td><td className="p-2">{line.availability_unknown?'غير محدد':num(line.available_quantity)}</td><td className="p-2">{num(line.minimum_order_quantity)}</td><td className="p-2">{line.lead_time_days||0} يوم</td><td className="p-2 font-black">{Number(line.score||0).toFixed(1)}</td><td className="p-2 text-xs text-slate-600">{line.reason||'—'}</td></tr>)}{!(item.lines||[]).length&&<tr><td colSpan="11" className="p-4 text-center text-red-500">لا يوجد عرض صالح لتغطية هذا الصنف.</td></tr>}</tbody></table></div>
      {Number(item.unresolved_qty||0)>0&&<div className="mt-2 text-xs font-bold text-red-700">ما زال غير مغطى: {num(item.unresolved_qty)} وحدة.</div>}
    </div>})}</div>}

    <div className="rounded-xl border bg-slate-50 p-3 text-xs text-slate-600">الخطة استرشادية للمراجعة فقط ولا تغيّر المورد أو الكميات ولا تعتمد الطلبية. التوافر غير المحدد لا يتحول تلقائيًا إلى صفر، بينما التوافر المعلن الأقل من الاحتياج يسمح بتقسيم الصنف على أكثر من مورد.</div>
  </section>;
}

function Metric({icon:Icon,label,value}){return <div className="rounded-xl border bg-white p-3"><Icon className="h-4 w-4 text-violet-700"/><div className="mt-1 text-[11px] text-slate-500">{label}</div><div className="mt-1 font-black">{value}</div></div>}
