import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, RefreshCw, ShieldCheck, ShoppingCart, Sparkles } from 'lucide-react';
import { smartPurchaseUnifiedApi as api } from '@/api/smartPurchaseUnifiedApi';

const BRANCHES = ['دواء الشامي', 'دواء شكري'];
const money = (value) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(Number(value || 0));
const num = (value, digits = 0) => Number(value || 0).toFixed(digits);

export default function SafePurchaseDraftBuilder() {
  const [branch, setBranch] = useState('دواء الشامي');
  const [targetBudget, setTargetBudget] = useState('');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [created, setCreated] = useState(null);

  async function loadPreview() {
    setLoading(true); setError(''); setMessage(''); setCreated(null);
    try {
      const result = await api.safeDraftPreview({ branch, targetBudget });
      setPreview(result || null);
      if (!targetBudget && Number(result?.safe_cap_today || 0) > 0) setTargetBudget(String(Math.floor(Number(result.safe_cap_today))));
    } catch (e) { setError(e.message); setPreview(null); }
    finally { setLoading(false); }
  }

  useEffect(() => { setPreview(null); setTargetBudget(''); setCreated(null); setMessage(''); setError(''); }, [branch]);

  async function createDraft() {
    if (!preview?.items_count) return;
    const ok = window.confirm(`إنشاء مسودة طلبية لـ ${branch} بقيمة تقديرية ${money(preview.estimated_total)} جنيه؟\n\nلن يتم اعتمادها أو إرسالها للمورد تلقائيًا.`);
    if (!ok) return;
    setCreating(true); setError(''); setMessage('');
    try {
      const result = await api.createSafeDraft({ branch, targetBudget });
      setCreated(result);
      setMessage(`${result?.message || 'تم إنشاء المسودة.'} رقم الطلبية: ${result?.order_number || ''}`);
    } catch (e) { setError(e.message); }
    finally { setCreating(false); }
  }

  function goToOrders() {
    document.getElementById('purchase-order-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const plan = preview?.plan || [];
  return <section className="rounded-3xl border border-teal-200 bg-gradient-to-b from-teal-50/60 to-white p-4 shadow-sm space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-black flex items-center gap-2"><Sparkles className="w-5 h-5 text-teal-700" />كوّن لي الطلبية الآمنة</h2>
        <p className="mt-1 text-xs text-slate-600">يحوّل قرار اليوم إلى مسودة قابلة للمراجعة: يختار الاحتياج الأعلى أولوية، يلتزم بحد الشراء الآمن، ولا يعتمد المورد أو الطلبية تلقائيًا.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-lg border bg-white p-2 text-sm">{BRANCHES.map((b) => <option key={b}>{b}</option>)}</select>
        <button onClick={loadPreview} disabled={loading} className="rounded-lg border bg-white px-3 py-2 text-sm font-bold flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />احسب المسودة</button>
      </div>
    </div>

    <div className="grid md:grid-cols-[1fr_auto] gap-2 items-end rounded-2xl border bg-white p-3">
      <label className="text-xs font-bold">الميزانية التي تريد تخصيصها لهذه الطلبية
        <input type="number" min="0" value={targetBudget} onChange={(e) => { setTargetBudget(e.target.value); setPreview(null); }} placeholder="اتركها فارغة لاستخدام أقصى شراء مقترح اليوم" className="mt-1 w-full rounded-lg border p-2 text-base" />
      </label>
      <button onClick={loadPreview} disabled={loading} className="rounded-lg bg-slate-900 text-white px-4 py-2.5 font-bold flex items-center justify-center gap-2"><Eye className="w-4 h-4" />معاينة قبل الإنشاء</button>
    </div>

    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5 shrink-0" />{error}</div>}
    {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 flex gap-2"><CheckCircle2 className="w-5 h-5 shrink-0" /><div>{message}{created && <button onClick={goToOrders} className="mr-3 underline font-bold">اذهب لتنفيذ الطلبية</button>}</div></div>}

    {preview && <>
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-2">
        <div className="rounded-xl border bg-white p-3"><div className="text-[11px] text-slate-500">أقصى شراء آمن اليوم</div><div className="mt-1 font-black">{money(preview.safe_cap_today)} ج</div></div>
        <div className="rounded-xl border bg-white p-3"><div className="text-[11px] text-slate-500">ميزانية التخطيط المستخدمة</div><div className="mt-1 font-black">{money(preview.planning_budget)} ج</div></div>
        <div className="rounded-xl border bg-white p-3"><div className="text-[11px] text-slate-500">قيمة المسودة التقديرية</div><div className="mt-1 font-black text-teal-800">{money(preview.estimated_total)} ج</div></div>
        <div className="rounded-xl border bg-white p-3"><div className="text-[11px] text-slate-500">عدد الأصناف</div><div className="mt-1 font-black">{preview.items_count || 0}</div></div>
        <div className="rounded-xl border bg-white p-3"><div className="text-[11px] text-slate-500">غير مستخدم من الميزانية</div><div className="mt-1 font-black">{money(preview.remaining_budget)} ج</div></div>
      </div>

      {preview.message && <div className={`rounded-xl border p-3 text-sm flex gap-2 ${preview.items_count ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}><ShieldCheck className="w-5 h-5 shrink-0" />{preview.message}</div>}

      {!!plan.length && <div className="overflow-auto rounded-2xl border bg-white"><table className="min-w-[1250px] w-full text-sm"><thead className="bg-teal-50"><tr>{['#','الصنف','الرصيد','المنتظر','تغطية','احتياج الشهر','كمية المسودة','تكلفة الوحدة','إجمالي تقديري','طلبات العملاء','الأولوية','سبب الاختيار'].map((h) => <th key={h} className="p-2 text-right">{h}</th>)}</tr></thead><tbody>
        {plan.map((r, i) => <tr key={`${r.product_code || r.product_name}-${i}`} className="border-t hover:bg-slate-50"><td className="p-2 font-black">{i + 1}</td><td className="p-2"><div className="font-bold">{r.product_name}</div><div className="text-[11px] text-slate-400">{r.product_code || 'بدون كود'}</div></td><td className="p-2">{num(r.current_stock, 1)}</td><td className="p-2">{num(r.pending_incoming, 1)}</td><td className="p-2">{r.coverage_days == null ? '—' : `${num(r.coverage_days, 1)} يوم`}</td><td className="p-2">{num(r.month_need_qty)}</td><td className="p-2 font-black text-teal-800">{num(r.proposed_quantity)}</td><td className="p-2">{money(r.unit_cost)} ج</td><td className="p-2 font-black">{money(r.estimated_total)} ج</td><td className="p-2">{r.effective_customer_requests || 0}</td><td className="p-2">{num(r.priority_score, 0)}</td><td className="p-2 text-xs text-slate-600">{r.reason}</td></tr>)}
      </tbody></table></div>}

      {!!plan.length && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-3"><div className="text-xs text-slate-600"><b>مهم:</b> التكلفة هنا تقديرية من آخر تكلفة شراء/التحليل. بعد إنشاء المسودة راجع عروض الموردين والخصم والـMOQ قبل الاعتماد.</div><button onClick={createDraft} disabled={creating} className="rounded-xl bg-teal-700 text-white px-4 py-2.5 font-black flex items-center gap-2 disabled:opacity-50"><ShoppingCart className="w-4 h-4" />{creating ? 'جاري إنشاء المسودة...' : 'إنشاء المسودة للمراجعة'}</button></div>}
    </>}
  </section>;
}
