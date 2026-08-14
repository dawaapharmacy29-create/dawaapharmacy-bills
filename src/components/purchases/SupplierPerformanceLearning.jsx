import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, ShieldCheck, Truck, WalletCards } from 'lucide-react';
import { smartPurchaseUnifiedApi as api } from '@/api/smartPurchaseUnifiedApi';

const BRANCHES = [['all','كل الفروع'],['دواء الشامي','دواء الشامي'],['دواء شكري','دواء شكري']];
const money = (v) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(Number(v || 0));
const pct = (v) => v == null ? '—' : `${Number(v).toFixed(1)}%`;
const scoreClass = (v) => Number(v)>=90?'text-emerald-700':Number(v)>=80?'text-teal-700':Number(v)>=70?'text-blue-700':Number(v)>=60?'text-amber-700':'text-red-700';

export default function SupplierPerformanceLearning(){
  const [branch,setBranch]=useState('all');
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  async function load(next=branch){
    setLoading(true); setError('');
    try{ setData(await api.supplierPerformance(next)); }
    catch(e){ setError(e.message); }
    finally{ setLoading(false); }
  }
  useEffect(()=>{ load(branch); },[branch]);

  const rows=useMemo(()=>data?.suppliers||[],[data]);
  const s=data?.summary||{};

  return <section className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-lg font-black flex items-center gap-2"><Truck className="w-5 h-5 text-indigo-700"/>تعلم أداء الموردين من الاستلام الفعلي</h3>
        <p className="mt-1 text-xs text-slate-600">يقيس الالتزام بالكميات والأسعار ومواعيد التوريد من ملفات الاستلام المحفوظة، وليس من تقييم يدوي.</p>
      </div>
      <div className="flex gap-2">
        <select value={branch} onChange={e=>setBranch(e.target.value)} className="rounded-lg border bg-white p-2 text-sm">{BRANCHES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
        <button onClick={()=>load()} disabled={loading} className="rounded-lg border bg-white px-3 py-2 text-sm flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/>تحديث</button>
      </div>
    </div>

    {error&&<div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5"/>{error}</div>}

    <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
      <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">موردين لهم تاريخ فعلي</div><div className="text-xl font-black">{s.suppliers_with_history??0}</div></div>
      <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">استلامات محللة</div><div className="text-xl font-black">{s.receipts_analyzed??0}</div></div>
      <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">قيمة نقص التوريد المقدرة</div><div className="text-xl font-black text-amber-700">{money(s.shortage_value)} ج</div></div>
      <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">زيادة سعر فعلية</div><div className="text-xl font-black text-red-700">{money(s.price_overpay_value)} ج</div></div>
      <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">موردين بثقة عالية</div><div className="text-xl font-black text-emerald-700">{s.high_confidence_suppliers??0}</div></div>
    </div>

    {!data?.readiness?.ready && !loading && <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900 flex gap-2"><ShieldCheck className="w-5 h-5 shrink-0"/><div><div className="font-bold">التعلم جاهز لكنه لسه ما عندوش تاريخ كفاية</div><div className="text-xs mt-1">{data?.readiness?.reason}</div><div className="text-xs mt-1">من أول استلام فعلي جديد، النظام هيسجل الكمية المطلوبة والمستلمة والسعر المتوقع والفعلي والتأخير تلقائيًا.</div></div></div>}

    {rows.length>0 && <div className="overflow-auto rounded-2xl border bg-white"><table className="min-w-[1250px] w-full text-sm"><thead className="bg-indigo-50"><tr>{['المورد','Score','الثقة','الاستلامات','اكتمال الكمية','التزام السعر','في الموعد','متوسط التأخير','استلامات نظيفة','قيمة النقص','زيادة السعر','آخر استلام'].map(h=><th key={h} className="p-2 text-right">{h}</th>)}</tr></thead><tbody>{rows.map((r)=><tr key={r.supplier_name} className="border-t hover:bg-slate-50"><td className="p-2"><div className="font-black">{r.supplier_name}</div><div className="text-[11px] text-slate-400">{r.rating}</div></td><td className={`p-2 text-xl font-black ${scoreClass(r.performance_score)}`}>{Number(r.performance_score||0).toFixed(1)}</td><td className="p-2"><div className="font-bold">{r.confidence}%</div><div className="text-[11px] text-slate-400">{r.confidence_label}</div></td><td className="p-2">{r.receipt_count}</td><td className="p-2 font-bold">{pct(r.completion_rate)}</td><td className="p-2 font-bold">{pct(r.price_adherence)}</td><td className="p-2">{r.delivery_observations>0?pct(r.on_time_rate):'لا يوجد قياس بعد'}</td><td className="p-2">{r.avg_delay_days==null?'—':`${Number(r.avg_delay_days).toFixed(1)} يوم`}</td><td className="p-2">{pct(r.clean_receipt_rate)}</td><td className="p-2 text-amber-700 font-bold">{money(r.shortage_value)} ج</td><td className="p-2 text-red-700 font-bold">{money(r.price_overpay_value)} ج</td><td className="p-2">{r.last_receipt_date||'—'}</td></tr>)}</tbody></table></div>}

    <div className="grid md:grid-cols-3 gap-2 text-xs text-slate-600">
      <div className="rounded-xl border bg-white p-3 flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0"/>اكتمال الكمية يقيس هل المورد سلّم المطلوب فعليًا، وليس مجرد قبول الطلب.</div>
      <div className="rounded-xl border bg-white p-3 flex gap-2"><WalletCards className="w-4 h-4 text-teal-700 shrink-0"/>التزام السعر يقارن سعر الاستلام الفعلي بالسعر المتوقع وقت الطلب.</div>
      <div className="rounded-xl border bg-white p-3 flex gap-2"><Clock3 className="w-4 h-4 text-blue-700 shrink-0"/>تقييم الموعد لا يدخل بقوة إلا لما يكون فيه مدة توريد متوقعة وتاريخ إرسال فعلي محفوظين.</div>
    </div>
  </section>;
}
