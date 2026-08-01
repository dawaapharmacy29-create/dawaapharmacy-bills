const fs = require('fs');

const pagePath = 'src/pages/SmartPurchaseUnifiedCenter.jsx';
const apiPath = 'src/api/smartPurchaseUnifiedApi.js';
let page = fs.readFileSync(pagePath, 'utf8');
let api = fs.readFileSync(apiPath, 'utf8');

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing snippet: ${label}`);
  return source.replace(from, to);
}

// مرحلة إنشاء الطلبية لا تعتمد على المورد أو الشركة.
page = page.replace("  preferred_supplier: 'المورد / الشركة', pending_incoming: 'الكمية المنتظر وصولها',", "  pending_incoming: 'الكمية المنتظر وصولها',");
page = page.replace(/\n\s*preferred_supplier:\s*\[[^\n]+\],/, '');
page = page.replace("        preferred_supplier: String(row[nextMapping.preferred_supplier] ?? '').trim(),\n", '');
page = page.replace("    expected_unit_cost: item.last_purchase_price, supplier_name: item.preferred_supplier,\n", "    expected_unit_cost: item.last_purchase_price, supplier_name: '',\n");
page = page.replace("  const [bulkSupplier, setBulkSupplier] = useState('');\n", '');

// ملف داخلي للإدارة بدون تقسيم موردين.
const exportStart = page.indexOf('function exportWorkbook(payload) {');
const exportEnd = page.indexOf('\n\nasync function runPool', exportStart);
if (exportStart < 0 || exportEnd < 0) throw new Error('Missing exportWorkbook block');
const exportsBlock = `function exportWorkbook(payload) {
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
  XLSX.writeFile(workbook, \`${'${order.order_number || \'طلبية\'}'}_مراجعة_داخلية.xlsx\`);
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
  XLSX.writeFile(workbook, \`${'${order.order_number || \'طلبية\'}'}_جاهز_للإرسال.xlsx\`);
}`;
page = page.slice(0, exportStart) + exportsBlock + page.slice(exportEnd);

// أرقام الصفحة تخص إنشاء الطلبية فقط.
page = page.replace("    suppliers: new Set(items.filter((item) => itemQuantity(item) > 0).map((item) => item.supplier_name).filter(Boolean)).size,\n    missing: items.filter((item) => itemQuantity(item) > 0 && !item.supplier_name).length,\n", "    average_discount: items.filter((item) => itemQuantity(item) > 0).length ? items.filter((item) => itemQuantity(item) > 0).reduce((sum, item) => sum + itemDiscount(item), 0) / items.filter((item) => itemQuantity(item) > 0).length : 0,\n");

// إزالة وظائف وأدوات المورد من الشاشة.
const assignStart = page.indexOf('  async function assignSupplier() {');
if (assignStart >= 0) {
  const assignEnd = page.indexOf('\n\n  const status =', assignStart);
  if (assignEnd < 0) throw new Error('Missing assignSupplier end');
  page = page.slice(0, assignStart) + page.slice(assignEnd + 2);
}
page = page.replace("['مسودات تحتاج مراجعة', data.pending_actions?.draft || 0], ['بدون مورد', data.pending_actions?.needs_supplier || 0], ['تنتظر الاستلام', data.pending_actions?.pending_receiving || 0]", "['مسودات تحتاج مراجعة', data.pending_actions?.draft || 0], ['الطلبيات المفتوحة', (data.orders || []).filter((order) => !['مغلقة', 'تمت مطابقة الفاتورة'].includes(normStatus(order.status))).length], ['تنتظر الاستلام', data.pending_actions?.pending_receiving || 0]");
page = page.replace("[['الأصناف', totals.items], ['الكميات', totals.quantity], ['الموردون', totals.suppliers], ['بدون مورد', totals.missing], ['تكلفة الصيدلية بعد الخصم', `${money(totals.total)} ج`]]", "[['الأصناف', totals.items], ['الكميات', totals.quantity], ['متوسط الخصم', `${money(totals.average_discount)}%`], ['سعر الجمهور قبل الخصم', `${money(items.reduce((sum, item) => sum + itemQuantity(item) * itemPrice(item), 0))} ج`], ['تكلفة الصيدلية بعد الخصم', `${money(totals.total)} ج`]]");

// أزرار التصدير: ملف إرسال بسيط + ملف داخلي.
page = page.replace(
  '<button onClick={() => exportWorkbook(selected)} className="rounded-lg border px-3 py-2 flex gap-2"><Download className="w-4 h-4" />تصدير ملف موحد</button>',
  '<button onClick={() => exportSendFile(selected)} className="rounded-lg bg-teal-600 text-white px-3 py-2 flex gap-2"><Download className="w-4 h-4" />ملف جاهز للإرسال</button><button onClick={() => exportWorkbook(selected)} className="rounded-lg border px-3 py-2 flex gap-2"><FileSpreadsheet className="w-4 h-4" />مراجعة داخلية</button>'
);

// إزالة قسم فلاتر وتعديل المورد بالكامل.
const supplierSectionStart = page.indexOf('<section className="rounded-2xl border bg-white p-3 space-y-3"><h3 className="font-bold flex items-center gap-2"><SlidersHorizontal');
if (supplierSectionStart >= 0) {
  const supplierSectionEnd = page.indexOf('</section>', supplierSectionStart);
  if (supplierSectionEnd < 0) throw new Error('Missing supplier section end');
  page = page.slice(0, supplierSectionStart) + page.slice(supplierSectionEnd + '</section>'.length);
}

// الاعتماد لا يتوقف بسبب المورد.
page = page.replace('disabled={loading || totals.missing > 0 || totals.total <= 0}', 'disabled={loading || totals.total <= 0}');

// جدول المراجعة بدون عمود المورد.
page = page.replace('<th className="p-2 text-right">المورد</th>', '');
page = page.replace(/<td className="p-2"><input defaultValue=\{item\.supplier_name \|\| ''\}[\s\S]*?<\/td><td className="p-2"><input type="number" min="0" step="0\.01"/, '<td className="p-2"><input type="number" min="0" step="0.01"');
page = page.replace('min-w-[1750px]', 'min-w-[1500px]');

// نصوص المرحلة الحالية.
page = page.replace('احتياج، ميزانية، اعتماد، وتصدير بدون تكرار في منطق الحساب.', 'إنشاء ومراجعة الطلبية، ضبط الميزانية، ثم تصدير ملف جاهز للإرسال.');
page = page.replace('فلاتر وتعديل المورد', 'فلاتر الطلبية');

// اعتماد مخصص لا يشترط المورد، مع fallback للمسار القديم.
if (!api.includes('approveWithoutSupplier')) {
  api = api.replace('async function rpc(action, payload = {}) {', `async function standaloneRpc(functionName, body) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(\`${'${SUPABASE_URL}'}/rest/v1/rpc/${'${functionName}'}\`, {
    method: 'POST', headers: { apikey: KEY, Authorization: \`Bearer ${'${KEY}'}\`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, ...body }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.message || data?.error || \`فشل الطلب (${'${response.status}'})\`);
  return data.data;
}

async function rpc(action, payload = {}) {`);
  api = api.replace("  approveOrder: (orderId) => rpc('approve_order', { order_id: orderId }),", "  approveOrder: async (orderId) => {\n    try { return await standaloneRpc('smart_purchase_approve_without_supplier', { p_order_id: orderId }); }\n    catch (error) {\n      if (/Could not find the function|schema cache|404/i.test(String(error?.message || ''))) return rpc('approve_order', { order_id: orderId });\n      throw error;\n    }\n  },");
}

fs.writeFileSync(pagePath, page);
fs.writeFileSync(apiPath, api);
console.log('Purchase creation stage finalized without supplier dependency.');
