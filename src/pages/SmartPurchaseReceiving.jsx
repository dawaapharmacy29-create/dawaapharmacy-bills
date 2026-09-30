import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { AlertTriangle, Download, FileSpreadsheet, PackageCheck, RefreshCw, Save, WandSparkles } from 'lucide-react';
import { smartPurchaseReceivingApi as api } from '@/api/smartPurchaseReceivingApi';
import { invoiceValueGuard } from '@/lib/purchaseFinancialControl';

const num = (value) => { const parsed = Number(String(value ?? '').replace(/[,٪%جنيه]/g, '').trim()); return Number.isFinite(parsed) ? parsed : 0; };
const money = (value) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(num(value));
const cleanName = (value) => String(value ?? '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ').trim().replace(/\s+/g, ' ');
const safeFileName = (value) => String(value || 'طلبية').replace(/[\\/:*?"<>|]+/g, '-').trim();
const ALIASES = {
  product_code: ['كود الصنف', 'الكود', 'كود', 'code', 'item code', 'product code'],
  product_name: ['اسم الصنف', 'الصنف', 'الاسم', 'name', 'item name', 'product name', 'description'],
  quantity: ['الكمية', 'الكميه', 'الكمية المطلوبة', 'الكمية المتاحة', 'المتاح', 'quantity', 'qty', 'available'],
  price: ['السعر', 'سعر الجمهور', 'سعر الوحدة', 'price', 'unit price', 'list price'],
};
function findValue(row, field) { const keys = Object.keys(row || {}); const wanted = ALIASES[field] || []; const exact = keys.find((key) => wanted.some((alias) => cleanName(key) === cleanName(alias))); if (exact) return row[exact]; const partial = keys.find((key) => wanted.some((alias) => cleanName(key).includes(cleanName(alias)))); return partial ? row[partial] : ''; }
function editDistance(a, b) { const left = cleanName(a); const right = cleanName(b); const matrix = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0)); for (let i = 0; i <= left.length; i += 1) matrix[i][0] = i; for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j; for (let i = 1; i <= left.length; i += 1) { for (let j = 1; j <= right.length; j += 1) { matrix[i][j] = left[i - 1] === right[j - 1] ? matrix[i - 1][j - 1] : 1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]); } } return matrix[left.length][right.length]; }
function nameSimilarity(a, b) { const left = cleanName(a); const right = cleanName(b); if (!left || !right) return 0; if (left === right) return 1; const chars = 1 - (editDistance(left, right) / Math.max(left.length, right.length)); const leftTokens = new Set(left.split(' ')); const rightTokens = new Set(right.split(' ')); const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length; const tokenScore = shared / Math.max(leftTokens.size, rightTokens.size, 1); return Math.max(0, (chars * 0.65) + (tokenScore * 0.35)); }
function activeQuantity(item) { return Math.max(0, num(item.approved_quantity || item.requested_quantity)); }
function remainingQuantity(item) { return Math.max(0, activeQuantity(item) - Math.max(0, num(item.received_quantity))); }
function expectedCost(item) { return Math.max(0, num(item.expected_unit_cost || item.last_purchase_price)); }
function orderTitle(order = {}) { return order.title || order.name || order.order_name || order.order_number || 'طلبية'; }
function parseWorkbook(file) { return file.arrayBuffer().then((buffer) => { const workbook = XLSX.read(buffer, { type: 'array' }); const sheet = workbook.Sheets[workbook.SheetNames[0]]; const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true }); return raw.map((row, index) => ({ row_number: index + 2, product_code: String(findValue(row, 'product_code') || '').trim(), product_name: String(findValue(row, 'product_name') || '').trim(), quantity: Math.max(0, num(findValue(row, 'quantity'))), price: Math.max(0, num(findValue(row, 'price'))), source: row })).filter((row) => row.product_code || row.product_name); }); }
function matchRows(orderItems, uploadedRows) {
  const used = new Set();
  const matches = orderItems.map((item) => {
    let index = -1; let confidence = 0; let method = 'none';
    if (item.product_code) { index = uploadedRows.findIndex((row, rowIndex) => !used.has(rowIndex) && row.product_code && String(row.product_code) === String(item.product_code)); if (index >= 0) { confidence = 1; method = 'code'; } }
    if (index < 0) { index = uploadedRows.findIndex((row, rowIndex) => !used.has(rowIndex) && cleanName(row.product_name) === cleanName(item.product_name)); if (index >= 0) { confidence = 0.98; method = 'name'; } }
    if (index < 0) { let best = { index: -1, score: 0 }; uploadedRows.forEach((row, rowIndex) => { if (used.has(rowIndex)) return; const score = nameSimilarity(item.product_name, row.product_name); if (score > best.score) best = { index: rowIndex, score }; }); if (best.score >= 0.72) { index = best.index; confidence = best.score; method = 'fuzzy'; } }
    if (index >= 0) used.add(index);
    return { item, row: index >= 0 ? uploadedRows[index] : null, confidence, method };
  });
  const unexpected = uploadedRows.map((row, index) => ({ row, index })).filter(({ index }) => !used.has(index)).map(({ row }) => { const closest = orderItems.reduce((best, item) => { const score = nameSimilarity(item.product_name, row.product_name); return score > best.score ? { item, score } : best; }, { item: null, score: 0 }); return { ...row, closest_item: closest.item, similarity: closest.score }; });
  return { matches, unexpected };
}
function downloadWorkbook(sheets, fileName) { const workbook = XLSX.utils.book_new(); Object.entries(sheets).forEach(([name, sheetRows]) => { const sheet = XLSX.utils.json_to_sheet(sheetRows); sheet['!dir'] = 'rtl'; sheet['!freeze'] = { ySplit: 1 }; if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] }; XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31)); }); XLSX.writeFile(workbook, fileName); }

export default function SmartPurchaseReceiving() {
  const [searchParams] = useSearchParams();
  const scopedOrderIdsParam = searchParams.get('orderIds') || '';
  const selectedOrderIdParam = searchParams.get('selectedOrderId') || '';
  const scopedOrderIds = useMemo(() => scopedOrderIdsParam
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean), [scopedOrderIdsParam]);
  const [orders, setOrders] = useState([]); const [selected, setSelected] = useState(null); const [mode, setMode] = useState('supplier_response'); const [responseType, setResponseType] = useState('available'); const [supplierName, setSupplierName] = useState(''); const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState(''); const [receiptDate, setReceiptDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())); const [fileName, setFileName] = useState(''); const [rows, setRows] = useState([]); const [loading, setLoading] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [invoiceLimit, setInvoiceLimit] = useState(0); const [invoiceTolerancePct] = useState(2); const [invoiceToleranceValue] = useState(100);
  async function refresh() {
    setLoading(true); setError('');
    try {
      const availableOrders = await api.listOrders() || [];
      setOrders(scopedOrderIds.length
        ? availableOrders.filter((order) => scopedOrderIds.includes(String(order.id)))
        : availableOrders);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, [scopedOrderIdsParam]);
  useEffect(() => {
    if (loading || selected?.order?.id || !orders.length) return;
    const preferredOrder = orders.find((order) => String(order.id) === String(selectedOrderIdParam)) || orders[0];
    if (preferredOrder?.id) void chooseOrder(preferredOrder.id);
  }, [orders, loading, selected?.order?.id, selectedOrderIdParam]);
  async function chooseOrder(id) { setLoading(true); setError(''); setMessage(''); setRows([]); setFileName(''); setSupplierInvoiceNumber(''); try { const detail = await api.getOrder(id); setSelected(detail); setInvoiceLimit(num(detail?.order?.maximum_order_value || detail?.order?.budget || 0)); const suppliers = [...new Set((detail?.items || []).map((item) => String(item.supplier_name || '').trim()).filter(Boolean))]; setSupplierName(suppliers.length === 1 ? suppliers[0] : ''); } catch (err) { setError(err.message); } finally { setLoading(false); } }
  async function readFile(file) { setError(''); setMessage(''); setFileName(file.name); try { const parsed = await parseWorkbook(file); if (!parsed.length) throw new Error('لم يتم التعرف على أصناف داخل الملف.'); setRows(parsed); setMessage(`تمت قراءة ${parsed.length} صنف من الملف. المطابقة هتتم على الكميات المتبقية للمورد المختار.`); } catch (err) { setRows([]); setError(`تعذر قراءة الملف: ${err.message}`); } }
  const orderSuppliers = useMemo(() => [...new Set((selected?.items || [])
    .filter((item) => activeQuantity(item) > 0)
    .map((item) => String(item.supplier_name || '').trim())
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar')), [selected]);
  const supplierAllItems = useMemo(() => {
    const supplierKey = String(supplierName || '').trim().toLowerCase();
    if (!supplierKey) return [];
    return (selected?.items || []).filter((item) => activeQuantity(item) > 0
      && String(item.supplier_name || '').trim().toLowerCase() === supplierKey);
  }, [selected, supplierName]);
  const orderItems = useMemo(() => supplierAllItems.filter((item) => remainingQuantity(item) > 0), [supplierAllItems]);
  const supplierProgress = useMemo(() => {
    const ordered = supplierAllItems.reduce((sum, item) => sum + activeQuantity(item), 0);
    const received = supplierAllItems.reduce((sum, item) => sum + Math.min(activeQuantity(item), Math.max(0, num(item.received_quantity))), 0);
    const remaining = Math.max(0, ordered - received);
    const completion = ordered > 0 ? Number(((received / ordered) * 100).toFixed(1)) : 0;
    return { ordered, received, remaining, completion };
  }, [supplierAllItems]);
  const matching = useMemo(() => matchRows(orderItems, rows), [orderItems, rows]);
  const supplierResult = useMemo(() => { if (!selected || !rows.length) return null; const details = matching.matches.map(({ item, row, confidence, method }) => { const ordered = remainingQuantity(item); let confirmed = 0; let remaining = 0; if (responseType === 'missing') { remaining = row ? Math.min(ordered, row.quantity > 0 ? row.quantity : ordered) : 0; confirmed = ordered - remaining; } else { confirmed = row ? Math.min(ordered, row.quantity > 0 ? row.quantity : ordered) : 0; remaining = Math.max(0, ordered - confirmed); } return { item, row, ordered, confirmed, remaining, confidence, method, status: remaining <= 0 ? 'متاح بالكامل' : confirmed > 0 ? 'متاح جزئيًا' : 'غير متاح' }; }); return { details, remaining: details.filter((row) => row.remaining > 0), confirmed: details.filter((row) => row.confirmed > 0), unexpected: matching.unexpected }; }, [selected, rows, matching, responseType]);
  const receiptResult = useMemo(() => { if (!selected || !rows.length) return null; const details = matching.matches.map(({ item, row, confidence, method }) => { const ordered = remainingQuantity(item); const received = row ? row.quantity : 0; const expectedPrice = expectedCost(item); const actualPrice = row ? row.price : 0; let status = 'سليم'; if (!row) status = 'لم يصل'; else if (received < ordered) status = 'كمية ناقصة'; else if (received > ordered) status = 'كمية زائدة'; else if (method === 'fuzzy' && confidence < 0.9) status = 'اسم مختلف يحتاج مراجعة'; if (row && received > 0 && actualPrice <= 0) status = status === 'سليم' ? 'السعر غير موجود' : `${status} + السعر غير موجود`;
    else if (row && actualPrice > 0 && expectedPrice > 0 && Math.abs(actualPrice - expectedPrice) > 0.01) status = status === 'سليم' ? 'فرق سعر' : `${status} + فرق سعر`; return { item, row, ordered, received, difference: received - ordered, expectedPrice, actualPrice, valueDifference: (received * actualPrice) - (ordered * expectedPrice), confidence, method, status }; }); const unexpected = matching.unexpected.map((row) => ({ ...row, status: row.similarity >= 0.45 ? 'صنف مختلف محتمل' : 'صنف غير مطلوب' })); return { details, unexpected }; }, [selected, rows, matching]);
  const currentResult = mode === 'supplier_response' ? supplierResult : receiptResult;
  const receiptExpectedTotal = receiptResult ? receiptResult.details.reduce((sum, row) => sum + (row.ordered * row.expectedPrice), 0) : 0;
  const receiptActualTotal = receiptResult ? (
    receiptResult.details.reduce((sum, row) => sum + (row.received * (row.actualPrice > 0 ? row.actualPrice : row.expectedPrice)), 0)
    + receiptResult.unexpected.reduce((sum, row) => sum + (num(row.quantity) * num(row.price)), 0)
  ) : 0;
  const receiptMissingPrices = receiptResult ? (
    receiptResult.details.filter((row) => row.received > 0 && row.actualPrice <= 0).length
    + receiptResult.unexpected.filter((row) => num(row.quantity) > 0 && num(row.price) <= 0).length
  ) : 0;
  const invoiceGuard = invoiceValueGuard(receiptExpectedTotal, receiptActualTotal, invoiceLimit, invoiceTolerancePct, invoiceToleranceValue);
  async function saveSnapshot() {
    if (!selected?.order?.id || !currentResult) return;
    if (!supplierName.trim()) {
      setError(mode === 'receipt' ? 'حدد المورد قبل تسجيل الاستلام الفعلي.' : 'حدد المورد صاحب ملف الرد أولًا.');
      return;
    }
    if (mode === 'receipt' && receiptMissingPrices > 0) {
      setError(`يوجد ${receiptMissingPrices} صف مستلم بدون سعر فعلي. أضف السعر قبل تسجيل الاستلام حتى لا تتسجل قيمة مالية ناقصة.`);
      return;
    }
    if (mode === 'receipt' && invoiceGuard.blocked) {
      setError(`تم إيقاف اعتماد الاستلام: قيمة الفاتورة ${money(receiptActualTotal)} ج تتجاوز الحد المقبول ${money(invoiceGuard.effectiveLimit)} ج.`);
      return;
    }

    setLoading(true); setError(''); setMessage('');
    let actualReceiptSaved = false;
    try {
      if (mode === 'receipt') {
        const receiptRows = [
          ...receiptResult.details.map((detail) => ({
            product_code: detail.row?.product_code || detail.item.product_code || '',
            product_name: detail.row?.product_name || detail.item.product_name,
            received_quantity: detail.received,
            invoiced_quantity: detail.received,
            actual_unit_cost: detail.actualPrice > 0 ? detail.actualPrice : detail.expectedPrice,
            actual_total: detail.received * (detail.actualPrice > 0 ? detail.actualPrice : detail.expectedPrice),
            notes: detail.status,
          })),
          ...receiptResult.unexpected.map((row) => ({
            product_code: row.product_code || '',
            product_name: row.product_name,
            received_quantity: num(row.quantity),
            invoiced_quantity: num(row.quantity),
            actual_unit_cost: num(row.price),
            actual_total: num(row.quantity) * num(row.price),
            notes: row.status,
          })),
        ];
        await api.importReceipt({
          order_id: selected.order.id,
          supplier_name: supplierName,
          supplier_invoice_number: supplierInvoiceNumber.trim(),
          receipt_date: receiptDate,
          file_name: fileName,
          rows: receiptRows,
        });
        actualReceiptSaved = true;
      }

      await api.saveWorkflowSnapshot({
        order_id: selected.order.id,
        workflow_type: mode,
        response_type: mode === 'supplier_response' ? responseType : null,
        supplier_name: supplierName,
        file_name: fileName,
        summary: mode === 'supplier_response'
          ? { confirmed_items: supplierResult.confirmed.length, remaining_items: supplierResult.remaining.length, unexpected_items: supplierResult.unexpected.length }
          : { matched_items: receiptResult.details.length, issue_items: receiptResult.details.filter((row) => row.status !== 'سليم').length, unexpected_items: receiptResult.unexpected.length, expected_total: receiptExpectedTotal, actual_total: receiptActualTotal },
        details: currentResult,
      });

      setMessage(mode === 'receipt' ? 'تم تسجيل الاستلام فعليًا وتحديث الطلبية وحفظ نتيجة المطابقة.' : 'تم حفظ نتيجة رد المورد داخل سجل الطلبية.');
      if (mode === 'receipt') {
        const detail = await api.getOrder(selected.order.id);
        setSelected(detail);
        await refresh();
      }
    } catch (err) {
      setError(actualReceiptSaved
        ? `تم تسجيل الاستلام فعليًا، لكن تعذر حفظ Snapshot المتابعة: ${err.message}`
        : err.message);
    } finally {
      setLoading(false);
    }
  }
  function exportRemaining() { if (!supplierResult) return; const exportRows = supplierResult.remaining.map(({ item, remaining }) => ({ 'اسم الصنف': item.product_name || '', 'تكلفة الوحدة المتوقعة': expectedCost(item), 'الكمية المطلوبة': remaining })); downloadWorkbook({ 'المتبقي لمورد آخر': exportRows }, `${safeFileName(orderTitle(selected.order))}_المتبقي_لمورد_آخر.xlsx`); }
  function exportReceiptReport() { if (!receiptResult) return; const summary = [{ 'البيان': 'اسم الطلبية', 'القيمة': orderTitle(selected.order) }, { 'البيان': 'الكود المرجعي', 'القيمة': selected.order.order_number || '' }, { 'البيان': 'عدد الأصناف المطلوبة', 'القيمة': receiptResult.details.length }, { 'البيان': 'القيمة المتوقعة', 'القيمة': receiptExpectedTotal }, { 'البيان': 'قيمة الفاتورة الفعلية', 'القيمة': receiptActualTotal }, { 'البيان': 'فرق القيمة', 'القيمة': Number((receiptActualTotal - receiptExpectedTotal).toFixed(2)) }, { 'البيان': 'حالة التحكم المالي', 'القيمة': invoiceGuard.status }, { 'البيان': 'أصناف سليمة', 'القيمة': receiptResult.details.filter((row) => row.status === 'سليم').length }, { 'البيان': 'أصناف بها ملاحظات', 'القيمة': receiptResult.details.filter((row) => row.status !== 'سليم').length }, { 'البيان': 'أصناف غير متوقعة', 'القيمة': receiptResult.unexpected.length }]; const details = receiptResult.details.map((row) => ({ 'الصنف المطلوب': row.item.product_name || '', 'الكود': row.item.product_code || '', 'الكمية المطلوبة': row.ordered, 'الصنف الموجود بالملف': row.row?.product_name || '', 'الكمية المستلمة': row.received, 'فرق الكمية': row.difference, 'السعر المتوقع': row.expectedPrice, 'السعر الفعلي': row.actualPrice, 'فرق القيمة': Number(row.valueDifference.toFixed(2)), 'طريقة المطابقة': row.method, 'نسبة الثقة %': Number((row.confidence * 100).toFixed(1)), 'النتيجة': row.status })); const unexpected = receiptResult.unexpected.map((row) => ({ 'الصنف الموجود بالملف': row.product_name, 'الكود': row.product_code, 'الكمية': row.quantity, 'السعر': row.price, 'أقرب صنف مطلوب': row.closest_item?.product_name || '', 'نسبة التشابه %': Number((row.similarity * 100).toFixed(1)), 'النتيجة': row.status })); downloadWorkbook({ 'الملخص': summary, 'مطابقة الأصناف': details, 'أصناف غير متوقعة': unexpected }, `${safeFileName(orderTitle(selected.order))}_تقرير_الاستلام_والمطابقة.xlsx`); }
  const supplierStats = supplierResult ? { confirmed: supplierResult.confirmed.length, remaining: supplierResult.remaining.length, unexpected: supplierResult.unexpected.length } : null;
  const receiptStats = receiptResult ? { ok: receiptResult.details.filter((row) => row.status === 'سليم').length, issues: receiptResult.details.filter((row) => row.status !== 'سليم').length, unexpected: receiptResult.unexpected.length } : null;
  const receivingResolutionItems = useMemo(() => (selected?.items || []).filter((item) => activeQuantity(item) > 0), [selected]);
  const pendingResolutionItems = useMemo(() => receivingResolutionItems.filter((item) => String(item.resolution_status || 'pending') === 'pending'), [receivingResolutionItems]);
  const followupResolutionItems = useMemo(() => receivingResolutionItems.filter((item) => String(item.resolution_status || '') === 'followup_required'), [receivingResolutionItems]);
  const receivingStarted = Boolean((selected?.receipts || []).length);
  const financialReceipts = useMemo(() => selected?.receipts || [], [selected]);
  const pendingFinancialReceipts = useMemo(() => financialReceipts.filter((receipt) => String(receipt.financial_resolution_status || 'pending') === 'pending'), [financialReceipts]);
  const followupFinancialReceipts = useMemo(() => financialReceipts.filter((receipt) => String(receipt.financial_resolution_status || '') === 'followup_required'), [financialReceipts]);
  const financialSummary = useMemo(() => ({
    expected: financialReceipts.reduce((sum, receipt) => sum + num(receipt.expected_total), 0),
    invoiced: financialReceipts.reduce((sum, receipt) => sum + num(receipt.invoiced_total), 0),
    received: financialReceipts.reduce((sum, receipt) => sum + num(receipt.received_total), 0),
    bonus: financialReceipts.reduce((sum, receipt) => sum + num(receipt.bonus_quantity), 0),
    valueVariance: financialReceipts.reduce((sum, receipt) => sum + num(receipt.value_variance), 0),
    priceVariance: financialReceipts.reduce((sum, receipt) => sum + num(receipt.price_variance), 0),
  }), [financialReceipts]);
  const closeReadyLocal = receivingStarted
    && receivingResolutionItems.length > 0
    && pendingResolutionItems.length === 0
    && followupResolutionItems.length === 0
    && pendingFinancialReceipts.length === 0
    && followupFinancialReceipts.length === 0;

  async function resolveReceivingItem(item, resolutionStatus) {
    if (!selected?.order?.id || !item?.id) return;
    setLoading(true); setError(''); setMessage('');
    try {
      await api.resolveItem(selected.order.id, item.id, resolutionStatus);
      const detail = await api.getOrder(selected.order.id);
      setSelected(detail);
      setMessage('تم حفظ قرار الاستلام للصنف.');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function resolveFinancialReceipt(receipt, resolutionStatus) {
    if (!receipt?.id) return;
    setLoading(true); setError(''); setMessage('');
    try {
      await api.resolveReceiptFinancial(receipt.id, resolutionStatus);
      const detail = await api.getOrder(selected.order.id);
      setSelected(detail);
      setMessage('تم حفظ قرار المطابقة المالية لفاتورة المورد.');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function closeCurrentOrder() {
    if (!selected?.order?.id) return;
    setLoading(true); setError(''); setMessage('');
    try {
      await api.closeOrder(selected.order.id);
      setMessage('تم إغلاق الطلبية بعد حسم كل فروق الاستلام.');
      setSelected(null);
      await refresh();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return <div dir="rtl" className="p-3 md:p-6 space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="rounded-xl bg-teal-50 p-2.5"><PackageCheck className="h-6 w-6 text-teal-600" /></div><div><h1 className="text-2xl font-bold">دورة تنفيذ ومطابقة الطلبية</h1><p className="text-sm text-slate-500 mt-1">رد المورد، استخراج المتبقي، ثم مطابقة ما وصل فعليًا مع المطلوب.</p></div></div><button onClick={refresh} className="rounded-lg border bg-white px-4 py-2 flex items-center gap-2"><RefreshCw className="w-4 h-4" />تحديث</button></header>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5 shrink-0" />{error}</div>}
    {message && <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-teal-700">{message}</div>}
    <div className="grid lg:grid-cols-[300px_minmax(0,1fr)] gap-4">
      <aside className="rounded-2xl border bg-white p-3 shadow-sm h-fit"><h2 className="font-bold mb-3">{scopedOrderIds.length ? 'طلبيتا الرحلة الحالية' : 'الطلبيات'}</h2>{scopedOrderIds.length > 0 && <p className="mb-3 text-xs text-slate-500">تم فتح شكري والشامي مباشرة من رحلة المشتريات الحالية.</p>}<div className="space-y-2 max-h-[700px] overflow-auto">{orders.map((order) => <button key={order.id} onClick={() => chooseOrder(order.id)} className={`w-full text-right rounded-xl border p-3 ${selected?.order?.id === order.id ? 'border-teal-500 bg-teal-50' : 'hover:bg-slate-50'}`}><div className="font-bold">{orderTitle(order)}</div><div className="text-[11px] text-slate-400 mt-1">{order.order_number}</div><div className="text-xs text-slate-500 mt-1">{order.branch} • {order.status}</div></button>)}{!orders.length && !loading && <p className="text-sm text-slate-400 p-3">لا توجد طلبيات متاحة.</p>}</div></aside>
      <main className="space-y-4">{!selected && <div className="rounded-2xl border bg-white p-8 text-center text-slate-500">اختر طلبية للبدء.</div>}{selected && <>
        <section className="rounded-2xl border bg-white p-4 shadow-sm"><h2 className="text-xl font-bold">{orderTitle(selected.order)}</h2><p className="text-xs text-slate-400 mt-1">{selected.order.order_number}</p><p className="text-sm text-slate-500 mt-1">{selected.order.branch} • {orderSuppliers.length} مورد • {supplierName ? `${orderItems.length} صنف للمورد المختار` : 'اختر المورد لبدء المطابقة'}</p><div className="mt-4 grid sm:grid-cols-2 gap-2"><button onClick={() => { setMode('supplier_response'); setRows([]); }} className={`rounded-xl border p-3 font-bold ${mode === 'supplier_response' ? 'border-teal-500 bg-teal-50 text-teal-700' : ''}`}>1. تسجيل رد المورد واستخراج المتبقي</button><button onClick={() => { setMode('receipt'); setRows([]); }} className={`rounded-xl border p-3 font-bold ${mode === 'receipt' ? 'border-teal-500 bg-teal-50 text-teal-700' : ''}`}>2. رفع المشتريات ومطابقة الاستلام</button></div></section>
        {receivingStarted && <section className="rounded-2xl border border-blue-200 bg-blue-50/30 p-4 shadow-sm space-y-3">
          <div>
            <h3 className="font-bold">المطابقة المالية النهائية</h3>
            <p className="text-xs text-slate-500 mt-1">كل فاتورة مورد لازم تكون مطابقة ماليًا أو يكون فرقها معتمد بقرار واضح قبل الإغلاق النهائي.</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
            {[
              ['المتوقع', `${money(financialSummary.expected)} ج`],
              ['المفوتر', `${money(financialSummary.invoiced)} ج`],
              ['المستلم', `${money(financialSummary.received)} ج`],
              ['البونص', financialSummary.bonus],
              ['فرق القيمة', `${money(financialSummary.valueVariance)} ج`],
              ['فرق السعر', `${money(financialSummary.priceVariance)} ج`],
            ].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">{label}</div><div className="font-bold mt-1">{value}</div></div>)}
          </div>
          <div className="space-y-2">
            {financialReceipts.map((receipt) => {
              const status = String(receipt.financial_resolution_status || 'pending');
              const unresolved = ['pending','followup_required'].includes(status);
              return <div key={receipt.id} className="rounded-xl border bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-bold">{receipt.supplier_name || 'مورد غير محدد'} {receipt.supplier_invoice_number ? `• فاتورة ${receipt.supplier_invoice_number}` : ''}</div>
                    <div className="text-xs text-slate-500 mt-1">متوقع {money(receipt.expected_total)} • مفوتر {money(receipt.invoiced_total)} • مستلم {money(receipt.received_total)} • بونص {num(receipt.bonus_quantity)} • فرق قيمة {money(receipt.value_variance)} • فرق سعر {money(receipt.price_variance)}</div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${status === 'accepted_match' ? 'bg-emerald-100 text-emerald-700' : status === 'accepted_variance' ? 'bg-blue-100 text-blue-700' : status === 'followup_required' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'}`}>
                    {status === 'accepted_match' ? 'مطابقة' : status === 'accepted_variance' ? 'فرق معتمد' : status === 'followup_required' ? 'متابعة مفتوحة' : 'قرار مالي مطلوب'}
                  </span>
                </div>
                {unresolved && <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={loading} onClick={() => resolveFinancialReceipt(receipt, 'accepted_variance')} className="rounded-lg border px-3 py-2 text-xs font-bold">اعتماد الفرق المالي</button>
                  <button type="button" disabled={loading} onClick={() => resolveFinancialReceipt(receipt, 'followup_required')} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">يحتاج متابعة مالية</button>
                </div>}
              </div>;
            })}
          </div>
        </section>}

        {receivingStarted && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold">إغلاق الطلبية بعد الاستلام</h3>
              <p className="text-xs text-slate-500 mt-1">الأصناف السليمة تُقفل تلقائيًا. أي نقص أو زيادة أو فرق سعر/فاتورة يحتاج قرار واضح قبل الإغلاق النهائي.</p>
            </div>
            <button type="button" onClick={closeCurrentOrder} disabled={loading || !closeReadyLocal} className="rounded-lg bg-slate-900 px-4 py-2 font-bold text-white disabled:opacity-40">إغلاق الطلبية نهائيًا</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            {[
              ['إجمالي البنود', receivingResolutionItems.length],
              ['قرارات معلقة', pendingResolutionItems.length],
              ['متابعة مفتوحة', followupResolutionItems.length + followupFinancialReceipts.length],
              ['جاهزية الإغلاق', closeReadyLocal ? 'جاهزة' : 'غير جاهزة'],
            ].map(([label, value]) => <div key={label} className="rounded-xl border bg-slate-50 p-3"><div className="text-xs text-slate-500">{label}</div><div className="font-bold mt-1">{value}</div></div>)}
          </div>
          {(pendingResolutionItems.length > 0 || followupResolutionItems.length > 0) && <div className="space-y-2">
            {receivingResolutionItems.filter((item) => ['pending','followup_required'].includes(String(item.resolution_status || 'pending'))).map((item) => {
              const approved = activeQuantity(item);
              const received = Math.max(0, num(item.received_quantity));
              const invoiced = Math.max(0, num(item.invoiced_quantity));
              const expected = expectedCost(item);
              const actual = Math.max(0, num(item.actual_unit_cost));
              const shortage = received < approved;
              const overage = received > approved;
              const priceIssue = received > 0 && expected > 0 && actual > 0 && Math.abs(actual - expected) > Math.max(0.01, expected * 0.03);
              const invoiceIssue = invoiced !== received;
              return <div key={item.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><div className="font-bold">{item.product_name}</div><div className="text-xs text-slate-500 mt-1">معتمد {approved} • مستلم {received} • مفوتر {invoiced}{priceIssue ? ` • السعر المتوقع ${money(expected)} / الفعلي ${money(actual)}` : ''}</div></div>
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${item.resolution_status === 'followup_required' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'}`}>{item.resolution_status === 'followup_required' ? 'متابعة مفتوحة' : 'قرار مطلوب'}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {shortage && <button type="button" disabled={loading} onClick={() => resolveReceivingItem(item, 'accepted_shortage')} className="rounded-lg border px-3 py-2 text-xs font-bold">اعتماد النقص</button>}
                  {overage && <button type="button" disabled={loading} onClick={() => resolveReceivingItem(item, 'accepted_overage')} className="rounded-lg border px-3 py-2 text-xs font-bold">اعتماد الزيادة</button>}
                  {priceIssue && <button type="button" disabled={loading} onClick={() => resolveReceivingItem(item, 'accepted_price_variance')} className="rounded-lg border px-3 py-2 text-xs font-bold">اعتماد فرق السعر</button>}
                  {invoiceIssue && <button type="button" disabled={loading} onClick={() => resolveReceivingItem(item, 'accepted_invoice_variance')} className="rounded-lg border px-3 py-2 text-xs font-bold">اعتماد فرق الفاتورة</button>}
                  <button type="button" disabled={loading} onClick={() => resolveReceivingItem(item, 'followup_required')} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">يحتاج متابعة</button>
                </div>
              </div>;
            })}
          </div>}
        </section>}
        {!receivingStarted && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">قرارات الفروق والإغلاق النهائي هتظهر بعد تسجيل أول استلام فعلي على الطلبية.</div>}

        {supplierName && <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
          <div className="font-bold text-emerald-950 mb-3">موقف المورد التراكمي</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              ['المعتمد', supplierProgress.ordered],
              ['المستلم حتى الآن', supplierProgress.received],
              ['المتبقي', supplierProgress.remaining],
              ['نسبة الاكتمال', `${supplierProgress.completion}%`],
            ].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">{label}</div><div className="text-xl font-bold mt-1">{value}</div></div>)}
          </div>
        </section>}
        <section className="rounded-2xl border bg-white p-4 shadow-sm space-y-4"><div className="grid md:grid-cols-5 gap-3">{mode === 'supplier_response' && <label className="text-sm">نوع ملف رد المورد<select value={responseType} onChange={(event) => setResponseType(event.target.value)} className="mt-1 w-full rounded-lg border p-2"><option value="available">الأصناف المتاحة فقط</option><option value="missing">الأصناف غير المتاحة فقط</option><option value="modified">نسخة الطلبية بعد حذف النواقص</option></select></label>}<label className="text-sm">المورد *<select value={supplierName} onChange={(event) => { setSupplierName(event.target.value); setRows([]); setFileName(''); }} className="mt-1 w-full rounded-lg border p-2"><option value="">اختر المورد</option>{orderSuppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}</select><span className="text-[11px] text-slate-500">المطابقة هتكون على أصناف المورد المختار فقط.</span></label>{mode === 'receipt' && <><label className="text-sm">رقم فاتورة المورد<input value={supplierInvoiceNumber} onChange={(event) => setSupplierInvoiceNumber(event.target.value)} className="mt-1 w-full rounded-lg border p-2" placeholder="اختياري لكن يفضل إدخاله" /></label><label className="text-sm">تاريخ الاستلام<input type="date" value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label></>}<label className="text-sm md:col-span-2">ملف Excel أو CSV<input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => event.target.files?.[0] && readFile(event.target.files[0])} className="mt-1 block w-full text-sm" /></label></div><div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">اختيار المورد إلزامي، والمطابقة تتم فقط على الأصناف المسندة له داخل الطلبية. يتعرف النظام تلقائيًا على الاسم والكود والكمية والسعر، ورقم فاتورة المورد يقوي منع التكرار.</div></section>
        {mode === 'supplier_response' && supplierResult && <><div className="grid sm:grid-cols-3 gap-3">{[['تم تأكيده', supplierStats.confirmed], ['متبقي لمورد آخر', supplierStats.remaining], ['صفوف غير معروفة', supplierStats.unexpected]].map(([label, value]) => <div key={label} className="rounded-2xl border bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">{label}</div><div className="text-2xl font-bold mt-2">{value}</div></div>)}</div><div className="flex flex-wrap gap-2"><button onClick={exportRemaining} className="rounded-lg bg-teal-600 text-white px-4 py-2 font-bold flex items-center gap-2"><Download className="w-4 h-4" />ملف المتبقي لمورد آخر</button><button disabled={loading} onClick={saveSnapshot} className="rounded-lg border bg-white px-4 py-2 font-bold flex items-center gap-2"><Save className="w-4 h-4" />حفظ النتيجة</button></div><div className="rounded-2xl border bg-white overflow-auto shadow-sm"><table className="min-w-[900px] w-full text-sm"><thead className="bg-slate-50"><tr>{['الصنف', 'المطلوب', 'المؤكد', 'المتبقي', 'المطابقة', 'النتيجة'].map((head) => <th key={head} className="p-3 text-right">{head}</th>)}</tr></thead><tbody>{supplierResult.details.map((row) => <tr key={row.item.id} className="border-t"><td className="p-3 font-semibold">{row.item.product_name}<div className="text-xs text-slate-400">{row.item.product_code}</div></td><td className="p-3">{row.ordered}</td><td className="p-3">{row.confirmed}</td><td className="p-3 font-bold">{row.remaining}</td><td className="p-3">{row.method === 'code' ? 'بالكود' : row.method === 'name' ? 'بالاسم' : row.method === 'fuzzy' ? `تشابه ${Math.round(row.confidence * 100)}%` : 'غير موجود'}</td><td className="p-3">{row.status}</td></tr>)}</tbody></table></div></>}
        {mode === 'receipt' && receiptResult && <><div className="grid sm:grid-cols-3 gap-3">{[['سليم', receiptStats.ok], ['يحتاج مراجعة', receiptStats.issues], ['أصناف غير متوقعة', receiptStats.unexpected]].map(([label, value]) => <div key={label} className="rounded-2xl border bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">{label}</div><div className="text-2xl font-bold mt-2">{value}</div></div>)}</div><div className="flex flex-wrap gap-2"><button onClick={exportReceiptReport} className="rounded-lg bg-slate-900 text-white px-4 py-2 font-bold flex items-center gap-2"><FileSpreadsheet className="w-4 h-4" />تصدير تقرير المطابقة</button><button disabled={loading || receiptMissingPrices > 0 || invoiceGuard.blocked} onClick={saveSnapshot} className="rounded-lg bg-teal-700 text-white px-4 py-2 font-bold flex items-center gap-2 disabled:opacity-50"><Save className="w-4 h-4" />تسجيل الاستلام فعليًا</button></div>
        {receiptMissingPrices > 0 && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">يوجد {receiptMissingPrices} صف بدون سعر فعلي؛ تم إيقاف التسجيل المالي حتى استكمال السعر.</div>}
        <div className={`rounded-xl border p-3 text-sm ${invoiceGuard.blocked ? 'border-red-200 bg-red-50 text-red-700' : invoiceGuard.needsReview ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>المتوقع: {money(receiptExpectedTotal)} ج • الفعلي بكل صفوف الملف: {money(receiptActualTotal)} ج • الحد المقبول: {money(invoiceGuard.effectiveLimit)} ج{invoiceLimit > 0 ? ` • سقف الطلبية: ${money(invoiceLimit)} ج` : ''}</div>
        <div className="rounded-2xl border bg-white overflow-auto shadow-sm"><table className="min-w-[1100px] w-full text-sm"><thead className="bg-slate-50"><tr>{['الصنف المطلوب', 'الصنف بالملف', 'المطلوب', 'المستلم', 'الفرق', 'السعر المتوقع', 'السعر الفعلي', 'النتيجة'].map((head) => <th key={head} className="p-3 text-right">{head}</th>)}</tr></thead><tbody>{receiptResult.details.map((row) => <tr key={row.item.id} className="border-t"><td className="p-3 font-semibold">{row.item.product_name}<div className="text-xs text-slate-400">{row.item.product_code}</div></td><td className="p-3">{row.row?.product_name || '—'}</td><td className="p-3">{row.ordered}</td><td className="p-3">{row.received}</td><td className="p-3 font-bold">{row.difference > 0 ? `+${row.difference}` : row.difference}</td><td className="p-3">{money(row.expectedPrice)}</td><td className="p-3">{row.actualPrice ? money(row.actualPrice) : '—'}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${row.status === 'سليم' ? 'bg-teal-100 text-teal-700' : 'bg-amber-100 text-amber-800'}`}>{row.status}</span></td></tr>)}</tbody></table></div>{receiptResult.unexpected.length > 0 && <section className="rounded-2xl border border-red-200 bg-red-50 p-4"><h3 className="font-bold text-red-800 flex items-center gap-2"><WandSparkles className="w-4 h-4" />أصناف موجودة في ملف المورد ولم تتطابق مع الطلبية</h3><div className="mt-3 space-y-2">{receiptResult.unexpected.map((row, index) => <div key={`${row.product_code}-${index}`} className="rounded-lg bg-white border p-3 text-sm"><b>{row.product_name}</b> — كمية {row.quantity}{row.closest_item && <span className="text-slate-500"> • أقرب صنف مطلوب: {row.closest_item.product_name} ({Math.round(row.similarity * 100)}%)</span>}<span className="mr-2 font-bold text-red-700">{row.status}</span></div>)}</div></section>}</>}
      </>}</main>
    </div>
  </div>;
}
