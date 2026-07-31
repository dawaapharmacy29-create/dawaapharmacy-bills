import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { smartPurchaseUnifiedApi as unified } from '@/api/smartPurchaseUnifiedApi';
import { smartPurchaseOrderManagementApi as management } from '@/api/smartPurchaseOrderManagementApi';
import { smartPurchaseApi } from '@/api/smartPurchaseApi';
import {
  AlertTriangle, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Send,
  Upload, ShoppingCart, SlidersHorizontal, Save, WalletCards, Calculator,
  TrendingDown, PackageCheck,
} from 'lucide-react';

const BRANCHES = ['دواء الشامي', 'دواء شكري'];
const STATUS_STEPS = ['مسودة', 'تم التحليل', 'معتمدة', 'تم الإرسال للمورد', 'وصلت جزئيًا', 'وصلت بالكامل', 'تمت مطابقة الفاتورة', 'مغلقة'];
const MAPPING_KEY = 'dawaa_purchase_excel_mappings_v3';
const money = (v) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(v || 0));
const normStatus = (s) => s === 'draft' ? 'مسودة' : s || 'مسودة';
const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/[\s_\-]+/g, ' ');
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[,٪%جنيه]/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};
const validName = (v) => {
  const s = String(v || '').trim();
  return s.length > 1 && !/^0+$/.test(s) && !/^\d{10,}$/.test(s);
};

const FIELD_LABELS = {
  product_code: 'كود الصنف', product_name: 'اسم الصنف', current_stock: 'الرصيد الحالي',
  sales_30: 'مبيعات آخر 30 يوم', sales_60: 'مبيعات آخر 60 يوم', sales_90: 'مبيعات آخر 90 يوم',
  avg_daily_usage: 'متوسط الاستهلاك اليومي', old_discount: 'الخصم السابق',
  last_purchase_price: 'آخر سعر شراء', preferred_supplier: 'المورد / الشركة',
  pending_incoming: 'الكمية المنتظر وصولها',
};
const aliases = {
  product_code: ['كود الصنف', 'الكود', 'كود', 'code', 'item code', 'product code', 'itemcode'],
  product_name: ['اسم الصنف', 'اسم', 'الاسم', 'الإسم', 'الصنف', 'name', 'item name', 'product name', 'description'],
  current_stock: ['الرصيد الحالي', 'الرصيد', 'stock', 'current stock', 'balance'],
  sales_30: ['مبيعات 30 يوم', 'مبيعات 30', 'sales 30', 'sales_30'],
  sales_60: ['مبيعات 60 يوم', 'مبيعات 60', 'sales 60', 'sales_60'],
  sales_90: ['مبيعات 90 يوم', 'مبيعات 90', 'sales 90', 'sales_90'],
  avg_daily_usage: ['متوسط الاستهلاك اليومي', 'متوسط الاستهلاك', 'avg daily usage', 'daily average'],
  old_discount: ['الخصم السابق', 'نسبة الخصم', 'discount'],
  last_purchase_price: ['آخر سعر شراء', 'سعر الشراء', 'السعر', 'purchase price', 'cost', 'price'],
  preferred_supplier: ['المورد', 'المورد السابق', 'الشركة', 'اسم الشركة', 'supplier', 'vendor', 'company'],
  pending_incoming: ['كمية منتظر وصولها', 'منتظر وصول', 'pending incoming', 'incoming qty', 'on order'],
};

const monthKey = (h) => {
  const m = String(h || '').trim().match(/^(20\d{2})[\/-](0?[1-9]|1[0-2])$/);
  return m ? Number(`${m[1]}${String(m[2]).padStart(2, '0')}`) : 0;
};
const monthlyHeaders = (headers) => headers.filter((h) => monthKey(h) > 0).sort((a, b) => monthKey(b) - monthKey(a));
const isBConnect = (headers) => {
  const n = headers.map(norm);
  return n.some((x) => ['الكود', 'كود'].includes(x)) && n.some((x) => ['الإسم', 'الاسم', 'اسم'].includes(x)) && n.includes('الرصيد') && monthlyHeaders(headers).length > 0;
};
function autoMapping(headers) {
  const out = {};
  Object.keys(FIELD_LABELS).forEach((field) => {
    out[field] = headers.find((h) => (aliases[field] || []).some((a) => norm(h) === norm(a)))
      || headers.find((h) => (aliases[field] || []).some((a) => norm(h).includes(norm(a)) || norm(a).includes(norm(h)))) || '';
  });
  const months = monthlyHeaders(headers);
  if (months.length) {
    out.sales_30 = months[0] || '';
    out.sales_60 = months[1] || '';
    out.sales_90 = months[2] || '';
  }
  return out;
}
const signature = (headers) => headers.map(norm).sort().join('|');
function loadMappings() { try { return JSON.parse(localStorage.getItem(MAPPING_KEY) || '{}'); } catch { return {}; } }

function itemUsage(item) {
  const direct = Number(item.avg_daily_usage || 0);
  if (direct > 0) return direct;
  const sales90 = Number(item.sales_90 || 0);
  if (sales90 > 0) return sales90 / 90;
  const sales30 = Number(item.sales_30 || 0);
  return sales30 > 0 ? sales30 / 30 : 0;
}
function itemCoverage(item) {
  const usage = itemUsage(item);
  if (usage <= 0) return 0;
  return Number(item.approved_quantity || 0) / usage;
}
function itemTotal(item) {
  return Number(item.approved_quantity || 0) * Number(item.expected_unit_cost || 0);
}
function priorityValue(item) {
  return Number(item.priority_score || 0) + Number(item.customer_requests_count || 0) * 40 + itemUsage(item) * 10;
}

function exportProfessionalWorkbook(payload) {
  const order = payload.order || {};
  const items = (payload.items || []).filter((x) => Number(x.approved_quantity || 0) > 0);
  const total = items.reduce((s, x) => s + itemTotal(x), 0);
  const qty = items.reduce((s, x) => s + Number(x.approved_quantity || 0), 0);
  const groups = new Map();
  items.forEach((x) => {
    const supplier = x.supplier_name || 'غير محدد';
    const current = groups.get(supplier) || { supplier, items: 0, quantity: 0, total: 0 };
    current.items += 1;
    current.quantity += Number(x.approved_quantity || 0);
    current.total += itemTotal(x);
    groups.set(supplier, current);
  });

  const summary = [
    ['بيانات الطلبية', ''],
    ['رقم الطلبية', order.order_number || ''],
    ['الفرع', order.branch || ''],
    ['الحالة', normStatus(order.status)],
    ['عدد الأصناف', items.length],
    ['إجمالي الكميات', qty],
    ['عدد الموردين', groups.size],
    ['إجمالي التكلفة المتوقعة', total],
    ['تاريخ التصدير', new Date().toLocaleString('ar-EG')],
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summary);
  summaryWs['!dir'] = 'rtl';
  summaryWs['!cols'] = [{ wch: 28 }, { wch: 28 }];

  const supplierRows = [...groups.values()].sort((a, b) => b.total - a.total).map((g) => ({
    'المورد / الشركة': g.supplier,
    'عدد الأصناف': g.items,
    'إجمالي الكميات': g.quantity,
    'إجمالي التكلفة المتوقعة': g.total,
    'نسبة من الطلبية %': total > 0 ? Number(((g.total / total) * 100).toFixed(2)) : 0,
  }));
  const supplierWs = XLSX.utils.json_to_sheet(supplierRows);
  supplierWs['!dir'] = 'rtl';
  supplierWs['!cols'] = [30, 14, 16, 24, 18].map((wch) => ({ wch }));
  supplierWs['!autofilter'] = { ref: supplierWs['!ref'] || 'A1:E1' };

  const allRows = items.map((x) => ({
    'كود الصنف': x.product_code || '',
    'اسم الصنف': x.product_name || '',
    'المورد / الشركة': x.supplier_name || 'غير محدد',
    'الكمية المطلوبة': Number(x.requested_quantity || 0),
    'الكمية المعتمدة': Number(x.approved_quantity || 0),
    'متوسط الاستهلاك اليومي': Number(itemUsage(x).toFixed(3)),
    'تغطية الكمية المعتمدة بالأيام': Number(itemCoverage(x).toFixed(1)),
    'سعر الوحدة المتوقع': Number(x.expected_unit_cost || 0),
    'إجمالي الصنف المتوقع': itemTotal(x),
    'الأولوية': x.priority_label || x.priority_score || '',
    'طلبات العملاء': Number(x.customer_requests_count || 0),
    'ملاحظات': x.notes || '',
  }));
  const allWs = XLSX.utils.json_to_sheet(allRows);
  allWs['!dir'] = 'rtl';
  allWs['!cols'] = [14, 38, 26, 16, 16, 22, 24, 18, 22, 16, 16, 30].map((wch) => ({ wch }));
  allWs['!autofilter'] = { ref: allWs['!ref'] || 'A1:L1' };
  allWs['!freeze'] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summaryWs, 'ملخص الطلبية');
  XLSX.utils.book_append_sheet(wb, supplierWs, 'ملخص الموردين');
  XLSX.utils.book_append_sheet(wb, allWs, 'الطلبية كاملة');
  XLSX.writeFile(wb, `${order.order_number || 'طلبية'}_ملف_موحد.xlsx`);
}

async function runPool(rows, worker, concurrency = 8) {
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    while (index < rows.length) {
      const row = rows[index++];
      await worker(row);
    }
  });
  await Promise.all(runners);
}

export default function SmartPurchaseUnifiedCenter() {
  const [data, setData] = useState({ orders: [], treasuries: [], pending_actions: {} });
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [branch, setBranch] = useState('دواء الشامي');
  const [coverageDays, setCoverageDays] = useState(21);
  const [safetyDays, setSafetyDays] = useState(5);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState([]);
  const [previewErrors, setPreviewErrors] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [mappingSource, setMappingSource] = useState('');
  const [bulkSupplier, setBulkSupplier] = useState('');
  const [bulkPercent, setBulkPercent] = useState(100);
  const [onlyUrgent, setOnlyUrgent] = useState(false);
  const [onlyCustomers, setOnlyCustomers] = useState(false);
  const [hideZero, setHideZero] = useState(true);
  const [budgetLimit, setBudgetLimit] = useState('');

  async function refresh(openId) {
    setLoading(true); setError('');
    try {
      const d = await unified.dashboard();
      setData(d || { orders: [], treasuries: [], pending_actions: {} });
      const id = openId || selected?.order?.id;
      if (id) {
        const detail = await unified.getOrder(id);
        setSelected(detail);
        const currentTotal = (detail.items || []).reduce((s, x) => s + itemTotal(x), 0);
        setBudgetLimit((old) => old || String(Math.ceil(currentTotal)));
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);
  async function openOrder(id) {
    setLoading(true); setError(''); setMessage('');
    try {
      const detail = await unified.getOrder(id);
      setSelected(detail);
      setBudgetLimit(String(Math.ceil((detail.items || []).reduce((s, x) => s + itemTotal(x), 0))));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  async function run(fn, msg, openId) {
    setLoading(true); setError(''); setMessage('');
    try { const result = await fn(); setMessage(msg); await refresh(openId || result?.id); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  async function approve() { if (selected) await run(() => unified.approveOrder(selected.order.id), 'تم اعتماد الطلبية بنجاح.'); }
  async function returnToReview() { if (selected) await run(() => unified.returnToReview(selected.order.id), 'تمت إعادة الطلبية للمراجعة.'); }
  async function markSent() { if (selected) await run(() => unified.markSent(selected.order.id), 'تم تسجيل إرسال الطلبية للموردين.'); }

  function buildPreview(rows, nextMapping) {
    const months = monthlyHeaders(Object.keys(rows[0] || {}));
    const parsed = rows.map((r, index) => {
      const monthly = months.map((h) => num(r[h]));
      const sales30 = months.length ? monthly[0] || 0 : num(r[nextMapping.sales_30]);
      const sales60 = months.length ? monthly.slice(0, 2).reduce((s, v) => s + v, 0) : num(r[nextMapping.sales_60]);
      const sales90 = months.length ? monthly.slice(0, 3).reduce((s, v) => s + v, 0) : num(r[nextMapping.sales_90]);
      const mappedAvg = num(r[nextMapping.avg_daily_usage]);
      return {
        row_number: index + 2,
        product_code: String(r[nextMapping.product_code] ?? '').trim(),
        product_name: String(r[nextMapping.product_name] ?? '').trim(),
        current_stock: Math.max(0, num(r[nextMapping.current_stock])),
        sales_30: sales30, sales_60: sales60, sales_90: sales90,
        avg_daily_usage: mappedAvg > 0 ? mappedAvg : sales90 > 0 ? sales90 / 90 : sales30 > 0 ? sales30 / 30 : 0,
        old_discount: num(r[nextMapping.old_discount]),
        last_purchase_price: num(r[nextMapping.last_purchase_price]),
        preferred_supplier: String(r[nextMapping.preferred_supplier] ?? '').trim(),
        pending_incoming: Math.max(0, num(r[nextMapping.pending_incoming])),
      };
    });
    const errors = [];
    parsed.forEach((r) => {
      if (!validName(r.product_name)) errors.push(`صف ${r.row_number}: اسم الصنف غير صالح`);
    });
    const merged = new Map();
    parsed.filter((r) => validName(r.product_name)).forEach((r) => {
      const key = r.product_code || norm(r.product_name);
      if (merged.has(key)) {
        const old = merged.get(key);
        merged.set(key, {
          ...old,
          current_stock: Math.max(old.current_stock, r.current_stock),
          sales_30: old.sales_30 + r.sales_30,
          sales_60: old.sales_60 + r.sales_60,
          sales_90: old.sales_90 + r.sales_90,
          pending_incoming: old.pending_incoming + r.pending_incoming,
        });
      } else merged.set(key, r);
    });
    setPreview([...merged.values()]); setPreviewErrors(errors);
    return { rows: parsed.length, valid: merged.size, errors: errors.length };
  }
  async function readFile(file) {
    setError(''); setMessage(''); setFileName(file.name);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true });
      const cols = Object.keys(rows[0] || {});
      if (!rows.length || !cols.length) throw new Error('الملف فارغ أو لا يحتوي على عناوين أعمدة.');
      const saved = loadMappings()[signature(cols)];
      const next = saved || autoMapping(cols);
      setRawRows(rows); setHeaders(cols); setMapping(next);
      const bconnect = isBConnect(cols);
      setMappingSource(saved ? 'تم تطبيق قالب محفوظ تلقائيًا' : bconnect ? 'تم التعرف تلقائيًا على ملف B-Connect وأعمدة الشهور' : 'تم التعرف على الأعمدة تلقائيًا');
      const stats = buildPreview(rows, next);
      setMessage(`تمت قراءة ${stats.rows} صف وتجميعها إلى ${stats.valid} صنف صالح.${bconnect ? ' تم حساب الاستهلاك من مبيعات الشهور.' : ''}`);
    } catch (e) {
      setError(`تعذر قراءة الملف: ${e.message}`); setPreview([]); setRawRows([]); setHeaders([]);
    }
  }
  function changeMapping(field, value) {
    const next = { ...mapping, [field]: value };
    setMapping(next); buildPreview(rawRows, next);
    setMappingSource('تم تعديل ربط الأعمدة يدويًا — احفظ القالب لاستخدامه لاحقًا');
  }
  function saveMapping() {
    if (!headers.length) return;
    const all = loadMappings(); all[signature(headers)] = mapping;
    localStorage.setItem(MAPPING_KEY, JSON.stringify(all));
    setMappingSource('تم حفظ قالب الأعمدة على هذا الجهاز');
    setMessage('تم حفظ قالب الأعمدة بنجاح.');
  }
  async function importAndCreate() {
    if (!mapping.product_name) return setError('حدد عمود اسم الصنف أولًا.');
    if (!preview.length) return setError('ارفع ملف Excel صالح أولًا.');
    await run(async () => {
      const targetDays = Number(coverageDays) + Number(safetyDays);
      const purchasable = preview.map((x) => {
        const usage = Number(x.avg_daily_usage || 0);
        const need = Math.max(0, Math.ceil(usage * targetDays - Number(x.current_stock || 0) - Number(x.pending_incoming || 0)));
        return { ...x, suggested_quantity: need };
      }).filter((x) => x.suggested_quantity > 0 && x.avg_daily_usage > 0);
      if (!purchasable.length) throw new Error('لا توجد أصناف تحتاج شراء وفق التغطية والمخزون الحالي.');
      const imported = await smartPurchaseApi.importRows({ file_name: fileName, branch, coverage_days: coverageDays, safety_days: safetyDays, rows: purchasable });
      const created = await smartPurchaseApi.createOrder({ import_id: imported.id, branch, title: `طلبية ${branch}` });
      setPreview([]); setPreviewErrors([]); setFileName(''); setShowImport(false); setRawRows([]); setHeaders([]);
      return created;
    }, 'تم تحليل الاحتياج وإنشاء الطلبية وفتحها للمراجعة.');
  }

  async function updateOne(item, patch) { await management.updateItem({ id: item.id, order_id: selected.order.id, ...patch }); }
  async function applyBulkQuantity() {
    if (!selected) return;
    const pct = Math.max(0, Number(bulkPercent || 0)) / 100;
    const changes = visibleItems.map((item) => ({ item, value: Math.max(0, Math.round(Number(item.requested_quantity || item.approved_quantity || 0) * pct)) })).filter((x) => x.value !== Number(x.item.approved_quantity || 0));
    setLoading(true); setError('');
    try {
      await runPool(changes, ({ item, value }) => updateOne(item, { approved_quantity: value }));
      setMessage(`تم تحديث كميات ${changes.length} صنف بنسبة ${bulkPercent}%.`); await refresh();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  async function applyBulkSupplier() {
    if (!selected || !bulkSupplier.trim()) return setError('اكتب اسم المورد أولًا.');
    const rows = visibleItems.filter((x) => Number(x.approved_quantity || 0) > 0 && x.supplier_name !== bulkSupplier.trim());
    setLoading(true); setError('');
    try { await runPool(rows, (item) => updateOne(item, { supplier_name: bulkSupplier.trim() })); setMessage(`تم تعيين المورد إلى ${rows.length} صنف.`); await refresh(); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  async function zeroVisible() {
    if (!selected) return;
    const rows = visibleItems.filter((x) => Number(x.approved_quantity || 0) > 0);
    setLoading(true); setError('');
    try { await runPool(rows, (item) => updateOne(item, { approved_quantity: 0 })); setMessage(`تم تصفير ${rows.length} صنف.`); await refresh(); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  const items = selected?.items || [];
  const visibleItems = useMemo(() => {
    let rows = items;
    if (hideZero) rows = rows.filter((x) => Number(x.approved_quantity || 0) > 0);
    if (onlyUrgent) rows = rows.filter((x) => Number(x.priority_score || 0) >= 50 || String(x.priority_label || '').includes('عاجل'));
    if (onlyCustomers) rows = rows.filter((x) => Number(x.customer_requests_count || 0) > 0);
    return rows;
  }, [items, hideZero, onlyUrgent, onlyCustomers]);
  const totals = useMemo(() => ({
    items: items.filter((x) => Number(x.approved_quantity || 0) > 0).length,
    suppliers: new Set(items.filter((x) => Number(x.approved_quantity || 0) > 0).map((x) => x.supplier_name).filter(Boolean)).size,
    missing: items.filter((x) => Number(x.approved_quantity || 0) > 0 && !x.supplier_name).length,
    quantity: items.reduce((s, x) => s + Number(x.approved_quantity || 0), 0),
    total: items.reduce((s, x) => s + itemTotal(x), 0),
    customers: items.reduce((s, x) => s + Number(x.customer_requests_count || 0), 0),
  }), [items]);
  const budget = Number(budgetLimit || 0);
  const budgetDifference = budget - totals.total;

  async function applySmartBudget() {
    if (!selected) return;
    if (!Number.isFinite(budget) || budget <= 0) return setError('اكتب ميزانية قصوى صحيحة.');
    const active = items.filter((x) => Number(x.requested_quantity || x.approved_quantity || 0) > 0 && Number(x.expected_unit_cost || 0) > 0);
    const sorted = [...active].sort((a, b) => priorityValue(b) - priorityValue(a));
    let remaining = budget;
    const planned = new Map();

    // المرحلة الأولى: حد أدنى للأصناف العاجلة وطلبات العملاء بما يعادل 7 أيام أو وحدة واحدة.
    sorted.forEach((item) => {
      const price = Number(item.expected_unit_cost || 0);
      const desired = Number(item.requested_quantity || item.approved_quantity || 0);
      const important = Number(item.customer_requests_count || 0) > 0 || Number(item.priority_score || 0) >= 50;
      const minimum = important ? Math.min(desired, Math.max(1, Math.ceil(itemUsage(item) * 7))) : 0;
      const affordable = Math.floor(remaining / price);
      const qty = Math.min(minimum, affordable);
      planned.set(item.id, qty);
      remaining -= qty * price;
    });
    // المرحلة الثانية: استكمال الأصناف الأعلى أولوية حتى الكمية المطلوبة داخل الميزانية.
    sorted.forEach((item) => {
      const price = Number(item.expected_unit_cost || 0);
      const desired = Number(item.requested_quantity || item.approved_quantity || 0);
      const current = planned.get(item.id) || 0;
      const affordable = Math.floor(remaining / price);
      const extra = Math.min(Math.max(0, desired - current), affordable);
      planned.set(item.id, current + extra);
      remaining -= extra * price;
    });
    const changes = active.map((item) => ({ item, value: planned.get(item.id) || 0 })).filter((x) => x.value !== Number(x.item.approved_quantity || 0));
    setLoading(true); setError('');
    try {
      await runPool(changes, ({ item, value }) => updateOne(item, { approved_quantity: value }), 10);
      setMessage(`تم ضبط ${changes.length} صنف داخل ميزانية ${money(budget)} ج مع أولوية للعاجل وطلبات العملاء.`);
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  const status = normStatus(selected?.order?.status);
  const stepIndex = Math.max(0, STATUS_STEPS.indexOf(status));
  const importWarnings = useMemo(() => ({
    zeroPrice: preview.filter((x) => Number(x.last_purchase_price || 0) <= 0).length,
    noSupplier: preview.filter((x) => !x.preferred_supplier).length,
    noCode: preview.filter((x) => !x.product_code).length,
  }), [preview]);

  return <div dir="rtl" className="p-4 md:p-6 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-teal-50 p-2.5"><ShoppingCart className="h-6 w-6 text-teal-600" /></div><div><h1 className="text-2xl font-bold">مركز الطلبية السريع</h1><p className="text-sm text-slate-500 mt-1">تحليل B-Connect، ضبط الكميات، التحكم المالي، والتصدير من شاشة واحدة.</p></div></div>
      <div className="flex gap-2"><button onClick={() => setShowImport((v) => !v)} className="rounded-lg bg-teal-600 text-white px-4 py-2 flex gap-2"><Upload className="w-4 h-4" />طلبية جديدة من Excel</button><button onClick={() => refresh()} className="rounded-lg border bg-white px-4 py-2 flex gap-2"><RefreshCw className="w-4 h-4" />تحديث</button></div>
    </div>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5" />{error}</div>}
    {message && <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-teal-700">{message}</div>}

    {showImport && <section className="rounded-2xl border border-teal-200 bg-white p-4 shadow-sm space-y-4">
      <div className="flex items-center gap-2"><FileSpreadsheet className="w-5 h-5 text-teal-600" /><h2 className="font-bold">إنشاء طلبية جديدة من Excel أو B-Connect</h2></div>
      <div className="grid md:grid-cols-4 gap-3">
        <label className="text-sm">الفرع<select value={branch} onChange={(e) => setBranch(e.target.value)} className="mt-1 w-full rounded-lg border p-2">{BRANCHES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="text-sm">أيام التغطية<input type="number" min="1" value={coverageDays} onChange={(e) => setCoverageDays(Number(e.target.value))} className="mt-1 w-full rounded-lg border p-2" /></label>
        <label className="text-sm">أيام مخزون الأمان<input type="number" min="0" value={safetyDays} onChange={(e) => setSafetyDays(Number(e.target.value))} className="mt-1 w-full rounded-lg border p-2" /></label>
        <label className="text-sm">ملف Excel<input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} className="mt-1 block w-full text-sm" /></label>
      </div>
      {headers.length > 0 && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-blue-900">ربط أعمدة الملف</h3><p className="text-xs text-blue-700">{mappingSource}</p></div><button onClick={saveMapping} className="rounded-lg bg-white border border-blue-200 px-3 py-2 text-sm font-semibold flex gap-2"><Save className="w-4 h-4" />حفظ القالب</button></div><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">{Object.entries(FIELD_LABELS).map(([field, label]) => <label key={field} className="text-xs font-semibold text-slate-600">{label}{field === 'product_name' && <span className="text-red-600"> *</span>}<select value={mapping[field] || ''} onChange={(e) => changeMapping(field, e.target.value)} className="mt-1 w-full rounded-lg border bg-white p-2 text-sm"><option value="">غير موجود</option>{headers.map((h) => <option key={h} value={h}>{h}</option>)}</select></label>)}</div></div>}
      {preview.length > 0 && <><div className="grid sm:grid-cols-4 gap-2">{[['الملف', fileName], ['الأصناف الصالحة', preview.length], ['ملاحظات الصفوف', previewErrors.length], ['الفرع', branch]].map(([l, v]) => <div key={l} className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">{l}</div><div className="font-bold mt-1 truncate">{v}</div></div>)}</div>
        <div className="grid sm:grid-cols-3 gap-2">{importWarnings.zeroPrice > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{importWarnings.zeroPrice} صنف بدون سعر.</div>}{importWarnings.noSupplier > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{importWarnings.noSupplier} صنف بدون شركة.</div>}{importWarnings.noCode > 0 && <div className="rounded-xl border bg-slate-50 p-3 text-sm">{importWarnings.noCode} صنف بدون كود.</div>}</div>
        <div className="overflow-auto rounded-xl border"><table className="min-w-[950px] w-full text-sm"><thead className="bg-slate-50"><tr>{['الكود', 'الصنف', 'الرصيد', 'مبيعات 30', 'مبيعات 90', 'متوسط يومي', 'السعر', 'الشركة'].map((h) => <th key={h} className="p-2 text-right">{h}</th>)}</tr></thead><tbody>{preview.slice(0, 25).map((x, i) => <tr key={`${x.product_code}-${i}`} className="border-t"><td className="p-2">{x.product_code || '—'}</td><td className="p-2 font-semibold">{x.product_name}</td><td className="p-2">{x.current_stock}</td><td className="p-2">{x.sales_30}</td><td className="p-2">{x.sales_90}</td><td className="p-2">{Number(x.avg_daily_usage || 0).toFixed(2)}</td><td className="p-2">{money(x.last_purchase_price)}</td><td className="p-2">{x.preferred_supplier || '—'}</td></tr>)}</tbody></table></div>
        <button disabled={loading || !mapping.product_name} onClick={importAndCreate} className="rounded-lg bg-teal-600 px-5 py-2.5 text-white font-bold flex items-center gap-2 disabled:opacity-50"><ShoppingCart className="w-4 h-4" />تحليل الاحتياج وإنشاء الطلبية</button></>}
    </section>}

    <div className="grid md:grid-cols-3 gap-3">{[['مسودات تحتاج مراجعة', data.pending_actions?.draft || 0], ['طلبيات بها أصناف بدون مورد', data.pending_actions?.needs_supplier || 0], ['طلبيات تنتظر الاستلام', data.pending_actions?.pending_receiving || 0]].map(([l, v]) => <div key={l} className="rounded-2xl border bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">{l}</div><div className="text-2xl font-bold mt-2">{v}</div></div>)}</div>

    <div className="grid lg:grid-cols-[310px_1fr] gap-4">
      <aside className="rounded-2xl border bg-white p-3 shadow-sm h-fit"><h2 className="font-bold mb-3">الطلبيات</h2><div className="space-y-2 max-h-[700px] overflow-auto">{(data.orders || []).map((o) => <button key={o.id} onClick={() => openOrder(o.id)} className={`w-full text-right rounded-xl border p-3 hover:bg-teal-50 ${selected?.order?.id === o.id ? 'border-teal-500 bg-teal-50' : ''}`}><div className="font-semibold">{o.order_number}</div><div className="text-xs text-slate-500 mt-1">{o.branch} • {normStatus(o.status)}</div><div className="font-bold mt-1">{money(o.approved_total || o.expected_total)} ج</div></button>)}{!data.orders?.length && <p className="text-sm text-slate-400 p-3">لا توجد طلبيات بعد.</p>}</div></aside>

      <main className="space-y-4">{selected ? <>
        <section className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-bold">{selected.order.order_number}</h2><p className="text-sm text-slate-500">{selected.order.branch} • {status}</p></div><div className="flex flex-wrap gap-2"><button onClick={() => exportProfessionalWorkbook(selected)} className="rounded-lg border px-3 py-2 flex gap-2"><Download className="w-4 h-4" />تصدير ملف موحد</button>{status === 'معتمدة' && <button onClick={markSent} disabled={loading} className="rounded-lg bg-blue-600 text-white px-3 py-2 flex gap-2"><Send className="w-4 h-4" />تم الإرسال</button>}</div></div><div className="mt-4 flex overflow-x-auto">{STATUS_STEPS.map((s, i) => <div key={s} className="min-w-[125px] flex-1"><div className={`h-2 ${i <= stepIndex ? 'bg-teal-500' : 'bg-slate-200'}`} /><div className={`text-[11px] mt-2 ${i <= stepIndex ? 'font-bold text-teal-700' : 'text-slate-400'}`}>{s}</div></div>)}</div></section>

        <div className="grid sm:grid-cols-2 xl:grid-cols-6 gap-3">{[
          ['الأصناف', totals.items], ['إجمالي الكميات', totals.quantity], ['الموردون', totals.suppliers], ['بدون مورد', totals.missing], ['طلبات العملاء', totals.customers], ['التكلفة المتوقعة', `${money(totals.total)} ج`],
        ].map(([l, v]) => <div key={l} className="rounded-2xl border bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">{l}</div><div className="text-xl font-bold mt-2">{v}</div></div>)}</div>

        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm space-y-3">
          <div className="flex items-center gap-2"><WalletCards className="w-5 h-5 text-emerald-700" /><h3 className="font-bold">التحكم المالي الذكي</h3></div>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <label className="text-sm">الميزانية القصوى<input type="number" min="1" value={budgetLimit} onChange={(e) => setBudgetLimit(e.target.value)} className="mt-1 w-full rounded-lg border p-2 bg-white" /></label>
            <div className="rounded-xl bg-white border p-3"><div className="text-xs text-slate-500">التكلفة الحالية</div><div className="font-bold text-lg mt-1">{money(totals.total)} ج</div></div>
            <div className={`rounded-xl border p-3 ${budgetDifference >= 0 ? 'bg-white text-emerald-700' : 'bg-red-50 text-red-700'}`}><div className="text-xs">{budgetDifference >= 0 ? 'المتبقي من الميزانية' : 'تجاوز الميزانية'}</div><div className="font-bold text-lg mt-1">{money(Math.abs(budgetDifference))} ج</div></div>
            <button onClick={applySmartBudget} disabled={loading || ['معتمدة', 'تم الإرسال للمورد'].includes(status)} className="rounded-xl bg-emerald-700 text-white px-4 py-3 font-bold flex justify-center items-center gap-2 disabled:opacity-50"><Calculator className="w-5 h-5" />ضبط الكميات داخل الميزانية</button>
          </div>
          <p className="text-xs text-slate-600">النظام يعطي أولوية للأصناف العاجلة وطلبات العملاء، ثم يوزع باقي الميزانية حسب الاستهلاك والأولوية، ولا يتجاوز الحد المالي المحدد.</p>
        </section>

        <section className="rounded-2xl border bg-white p-4 shadow-sm space-y-3"><div className="flex items-center gap-2"><SlidersHorizontal className="w-5 h-5 text-violet-600" /><h3 className="font-bold">تعديل جماعي سريع</h3><span className="text-xs text-slate-400">يُطبق على الأصناف الظاهرة فقط ({visibleItems.length})</span></div><div className="flex flex-wrap gap-2 items-end"><label className="text-xs">نسبة الكمية<input type="number" min="0" value={bulkPercent} onChange={(e) => setBulkPercent(e.target.value)} className="mt-1 w-28 rounded-lg border p-2" /></label><button onClick={applyBulkQuantity} disabled={loading} className="rounded-lg border px-3 py-2 font-semibold">تطبيق النسبة</button><label className="text-xs">تعيين مورد<input value={bulkSupplier} onChange={(e) => setBulkSupplier(e.target.value)} placeholder="اسم المورد" className="mt-1 w-44 rounded-lg border p-2" /></label><button onClick={applyBulkSupplier} disabled={loading} className="rounded-lg border px-3 py-2 font-semibold">تعيين للظاهر</button><button onClick={zeroVisible} disabled={loading} className="rounded-lg border border-red-200 text-red-700 px-3 py-2 font-semibold">تصفير الظاهر</button></div><div className="flex flex-wrap gap-4 text-sm"><label className="flex gap-2"><input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />إخفاء الكمية صفر</label><label className="flex gap-2"><input type="checkbox" checked={onlyUrgent} onChange={(e) => setOnlyUrgent(e.target.checked)} />العاجل فقط</label><label className="flex gap-2"><input type="checkbox" checked={onlyCustomers} onChange={(e) => setOnlyCustomers(e.target.checked)} />طلبات العملاء فقط</label></div></section>

        <div className="flex flex-wrap gap-2">{!['معتمدة', 'تم الإرسال للمورد'].includes(status) && <button onClick={approve} disabled={loading || totals.missing > 0 || totals.total <= 0} className="rounded-lg bg-teal-600 text-white px-4 py-2 font-semibold flex gap-2"><CheckCircle2 className="w-4 h-4" />اعتماد الطلبية</button>}{['معتمدة', 'تم الإرسال للمورد'].includes(status) && <button onClick={returnToReview} disabled={loading} className="rounded-lg border border-amber-300 text-amber-800 px-4 py-2 font-semibold">إعادة للمراجعة</button>}</div>

        <section className="rounded-2xl border bg-white shadow-sm overflow-auto"><table className="min-w-[1350px] w-full text-sm"><thead className="bg-slate-50"><tr>{['الصنف', 'المطلوب', 'المعتمد', 'متوسط يومي', 'تغطية بالأيام', 'المورد', 'سعر الوحدة', 'إجمالي الصنف', 'الأولوية', 'طلبات العملاء'].map((h) => <th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody>{visibleItems.map((x) => <tr key={x.id} className="border-t"><td className="p-3"><div className="font-semibold">{x.product_name}</div><div className="text-xs text-slate-400">{x.product_code || 'بدون كود'}</div></td><td className="p-3">{x.requested_quantity}</td><td className="p-3"><input type="number" min="0" defaultValue={x.approved_quantity} disabled={['معتمدة', 'تم الإرسال للمورد'].includes(status)} onBlur={(e) => { const v = Number(e.target.value); if (v !== Number(x.approved_quantity)) run(() => updateOne(x, { approved_quantity: v }), 'تم تحديث كمية الصنف.'); }} className="w-24 rounded-lg border p-2 font-bold" /></td><td className="p-3 font-semibold">{itemUsage(x).toFixed(2)}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs ${itemCoverage(x) < 7 ? 'bg-red-50 text-red-700' : itemCoverage(x) > 35 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{itemCoverage(x).toFixed(1)} يوم</span></td><td className="p-3"><input defaultValue={x.supplier_name || ''} disabled={['معتمدة', 'تم الإرسال للمورد'].includes(status)} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (x.supplier_name || '')) run(() => updateOne(x, { supplier_name: v }), 'تم تحديث مورد الصنف.'); }} className="w-40 rounded-lg border p-2" /></td><td className="p-3"><input type="number" min="0" step="0.01" defaultValue={x.expected_unit_cost} disabled={['معتمدة', 'تم الإرسال للمورد'].includes(status)} onBlur={(e) => { const v = Number(e.target.value); if (v !== Number(x.expected_unit_cost)) run(() => updateOne(x, { expected_unit_cost: v }), 'تم تحديث سعر الصنف.'); }} className="w-28 rounded-lg border p-2" /></td><td className="p-3 font-bold">{money(itemTotal(x))} ج</td><td className="p-3">{x.priority_label || x.priority_score}</td><td className="p-3">{x.customer_requests_count || 0}</td></tr>)}{!visibleItems.length && <tr><td colSpan="10" className="p-10 text-center text-slate-400">لا توجد أصناف مطابقة للفلاتر الحالية.</td></tr>}</tbody></table></section>
      </> : <section className="rounded-2xl border border-dashed bg-white p-12 text-center text-slate-400"><FileSpreadsheet className="w-10 h-10 mx-auto mb-3" />اختر طلبية أو ارفع ملف Excel لبدء العمل.</section>}</main>
    </div>
  </div>;
}
