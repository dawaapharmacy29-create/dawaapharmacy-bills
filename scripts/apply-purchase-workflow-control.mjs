import fs from 'node:fs';

function patch(path, transforms) {
  let source = fs.readFileSync(path, 'utf8');
  for (const transform of transforms) {
    const next = transform(source);
    if (next === source) throw new Error(`Patch anchor not found in ${path}`);
    source = next;
  }
  fs.writeFileSync(path, source);
}

patch('src/pages/SmartPurchaseUnifiedCenter.jsx', [
  (source) => source.replace(
    "import {\n  buildBudgetPlan,",
    "import { purchaseBudgetGuard } from '@/lib/purchaseFinancialControl';\nimport {\n  buildBudgetPlan,"
  ),
  (source) => source.replace(
    "  const budgetPlan = useMemo(() => number(budgetLimit) > 0 ? buildBudgetPlan(items, number(budgetLimit)) : null, [items, budgetLimit]);",
    "  const budgetPlan = useMemo(() => number(budgetLimit) > 0 ? buildBudgetPlan(items, number(budgetLimit)) : null, [items, budgetLimit]);\n  const financialGuard = useMemo(() => purchaseBudgetGuard(totals.total, number(budgetLimit)), [totals.total, budgetLimit]);"
  ),
  (source) => source.replace(
    "    if (creationBudget && rowsForCreation.length === 0) return setError('الميزانية لا تكفي لإضافة أي صنف بسعره الحالي.');",
    "    if (creationBudget && rowsForCreation.length === 0) return setError('الميزانية لا تكفي لإضافة أي صنف بسعره الحالي.');\n    if (creationBudget && creationTotal > number(creationBudget) + 0.01) return setError(`قيمة الطلبية ${money(creationTotal)} ج تتجاوز الحد المالي ${money(creationBudget)} ج.`);"
  ),
  (source) => source.replace(
    "الميزانية القصوى<input type=\"number\"",
    "الحد الأقصى لقيمة الطلبية / الفاتورة<input type=\"number\""
  ),
  (source) => source.replace(
    "        <div className=\"flex gap-2\">{!['معتمدة', 'تم الإرسال للمورد'].includes(status) ?",
    "        {financialGuard.blocked && <div className=\"rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700\">لا يمكن اعتماد الطلبية: القيمة الحالية أعلى من الحد المالي بمقدار {money(financialGuard.over)} ج.</div>}\n        {financialGuard.warning && <div className=\"rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800\">تنبيه: تم استخدام {money(financialGuard.usage)}% من الحد المالي المحدد.</div>}\n        <div className=\"flex gap-2\">{!['معتمدة', 'تم الإرسال للمورد'].includes(status) ?"
  ),
  (source) => source.replace(
    "disabled={loading || totals.total <= 0}",
    "disabled={loading || totals.total <= 0 || financialGuard.blocked}"
  ),
]);

patch('src/pages/SmartPurchaseReceiving.jsx', [
  (source) => source.replace(
    "import { smartPurchaseReceivingApi as api } from '@/api/smartPurchaseReceivingApi';",
    "import { smartPurchaseReceivingApi as api } from '@/api/smartPurchaseReceivingApi';\nimport { invoiceValueGuard } from '@/lib/purchaseFinancialControl';"
  ),
  (source) => source.replace(
    "  const [orders, setOrders] = useState([]); const [selected, setSelected] = useState(null); const [mode, setMode] = useState('supplier_response'); const [responseType, setResponseType] = useState('available'); const [supplierName, setSupplierName] = useState(''); const [fileName, setFileName] = useState(''); const [rows, setRows] = useState([]); const [loading, setLoading] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');",
    "  const [orders, setOrders] = useState([]); const [selected, setSelected] = useState(null); const [mode, setMode] = useState('supplier_response'); const [responseType, setResponseType] = useState('available'); const [supplierName, setSupplierName] = useState(''); const [fileName, setFileName] = useState(''); const [rows, setRows] = useState([]); const [loading, setLoading] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [invoiceLimit, setInvoiceLimit] = useState(0); const [invoiceTolerancePct] = useState(2); const [invoiceToleranceValue] = useState(100);"
  ),
  (source) => source.replace(
    "  async function chooseOrder(id) { setLoading(true); setError(''); setMessage(''); setRows([]); setFileName(''); try { setSelected(await api.getOrder(id)); } catch (err) { setError(err.message); } finally { setLoading(false); } }",
    "  async function chooseOrder(id) { setLoading(true); setError(''); setMessage(''); setRows([]); setFileName(''); try { const detail = await api.getOrder(id); setSelected(detail); setInvoiceLimit(num(detail?.order?.approved_total || detail?.order?.expected_total || 0)); } catch (err) { setError(err.message); } finally { setLoading(false); } }"
  ),
  (source) => source.replace(
    "  const currentResult = mode === 'supplier_response' ? supplierResult : receiptResult;",
    "  const currentResult = mode === 'supplier_response' ? supplierResult : receiptResult;\n  const receiptExpectedTotal = receiptResult ? receiptResult.details.reduce((sum, row) => sum + (row.ordered * row.expectedPrice), 0) : 0;\n  const receiptActualTotal = receiptResult ? receiptResult.details.reduce((sum, row) => sum + (row.received * row.actualPrice), 0) : 0;\n  const invoiceGuard = invoiceValueGuard(receiptExpectedTotal, receiptActualTotal, invoiceLimit, invoiceTolerancePct, invoiceToleranceValue);"
  ),
  (source) => source.replace(
    "  async function saveSnapshot() { if (!selected?.order?.id || !currentResult) return; setLoading(true); setError(''); try {",
    "  async function saveSnapshot() { if (!selected?.order?.id || !currentResult) return; if (mode === 'receipt' && invoiceGuard.blocked) { setError(`تم إيقاف اعتماد الاستلام: قيمة الفاتورة ${money(receiptActualTotal)} ج تتجاوز الحد المقبول ${money(invoiceGuard.effectiveLimit)} ج.`); return; } setLoading(true); setError(''); try {"
  ),
  (source) => source.replace(
    "{ 'البيان': 'عدد الأصناف المطلوبة', 'القيمة': receiptResult.details.length },",
    "{ 'البيان': 'عدد الأصناف المطلوبة', 'القيمة': receiptResult.details.length }, { 'البيان': 'القيمة المتوقعة', 'القيمة': receiptExpectedTotal }, { 'البيان': 'قيمة الفاتورة الفعلية', 'القيمة': receiptActualTotal }, { 'البيان': 'فرق القيمة', 'القيمة': Number((receiptActualTotal - receiptExpectedTotal).toFixed(2)) }, { 'البيان': 'حالة التحكم المالي', 'القيمة': invoiceGuard.status },"
  ),
]);

patch('src/components/pharmacy/ReplenishmentList.jsx', [
  (source) => source.replace(
    "  const updateStatus = useMutation({\n    mutationFn: ({ id, order_status }) =>\n      base44.entities.ReplenishmentOrder.update(id, { order_status }),",
    "  const updateStatus = useMutation({\n    mutationFn: ({ id, order_status }) =>\n      base44.entities.ReplenishmentOrder.update(id, { order_status, status_updated_at: new Date().toISOString(), ...(order_status === 'closed' ? { closed_at: new Date().toISOString() } : {}) }),"
  ),
  (source) => source.replace(
    "    createMutation.mutate({\n      ...form,",
    "    const normalizedCode = String(form.product_code || '').trim().toLowerCase();\n    const normalizedName = String(form.product_name || '').trim().toLowerCase();\n    const duplicate = items.find((item) => item.branch === form.branch && !['closed', 'cancelled', 'received'].includes(getStatus(item)) && ((normalizedCode && String(item.product_code || '').trim().toLowerCase() === normalizedCode) || (!normalizedCode && String(item.product_name || '').trim().toLowerCase() === normalizedName)));\n    if (duplicate) {\n      toast({ variant: 'destructive', description: `الصنف موجود بالفعل كنقص مفتوح في ${form.branch}. افتح السجل الحالي بدل إنشاء تكرار جديد.` });\n      return;\n    }\n    const qty = parseFloat(form.requested_quantity) || 0;\n    const unitPrice = parseFloat(form.purchase_price) || 0;\n    createMutation.mutate({\n      ...form,"
  ),
  (source) => source.replace(
    "      requested_quantity: parseFloat(form.requested_quantity) || 0,\n      actual_balance: parseFloat(form.actual_balance) || 0,",
    "      requested_quantity: qty,\n      approved_quantity: 0,\n      ordered_quantity: 0,\n      received_quantity: 0,\n      outstanding_quantity: qty,\n      expected_total: qty * unitPrice,\n      actual_balance: parseFloat(form.actual_balance) || 0,\n      priority: 'normal',\n      source_type: 'manual',\n      status_updated_at: new Date().toISOString(),"
  ),
]);

console.log('Purchase workflow and invoice control upgrade applied.');
