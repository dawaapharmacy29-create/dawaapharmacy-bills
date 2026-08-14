import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock3, PackageCheck, RefreshCw, Truck, WalletCards } from 'lucide-react';
import { smartPurchaseUnifiedApi as api } from '@/api/smartPurchaseUnifiedApi';

const money = (v) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(v || 0));
const num = (v, d = 0) => Number(v || 0).toFixed(d);

const statusMeta = {
  ready: ['جاهز للمراجعة','bg-emerald-100 text-emerald-800'],
  no_offer: ['لا يوجد عرض','bg-red-100 text-red-800'],
  availability_gap: ['الكمية لا تكفي','bg-orange-100 text-orange-800'],
  moq_overbuy: ['MOQ يسبب زيادة','bg-amber-100 text-amber-800'],
};

export default function SupplierDecisionAdvisor() {
  const [orders,setOrders]=useState([]);
  const [orderId,setOrderId]=useState('');
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');

  async function loadOrders(){
    setError('');
    try {
      const d=await api.dashboard();
      const rows=(d?.orders||[]).filter(o=>!['مغلقة','cancelled','ملغاة'].includes(String(o.status||'')));
      setOrders(rows);
      if(!orderId && rows.length) setOrderId(rows[0].id);
    } catch(e){setError(e.message);}
  }
  async function analyze(id=orderId){
    if(!id) return;
    setLoading(true);setError('');
    try{setData(await api.supplierDecision(id));}
    catch(e){setError(e.message);setData(null);}
    finally{setLoading(false);}
  }
  useEffect(()=>{loadOrders();},[]);
  useEffect(()=>{if(orderId) analyze(orderId);},[orderId]);

  const s=data?.summary||{};
  const rows=useMemo(()=>data?.items||[],[data]);
  const noOffers=Number(data?.offers_loaded||0)===0;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h3 className="text-lg font-black flex items-center gap-2"><Truck className="h-5 w-5 text-blue-700"/>مستشار اختيار المورد</h3><p className="mt-1 text-xs text-slate-500">يقارن التكلفة الفعالة بعد البونص مع MOQ والتوافر وسرعة التوريد وأجل السداد. استشارة فقط قبل الاعتماد.</p></div>
      <div className="flex flex-wrap gap-2 items-end"><label className="text-xs font-bold">الطلبية<select value={orderId} onChange={e=>setOrderId(e.target.value)} className="mt-1 min-w-[260px] rounded-lg border bg-white p-2 text-sm"><option value="">اختر طلبية</option>{orders.map(o=><option key={o.id} value={o.id}>{o.title||o.order_number} — {o.branch}</option>)}</select></label><button onClick={()=>analyze()} disabled={!orderId||loading} className="rounded-lg border bg-white px-3 py-2 text-sm font-bold flex items-center gap-2"><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/>إعادة التحليل</button></div>
    </div>

    {error&&<div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><AlertTriangle className="h-5 w-5"/>{error}</div>}
    {noOffers&&data&&<div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800"><b>لا توجد عروض موردين مرفوعة حاليًا.</b> المستشار جاهز، لكن لن يختار موردًا بالافتراض. ارفع عروض الموردين أولًا، ثم أعد التحليل.</div>}

    {data&&<div className="grid grid-cols-2 xl:grid-cols-6 gap-2">
      <Metric icon={PackageCheck} label="أصناف الطلبية" value={s.items||0}/>
      <Metric icon={PackageCheck} label="لها عرض قابل للمراجعة" value={s.ready||0}/>
      <Metric icon={AlertTriangle} label="بدون عروض" value={s.without_offers||0}/>
      <Metric icon={AlertTriangle} label="فجوة توافر" value={s.availability_gaps||0}/>
      <Metric icon={WalletCards} label="تكلفة نقدية مقترحة" value={`${money(s.recommended_cash_cost)} ج`}/>
      <Metric icon={PackageCheck} label="بونص متوقع" value={`${num(s.estimated_bonus_units)} وحدة`}/>
    </div>}

    {data&&<div className="overflow-auto rounded-xl border bg-white"><table className="min-w-[1450px] w-full text-sm"><thead className="bg-slate-50"><tr>{['الصنف','الاحتياج','الحالة','المورد المقترح','كمية الشراء','بونص','تكلفة نقدية','تكلفة فعالة/وحدة','MOQ','التوافر','التوريد','الأجل','Score','سبب الاختيار'].map(h=><th key={h} className="p-2 text-right">{h}</th>)}</tr></thead><tbody>{rows.map(r=>{const m=r.recommended||{};const meta=statusMeta[r.status]||statusMeta.no_offer;return <tr key={r.item_id} className="border-t align-top hover:bg-slate-50"><td className="p-2"><div className="font-bold">{r.product_name}</div>{r.urgent&&<span className="text-[11px] font-bold text-red-700">عاجل/طلب عميل</span>}</td><td className="p-2 font-bold">{num(r.needed_qty)}</td><td className="p-2"><span className={`rounded-full px-2 py-1 text-xs font-bold ${meta[1]}`}>{meta[0]}</span></td><td className="p-2 font-black">{m.supplier_name||'—'}</td><td className="p-2">{m.purchase_qty!=null?num(m.purchase_qty):'—'}{Number(m.overbuy_units||0)>0&&<div className="text-[11px] text-amber-700">+{num(m.overbuy_units)} زيادة بسبب MOQ</div>}</td><td className="p-2">{m.earned_bonus_units!=null?num(m.earned_bonus_units):'—'}</td><td className="p-2 font-bold">{m.cash_cost!=null?`${money(m.cash_cost)} ج`:'—'}</td><td className="p-2">{m.effective_unit_cost!=null?money(m.effective_unit_cost):'—'}</td><td className="p-2">{m.minimum_order_quantity!=null?num(m.minimum_order_quantity):'—'}</td><td className="p-2">{m.supplier_name?(m.availability_unknown?'غير محدد':m.quantity_fully_available?'يكفي':'لا يكفي'):'—'}</td><td className="p-2">{m.supplier_name?<span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5"/>{m.lead_time_days||0} يوم</span>:'—'}</td><td className="p-2">{m.supplier_name?(Number(m.payment_terms_days||0)>0?`${m.payment_terms_days} يوم`:m.payment_type||'—'):'—'}</td><td className="p-2 font-black">{m.recommendation_score!=null?num(m.recommendation_score,1):'—'}</td><td className="p-2 max-w-[300px] text-xs text-slate-600">{m.reason||'ارفع عرض مورد لهذا الصنف'}</td></tr>})}{!loading&&!rows.length&&<tr><td colSpan="14" className="p-8 text-center text-slate-400">اختر طلبية لعرض مقارنة الموردين.</td></tr>}</tbody></table></div>}

    <div className="rounded-xl border bg-slate-50 p-3 text-xs text-slate-600">المستشار لا يغيّر المورد أو الكمية ولا يعتمد الطلبية. لو عرض أرخص لكنه يفرض MOQ كبير أو يتأخر في صنف عاجل، يتم خفض ترتيبه بدل اختيار الأرخص بشكل أعمى.</div>
  </div>;
}

function Metric({icon:Icon,label,value}){return <div className="rounded-xl border bg-white p-3"><Icon className="h-4 w-4 text-blue-700"/><div className="mt-1 text-[11px] text-slate-500">{label}</div><div className="mt-1 font-black">{value}</div></div>}
