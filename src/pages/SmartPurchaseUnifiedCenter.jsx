import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { smartPurchaseUnifiedApi as unified } from '@/api/smartPurchaseUnifiedApi';
import { smartPurchaseOrderManagementApi as management } from '@/api/smartPurchaseOrderManagementApi';
import { smartPurchaseApi } from '@/api/smartPurchaseApi';
import {
  AlertTriangle, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Send,
  Upload, ShoppingCart, SlidersHorizontal, Save, WalletCards, Calculator, Eye,
} from 'lucide-react';
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
  preferred_supplier: 'المورد / الشركة', pending_incoming: 'الكمية المنتظر وصولها',
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
  preferred_supplier: ['المورد', 'المورد السابق', 'الشركة', 'اسم الشركة', 'supplier', 'vendor', 'company'],
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
function itemQuantity(item) { return Math.max(0, number(item.approved_quantity)); }
function itemTotal(item) { return itemQuantity(item) * itemPrice(item); }
function finalCoverage(item) {
  const usage = estimateDailyUsage(item);
  if (usage <= 0) return 0;
  return (Math.max(0, number(item.current_stock)) + Math.max(0, number(item.pending_incoming)) + itemQuantity(item)) / usage;
}

function exportWorkbook(payload) {
  const order = payload.order || {};
  const items = (payload.items || []).filter((item) => itemQuantity(item) > 0);
  const total = items.reduce((sum, item) => sum + itemTotal(item), 0);
  const groups = new Map();
  items.forEach((item) => {
    const supplier = item.supplier_name || 'غير محدد';
    const group = groups.get(supplier) || { supplier, items: 0, quantity: 0, total: 0 };
    group.items += 1;
    group.quantity += itemQuantity(item);
    group.total += itemTotal(item);
    groups.set(supplier, group);
  });
  const summary = XLSX.utils.aoa_to_sheet([
    ['بيانات الطلبية', ''], ['رقم الطلبية', order.order_number || ''], ['الفرع', order.branch || ''],
    ['الحالة', normStatus(order.status)], ['عدد الأصناف', items.length],
    ['إجمالي الكميات', items.reduce((sum, item) => sum + itemQuantity(item), 0)],
    ['عدد الموردين', groups.size], ['إجمالي التكلفة المتوقعة', total],
    ['تاريخ التصدير', new Date().toLocaleString('ar-EG')],
  ]);
  summary['!dir'] = 'rtl'; summary['!cols'] = [{ wch: 28 }, { wch: 28 }];
  const supplierSheet = XLSX.utils.json_to_sheet([...groups.values()].sort((a, b) => b.total - a.total).map((group) => ({
    'المورد / الشركة': group.supplier, 'عدد الأصناف': group.items, 'إجمالي الكميات': group.quantity,
    'إجمالي التكلفة المتوقعة': group.total, 'نسبة من الطلبية %': total > 0 ? Number(((group.total / total) * 100).toFixed(2)) : 0,
  })));
  supplierSheet['!dir'] = 'rtl'; supplierSheet['!autofilter'] = { ref: supplierSheet['!ref'] || 'A1:E1' };
  const allSheet = XLSX.utils.json_to_sheet(items.map((item) => ({
    'كود الصنف': item.product_code || '', 'اسم الصنف': item.product_name || '',
    'المورد / الشركة': item.supplier_name || 'غير محدد', 'الكمية المطلوبة': number(item.requested_quantity),
    'الكمية المعتمدة': itemQuantity(item), 'الرصيد الحالي': number(item.current_stock),
    'المنتظر وصوله': number(item.pending_incoming), 'متوسط الاستهلاك اليومي': Number(estimateDailyUsage(item).toFixed(3)),
    'التغطية النهائية بالأيام': Number(finalCoverage(item).toFixed(1)), 'سعر الوحدة المتوقع': itemPrice(item),
    'إجمالي الصنف المتوقع': itemTotal(item), 'طلبات العملاء': number(item.customer_requests_count), 'ملاحظات': item.notes || '',
  })));
  allSheet['!dir'] = 'rtl'; allSheet['!autofilter'] = { ref: allSheet['!ref'] || 'A1:M1' }; allSheet['!freeze'] = { ySplit: 1 };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summary, 'ملخص الطلبية');
  XLSX.utils.book_append_sheet(workbook, supplierSheet, 'ملخص الموردين');
  XLSX.utils.book_append_sheet(workbook, allSheet, 'الطلبية كاملة');
  XLSX.writeFile(workbook, `${order.order_number || 'طلبية'}_ملف_موحد.xlsx`);
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
  const [bulkSupplier, setBulkSupplier] = useState('');
  const [onlyUrgent, setOnlyUrgent] = useState(false);
  const [onlyCustomers, setOnlyCustomers] = useState(false);
  const [hideZero, setHideZero] = useState(true);

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
        preferred_supplier: String(row[nextMapping.preferred_supplier] ?? '').trim(),
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
    expected_unit_cost: item.last_purchase_price, supplier_name: item.preferred_supplier,
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
    await run(async () => {
      const imported = await smartPurchaseApi.importRows({
        file_name: fileName, branch, coverage_days: coverageDays, safety_days: 0,
        enforce_budget: Boolean(creationBudgetPlan), budget_limit: number(creationBudget),
        rows: rowsForCreation.map((item) => ({ ...item, budget_quantity: number(item.approved_quantity || item.suggested_quantity) })),
      });
      const created = await smartPurchaseApi.createOrder({ import_id: imported.id, branch, title: `طلبية ${branch}` });
      setPreview([]); setRawRows([]); setHeaders([]); setFileName(''); setShowImport(false); setCreationBudget('');
      return created;
    }, 'تم إنشاء الطلبية وفق التغطية والميزانية المحددة.');
  }

  const items = selected?.items || [];
  const totals = useMemo(() => ({
    items: items.filter((item) => itemQuantity(item) > 0).length,
    quantity: items.reduce((sum, item) => sum + itemQuantity(item), 0),
    total: items.reduce((sum, item) => sum + itemTotal(item), 0),
    suppliers: new Set(items.filter((item) => itemQuantity(item) > 0).map((item) => item.supplier_name).filter(Boolean)).size,
    missing: items.filter((item) => itemQuantity(item) > 0 && !item.supplier_name).length,
  }), [items]);
  const visibleItems = useMemo(() => items.filter((item) => {
    if (hideZero && itemQuantity(item) <= 0) return false;
    if (onlyUrgent && number(item.priority_score) < 50 && !String(item.priority_label || '').includes('عاجل')) return false;
    if (onlyCustomers && number(item.customer_requests_count) <= 0) return false;
    return true;
  }), [items, hideZero, onlyUrgent, onlyCustomers]);
  const budgetPlan = useMemo(() => number(budgetLimit) > 0 ? buildBudgetPlan(items, number(budgetLimit)) : null, [items, budgetLimit]);

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
  async function assignSupplier() {
    if (!bulkSupplier.trim()) return setError('اكتب اسم المورد أولًا.');
    const changes = visibleItems.filter((item) => itemQuantity(item) > 0 && item.supplier_name !== bulkSupplier.trim());
    setLoading(true); setError('');
    try { await runPool(changes, (item) => updateOne(item, { supplier_name: bulkSupplier.trim() })); setMessage(`تم تعيين المورد إلى ${changes.length} صنف.`); await refresh(); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  const status = normStatus(selected?.order?.status);
  const stepIndex = Math.max(0, STATUS_STEPS.indexOf(status));

  return <div dir="rtl" className="p-3 md:p-4 space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-teal-50 p-2"><ShoppingCart className="h-6 w-6 text-teal-600" /></div><div><h1 className="text-2xl font-bold">مركز الطلبية الموحد</h1><p className="text-sm text-slate-500">احتياج، ميزانية، اعتماد، وتصدير بدون تكرار في منطق الحساب.</p></div></div>
      <div className="flex gap-2"><button onClick={() => setShowImport((value) => !value)} className="rounded-lg bg-teal-600 text-white px-4 py-2 flex gap-2"><Upload className="w-4 h-4" />طلبية جديدة</button><button onClick={() => refresh()} className="rounded-lg border bg-white px-4 py-2 flex gap-2"><RefreshCw className="w-4 h-4" />تحديث</button></div>
    </header>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5 shrink-0" />{error}</div>}
    {message && <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-teal-700">{message}</div>}

    {showImport && <section className="rounded-2xl border border-teal-200 bg-white p-4 shadow-sm space-y-4">
      <h2 className="font-bold flex items-center gap-2"><FileSpreadsheet className="w-5 h-5 text-teal-600" />إنشاء طلبية من B-Connect أو Excel</h2>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
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

    <div className="grid md:grid-cols-3 gap-3">{[['مسودات تحتاج مراجعة', data.pending_actions?.draft || 0], ['بدون مورد', data.pending_actions?.needs_supplier || 0], ['تنتظر الاستلام', data.pending_actions?.pending_receiving || 0]].map(([label, value]) => <div key={label} className="rounded-2xl border bg-white p-3 shadow-sm"><div className="text-xs text-slate-500">{label}</div><div className="text-2xl font-bold mt-1">{value}</div></div>)}</div>

    <div className="grid lg:grid-cols-[250px_minmax(0,1fr)] gap-3">
      <aside className="rounded-2xl border bg-white p-3 shadow-sm h-fit"><h2 className="font-bold mb-3">الطلبيات</h2><div className="space-y-2 max-h-[700px] overflow-auto">{(data.orders || []).map((order) => <button key={order.id} onClick={() => openOrder(order.id)} className={`w-full text-right rounded-xl border p-3 ${selected?.order?.id === order.id ? 'border-teal-500 bg-teal-50' : 'hover:bg-slate-50'}`}><div className="font-semibold">{order.order_number}</div><div className="text-xs text-slate-500 mt-1">{order.branch} • {normStatus(order.status)}</div><div className="font-bold mt-1">{money(order.approved_total || order.expected_total)} ج</div></button>)}</div></aside>
      <main className="min-w-0 space-y-3">{selected ? <>
        <section className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-bold">{selected.order.order_number}</h2><p className="text-sm text-slate-500">{selected.order.branch} • {status}</p></div><div className="flex gap-2"><button onClick={() => exportWorkbook(selected)} className="rounded-lg border px-3 py-2 flex gap-2"><Download className="w-4 h-4" />تصدير ملف موحد</button>{status === 'معتمدة' && <button onClick={() => run(() => unified.markSent(selected.order.id), 'تم تسجيل إرسال الطلبية.')} className="rounded-lg bg-blue-600 text-white px-3 py-2 flex gap-2"><Send className="w-4 h-4" />تم الإرسال</button>}</div></div><div className="mt-4 flex overflow-x-auto">{STATUS_STEPS.map((step, index) => <div key={step} className="min-w-[115px] flex-1"><div className={`h-2 ${index <= stepIndex ? 'bg-teal-500' : 'bg-slate-200'}`} /><div className={`text-[11px] mt-1 ${index <= stepIndex ? 'font-bold text-teal-700' : 'text-slate-400'}`}>{step}</div></div>)}</div></section>
        <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-2">{[['الأصناف', totals.items], ['الكميات', totals.quantity], ['الموردون', totals.suppliers], ['بدون مورد', totals.missing], ['التكلفة المتوقعة', `${money(totals.total)} ج`]].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">{label}</div><div className="text-xl font-bold mt-1">{value}</div></div>)}</div>
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3"><h3 className="font-bold flex items-center gap-2"><WalletCards className="w-5 h-5" />التحكم المالي الذكي</h3><div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3"><label className="text-sm">الميزانية القصوى<input type="number" value={budgetLimit} onChange={(event) => { setBudgetLimit(event.target.value); setBudgetPreviewVisible(false); }} className="mt-1 w-full rounded-lg border bg-white p-2" /></label><div className="rounded-xl bg-white border p-3"><div className="text-xs text-slate-500">التكلفة الحالية</div><div className="font-bold text-lg">{money(totals.total)} ج</div></div><button onClick={() => setBudgetPreviewVisible(true)} className="rounded-xl border border-emerald-300 bg-white px-4 py-3 font-bold flex justify-center items-center gap-2"><Eye className="w-5 h-5" />معاينة التوزيع</button><button onClick={applyBudgetPlan} disabled={!budgetPreviewVisible || loading || ['معتمدة', 'تم الإرسال للمورد'].includes(status)} className="rounded-xl bg-emerald-700 text-white px-4 py-3 font-bold flex justify-center items-center gap-2 disabled:opacity-50"><Calculator className="w-5 h-5" />تطبيق الخطة</button></div>{budgetPreviewVisible && budgetPlan && <div className="grid sm:grid-cols-2 xl:grid-cols-6 gap-2">{[['التكلفة بعد الضبط', `${money(budgetPlan.total)} ج`], ['المتبقي', `${money(budgetPlan.remaining)} ج`], ['الأصناف', budgetPlan.active_items], ['الكميات', budgetPlan.total_quantity], ['المخفضة', budgetPlan.reduced_items], ['المصفرة', budgetPlan.zeroed_items]].map(([label, value]) => <div key={label} className="rounded-lg bg-white border p-2"><div className="text-[11px] text-slate-500">{label}</div><div className="font-bold">{value}</div></div>)}</div>}</section>
        <section className="rounded-2xl border bg-white p-3 space-y-3"><h3 className="font-bold flex items-center gap-2"><SlidersHorizontal className="w-5 h-5" />فلاتر وتعديل المورد</h3><div className="flex flex-wrap items-end gap-3"><label className="text-xs">المورد<input value={bulkSupplier} onChange={(event) => setBulkSupplier(event.target.value)} className="mt-1 block w-48 rounded-lg border p-2" /></label><button onClick={assignSupplier} className="rounded-lg border px-3 py-2">تعيين للظاهر</button><label className="flex gap-2 text-sm"><input type="checkbox" checked={hideZero} onChange={(event) => setHideZero(event.target.checked)} />إخفاء الصفر</label><label className="flex gap-2 text-sm"><input type="checkbox" checked={onlyUrgent} onChange={(event) => setOnlyUrgent(event.target.checked)} />العاجل فقط</label><label className="flex gap-2 text-sm"><input type="checkbox" checked={onlyCustomers} onChange={(event) => setOnlyCustomers(event.target.checked)} />طلبات العملاء فقط</label></div></section>
        <div className="flex gap-2">{!['معتمدة', 'تم الإرسال للمورد'].includes(status) ? <button onClick={() => run(() => unified.approveOrder(selected.order.id), 'تم اعتماد الطلبية.')} disabled={loading || totals.missing > 0 || totals.total <= 0} className="rounded-lg bg-teal-600 text-white px-4 py-2 font-semibold flex gap-2 disabled:opacity-50"><CheckCircle2 className="w-4 h-4" />اعتماد الطلبية</button> : <button onClick={() => run(() => unified.returnToReview(selected.order.id), 'تمت إعادة الطلبية للمراجعة.')} className="rounded-lg border border-amber-300 px-4 py-2">إعادة للمراجعة</button>}</div>
        <section className="rounded-2xl border bg-white overflow-auto"><table className="min-w-[1450px] w-full text-sm"><thead className="bg-slate-50"><tr>{['الصنف', 'الرصيد', 'المنتظر', 'المطلوب', 'المعتمد', 'متوسط يومي', 'التغطية النهائية', 'المورد', 'السعر', 'الإجمالي', 'طلبات العملاء'].map((header) => <th key={header} className="p-2 text-right">{header}</th>)}</tr></thead><tbody>{visibleItems.map((item) => <tr key={item.id} className="border-t"><td className="p-2"><div className="font-semibold">{item.product_name}</div><div className="text-xs text-slate-400">{item.product_code || 'بدون كود'}</div></td><td className="p-2">{number(item.current_stock)}</td><td className="p-2">{number(item.pending_incoming)}</td><td className="p-2">{number(item.requested_quantity)}</td><td className="p-2"><input type="number" min="0" defaultValue={item.approved_quantity} disabled={['معتمدة', 'تم الإرسال للمورد'].includes(status)} onBlur={(event) => { const value = number(event.target.value); if (value !== number(item.approved_quantity)) run(() => updateOne(item, { approved_quantity: value }), 'تم تحديث الكمية.'); }} className="w-20 rounded-lg border p-2 font-bold" /></td><td className="p-2">{estimateDailyUsage(item).toFixed(2)}</td><td className="p-2"><span className={`rounded-full px-2 py-1 text-xs ${finalCoverage(item) < 3 ? 'bg-red-50 text-red-700' : finalCoverage(item) > 14 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{finalCoverage(item).toFixed(1)} يوم</span></td><td className="p-2"><input defaultValue={item.supplier_name || ''} disabled={['معتمدة', 'تم الإرسال للمورد'].includes(status)} onBlur={(event) => { const value = event.target.value.trim(); if (value !== (item.supplier_name || '')) run(() => updateOne(item, { supplier_name: value }), 'تم تحديث المورد.'); }} className="w-40 rounded-lg border p-2" /></td><td className="p-2"><input type="number" min="0" step="0.01" defaultValue={item.expected_unit_cost} disabled={['معتمدة', 'تم الإرسال للمورد'].includes(status)} onBlur={(event) => { const value = number(event.target.value); if (value !== number(item.expected_unit_cost)) run(() => updateOne(item, { expected_unit_cost: value }), 'تم تحديث السعر.'); }} className="w-24 rounded-lg border p-2" /></td><td className="p-2 font-bold">{money(itemTotal(item))} ج</td><td className="p-2">{number(item.customer_requests_count)}</td></tr>)}</tbody></table></section>
      </> : <section className="rounded-2xl border border-dashed bg-white p-12 text-center text-slate-400"><FileSpreadsheet className="w-10 h-10 mx-auto mb-3" />اختر طلبية أو أنشئ طلبية جديدة.</section>}</main>
    </div>
  </div>;
}
