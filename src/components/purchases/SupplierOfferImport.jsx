import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Upload } from 'lucide-react';
import { smartPurchaseUnifiedApi as api } from '@/api/smartPurchaseUnifiedApi';

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/[\s_\-]+/g, ' ');
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[,٪%جنيه]/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};

const FIELDS = {
  supplier_name: ['اسم المورد','المورد','supplier','supplier name','supplier_name'],
  product_code: ['كود الصنف','الكود','code','product code','product_code'],
  product_name: ['اسم الصنف','الصنف','item','product','product name','product_name'],
  list_price: ['سعر الجمهور','السعر','list price','price','list_price'],
  discount_percent: ['خصم','الخصم','discount','discount %','discount_percent'],
  extra_discount_percent: ['خصم إضافي','خصم اضافي','extra discount','extra_discount_percent'],
  bonus_base_quantity: ['أساس البونص','اساس البونص','bonus base','bonus_base_quantity'],
  bonus_quantity: ['بونص','bonus','bonus quantity','bonus_quantity'],
  net_unit_cost: ['صافي سعر الوحدة','صافي التكلفة','net cost','net unit cost','net_unit_cost'],
  available_quantity: ['الكمية المتاحة','المتاح','available qty','available_quantity'],
  minimum_order_quantity: ['أقل كمية طلب','اقل كمية طلب','moq','minimum order quantity','minimum_order_quantity'],
  lead_time_days: ['مدة التوريد','أيام التوريد','lead time','lead_time_days'],
  payment_type: ['طريقة الدفع','payment type','payment_type'],
  valid_until: ['صالح حتى','تاريخ انتهاء العرض','valid until','valid_until'],
  is_available: ['متاح','available','is_available'],
};

function mapHeaders(headers) {
  const mapping = {};
  for (const [field, aliases] of Object.entries(FIELDS)) {
    mapping[field] = headers.find((h) => aliases.some((a) => norm(h) === norm(a))) || '';
  }
  return mapping;
}

function parseAvailability(v) {
  const s = norm(v);
  if (!s) return true;
  if (['0','false','no','غير متاح','لا'].includes(s)) return false;
  return true;
}

function makeTemplate() {
  const rows = [{
    'اسم المورد': 'اسم مورد مسجل بالنظام',
    'كود الصنف': '12345',
    'اسم الصنف': 'مثال صنف',
    'سعر الجمهور': 100,
    'خصم': 15,
    'خصم إضافي': 2,
    'أساس البونص': 10,
    'بونص': 1,
    'صافي سعر الوحدة': '',
    'الكمية المتاحة': 50,
    'أقل كمية طلب': 5,
    'مدة التوريد': 2,
    'طريقة الدفع': 'آجل',
    'صالح حتى': '2026-08-31',
    'متاح': 'نعم',
  }];
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!dir'] = 'rtl';
  ws['!cols'] = Array(15).fill({ wch: 18 });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'عروض الموردين');
  XLSX.writeFile(wb, 'قالب_عروض_الموردين.xlsx');
}

export default function SupplierOfferImport() {
  const [health,setHealth]=useState(null);
  const [fileName,setFileName]=useState('');
  const [rows,setRows]=useState([]);
  const [preview,setPreview]=useState([]);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState(null);

  async function loadHealth(){
    try { setHealth(await api.supplierOfferHealth()); } catch (e) { setError(e.message); }
  }
  useEffect(()=>{ loadHealth(); },[]);

  async function onFile(file){
    setError(''); setMessage(''); setResult(null);
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf,{type:'array',cellDates:true});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws,{defval:'',raw:false});
      if (!raw.length) throw new Error('الملف لا يحتوي على بيانات.');
      const headers = Object.keys(raw[0] || {});
      const m = mapHeaders(headers);
      if (!m.supplier_name || !m.product_name) throw new Error('لازم الملف يحتوي على اسم المورد واسم الصنف على الأقل.');
      const mapped = raw.map((r)=>({
        supplier_name: String(r[m.supplier_name]||'').trim(),
        product_code: String(r[m.product_code]||'').trim(),
        product_name: String(r[m.product_name]||'').trim(),
        list_price: num(r[m.list_price]),
        discount_percent: num(r[m.discount_percent]),
        extra_discount_percent: num(r[m.extra_discount_percent]),
        bonus_base_quantity: num(r[m.bonus_base_quantity]),
        bonus_quantity: num(r[m.bonus_quantity]),
        net_unit_cost: num(r[m.net_unit_cost]),
        available_quantity: num(r[m.available_quantity]),
        minimum_order_quantity: num(r[m.minimum_order_quantity]),
        lead_time_days: num(r[m.lead_time_days]),
        payment_type: String(r[m.payment_type]||'').trim(),
        valid_until: String(r[m.valid_until]||'').trim(),
        is_available: parseAvailability(r[m.is_available]),
      })).filter(r=>r.supplier_name || r.product_name);
      setRows(mapped); setPreview(mapped.slice(0,12)); setFileName(file.name);
    } catch(e){ setError(e.message); setRows([]); setPreview([]); }
  }

  async function upload(){
    if (!rows.length) return;
    setLoading(true); setError(''); setMessage('');
    try {
      const res = await api.importSupplierOffers({fileName,rows});
      setResult(res);
      setMessage(`تم استيراد ${res.imported || 0} عرض مورد بنجاح.`);
      await loadHealth();
    } catch(e){ setError(e.message); }
    finally{ setLoading(false); }
  }

  const rejected = useMemo(()=>result?.rejections || [],[result]);

  return <section className="space-y-4">
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
      <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">عروض نشطة</div><div className="text-xl font-black">{health?.active_offers ?? '—'}</div></div>
      <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">موردين بعروض</div><div className="text-xl font-black">{health?.active_suppliers ?? '—'}</div></div>
      <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">أصناف مغطاة</div><div className="text-xl font-black">{health?.active_products ?? '—'}</div></div>
      <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">عروض تنتهي خلال 7 أيام</div><div className="text-xl font-black">{health?.expiring_7_days ?? '—'}</div></div>
      <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">آخر رفع</div><div className="text-sm font-black">{health?.last_import_at ? new Date(health.last_import_at).toLocaleString('ar-EG') : 'لا يوجد'}</div></div>
    </div>

    <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-black text-lg flex items-center gap-2"><FileSpreadsheet className="w-5 h-5 text-blue-700"/>رفع عروض الموردين</h3><p className="text-xs text-slate-600 mt-1">ارفع Excel من الموردين. اسم المورد لازم يطابق موردًا مسجلًا بالنظام. صافي التكلفة يُحسب تلقائيًا من السعر والخصومات لو لم ترسله.</p></div>
        <div className="flex gap-2"><button onClick={loadHealth} className="rounded-lg border bg-white px-3 py-2 text-sm flex items-center gap-2"><RefreshCw className="w-4 h-4"/>تحديث</button><button onClick={makeTemplate} className="rounded-lg border bg-white px-3 py-2 text-sm flex items-center gap-2"><Download className="w-4 h-4"/>تحميل قالب</button></div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-xl bg-blue-700 text-white px-4 py-2 font-bold flex items-center gap-2"><Upload className="w-4 h-4"/>اختيار ملف<input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e=>onFile(e.target.files?.[0])}/></label>
        <div className="text-sm text-slate-600">{fileName || 'لم يتم اختيار ملف'}</div>
        {rows.length>0 && <button onClick={upload} disabled={loading} className="rounded-xl bg-emerald-700 text-white px-4 py-2 font-bold">{loading?'جاري الاستيراد...':`استيراد ${rows.length} صف`}</button>}
      </div>
    </div>

    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5"/>{error}</div>}
    {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-800 flex gap-2"><CheckCircle2 className="w-5 h-5"/>{message}</div>}

    {preview.length>0 && <div className="overflow-auto rounded-xl border bg-white"><table className="min-w-[1250px] w-full text-sm"><thead className="bg-slate-50"><tr>{['المورد','الكود','الصنف','السعر','خصم %','خصم إضافي %','البونص','المتاح','MOQ','توريد/يوم','الدفع','صالح حتى'].map(h=><th key={h} className="p-2 text-right">{h}</th>)}</tr></thead><tbody>{preview.map((r,i)=><tr key={i} className="border-t"><td className="p-2 font-bold">{r.supplier_name}</td><td className="p-2">{r.product_code||'—'}</td><td className="p-2">{r.product_name}</td><td className="p-2">{r.list_price||'—'}</td><td className="p-2">{r.discount_percent||0}</td><td className="p-2">{r.extra_discount_percent||0}</td><td className="p-2">{r.bonus_base_quantity||0}+{r.bonus_quantity||0}</td><td className="p-2">{r.available_quantity||'غير محدد'}</td><td className="p-2">{r.minimum_order_quantity||0}</td><td className="p-2">{r.lead_time_days||0}</td><td className="p-2">{r.payment_type||'من بيانات المورد'}</td><td className="p-2">{r.valid_until||'—'}</td></tr>)}</tbody></table><div className="p-2 text-xs text-slate-400">معاينة أول {preview.length} صف فقط قبل الاستيراد.</div></div>}

    {result && <div className="grid md:grid-cols-3 gap-2"><div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">تم الاستيراد</div><div className="text-xl font-black text-emerald-700">{result.imported||0}</div></div><div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">مرفوض</div><div className="text-xl font-black text-red-700">{result.rejected||0}</div></div><div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">العروض النشطة بعد الرفع</div><div className="text-xl font-black">{result.active_offers||0}</div></div></div>}

    {rejected.length>0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="font-bold mb-2">الصفوف المرفوضة</div>{rejected.slice(0,20).map((r,i)=><div key={i} className="text-xs py-1 border-b border-amber-100 last:border-0">صف {r.row}: {r.supplier_name||'بدون مورد'} — {r.product_name||'بدون صنف'} — {r.reason==='supplier_not_found'?'اسم المورد غير موجود بالنظام':r.reason==='invalid_cost'?'لا توجد تكلفة صالحة':'بيانات أساسية ناقصة'}</div>)}</div>}
  </section>;
}
