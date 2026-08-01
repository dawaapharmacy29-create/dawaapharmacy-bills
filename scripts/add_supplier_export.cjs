const fs = require('fs');
const path = 'src/pages/SmartPurchaseUnifiedCenter.jsx';
let src = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  if (!src.includes(from)) throw new Error(`Missing snippet: ${label}`);
  src = src.replace(from, to);
}

const anchor = `function exportWorkbook(payload) {`;
const fn = `function exportSupplierWorkbook(payload) {\n  const order = payload.order || {};\n  const items = (payload.items || []).filter((item) => itemQuantity(item) > 0);\n  const rows = items.map((item) => ({\n    'اسم الصنف': item.product_name || '',\n    'سعر الجمهور': itemPrice(item),\n    'الكمية المطلوبة': itemQuantity(item),\n  }));\n  const sheet = XLSX.utils.json_to_sheet(rows);\n  sheet['!dir'] = 'rtl';\n  sheet['!autofilter'] = { ref: sheet['!ref'] || 'A1:C1' };\n  sheet['!freeze'] = { ySplit: 1 };\n  sheet['!cols'] = [{ wch: 42 }, { wch: 16 }, { wch: 18 }];\n  const workbook = XLSX.utils.book_new();\n  XLSX.utils.book_append_sheet(workbook, sheet, 'طلبية المورد');\n  XLSX.writeFile(workbook, \\`${'${order.order_number || \'طلبية\'}'}_للمورد.xlsx\\`);\n}\n\nfunction exportWorkbook(payload) {`;
replaceOnce(anchor, fn, 'export function anchor');

const oldButtons = `<div className="flex gap-2"><button onClick={() => exportWorkbook(selected)} className="rounded-lg border px-3 py-2 flex gap-2"><Download className="w-4 h-4" />تصدير ملف موحد</button>{status === 'معتمدة' && <button onClick={() => run(() => unified.markSent(selected.order.id), 'تم تسجيل إرسال الطلبية.')} className="rounded-lg bg-blue-600 text-white px-3 py-2 flex gap-2"><Send className="w-4 h-4" />تم الإرسال</button>}</div>`;
const newButtons = `<div className="flex flex-wrap gap-2"><button onClick={() => exportSupplierWorkbook(selected)} className="rounded-lg bg-teal-600 text-white px-3 py-2 flex gap-2"><Download className="w-4 h-4" />ملف إرسال للمورد</button><button onClick={() => exportWorkbook(selected)} className="rounded-lg border px-3 py-2 flex gap-2"><Download className="w-4 h-4" />الملف الداخلي الكامل</button>{status === 'معتمدة' && <button onClick={() => run(() => unified.markSent(selected.order.id), 'تم تسجيل إرسال الطلبية.')} className="rounded-lg bg-blue-600 text-white px-3 py-2 flex gap-2"><Send className="w-4 h-4" />تم الإرسال</button>}</div>`;
replaceOnce(oldButtons, newButtons, 'export buttons');

fs.writeFileSync(path, src);
console.log('Supplier export added');
