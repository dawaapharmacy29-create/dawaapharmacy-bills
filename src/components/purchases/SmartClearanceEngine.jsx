import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, CalendarClock, RefreshCw, ShieldAlert, Target, WalletCards } from 'lucide-react';
import { smartPurchaseUnifiedApi as api } from '@/api/smartPurchaseUnifiedApi';

const BRANCHES = [['all','كل الفروع'],['دواء الشامي','دواء الشامي'],['دواء شكري','دواء شكري']];
const money = (value) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(Number(value || 0));
const num = (value, digits = 0) => Number(value || 0).toFixed(digits);
const ACTION_META = {
  expired_quarantine: ['منتهي/عزل','bg-red-100 text-red-800'],
  urgent_clearance: ['تصريف عاجل','bg-red-100 text-red-800'],
  transfer_first: ['تحويل فرع أولًا','bg-blue-100 text-blue-800'],
  doctor_push_offer: ['دكاترة + عرض','bg-orange-100 text-orange-800'],
  controlled_push: ['دفع منظم','bg-amber-100 text-amber-800'],
  watch_push: ['مراقبة ودفع','bg-slate-100 text-slate-700'],
  natural_sell_ok: ['الحركة تكفي','bg-emerald-100 text-emerald-800'],
};

function Stat({ icon: Icon, label, value, hint }) {
  return <div className="rounded-2xl border bg-white p-3 shadow-sm"><div className="flex gap-2"><div className="rounded-xl bg-slate-50 p-2"><Icon className="h-4 w-4 text-teal-700" /></div><div><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-lg font-black">{value}</div>{hint&&<div className="mt-1 text-[11px] text-slate-400">{hint}</div>}</div></div></div>;
}

export default function SmartClearanceEngine() {
  const [branch,setBranch]=useState('all');
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [onlyAction,setOnlyAction]=useState(true);

  async function load(nextBranch=branch){
    setLoading(true); setError('');
    try { setData(await api.smartClearanceEngine(nextBranch)); }
    catch(e){ setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(()=>{load(branch);},[branch]);

  const rows=useMemo(()=>{
    const all=data?.plan||[];
    return onlyAction ? all.filter(r=>Number(r.units_to_act||0)>0 || Number(r.days_to_expiry||0)<0) : all;
  },[data,onlyAction]);
  const s=data?.summary||{};

  return <section className="rounded-2xl border border-orange-200 bg-orange-50/30 p-4 shadow-sm space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-black flex items-center gap-2"><Target className="w-6 h-6 text-orange-700"/>محرك التصريف الذكي قبل الصلاحية</h2><p className="mt-1 text-xs text-slate-600">يحسب ما سيتحرك طبيعيًا، وما يحتاج تدخل، ويفضل التحويل بين الفروع قبل الخصم أو الضغط البيعي.</p></div>
      <div className="flex flex-wrap gap-2"><select value={branch} onChange={e=>setBranch(e.target.value)} className="rounded-lg border bg-white p-2 text-sm">{BRANCHES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><label className="flex items-center gap-2 rounded-lg border bg-white px-3 text-xs font-bold"><input type="checkbox" checked={onlyAction} onChange={e=>setOnlyAction(e.target.checked)}/>المحتاج تدخل فقط</label><button onClick={()=>load()} disabled={loading} className="rounded-lg border bg-white px-3 py-2 text-sm flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/>تحديث</button></div>
    </div>
    {error&&<div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5"/>{error}</div>}

    <div className="grid grid-cols-2 xl:grid-cols-6 gap-2">
      <Stat icon={CalendarClock} label="Batches تمت مراجعتها" value={num(s.batches_reviewed)} />
      <Stat icon={ShieldAlert} label="Batches محتاجة تدخل" value={num(s.batches_needing_action)} />
      <Stat icon={Target} label="وحدات محتاجة تصرف" value={num(s.units_needing_action)} />
      <Stat icon={WalletCards} label="رأس مال معرض للخطر" value={`${money(s.capital_at_risk)} ج`} />
      <Stat icon={ArrowRightLeft} label="قابل للتحويل بين الفروع" value={`${money(s.transferable_capital)} ج`} />
      <Stat icon={Target} label="هدف التصريف اليومي" value={`${num(s.daily_units_target)} وحدة`} hint="تجميعي لكل الأصناف المحتاجة تدخل" />
    </div>

    <div className="overflow-auto rounded-2xl border bg-white"><table className="min-w-[1550px] w-full text-sm"><thead className="bg-orange-50"><tr>{['الأولوية','الفرع','الصنف / Batch','الصلاحية','كمية الباتش','يتحرك طبيعيًا','لازم نتدخل في','هدف/يوم','رأس مال معرض','تحويل مقترح','دفع محلي','حد خصم استرشادي','الإجراء'].map(h=><th key={h} className="p-2 text-right">{h}</th>)}</tr></thead><tbody>
      {rows.map((r,i)=>{const meta=ACTION_META[r.action_code]||ACTION_META.watch_push;return <tr key={`${r.batch_id}-${i}`} className="border-t align-top hover:bg-slate-50"><td className="p-2 font-black">{r.priority_score}</td><td className="p-2">{r.branch}</td><td className="p-2"><div className="font-bold">{r.product_name}</div><div className="text-[11px] text-slate-400">{r.batch_number||'بدون Batch'} • {r.product_code||'بدون كود'}</div></td><td className={`p-2 font-bold ${Number(r.days_to_expiry)<0?'text-red-800':Number(r.days_to_expiry)<=30?'text-red-700':Number(r.days_to_expiry)<=60?'text-orange-700':''}`}>{r.expiry_date}<div className="text-[11px]">{r.days_to_expiry} يوم</div></td><td className="p-2">{num(r.batch_quantity)}</td><td className="p-2 text-emerald-700 font-bold">{num(r.natural_sell_before_danger)}</td><td className="p-2 font-black text-orange-800">{num(r.units_to_act)}</td><td className="p-2 font-black">{num(r.daily_clearance_target)}</td><td className="p-2 font-black">{money(r.capital_at_risk)} ج</td><td className="p-2">{Number(r.suggested_transfer_units)>0?<div><b>{num(r.suggested_transfer_units)} وحدة</b><div className="text-[11px] text-blue-700">إلى {r.transfer_branch} • تغطية {num(r.transfer_branch_coverage,1)} يوم</div></div>:'—'}</td><td className="p-2">{num(r.local_push_units)} وحدة</td><td className="p-2">{Number(r.suggested_discount_ceiling_percent)>0?`≤ ${num(r.suggested_discount_ceiling_percent,1)}%`:'—'}</td><td className="p-2 max-w-[280px]"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${meta[1]}`}>{meta[0]}</span><div className="mt-1 text-[11px] text-slate-600">{r.action_label}</div></td></tr>})}
      {!loading&&!rows.length&&<tr><td colSpan="13" className="p-8 text-center text-slate-400">لا توجد Batches تحتاج تدخل حاليًا، أو لم يتم رفع بيانات الصلاحية بعد.</td></tr>}
    </tbody></table></div>

    <div className="grid md:grid-cols-3 gap-2 text-xs text-slate-600"><div className="rounded-xl bg-white border p-3">منطقة الخطر تبدأ قبل الصلاحية بـ30 يوم. النظام يحسب كمية متوقع تتحرك طبيعيًا قبلها بدل ما يعتبر كل الـBatch خطر.</div><div className="rounded-xl bg-white border p-3">لو الفرع الآخر ناقص نفس الصنف، التحويل له يأخذ أولوية قبل الخصم ويحمي رأس المال والهامش.</div><div className="rounded-xl bg-white border p-3">حد الخصم استرشادي ومحسوب كنسبة من هامش الربح؛ المحرك لا يعتمد تلقائيًا بيعًا تحت التكلفة.</div></div>
  </section>;
}
