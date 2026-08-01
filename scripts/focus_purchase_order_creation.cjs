const fs = require('fs');
const path = 'src/pages/SmartPurchaseUnifiedCenter.jsx';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing snippet: ${label}`);
  source = source.replace(from, to);
}

// Remove supplier/company from import mapping and creation stage.
source = source.replace("  avg_daily_usage: 'متوسط الاستهلاك اليومي', last_purchase_price: 'آخر سعر شراء',\n  preferred_supplier: 'المورد / الشركة', pending_incoming: 'الكمية المنتظر وصولها',", "  avg_daily_usage: 'متوسط الاستهلاك اليومي', last_purchase_price: 'آخر سعر شراء',\n  pending_incoming: 'الكمية المنتظر وصولها',");
source = source.replace("  preferred_supplier: ['المورد', 'المورد السابق', 'الشركة', 'اسم الشركة', 'supplier', 'vendor', 'company'],\n", '');
source = source.replace("        last_purchase_price: number(row[nextMapping.last_purchase_price]),\n        preferred_supplier: String(row[nextMapping.preferred_supplier] ?? '').trim(),", "        last_purchase_price: number(row[nextMapping.last_purchase_price]),");
source = source.replace("    ...item, requested_quantity: item.suggested_quantity, approved_quantity: item.suggested_quantity,\n    expected_unit_cost: item.last_purchase_price, supplier_name: item.preferred_supplier,", "    ...item, requested_quantity: item.suggested_quantity, approved_quantity: item.suggested_quantity,\n    expected_unit_cost: item.last_purchase_price,");
source = source.replace("  const [bulkSupplier, setBulkSupplier] = useState('');\n", '');

// Replace internal workbook and add the WhatsApp-ready order file.
const exportStart = source.indexOf('function exportWorkbook(payload) {');
const exportEnd = source.indexOf('\n\nasync function runPool', exportStart);
if (exportStart < 0 || exportEnd < 0) throw new Error('exportWorkbook block not found');
const exportBlock = `function exportWorkbook(payload) {
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
  const allSheet = XLSX.utils.json_to_sheet(items.map((item) => ({
    'كود الصنف': item.product_code || '', 'اسم الصنف': item.product_name || '',
    'الكمية المطلوبة الأصلية': number(item.requested_quantity), 'الكمية النهائية المعتمدة': itemQuantity(item),
    'الرصيد الحالي': number(item.current_stock), 'المنتظر وصوله': number(item.pending_incoming),
    'متوسط الاستهلاك اليومي': Number(estimateDailyUsage(item).toFixed(3)),
    'التغطية النهائية بالأيام': Number(finalCoverage(item).toFixed(1)), 'سعر الجمهور': itemPrice(item),
    'الخصم %': itemDiscount(item), 'سعر الصيدلية بعد الخصم': Number(netUnitPrice(item).toFixed(2)),
    'إجمالي الصنف بعد الخصم': Number(itemTotal(item).toFixed(2)), 'طلبات العملاء': number(item.customer_requests_count),
  })));
  allSheet['!dir'] = 'rtl'; allSheet['!autofilter'] = { ref: allSheet['!ref'] || 'A1:L1' }; allSheet['!freeze'] = { ySplit: 1 };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summary, 'ملخص الطلبية');
  XLSX.utils.book_append_sheet(workbook, allSheet, 'المراجعة الداخلية');
  XLSX.writeFile(workbook, \`${'${order.order_number || \'طلبية\'}'}_مراجعة_داخلية.xlsx\`);
}

function exportOrderForWhatsApp(payload) {
  const order = payload.order || {};
  const rows = (payload.items || [])
    .filter((item) => itemQuantity(item) > 0)
    .sort((a, b) => String(a.product_name || '').localeCompare(String(b.product_name || ''), 'ar'))
    .map((item) => ({
      'اسم الصنف': item.product_name || '',
      'سعر الجمهور': itemPrice(item),
      'الكمية المطلوبة': itemQuantity(item),
    }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!dir'] = 'rtl';
  sheet['!autofilter'] = { ref: sheet['!ref'] || 'A1:C1' };
  sheet['!freeze'] = { ySplit: 1 };
  sheet['!cols'] = [{ wch: 46 }, { wch: 16 }, { wch: 18 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'الطلبية');
  XLSX.writeFile(workbook, \`${'${order.order_number || \'طلبية\'}'}_جاهز_للإرسال.xlsx\`);
}`;
source = source.slice(0, exportStart) + exportBlock + source.slice(exportEnd);

// Totals no longer depend on supplier assignment.
replaceOnce(`  const totals = useMemo(() => ({
    items: items.filter((item) => itemQuantity(item) > 0).length,
    quantity: items.reduce((sum, item) => sum + itemQuantity(item), 0),
    total: items.reduce((sum, item) => sum + itemTotal(item), 0),
    suppliers: new Set(items.filter((item) => itemQuantity(item) > 0).map((item) => item.supplier_name).filter(Boolean)).size,
    missing: items.filter((item) => itemQuantity(item) > 0 && !item.supplier_name).length,
  }), [items]);`, `  const totals = useMemo(() => ({
    items: items.filter((item) => itemQuantity(item) > 0).length,
    quantity: items.reduce((sum, item) => sum + itemQuantity(item), 0),
    total: items.reduce((sum, item) => sum + itemTotal(item), 0),
  }), [items]);`, 'totals');

// Remove supplier assignment action.
source = source.replace(/\n  async function assignSupplier\(\) \{[\s\S]*?\n  \}\n\n  const status =/, '\n\n  const status =');

// Dashboard cards and order statistics focus on order creation.
source = source.replace("[['مسودات تحتاج مراجعة', data.pending_actions?.draft || 0], ['بدون مورد', data.pending_actions?.needs_supplier || 0], ['تنتظر الاستلام', data.pending_actions?.pending_receiving || 0]]", "[['مسودات تحتاج مراجعة', data.pending_actions?.draft || 0], ['إجمالي الطلبيات', (data.orders || []).length], ['تنتظر الاستلام', data.pending_actions?.pending_receiving || 0]]");
source = source.replace("[['الأصناف', totals.items], ['الكميات', totals.quantity], ['الموردون', totals.suppliers], ['بدون مورد', totals.missing], ['تكلفة الصيدلية بعد الخصم', `${money(totals.total)} ج`]]", "[['الأصناف', totals.items], ['الكميات', totals.quantity], ['تكلفة الصيدلية بعد الخصم', `${money(totals.total)} ج`]]");

// Export buttons: internal review + simple WhatsApp file.
source = source.replace(`<button onClick={() => exportWorkbook(selected)} className="rounded-lg border px-3 py-2 flex gap-2"><Download className="w-4 h-4" />تصدير ملف موحد</button>`, `<button onClick={() => exportOrderForWhatsApp(selected)} className="rounded-lg bg-teal-600 text-white px-3 py-2 flex gap-2"><Download className="w-4 h-4" />ملف الطلبية للإرسال</button><button onClick={() => exportWorkbook(selected)} className="rounded-lg border px-3 py-2 flex gap-2"><FileSpreadsheet className="w-4 h-4" />المراجعة الداخلية</button>`);

// Replace supplier section with display filters only.
source = source.replace(/<section className="rounded-2xl border bg-white p-3 space-y-3"><h3 className="font-bold flex items-center gap-2"><SlidersHorizontal[\s\S]*?<\/section>/, `<section className="rounded-2xl border bg-white p-3 space-y-3"><h3 className="font-bold flex items-center gap-2"><SlidersHorizontal className="w-5 h-5" />فلاتر عرض الأصناف</h3><div className="flex flex-wrap items-center gap-4"><label className="flex gap-2 text-sm"><input type="checkbox" checked={hideZero} onChange={(event) => setHideZero(event.target.checked)} />إخفاء الكميات الصفرية</label><label className="flex gap-2 text-sm"><input type="checkbox" checked={onlyUrgent} onChange={(event) => setOnlyUrgent(event.target.checked)} />العاجل فقط</label><label className="flex gap-2 text-sm"><input type="checkbox" checked={onlyCustomers} onChange={(event) => setOnlyCustomers(event.target.checked)} />طلبات العملاء فقط</label></div></section>`);

// Approval should not be blocked by missing supplier in this stage.
source = source.replace('disabled={loading || totals.missing > 0 || totals.total <= 0}', 'disabled={loading || totals.total <= 0}');

// Remove supplier column and input from the item table.
source = source.replace('<th className="p-2 text-right">المورد</th>', '');
source = source.replace(/<td className="p-2"><input defaultValue=\{item\.supplier_name \|\| ''\}[\s\S]*?<\/td><td className="p-2"><input type="number" min="0" step="0\.01"/, '<td className="p-2"><input type="number" min="0" step="0.01"');
source = source.replace('min-w-[1750px]', 'min-w-[1550px]');

fs.writeFileSync(path, source);
console.log('Purchase order creation stage simplified and supplier-free.');
