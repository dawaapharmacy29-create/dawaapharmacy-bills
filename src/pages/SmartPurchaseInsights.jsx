import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, Upload, Sparkles, Users, BarChart3, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { smartPurchaseOrderManagementApi as ordersApi } from '@/api/smartPurchaseOrderManagementApi';
import { smartPurchaseAdvancedApi as api } from '@/api/smartPurchaseAdvancedApi';

const money = (v) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(v || 0));
const num = (v) => { const n = Number(String(v ?? '').replace(/[,٪%جنيه]/g, '').trim()); return Number.isFinite(n) ? n : 0; };
function downloadWorkbook(sheets, name) { const wb = XLSX.utils.book_new(); Object.entries(sheets).forEach(([sheet, rows]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheet.slice(0, 31))); XLSX.writeFile(wb, name); }

export default function SmartPurchaseInsights() {
  const [orders, setOrders] = useState([]);
  const [orderId, setOrderId] = useState('');
  const [evaluation, setEvaluation] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [budget, setBudget] = useState(0);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refreshBase() {
    try {
      const [o, s] = await Promise.all([ordersApi.listOrders(), api.supplierPerformance()]);
      setOrders(o || []); setSuppliers(s || []);
      if (!orderId && o?.[0]?.id) setOrderId(o[0].id);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { refreshBase(); }, []);
  useEffect(() => { if (orderId) openOrder(orderId); }, [orderId]);

  async function openOrder(id) {
    setLoading(true); setError('');
    try {
      const [e, f] = await Promise.all([api.orderEvaluation(id), api.listFollowups(id)]);
      setEvaluation(e); setFollowups(f || []); setBudget(Number(e?.order?.budget || e?.expected_total || 0)); setPlan(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function previewBudget() {
    if (!orderId || budget <= 0) return setError('اكتب ميزانية صحيحة أولًا.');
    setLoading(true); setError('');
    try { setPlan(await api.budgetPreview(orderId, budget)); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function applyPlan() {
    if (!plan?.items?.length) return;
    setLoading(true); setError('');
    try {
      await api.applyBudgetPlan(orderId, budget, plan.items);
      setMessage('تم تطبيق خطة الميزانية على الطلبية.');
      await openOrder(orderId); await refreshBase();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function createFollowups() {
    setLoading(true); setError('');
    try {
      const r = await api.createCustomerFollowups(orderId);
      setMessage(`تم إنشاء ${r.created || 0} متابعة جديدة للعملاء.`);
      setFollowups(await api.listFollowups(orderId) || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function updateLocal(id, key, value) { setFollowups(rows => rows.map(x => x.id === id ? { ...x, [key]: value } : x)); }
  async function saveFollowups() {
    setLoading(true); setError('');
    try { await api.updateFollowups(followups); setMessage('تم حفظ نتائج التواصل.'); await openOrder(orderId); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function importFollowups(file) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const byPhone = new Map(followups.map(x => [`${String(x.phone || '').trim()}|${String(x.product_name || '').trim()}`, x]));
    const rows = raw.map(r => {
      const phone = String(r['الهاتف'] || r.phone || '').trim();
      const product = String(r['اسم الصنف'] || r.product_name || '').trim();
      const current = byPhone.get(`${phone}|${product}`);
      return current ? { ...current, status: String(r['الحالة'] || current.status), contact_result: String(r['نتيجة التواصل'] || current.contact_result || ''), notes: String(r['ملاحظات'] || current.notes || '') } : null;
    }).filter(Boolean);
    if (!rows.length) return setError('لم يتم العثور على صفوف مطابقة للهاتف واسم الصنف.');
    await api.updateFollowups(rows); setMessage(`تم تحديث ${rows.length} متابعة من Excel.`); await openOrder(orderId);
  }

  function exportFollowups() {
    downloadWorkbook({ 'متابعة العملاء': followups.map(x => ({
      'المعرف': x.id, 'اسم الصنف': x.product_name, 'كود الصنف': x.product_code, 'اسم العميل': x.customer_name,
      'كود العميل': x.customer_code, 'الهاتف': x.phone, 'الفرع': x.branch, 'تاريخ الطلب': x.request_date,
      'الحالة': x.status, 'نتيجة التواصل': x.contact_result || '', 'ملاحظات': x.notes || ''
    })) }, `متابعة_عملاء_${evaluation?.order?.order_number || 'طلبية'}.xlsx`);
  }

  function exportReport() {
    downloadWorkbook({
      'تقييم الطلبية': evaluation ? [{
        'رقم الطلبية': evaluation.order?.order_number, 'الفرع': evaluation.order?.branch, 'التقييم': evaluation.score,
        'نسبة التوريد %': evaluation.fill_rate, 'القيمة المتوقعة': evaluation.expected_total, 'القيمة الفعلية': evaluation.actual_total,
        'فرق القيمة': evaluation.value_variance, 'أصناف سليمة': evaluation.complete_items, 'أصناف ناقصة': evaluation.shortage_items,
        'أصناف بها مشاكل': evaluation.issue_items, 'عملاء بانتظار التواصل': evaluation.customers_waiting
      }] : [],
      'تقييم الموردين': suppliers.map(x => ({
        'المورد': x.supplier_name, 'التقييم': x.score, 'نسبة التوريد %': x.fill_rate, 'فرق السعر %': x.price_variance_percent,
        'عدد الأصناف': x.items_count, 'الكمية المطلوبة': x.ordered_quantity, 'الكمية المستلمة': x.received_quantity,
        'أصناف ناقصة': x.shortage_items, 'مشاكل': x.issue_items
      }))
    }, `تقييم_المشتريات_${evaluation?.order?.order_number || 'تقرير'}.xlsx`);
  }

  const stats = useMemo(() => evaluation ? [
    ['تقييم الطلبية', `${Number(evaluation.score || 0).toFixed(0)}/100`],
    ['نسبة التوريد', `${Number(evaluation.fill_rate || 0).toFixed(1)}%`],
    ['فرق القيمة', `${money(evaluation.value_variance)} ج`],
    ['عملاء ينتظرون', evaluation.customers_waiting || 0],
  ] : [], [evaluation]);

  return <div dir="rtl" className="p-4 md:p-6 space-y-5">
    <div><h1 className="text-2xl font-bold">تقييم وتحسين المشتريات</h1><p className="text-sm text-slate-500 mt-1">تحسين الميزانية، تقييم الموردين، تقييم الطلبية، ومتابعة العملاء بعد وصول الأصناف.</p></div>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5" />{error}</div>}
    {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">{message}</div>}

    <section className="rounded-2xl border bg-white p-4 shadow-sm flex flex-wrap gap-3 items-end">
      <label className="text-sm min-w-64">الطلبية<select value={orderId} onChange={e => setOrderId(e.target.value)} className="mt-1 w-full rounded-lg border p-2"><option value="">اختر الطلبية</option>{orders.map(o => <option key={o.id} value={o.id}>{o.order_number} — {o.branch} — {o.status}</option>)}</select></label>
      <label className="text-sm">الميزانية<input type="number" value={budget} onChange={e => setBudget(num(e.target.value))} className="mt-1 w-44 rounded-lg border p-2" /></label>
      <button disabled={loading || !orderId} onClick={previewBudget} className="rounded-lg bg-violet-600 text-white px-4 py-2 font-semibold flex gap-2"><Sparkles className="w-4 h-4" />معاينة خطة الميزانية</button>
      <button disabled={loading || !plan?.items?.length} onClick={applyPlan} className="rounded-lg bg-emerald-600 text-white px-4 py-2 font-semibold flex gap-2"><CheckCircle2 className="w-4 h-4" />تطبيق الخطة</button>
      <button onClick={exportReport} className="rounded-lg border px-4 py-2 font-semibold flex gap-2"><Download className="w-4 h-4" />تصدير التقرير</button>
    </section>

    {evaluation && <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">{stats.map(([l, v]) => <div key={l} className="rounded-2xl border bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">{l}</div><div className="mt-2 text-xl font-bold">{v}</div></div>)}</div>}

    {plan && <section className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex justify-between gap-3 mb-3"><h2 className="font-bold">خطة الميزانية المقترحة</h2><div className="text-sm">المطلوب: <b>{money(plan.requested_total)} ج</b> — المخصص: <b>{money(plan.allocated_total)} ج</b></div></div><div className="overflow-auto"><table className="min-w-[800px] w-full text-sm"><thead className="bg-slate-50"><tr>{['الصنف','الأولوية','طلبات العملاء','الكمية الأصلية','الكمية المقترحة','القيمة المخصصة'].map(h => <th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody>{plan.items.map(x => <tr key={x.id} className="border-t"><td className="p-3 font-semibold">{x.product_name}</td><td className="p-3">{x.priority_score}</td><td className="p-3">{x.customer_requests_count}</td><td className="p-3">{x.requested_qty}</td><td className="p-3 font-bold">{x.recommended_qty}</td><td className="p-3">{money(x.allocated_value)}</td></tr>)}</tbody></table></div></section>}

    <section className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex flex-wrap justify-between gap-2 mb-3"><h2 className="font-bold flex gap-2"><BarChart3 className="w-5 h-5" />تقييم الموردين</h2></div><div className="overflow-auto"><table className="min-w-[850px] w-full text-sm"><thead className="bg-slate-50"><tr>{['المورد','التقييم','نسبة التوريد','فرق السعر','الأصناف','النواقص','المشاكل'].map(h => <th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody>{suppliers.map(x => <tr key={x.supplier_name} className="border-t"><td className="p-3 font-semibold">{x.supplier_name}</td><td className="p-3 font-bold">{Number(x.score || 0).toFixed(0)}/100</td><td className="p-3">{x.fill_rate}%</td><td className="p-3">{x.price_variance_percent}%</td><td className="p-3">{x.items_count}</td><td className="p-3">{x.shortage_items}</td><td className="p-3">{x.issue_items}</td></tr>)}</tbody></table></div></section>

    <section className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex flex-wrap justify-between items-center gap-2 mb-3"><h2 className="font-bold flex gap-2"><Users className="w-5 h-5" />عملاء الأصناف التي وصلت</h2><div className="flex flex-wrap gap-2"><button disabled={!orderId || loading} onClick={createFollowups} className="rounded-lg bg-cyan-600 text-white px-3 py-2 text-sm font-semibold">إنشاء المتابعات</button><button onClick={exportFollowups} className="rounded-lg border px-3 py-2 text-sm font-semibold flex gap-2"><Download className="w-4 h-4" />تصدير Excel</button><label className="rounded-lg border px-3 py-2 text-sm font-semibold cursor-pointer flex gap-2"><Upload className="w-4 h-4" />استيراد النتائج<input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => e.target.files?.[0] && importFollowups(e.target.files[0])} /></label><button disabled={loading || !followups.length} onClick={saveFollowups} className="rounded-lg bg-slate-800 text-white px-3 py-2 text-sm font-semibold">حفظ النتائج</button></div></div><div className="overflow-auto"><table className="min-w-[1050px] w-full text-sm"><thead className="bg-slate-50"><tr>{['الصنف','العميل','الهاتف','تاريخ الطلب','الحالة','نتيجة التواصل','ملاحظات'].map(h => <th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody>{followups.map(x => <tr key={x.id} className="border-t"><td className="p-3 font-semibold">{x.product_name}</td><td className="p-3">{x.customer_name || '-'}</td><td className="p-3" dir="ltr">{x.phone || '-'}</td><td className="p-3">{x.request_date || '-'}</td><td className="p-3"><select value={x.status} onChange={e => updateLocal(x.id, 'status', e.target.value)} className="rounded border p-2"><option>بانتظار التواصل</option><option>تم التواصل</option><option>تم الحجز</option><option>تم البيع</option><option>لم يرد</option><option>لم يعد يحتاجه</option><option>اشترى من مكان آخر</option></select></td><td className="p-3"><input value={x.contact_result || ''} onChange={e => updateLocal(x.id, 'contact_result', e.target.value)} className="w-48 rounded border p-2" /></td><td className="p-3"><input value={x.notes || ''} onChange={e => updateLocal(x.id, 'notes', e.target.value)} className="w-52 rounded border p-2" /></td></tr>)}</tbody></table></div></section>
  </div>;
}
