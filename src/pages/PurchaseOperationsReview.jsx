import { useEffect, useMemo, useState } from 'react';
import { purchaseOperationsApi } from '@/api/operationsReviewApi';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';

const STATUS_LABELS = {
  draft: 'مسودة', under_review: 'تحت المراجعة', approved: 'معتمد', supplier_selected: 'تم اختيار المورد', ordered: 'تم الطلب',
  partially_received: 'استلام جزئي', received: 'تم الاستلام', invoice_matched: 'تمت مطابقة الفاتورة', closed: 'مغلق', cancelled: 'ملغي', shortage: 'نواقص',
};

export default function PurchaseOperationsReview() {
  const [data, setData] = useState({ issues: [], unified_orders: [], three_way_issues: [], summary: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [branches, setBranches] = useState({});

  async function refresh() {
    setLoading(true); setError('');
    try { setData(await purchaseOperationsApi.dashboard() || {}); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function run(action, success) {
    setLoading(true); setError(''); setMessage('');
    try { await action(); setMessage(success); await refresh(); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  const orders = useMemo(() => data.unified_orders || [], [data.unified_orders]);

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">مراجعة وتشغيل طلبيات المشتريات</h1><p className="text-sm text-slate-500 mt-1">توحيد الطلبات، إصلاح البيانات الناقصة، ومتابعة دورة الطلب حتى الإغلاق.</p></div>
        <button onClick={refresh} disabled={loading} className="rounded-lg border bg-white px-4 py-2 flex gap-2"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />تحديث</button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5" />{error}</div>}
      {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-700 flex gap-2"><CheckCircle2 className="w-5 h-5" />{message}</div>}

      <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <div className="rounded-xl border bg-white p-4"><div className="text-xs text-slate-500">مشكلات بيانات مفتوحة</div><div className="text-3xl font-bold mt-1">{data.summary?.open_issues || 0}</div></div>
        <div className="rounded-xl border bg-white p-4"><div className="text-xs text-slate-500">مسودات</div><div className="text-3xl font-bold mt-1">{data.summary?.draft_orders || 0}</div></div>
        <div className="rounded-xl border bg-white p-4"><div className="text-xs text-slate-500">تم الطلب</div><div className="text-3xl font-bold mt-1">{data.summary?.ordered_orders || 0}</div></div>
        <div className="rounded-xl border bg-white p-4"><div className="text-xs text-slate-500">نواقص</div><div className="text-3xl font-bold mt-1">{data.summary?.shortage_orders || 0}</div></div>
        <div className="rounded-xl border bg-white p-4"><div className="text-xs text-slate-500">فروق مطابقة ثلاثية</div><div className="text-3xl font-bold mt-1">{data.summary?.three_way_issues || 0}</div></div>
      </div>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 overflow-auto">
        <div className="p-4 font-bold text-amber-900">طلبات تحتاج استكمال بيانات ({(data.issues || []).length})</div>
        <table className="min-w-[900px] w-full text-sm bg-white"><thead className="bg-amber-50"><tr>{['رقم السجل','المشكلة','التفاصيل','الفرع الصحيح','الإجراء'].map((h)=><th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody>
          {(data.issues || []).map((x) => <tr key={x.id} className="border-t"><td className="p-3 font-mono text-xs">{x.record_id}</td><td className="p-3">{x.issue_code}</td><td className="p-3">{x.issue_message || x.details || '—'}</td><td className="p-3"><select value={branches[x.record_id] || ''} onChange={(e)=>setBranches({...branches,[x.record_id]:e.target.value})} className="rounded border p-2"><option value="">اختر</option><option>دواء الشامي</option><option>دواء شكري</option></select></td><td className="p-3"><button disabled={loading || !branches[x.record_id]} onClick={()=>run(()=>purchaseOperationsApi.fixBranch(x.record_id, branches[x.record_id]),'تم تحديد الفرع وإغلاق مشكلة البيانات.')} className="rounded bg-emerald-600 text-white px-3 py-2 disabled:opacity-40">حفظ الفرع</button></td></tr>)}
          {!(data.issues || []).length && <tr><td colSpan="5" className="p-8 text-center text-slate-500">لا توجد مشكلات بيانات مفتوحة.</td></tr>}
        </tbody></table>
      </section>

      <section className="rounded-2xl border bg-white overflow-auto shadow-sm">
        <div className="p-4 font-bold">كل الطلبات في دورة موحدة ({orders.length})</div>
        <table className="min-w-[1200px] w-full text-sm"><thead className="bg-slate-50"><tr>{['المصدر','التاريخ','الفرع','كود الصنف','الصنف','الكمية','المورد','الحالة','تحديث الحالة'].map((h)=><th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody>
          {orders.map((x) => <tr key={`${x.source_type}-${x.id}`} className="border-t"><td className="p-3">{x.source_type === 'pharmacy_order' ? 'طلب صيدلية' : 'إعادة تزويد'}</td><td className="p-3">{x.request_date || x.created_at?.slice?.(0,10) || '—'}</td><td className="p-3">{x.branch || 'غير محدد'}</td><td className="p-3">{x.product_code || '—'}</td><td className="p-3 font-medium">{x.product_name || '—'}</td><td className="p-3">{x.requested_quantity || 1}</td><td className="p-3">{x.supplier_name || x.ordered_supplier || '—'}</td><td className="p-3">{STATUS_LABELS[x.status] || x.status}</td><td className="p-3"><select value={x.status || 'draft'} onChange={(e)=>run(()=>purchaseOperationsApi.updateStatus(x.id,x.source_type,e.target.value),'تم تحديث حالة الطلب.')} className="rounded border p-2">{Object.entries(STATUS_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></td></tr>)}
        </tbody></table>
      </section>

      <section className="rounded-2xl border bg-white overflow-auto shadow-sm">
        <div className="p-4 font-bold">فروق المطابقة الثلاثية</div>
        <table className="min-w-[900px] w-full text-sm"><thead className="bg-slate-50"><tr>{['أمر الشراء','الاستلام','الفاتورة','نوع الفرق','القيمة','التفاصيل'].map((h)=><th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody>
          {(data.three_way_issues || []).map((x,i)=><tr key={x.id || i} className="border-t"><td className="p-3">{x.order_id || '—'}</td><td className="p-3">{x.receipt_id || '—'}</td><td className="p-3">{x.invoice_id || '—'}</td><td className="p-3">{x.issue_type || x.match_status || '—'}</td><td className="p-3">{x.variance_amount || x.value_variance || 0}</td><td className="p-3">{x.details || x.notes || '—'}</td></tr>)}
          {!(data.three_way_issues || []).length && <tr><td colSpan="6" className="p-8 text-center text-slate-500">لا توجد فروق مطابقة حاليًا.</td></tr>}
        </tbody></table>
      </section>
    </div>
  );
}