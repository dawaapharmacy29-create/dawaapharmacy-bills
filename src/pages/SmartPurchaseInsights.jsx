import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, Upload, Users, BarChart3, AlertTriangle } from 'lucide-react';
import { smartPurchaseOrderManagementApi as ordersApi } from '@/api/smartPurchaseOrderManagementApi';
import { smartPurchaseAdvancedApi as api } from '@/api/smartPurchaseAdvancedApi';
import { smartPurchaseUnifiedApi as unified } from '@/api/smartPurchaseUnifiedApi';

const money = (v) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(v || 0));
const num = (v) => { const n = Number(String(v ?? '').replace(/[,٪%جنيه]/g, '').trim()); return Number.isFinite(n) ? n : 0; };
function downloadWorkbook(sheets, name) { const wb = XLSX.utils.book_new(); Object.entries(sheets).forEach(([sheet, rows]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheet.slice(0, 31))); XLSX.writeFile(wb, name); }

export default function SmartPurchaseInsights() {
  const [orders, setOrders] = useState([]);
  const [orderId, setOrderId] = useState('');
  const [evaluation, setEvaluation] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [supplierPerformance, setSupplierPerformance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refreshBase() {
    try {
      const [o, s] = await Promise.all([ordersApi.listOrders(), unified.supplierPerformance('all')]);
      setOrders((o || []).filter((row) => ['received','partially_received','وصلت بالكامل','وصلت جزئيًا','تمت مطابقة الفاتورة','مغلقة'].includes(String(row.status || '').trim())));
      setSupplierPerformance(s || null);
      setSuppliers(s?.suppliers || []);
      if (!orderId && o?.[0]?.id) setOrderId(o[0].id);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { refreshBase(); }, []);
  useEffect(() => { if (orderId) openOrder(orderId); }, [orderId]);

  async function openOrder(id) {
    setLoading(true); setError('');
    try {
      const [e, f] = await Promise.all([api.orderEvaluation(id), api.listFollowups(id)]);
      setEvaluation(e); setFollowups(f || []);
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
        'المورد': x.supplier_name, 'التقييم': x.performance_score, 'الثقة %': x.confidence, 'نسبة التوريد %': x.completion_rate,
        'التزام السعر %': x.price_adherence, 'الاستلامات': x.receipt_count, 'قيمة النقص': x.shortage_value,
        'زيادة السعر': x.price_overpay_value, 'آخر استلام': x.last_receipt_date
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
    <div className="flex items-center gap-3"><div className="rounded-xl bg-teal-50 p-2.5"><BarChart3 className="h-6 w-6 text-teal-600" /></div><div><h1 className="text-2xl font-bold">تقييم وتحسين المشتريات</h1><p className="text-sm text-slate-500 mt-1">تحسين الميزانية، تقييم الموردين، تقييم الطلبية، ومتابعة العملاء بعد وصول الأصناف.</p></div></div>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5" />{error}</div>}
    {message && <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-teal-700">{message}</div>}

    <section className="rounded-2xl border bg-white p-4 shadow-sm flex flex-wrap gap-3 items-end">
      <label className="text-sm min-w-72">الطلبية بعد التنفيذ<select value={orderId} onChange={e => setOrderId(e.target.value)} className="mt-1 w-full rounded-lg border p-2"><option value="">اختر الطلبية</option>{orders.map(o => <option key={o.id} value={o.id}>{o.order_number} — {o.branch} — {o.status}</option>)}</select></label>
      <button onClick={exportReport} className="rounded-lg border px-4 py-2 font-semibold flex gap-2"><Download className="w-4 h-4" />تصدير التقرير</button>
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-800">الشاشة دي تقييم وتعلّم فقط. تعديل الكميات أو الميزانية يتم قبل الاعتماد من مركز الطلبية.</div>
    </section>

    {evaluation && <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">{stats.map(([l, v]) => <div key={l} className="rounded-2xl border bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">{l}</div><div className="mt-2 text-xl font-bold">{v}</div></div>)}</div>}

    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap justify-between gap-2 mb-3"><div><h2 className="font-bold flex gap-2"><BarChart3 className="w-5 h-5" />تقييم الموردين من الاستلام الفعلي</h2><p className="text-xs text-slate-500 mt-1">التقييم ده هو نفسه اللي يدخل تدريجيًا في ترتيب المورد للطلبيات القادمة.</p></div>{supplierPerformance?.readiness && <span className="rounded-full border px-3 py-1 text-xs">{supplierPerformance.readiness.ready ? 'بيانات فعلية متاحة' : 'في انتظار تاريخ استلام كافٍ'}</span>}</div>
      <div className="overflow-auto"><table className="min-w-[1100px] w-full text-sm"><thead className="bg-slate-50"><tr>{['المورد','التقييم','الثقة','الاستلامات','اكتمال الكمية','التزام السعر','في الموعد','قيمة النقص','زيادة السعر','آخر استلام'].map(h => <th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody>{suppliers.map(x => <tr key={x.supplier_name} className="border-t"><td className="p-3 font-semibold">{x.supplier_name}</td><td className="p-3 font-bold">{Number(x.performance_score || 0).toFixed(0)}/100</td><td className="p-3">{x.confidence || 0}%</td><td className="p-3">{x.receipt_count || 0}</td><td className="p-3">{x.completion_rate ?? '—'}%</td><td className="p-3">{x.price_adherence ?? '—'}%</td><td className="p-3">{x.on_time_rate == null ? '—' : `${x.on_time_rate}%`}</td><td className="p-3">{money(x.shortage_value)} ج</td><td className="p-3">{money(x.price_overpay_value)} ج</td><td className="p-3">{x.last_receipt_date || '—'}</td></tr>)}</tbody></table></div>
    </section>

    <section className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex flex-wrap justify-between items-center gap-2 mb-3"><h2 className="font-bold flex gap-2"><Users className="w-5 h-5" />عملاء الأصناف التي وصلت</h2><div className="flex flex-wrap gap-2"><button disabled={!orderId || loading} onClick={createFollowups} className="rounded-lg bg-cyan-600 text-white px-3 py-2 text-sm font-semibold">إنشاء المتابعات</button><button onClick={exportFollowups} className="rounded-lg border px-3 py-2 text-sm font-semibold flex gap-2"><Download className="w-4 h-4" />تصدير Excel</button><label className="rounded-lg border px-3 py-2 text-sm font-semibold cursor-pointer flex gap-2"><Upload className="w-4 h-4" />استيراد النتائج<input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => e.target.files?.[0] && importFollowups(e.target.files[0])} /></label><button disabled={loading || !followups.length} onClick={saveFollowups} className="rounded-lg bg-slate-800 text-white px-3 py-2 text-sm font-semibold">حفظ النتائج</button></div></div><div className="overflow-auto"><table className="min-w-[1050px] w-full text-sm"><thead className="bg-slate-50"><tr>{['الصنف','العميل','الهاتف','تاريخ الطلب','الحالة','نتيجة التواصل','ملاحظات'].map(h => <th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody>{followups.map(x => <tr key={x.id} className="border-t"><td className="p-3 font-semibold">{x.product_name}</td><td className="p-3">{x.customer_name || '-'}</td><td className="p-3" dir="ltr">{x.phone || '-'}</td><td className="p-3">{x.request_date || '-'}</td><td className="p-3"><select value={x.status} onChange={e => updateLocal(x.id, 'status', e.target.value)} className="rounded border p-2"><option>بانتظار التواصل</option><option>تم التواصل</option><option>تم الحجز</option><option>تم البيع</option><option>لم يرد</option><option>لم يعد يحتاجه</option><option>اشترى من مكان آخر</option></select></td><td className="p-3"><input value={x.contact_result || ''} onChange={e => updateLocal(x.id, 'contact_result', e.target.value)} className="w-48 rounded border p-2" /></td><td className="p-3"><input value={x.notes || ''} onChange={e => updateLocal(x.id, 'notes', e.target.value)} className="w-52 rounded border p-2" /></td></tr>)}</tbody></table></div></section>
  </div>;
}
