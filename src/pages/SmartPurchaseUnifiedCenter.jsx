import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { smartPurchaseUnifiedApi as unified } from '@/api/smartPurchaseUnifiedApi';
import { smartPurchaseOrderManagementApi as management } from '@/api/smartPurchaseOrderManagementApi';
import { smartPurchaseApi } from '@/api/smartPurchaseApi';
import {
  AlertTriangle, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Send,
  Upload, ShoppingCart, SlidersHorizontal, Save, WalletCards, Calculator, Eye, ArrowUpDown,
} from 'lucide-react';
import { purchaseBudgetGuard } from '@/lib/purchaseFinancialControl';
import {
  buildBudgetPlan,
  buildPurchaseCandidates,
  estimateDailyUsage,
  isValidProductName,
  mergePurchaseRows,
} from '@/lib/purchasePlanning';

const BRANCHES = ['دواء الشامي', 'دواء شكري'];
const STATUS_STEPS = ['مسودة', 'تم التحليل', 'معتمدة', 'تم الإرسال للمورد', 'وصلت جزئيًا', 'وصلت بالكامل', 'تمت مطابقة الفاتورة', 'مغلقة'];
const MAPPING_KEY = 'dawaa_purchase_excel_mappings_v4';
const money = (value) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(value || 0));
const number = (value) => {
  const parsed = Number(String(value ?? '').replace(/[,٪%جنيه]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};
const norm = (value) => String(value ?? '').trim().toLowerCase().replace(/[\s_\-]+/g, ' ');
const normStatus = (status) => status === 'draft' ? 'مسودة' : status || 'مسودة';

const FIELD_LABELS = {
  product_code: 'كود الصنف', product_name: 'اسم الصنف', current_stock: 'الرصيد الحالي',
  sales_30: 'مبيعات آخر 30 يوم', sales_60: 'مبيعات آخر 60 يوم', sales_90: 'مبيعات آخر 90 يوم',
  avg_daily_usage: 'متوسط الاستهلاك اليومي', last_purchase_price: 'آخر سعر شراء',
  pending_incoming: 'الكمية المنتظر وصولها',
};
const ALIASES = {
  product_code: ['كود الصنف', 'الكود', 'كود', 'code', 'item code', 'product code'],
  product_name: ['اسم الصنف', 'اسم', 'الاسم', 'الإسم', 'الصنف', 'name', 'item name', 'product name', 'description'],
  current_stock: ['الرصيد الحالي', 'الرصيد', 'stock', 'current stock', 'balance'],
  sales_30: ['مبيعات 30 يوم', 'مبيعات 30', 'sales 30', 'sales_30'],
  sales_60: ['مبيعات 60 يوم', 'مبيعات 60', 'sales 60', 'sales_60'],
  sales_90: ['مبيعات 90 يوم', 'مبيعات 90', 'sales 90', 'sales_90'],
  avg_daily_usage: ['متوسط الاستهلاك اليومي', 'متوسط الاستهلاك', 'avg daily usage', 'daily average'],
  last_purchase_price: ['آخر سعر شراء', 'سعر الشراء', 'السعر', 'purchase price', 'cost', 'price'],
  pending_incoming: ['كمية منتظر وصولها', 'منتظر وصول', 'pending incoming', 'incoming qty', 'on order'],
};
const monthKey = (header) => {
  const match = String(header || '').trim().match(/^(20\d{2})[\/-](0?[1-9]|1[0-2])$/);
  return match ? Number(`${match[1]}${String(match[2]).padStart(2, '0')}`) : 0;
};
const monthlyHeaders = (headers) => headers.filter((header) => monthKey(header) > 0).sort((a, b) => monthKey(b) - monthKey(a));
const signature = (headers) => headers.map(norm).sort().join('|');
function loadMappings() { try { return JSON.parse(localStorage.getItem(MAPPING_KEY) || '{}'); } catch { return {}; } }
function autoMapping(headers) {
  const mapping = {};
  Object.keys(FIELD_LABELS).forEach((field) => {
    mapping[field] = headers.find((header) => (ALIASES[field] || []).some((alias) => norm(header) === norm(alias)))
      || headers.find((header) => (ALIASES[field] || []).some((alias) => norm(header).includes(norm(alias)) || norm(alias).includes(norm(header)))) || '';
  });
  const months = monthlyHeaders(headers);
  if (months.length) {
    mapping.sales_30 = months[0] || '';
    mapping.sales_60 = months[1] || '';
    mapping.sales_90 = months[2] || '';
  }
  return mapping;
}
function itemPrice(item) { return Math.max(0, number(item.expected_unit_cost || item.last_purchase_price)); }
function itemDiscount(item) {
  const value = number(item.expected_discount);
  return value > 0 ? Math.min(100, value) : 20;
}
function netUnitPrice(item) { return itemPrice(item) * (1 - (itemDiscount(item) / 100)); }
function itemQuantity(item) { return Math.max(0, number(item.approved_quantity)); }
function itemTotal(item) { return itemQuantity(item) * netUnitPrice(item); }
function sortValue(item, field) {
  if (field === 'quantity') return itemQuantity(item);
  if (field === 'public_price') return itemPrice(item);
  if (field === 'net_price') return netUnitPrice(item);
  if (field === 'total') return itemTotal(item);
  return 0;
}
function SortableHeader({ label, field, sortConfig, onSort }) {
  const active = sortConfig.field === field;
  return <th className="p-2 text-right"><button type="button" onClick={() => onSort(field)} className={`inline-flex items-center gap-1 font-bold hover:text-teal-700 ${active ? 'text-teal-700' : ''}`}><ArrowUpDown className="w-3.5 h-3.5" />{label}{active ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>;
}
function finalCoverage(item) {
  const usage = estimateDailyUsage(item);
  if (usage <= 0) return 0;
  return (Math.max(0, number(item.current_stock)) + Math.max(0, number(item.pending_incoming)) + itemQuantity(item)) / usage;
}

function exportWorkbook(payload) {
  const order = payload.order || {};
  const items = (payload.items || []).filter((item) => itemQuantity(item) > 0);
  const total = items.reduce((sum, item) => sum + itemTotal(item), 0);
  const summary = XLSX.utils.aoa_to_sheet([
    ['بيانات الطلبية', ''], ['رقم الطلبية', order.order_number || ''], ['الفرع', order.branch || ''],
    ['الحالة', normStatus(order.status)], ['عدد الأصناف', items.length],
    ['إجمالي الكميات', items.reduce((sum, item) => sum + itemQuantity(item), 0)],
    ['إجمالي تكلفة الصيدلية بعد الخصم', total], ['تاريخ التصدير', new Date().toLocaleString('ar-EG')],
  ]);
  summary['!dir'] = 'rtl'; summary['!cols'] = [{ wch: 30 }, { wch: 28 }];
  const details = XLSX.utils.json_to_sheet(items.map((item) => ({
    'كود الصنف': item.product_code || '', 'اسم الصنف': item.product_name || '',
    'الكمية المطلوبة قبل الميزانية': number(item.requested_quantity),
    'الكمية النهائية المعتمدة': itemQuantity(item), 'الرصيد الحالي': number(item.current_stock),
    'المنتظر وصوله': number(item.pending_incoming), 'متوسط الاستهلاك اليومي': Number(estimateDailyUsage(item).toFixed(3)),
    'التغطية النهائية بالأيام': Number(finalCoverage(item).toFixed(1)), 'سعر الجمهور': itemPrice(item),
    'الخصم المتوقع %': itemDiscount(item), 'سعر الصيدلية بعد الخصم': Number(netUnitPrice(item).toFixed(2)),
    'إجمالي الصنف بعد الخصم': Number(itemTotal(item).toFixed(2)), 'طلبات العملاء': number(item.customer_requests_count),
  })));
  details['!dir'] = 'rtl'; details['!autofilter'] = { ref: details['!ref'] || 'A1:L1' }; details['!freeze'] = { ySplit: 1 };
  details['!cols'] = [{ wch: 14 }, { wch: 38 }, { wch: 22 }, { wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 22 }, { wch: 14 }, { wch: 18 }, { wch: 24 }, { wch: 22 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summary, 'ملخص الطلبية');
  XLSX.utils.book_append_sheet(workbook, details, 'المراجعة الداخلية');
  XLSX.writeFile(workbook, `${String(order.title || order.order_number || 'طلبية').replace(/[\/:*?"<>|]/g, '-')}_${order.order_number || ''}_مراجعة_داخلية.xlsx`);
}

function exportSendFile(payload) {
  const order = payload.order || {};
  const items = (payload.items || [])
    .filter((item) => itemQuantity(item) > 0)
    .sort((a, b) => String(a.product_name || '').localeCompare(String(b.product_name || ''), 'ar'));
  const sheet = XLSX.utils.json_to_sheet(items.map((item) => ({
    'اسم الصنف': item.product_name || '',
    'سعر الجمهور': itemPrice(item),
    'الكمية المطلوبة': itemQuantity(item),
  })));
  sheet['!dir'] = 'rtl';
  sheet['!autofilter'] = { ref: sheet['!ref'] || 'A1:C1' };
  sheet['!freeze'] = { ySplit: 1 };
  sheet['!cols'] = [{ wch: 45 }, { wch: 16 }, { wch: 18 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'الطلبية');
  XLSX.writeFile(workbook, `${String(order.title || order.order_number || 'طلبية').replace(/[\/:*?"<>|]/g, '-')}_${order.order_number || ''}_جاهز_للإرسال.xlsx`);
}

async function runPool(rows, worker, concurrency = 8) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    while (index < rows.length) await worker(rows[index++]);
  }));
}

export default function SmartPurchaseUnifiedCenter() {
  const [data, setData] = useState({ orders: [], pending_actions: {} });
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [branch, setBranch] = useState('دواء الشامي');
  const [creationTitle, setCreationTitle] = useState('');
  const [editingTitle, setEditingTitle] = useState('');
  const [coverageDays, setCoverageDays] = useState(7);
  const [creationBudget, setCreationBudget] = useState('');
  const [fileName, setFileName] = useState('');
  const [rawRows, setRawRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [mappingSource, setMappingSource] = useState('');
  const [preview, setPreview] = useState([]);
  const [previewErrors, setPreviewErrors] = useState([]);
  const [budgetLimit, setBudgetLimit] = useState('');
  const [budgetPreviewVisible, setBudgetPreviewVisible] = useState(false);
  const [onlyUrgent, setOnlyUrgent] = useState(false);
  const [onlyCustomers, setOnlyCustomers] = useState(false);
  const [hideZero, setHideZero] = useState(true);
  const [sortConfig, setSortConfig] = useState({ field: 'quantity', direction: 'desc' });

  async function refresh(openId) {
    setLoading(true); setError('');
    try {
      const next = await unified.dashboard();
      setData(next || { orders: [], pending_actions: {} });
      const id = openId || selected?.order?.id;
      if (id) {
        const detail = await unified.getOrder(id);
        setSelected(detail);
        setBudgetLimit((old) => old || String(Math.ceil((detail.items || []).reduce((sum, item) => sum + itemTotal(item), 0))));
      }
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function openOrder(id) {
    setLoading(true); setError(''); setMessage(''); setBudgetPreviewVisible(false);
    try {
      const detail = await unified.getOrder(id);
      setSelected(detail);
      setBudgetLimit(String(Math.ceil((detail.items || []).reduce((sum, item) => sum + itemTotal(item), 0))));
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  async function run(action, successMessage, openId) {
    setLoading(true); setError(''); setMessage('');
    try {
      const result = await action();
      setMessage(successMessage);
      await refresh(openId || result?.id);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  function buildPreview(rows, nextMapping) {
    const months = monthlyHeaders(Object.keys(rows[0] || {}));
    const parsed = rows.map((row, index) => {
      const monthly = months.map((header) => number(row[header]));
      const sales30 = months.length ? monthly[0] || 0 : number(row[nextMapping.sales_30]);
      const sales60 = months.length ? monthly.slice(0, 2).reduce((sum, value) => sum + value, 0) : number(row[nextMapping.sales_60]);
      const sales90 = months.length ? monthly.slice(0, 3).reduce((sum, value) => sum + value, 0) : number(row[nextMapping.sales_90]);
      return {
        row_number: index + 2,
        product_code: String(row[nextMapping.product_code] ?? '').trim(),
        product_name: String(row[nextMapping.product_name] ?? '').trim(),
        current_stock: Math.max(0, number(row[nextMapping.current_stock])),
        pending_incoming: Math.max(0, number(row[nextMapping.pending_incoming])),
        sales_30: sales30, sales_60: sales60, sales_90: sales90,
        avg_daily_usage: number(row[nextMapping.avg_daily_usage]),
        last_purchase_price: number(row[nextMapping.last_purchase_price]),
      };
    });
    const errors = parsed.filter((row) => !isValidProductName(row.product_name)).map((row) => `صف ${row.row_number}: اسم الصنف غير صالح`);
    setPreview(mergePurchaseRows(parsed)); setPreviewErrors(errors);
  }

  async function readFile(file) {
    setError(''); setMessage(''); setFileName(file.name);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: true });
      const cols = Object.keys(rows[0] || {});
      if (!rows.length || !cols.length) throw new Error('الملف فارغ أو لا يحتوي على عناوين أعمدة.');
      const saved = loadMappings()[signature(cols)];
      const nextMapping = saved || autoMapping(cols);
      setRawRows(rows); setHeaders(cols); setMapping(nextMapping);
      setMappingSource(saved ? 'تم تطبيق قالب محفوظ تلقائيًا' : monthlyHeaders(cols).length ? 'تم التعرف على ملف B-Connect وأعمدة الشهور' : 'تم التعرف على الأعمدة تلقائيًا');
      buildPreview(rows, nextMapping);
      setMessage(`تمت قراءة ${rows.length} صف وتجميع التكرارات حسب الكود أو اسم الصنف.`);
    } catch (err) { setError(`تعذر قراءة الملف: ${err.message}`); }
  }
  function changeMapping(field, value) {
    const next = { ...mapping, [field]: value };
    setMapping(next); buildPreview(rawRows, next); setMappingSource('تم تعديل ربط الأعمدة يدويًا');
  }
  function saveMapping() {
    const all = loadMappings(); all[signature(headers)] = mapping;
    localStorage.setItem(MAPPING_KEY, JSON.stringify(all)); setMappingSource('تم حفظ القالب على هذا الجهاز');
  }

  const plannedCandidates = useMemo(() => buildPurchaseCandidates(preview, { coverage_days: coverageDays }).map((item) => ({
    ...item, requested_quantity: item.suggested_quantity, approved_quantity: item.suggested_quantity,
    expected_unit_cost: item.last_purchase_price, supplier_name: '',
  })), [preview, coverageDays]);
  const creationBudgetPlan = useMemo(() => {
    const value = number(creationBudget);
    return value > 0 ? buildBudgetPlan(plannedCandidates, value) : null;
  }, [plannedCandidates, creationBudget]);
  const rowsForCreation = creationBudgetPlan ? creationBudgetPlan.rows.filter((item) => number(item.approved_quantity) > 0) : plannedCandidates;
  const creationTotal = rowsForCreation.reduce((sum, item) => sum + number(item.approved_quantity || item.suggested_quantity) * itemPrice(item), 0);
  const openOrderForBranch = (data.orders || []).find((order) => order.branch === branch && ['مسودة', 'تم التحليل', 'معتمدة', 'تم الإرسال للمورد', 'وصلت جزئيًا'].includes(normStatus(order.status)));

  async function importAndCreate() {
    if (!mapping.product_name) return setError('حدد عمود اسم الصنف أولًا.');
    if (!plannedCandidates.length) return setError('لا توجد أصناف تحتاج شراء وفق أيام التغطية الحالية.');
    if (openOrderForBranch) return setError(`يوجد طلبية مفتوحة للفرع رقم ${openOrderForBranch.order_number}. أكملها أو أغلقها قبل إنشاء طلبية جديدة.`);
    if (creationBudget && rowsForCreation.length === 0) return setError('الميزانية لا تكفي لإضافة أي صنف بسعره الحالي.');
    if (creationBudget && creationTotal > number(creationBudget) + 0.01) return setError(`قيمة الطلبية ${money(creationTotal)} ج تتجاوز الحد المالي ${money(creationBudget)} ج.`);
    await run(async () => {
      const imported = await smartPurchaseApi.importRows({
        file_name: fileName, branch, coverage_days: coverageDays, safety_days: 0,
        enforce_budget: Boolean(creationBudgetPlan), budget_limit: number(creationBudget),
        rows: rowsForCreation.map((item) => ({ ...item, budget_quantity: number(item.approved_quantity || item.suggested_quantity) })),
      });
      const title = creationTitle.trim() || `طلبية ${branch}`;
      const created = await smartPurchaseApi.createOrder({ import_id: imported.id, branch, title });
      setPreview([]); setRawRows([]); setHeaders([]); setFileName(''); setShowImport(false); setCreationBudget(''); setCreationTitle('');
      return created;
    }, 'تم إنشاء الطلبية وفق التغطية والميزانية المحددة.');
  }

  const items = selected?.items || [];
  const totals = useMemo(() => ({
    items: items.filter((item) => itemQuantity(item) > 0).length,
    quantity: items.reduce((sum, item) => sum + itemQuantity(item), 0),
    total: items.reduce((sum, item) => sum + itemTotal(item), 0),
    average_discount: items.filter((item) => itemQuantity(item) > 0).length ? items.filter((item) => itemQuantity(item) > 0).reduce((sum, item) => sum + itemDiscount(item), 0) / items.filter((item) => itemQuantity(item) > 0).length : 0,
  }), [items]);
  const visibleItems = useMemo(() => items.filter((item) => {
    if (hideZero && itemQuantity(item) <= 0) return false;
    if (onlyUrgent && number(item.priority_score) < 50 && !String(item.priority_label || '').includes('عاجل')) return false;
    if (onlyCustomers && number(item.customer_requests_count) <= 0) return false;
    return true;
  }).sort((a, b) => {
    const delta = sortValue(a, sortConfig.field) - sortValue(b, sortConfig.field);
    return sortConfig.direction === 'asc' ? delta : -delta;
  }), [items, hideZero, onlyUrgent, onlyCustomers, sortConfig]);
  function toggleSort(field) {
    setSortConfig((current) => ({ field, direction: current.field === field && current.direction === 'desc' ? 'asc' : 'desc' }));
  }
  const budgetPlan = useMemo(() => number(budgetLimit) > 0 ? buildBudgetPlan(items, number(budgetLimit)) : null, [items, budgetLimit]);
  const financialGuard = useMemo(() => purchaseBudgetGuard(totals.total, number(budgetLimit)), [totals.total, budgetLimit]);

  async function updateOne(item, patch) { return management.updateItem({ id: item.id, order_id: selected.order.id, ...patch }); }
  async function applyBudgetPlan() {
    if (!budgetPlan) return setError('اكتب ميزانية صحيحة أولًا.');
    const changes = budgetPlan.rows.filter((item) => number(item.approved_quantity) !== number(items.find((source) => source.id === item.id)?.approved_quantity));
    setLoading(true); setError('');
    try {
      await runPool(changes, (item) => updateOne(item, { approved_quantity: number(item.approved_quantity) }), 10);
      setMessage(`تم ضبط الطلبية إلى ${money(budgetPlan.total)} ج داخل ميزانية ${money(budgetPlan.budget)} ج.`);
      setBudgetPreviewVisible(false); await refresh();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  const status = normStatus(selected?.order?.status);
  const stepIndex = Math.max(0, STATUS_STEPS.indexOf(status));

  return <div dir="rtl" className="p-3 md:p-4 space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-teal-50 p-2"><ShoppingCart className="h-6 w-6 text-teal-600" /></div><div><h1 className="text-2xl font-bold">مركز الطلبية الموحد</h1><p className="text-sm text-slate-500">إنشاء ومراجعة الطلبية، ضبط الميزانية، ثم تصدير ملف جاهز للإرسال.</p></div></div>
      <div className="flex gap-2"><button onClick={() => setShowImport((value) => !value)} className="rounded-lg bg-teal-600 text-white px-4 py-2 flex gap-2"><Upload className="w-4 h-4" />طلبية جديدة</button><button onClick={() => refresh()} className="rounded-lg border bg-white px-4 py-2 flex gap-2"><RefreshCw className="w-4 h-4" />تحديث</button></div>
    </header>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5 shrink-0" />{error}</div>}
    {message && <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-teal-700">{message}</div>}

    {showImport && <section className="rounded-2xl border border-teal-200 bg-white p-4 shadow-sm space-y-4">
      <h2 className="font-bold flex items-center gap-2"><FileSpreadsheet className="w-5 h-5 text-teal-600" />إنشاء طلبية من B-Connect أو Excel</h2>
      <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <label className="text-sm">اسم الطلبية<input type="text" maxLength="120" value={creationTitle} onChange={(event) => setCreationTitle(event.target.value)} placeholder="مثال: طلبية أول أغسطس — فرع الشامي" className="mt-1 w-full rounded-lg border p-2" /><span className="text-[11px] text-slate-500">اسم واضح للمراجعة والبحث، والكود المرجعي سيظهر تحته.</span></label>
        <label className="text-sm">الفرع<select value={branch} onChange={(event) => setBranch(event.target.value)} className="mt-1 w-full rounded-lg border p-2">{BRANCHES.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="text-sm">التغطية النهائية المطلوبة بالأيام<input type="number" min="1" value={coverageDays} onChange={(event) => setCoverageDays(Math.max(1, number(event.target.value)))} className="mt-1 w-full rounded-lg border p-2" /><span className="text-[11px] text-slate-500">تشمل الرصيد الحالي والمنتظر والطلبية.</span></label>
        <label className="text-sm">ميزانية الطلبية — اختياري<input type="number" min="1" value={creationBudget} onChange={(event) => setCreationBudget(event.target.value)} placeholder="مثال: 30000" className="mt-1 w-full rounded-lg border p-2" /></label>
        <label className="text-sm">ملف Excel<input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => event.target.files?.[0] && readFile(event.target.files[0])} className="mt-2 block w-full text-sm" /></label>
      </div>
      {openOrderForBranch && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">يوجد طلبية مفتوحة للفرع: {openOrderForBranch.order_number}. تم منع إنشاء طلبية مكررة حتى إغلاقها.</div>}
      {headers.length > 0 && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 space-y-3"><div className="flex justify-between gap-2"><div><h3 className="font-bold">ربط الأعمدة</h3><p className="text-xs text-blue-700">{mappingSource}</p></div><button onClick={saveMapping} className="rounded-lg border bg-white px-3 py-2 flex gap-2"><Save className="w-4 h-4" />حفظ القالب</button></div><div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-2">{Object.entries(FIELD_LABELS).map(([field, label]) => <label key={field} className="text-xs font-semibold">{label}{field === 'product_name' && <span className="text-red-600"> *</span>}<select value={mapping[field] || ''} onChange={(event) => changeMapping(field, event.target.value)} className="mt-1 w-full rounded-lg border bg-white p-2"><option value="">غير موجود</option>{headers.map((header) => <option key={header}>{header}</option>)}</select></label>)}</div></div>}
      {preview.length > 0 && <>
        <div className="grid sm:grid-cols-2 xl:grid-cols-6 gap-2">{[
          ['الأصناف بعد إزالة التكرار', preview.length], ['تحتاج شراء', plannedCandidates.length], ['أخطاء الصفوف', previewErrors.length],
          ['أصناف الطلبية', rowsForCreation.length], ['التكلفة المتوقعة', `${money(creationTotal)} ج`], ['الميزانية المتبقية', creationBudgetPlan ? `${money(creationBudgetPlan.remaining)} ج` : '—'],
        ].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">{label}</div><div className="font-bold mt-1">{value}</div></div>)}</div>
        {creationBudgetPlan && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">داخل الميزانية: {creationBudgetPlan.active_items} صنف، {creationBudgetPlan.total_quantity} وحدة، خُفّض {creationBudgetPlan.reduced_items} صنف، وصُفّر {creationBudgetPlan.zeroed_items} صنف.</div>}
        <div className="overflow-auto rounded-xl border"><table className="min-w-[1050px] w-full text-sm"><thead className="bg-slate-50"><tr>{['الكود', 'الصنف', 'الرصيد', 'المتوسط اليومي', 'الاحتياج', 'التغطية بعد الوصول', 'السعر', 'الإجمالي'].map((header) => <th key={header} className="p-2 text-right">{header}</th>)}</tr></thead><tbody>{rowsForCreation.slice(0, 30).map((item) => <tr key={item.product_code || item.product_name} className="border-t"><td className="p-2">{item.product_code || '—'}</td><td className="p-2 font-semibold">{item.product_name}</td><td className="p-2">{item.current_stock}</td><td className="p-2">{estimateDailyUsage(item).toFixed(2)}</td><td className="p-2 font-bold">{number(item.approved_quantity || item.suggested_quantity)}</td><td className="p-2">{item.projected_coverage_days?.toFixed?.(1) || coverageDays} يوم</td><td className="p-2">{money(itemPrice(item))}</td><td className="p-2 font-bold">{money(number(item.approved_quantity || item.suggested_quantity) * itemPrice(item))}</td></tr>)}</tbody></table></div>
        <button disabled={loading || !mapping.product_name || Boolean(openOrderForBranch)} onClick={importAndCreate} className="rounded-lg bg-teal-600 px-5 py-2.5 text-white font-bold flex items-center gap-2 disabled:opacity-50"><ShoppingCart className="w-4 h-4" />إنشاء الطلبية بالمقادير المعروضة</button>
      </>}
    </section>}

    <div className="grid md:grid-cols-3 gap-3">{[['مسودات تحتاج مراجعة', data.pending_actions?.draft || 0], ['الطلبيات المفتوحة', (data.orders || []).filter((order) => !['مغلقة', 'تمت مطابقة الفاتورة'].includes(normStatus(order.status))).length], ['تنتظر الاستلام', data.pending_actions?.pending_receiving || 0]].map(([label, value]) => <div key={label} className="rounded-2xl border bg-white p-3 shadow-sm"><div className="text-xs text-slate-500">{label}</div><div className="text-2xl font-bold mt-1">{value}</div></div>)}</div>

    <div className="grid lg:grid-cols-[250px_minmax(0,1fr)] gap-3">
      <aside className="rounded-2xl border bg-white p-3 shadow-sm h-fit"><h2 className="font-bold mb-3">الطلبيات</h2><div className="space-y-2 max-h-[700px] overflow-auto">{(data.orders || []).map((order) => <button key={order.id} onClick={() => openOrder(order.id)} className={`w-full text-right rounded-xl border p-3 ${selected?.order?.id === order.id ? 'border-teal-500 bg-teal-50' : 'hover:bg-slate-50'}`}><div className="font-bold text-base">{order.title || `طلبية ${order.branch}`}</div><div className="text-[11px] text-slate-400 mt-1 font-mono">{order.order_number}</div><div className="text-xs text-slate-500 mt-1">{order.branch} • {normStatus(order.status)}</div><div className="font-bold mt-1">{money(order.approved_total || order.expected_total)} ج</div></button>)}</div></aside>
      <main className="min-w-0 space-y-3">{selected ? <>
        <section className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex flex-wrap justify-between gap-3"><div className="min-w-[260px]"><div className="flex flex-wrap items-center gap-2"><input value={editingTitle || selected.order.title || `طلبية ${selected.order.branch}`} onFocus={() => setEditingTitle(selected.order.title || `طلبية ${selected.order.branch}`)} onChange={(event) => setEditingTitle(event.target.value)} disabled={['مغلقة', 'تمت مطابقة الفاتورة'].includes(status)} className="min-w-[260px] rounded-lg border px-3 py-2 text-xl font-bold disabled:bg-transparent disabled:border-transparent" /><button type="button" disabled={!editingTitle.trim() || editingTitle.trim() === (selected.order.title || `طلبية ${selected.order.branch}`) || ['مغلقة', 'تمت مطابقة الفاتورة'].includes(status)} onClick={() => run(() => unified.updateOrderTitle(selected.order.id, editingTitle.trim()), 'تم تحديث اسم الطلبية.', selected.order.id)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">حفظ الاسم</button></div><div className="mt-1 text-xs text-slate-400 font-mono">المرجع: {selected.order.order_number}</div><p className="text-sm text-slate-500 mt-1">{selected.order.branch} • {status}</p></div><div className="flex gap-2"><button onClick={() => exportSendFile(selected)} className="rounded-lg bg-teal-600 text-white px-3 py-2 flex gap-2"><Download className="w-4 h-4" />ملف جاهز للإرسال</button><button onClick={() => exportWorkbook(selected)} className="rounded-lg border px-3 py-2 flex gap-2"><FileSpreadsheet className="w-4 h-4" />مراجعة داخلية</button>{status === 'معتمدة' && <button onClick={() => run(() => unified.markSent(selected.order.id), 'تم تسجيل إرسال الطلبية.')} className="rounded-lg bg-blue-600 text-white px-3 py-2 flex gap-2"><Send className="w-4 h-4" />تم الإرسال</button>}</div></div><div className="mt-4 flex overflow-x-auto">{STATUS_STEPS.map((step, index) => <div key={step} className="min-w-[115px] flex-1"><div className={`h-2 ${index <= stepIndex ? 'bg-teal-500' : 'bg-slate-200'}`} /><div className={`text-[11px] mt-1 ${index <= stepIndex ? 'font-bold text-teal-700' : 'text-slate-400'}`}>{step}</div></div>)}</div></section>
        <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-2">{[['الأصناف', totals.items], ['الكميات', totals.quantity], ['متوسط الخصم', `${money(totals.average_discount)}%`], ['سعر الجمهور قبل الخصم', `${money(items.reduce((sum, item) => sum + itemQuantity(item) * itemPrice(item), 0))} ج`], ['تكلفة الصيدلية بعد الخصم', `${money(totals.total)} ج`]].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">{label}</div><div className="text-xl font-bold mt-1">{value}</div></div>)}</div>
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3"><h3 className="font-bold flex items-center gap-2"><WalletCards className="w-5 h-5" />التحكم المالي الذكي</h3><div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3"><label className="text-sm">الحد الأقصى لقيمة الطلبية / الفاتورة<input type="number" value={budgetLimit} onChange={(event) => { setBudgetLimit(event.target.value); setBudgetPreviewVisible(false); }} className="mt-1 w-full rounded-lg border bg-white p-2" /></label><div className="rounded-xl bg-white border p-3"><div className="text-xs text-slate-500">التكلفة الحالية</div><div className="font-bold text-lg">{money(totals.total)} ج</div></div><button onClick={() => setBudgetPreviewVisible(true)} className="rounded-xl border border-emerald-300 bg-white px-4 py-3 font-bold flex justify-center items-center gap-2"><Eye className="w-5 h-5" />معاينة التوزيع</button><button onClick={applyBudgetPlan} disabled={!budgetPreviewVisible || loading || ['معتمدة', 'تم الإرسال للمورد'].includes(status)} className="rounded-xl bg-emerald-700 text-white px-4 py-3 font-bold flex justify-center items-center gap-2 disabled:opacity-50"><Calculator className="w-5 h-5" />تطبيق الخطة</button></div>{budgetPreviewVisible && budgetPlan && <div className="grid sm:grid-cols-2 xl:grid-cols-6 gap-2">{[['التكلفة بعد الضبط', `${money(budgetPlan.total)} ج`], ['المتبقي', `${money(budgetPlan.remaining)} ج`], ['الأصناف', budgetPlan.active_items], ['الكميات', budgetPlan.total_quantity], ['المخفضة', budgetPlan.reduced_items], ['المصفرة', budgetPlan.zeroed_items]].map(([label, value]) => <div key={label} className="rounded-lg bg-white border p-2"><div className="text-[11px] text-slate-500">{label}</div><div className="font-bold">{value}</div></div>)}</div>}</section>
        
        {financialGuard.blocked && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">لا يمكن اعتماد الطلبية: القيمة الحالية أعلى من الحد المالي بمقدار {money(financialGuard.over)} ج.</div>}
        {financialGuard.warning && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">تنبيه: تم استخدام {money(financialGuard.usage)}% من الحد المالي المحدد.</div>}
        <div className="flex gap-2">{!['معتمدة', 'تم الإرسال للمورد'].includes(status) ? <button onClick={() => run(() => unified.approveOrder(selected.order.id), 'تم اعتماد الطلبية.')} disabled={loading || totals.total <= 0 || financialGuard.blocked} className="rounded-lg bg-teal-600 text-white px-4 py-2 font-semibold flex gap-2 disabled:opacity-50"><CheckCircle2 className="w-4 h-4" />اعتماد الطلبية</button> : <button onClick={() => run(() => unified.returnToReview(selected.order.id), 'تمت إعادة الطلبية للمراجعة.')} className="rounded-lg border border-amber-300 px-4 py-2">إعادة للمراجعة</button>}</div>
        <section className="rounded-2xl border bg-white overflow-auto"><table className="min-w-[1500px] w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-2 text-right">الصنف</th><th className="p-2 text-right">الرصيد</th><th className="p-2 text-right">المنتظر</th><th className="p-2 text-right">المطلوب</th><SortableHeader label="المعتمد" field="quantity" sortConfig={sortConfig} onSort={toggleSort} /><th className="p-2 text-right">متوسط يومي</th><th className="p-2 text-right">التغطية النهائية</th><SortableHeader label="سعر الجمهور" field="public_price" sortConfig={sortConfig} onSort={toggleSort} /><th className="p-2 text-right">الخصم %</th><SortableHeader label="سعر الصيدلية" field="net_price" sortConfig={sortConfig} onSort={toggleSort} /><SortableHeader label="الإجمالي" field="total" sortConfig={sortConfig} onSort={toggleSort} /><th className="p-2 text-right">طلبات العملاء</th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.id} className="border-t"><td className="p-2"><div className="font-semibold">{item.product_name}</div><div className="text-xs text-slate-400">{item.product_code || 'بدون كود'}</div></td><td className="p-2">{number(item.current_stock)}</td><td className="p-2">{number(item.pending_incoming)}</td><td className="p-2">{number(item.requested_quantity)}</td><td className="p-2"><input type="number" min="0" defaultValue={item.approved_quantity} disabled={['معتمدة', 'تم الإرسال للمورد'].includes(status)} onBlur={(event) => { const value = number(event.target.value); if (value !== number(item.approved_quantity)) run(() => updateOne(item, { approved_quantity: value }), 'تم تحديث الكمية.'); }} className="w-20 rounded-lg border p-2 font-bold" /></td><td className="p-2">{estimateDailyUsage(item).toFixed(2)}</td><td className="p-2"><span className={`rounded-full px-2 py-1 text-xs ${finalCoverage(item) < 3 ? 'bg-red-50 text-red-700' : finalCoverage(item) > 14 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{finalCoverage(item).toFixed(1)} يوم</span></td><td className="p-2"><input type="number" min="0" step="0.01" defaultValue={item.expected_unit_cost} disabled={['معتمدة', 'تم الإرسال للمورد'].includes(status)} onBlur={(event) => { const value = number(event.target.value); if (value !== number(item.expected_unit_cost)) run(() => updateOne(item, { expected_unit_cost: value }), 'تم تحديث سعر الجمهور.'); }} className="w-24 rounded-lg border p-2" /></td><td className="p-2"><input type="number" min="0" max="100" step="0.1" defaultValue={itemDiscount(item)} disabled={['معتمدة', 'تم الإرسال للمورد'].includes(status)} onBlur={(event) => { const value = Math.min(100, Math.max(0, number(event.target.value))); if (value !== itemDiscount(item)) run(() => updateOne(item, { expected_discount: value }), 'تم تحديث خصم الصنف.'); }} className="w-20 rounded-lg border p-2" /></td><td className="p-2 font-semibold">{money(netUnitPrice(item))} ج</td><td className="p-2 font-bold text-teal-800">{money(itemTotal(item))} ج</td><td className="p-2">{number(item.customer_requests_count)}</td></tr>)}</tbody></table></section>
      </> : <section className="rounded-2xl border border-dashed bg-white p-12 text-center text-slate-400"><FileSpreadsheet className="w-10 h-10 mx-auto mb-3" />اختر طلبية أو أنشئ طلبية جديدة.</section>}</main>
    </div>
  </div>;
}
