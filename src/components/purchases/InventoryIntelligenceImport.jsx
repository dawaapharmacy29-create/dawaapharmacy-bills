import { useState } from 'react';
import * as XLSX from 'xlsx';
import { FileSpreadsheet, Upload, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { smartPurchaseUnifiedApi as api } from '@/api/smartPurchaseUnifiedApi';

const BRANCHES = ['دواء الشامي', 'دواء شكري'];
const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/[\s_\-]+/g, ' ');
const n = (v) => { const x = Number(String(v ?? '').replace(/[,٪%جنيه]/g, '').trim()); return Number.isFinite(x) ? x : 0; };
const aliases = {
  product_code: ['كود الصنف','الكود','code','item code','product code'],
  product_name: ['اسم الصنف','الصنف','الاسم','name','item name','product name','description'],
  selling_price: ['سعر البيع','سعر الجمهور','public price','selling price','retail price'],
  unit_cost: ['تكلفة الشراء','صافي الشراء','سعر الشراء','purchase cost','unit cost','net cost'],
  batch_number: ['باتش','رقم الباتش','batch','batch no','batch number','lot'],
  expiry_date: ['تاريخ الصلاحية','الصلاحية','expiry','expiry date','expiration date','exp date'],
  expiry_quantity: ['كمية الباتش','كمية الصلاحية','expiry quantity','batch quantity','qty','quantity'],
};
function findHeader(headers, key) {
  return headers.find((h) => aliases[key].some((a) => norm(h) === norm(a)))
    || headers.find((h) => aliases[key].some((a) => norm(h).includes(norm(a)) || norm(a).includes(norm(h)))) || '';
}
function toIsoDate(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0,10);
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value);
    if (d?.y && d?.m && d?.d) return `${String(d.y).padStart(4,'0')}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) { const [y,m,d] = s.split('-'); return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return '';
}

export default function InventoryIntelligenceImport({ onImported }) {
  const [branch, setBranch] = useState('دواء الشامي');
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function readFile(file) {
    setError(''); setMessage(''); setFileName(file.name);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true });
      const headers = Object.keys(raw[0] || {});
      if (!raw.length || !headers.length) throw new Error('الملف فارغ.');
      const map = Object.fromEntries(Object.keys(aliases).map((key) => [key, findHeader(headers,key)]));
      if (!map.product_name) throw new Error('لم أتعرف على عمود اسم الصنف.');
      const parsed = raw.map((r) => ({
        product_code: map.product_code ? String(r[map.product_code] ?? '').trim() : '',
        product_name: String(r[map.product_name] ?? '').trim(),
        selling_price: map.selling_price ? n(r[map.selling_price]) : 0,
        unit_cost: map.unit_cost ? n(r[map.unit_cost]) : 0,
        batch_number: map.batch_number ? String(r[map.batch_number] ?? '').trim() : '',
        expiry_date: map.expiry_date ? toIsoDate(r[map.expiry_date]) : '',
        expiry_quantity: map.expiry_quantity ? n(r[map.expiry_quantity]) : 0,
      })).filter((r) => r.product_name && (r.selling_price > 0 || (r.expiry_date && r.expiry_quantity > 0)));
      setRows(parsed);
      setMessage(`تمت قراءة ${parsed.length} صف صالح من ${raw.length}.`);
    } catch (e) { setRows([]); setError(e.message); }
  }

  async function upload() {
    if (!rows.length) return;
    setLoading(true); setError(''); setMessage('');
    try {
      const result = await api.importInventoryIntelligence({ branch, rows });
      setMessage(`تم حفظ ${result?.rows_processed || rows.length} صف، وتحديث سعر البيع لـ ${result?.products_price_updated || 0} صنف.`);
      setRows([]); setFileName('');
      await onImported?.();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return <section className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-black flex items-center gap-2"><FileSpreadsheet className="w-5 h-5 text-violet-700" />إكمال بيانات الربحية والصلاحية</h2><p className="text-xs text-slate-500 mt-1">ملف اختياري يضيف سعر البيع وبيانات الـBatch والصلاحية بدون ما يغيّر كميات الطلبية.</p></div><select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-lg border p-2 text-sm">{BRANCHES.map((b) => <option key={b}>{b}</option>)}</select></div>
    <div className="rounded-xl bg-violet-50 p-3 text-xs text-violet-900">الأعمدة التي يتعرف عليها تلقائيًا: اسم الصنف، الكود، سعر البيع/الجمهور، تكلفة الشراء، Batch، تاريخ الصلاحية، وكمية الـBatch. يمكن تكرار نفس الصنف في أكثر من Batch.</div>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5" />{error}</div>}
    {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 flex gap-2"><CheckCircle2 className="w-5 h-5" />{message}</div>}
    <div className="flex flex-wrap items-center gap-3"><input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} className="text-sm" />{fileName && <span className="text-xs text-slate-500">{fileName} • {rows.length} صف صالح</span>}<button onClick={upload} disabled={loading || !rows.length} className="rounded-lg bg-violet-700 text-white px-4 py-2 text-sm font-bold flex items-center gap-2 disabled:opacity-50"><Upload className="w-4 h-4" />حفظ وتحديث التحليلات</button></div>
  </section>;
}
