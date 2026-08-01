const fs = require('fs');
const path = 'src/pages/SmartPurchaseUnifiedCenter.jsx';
let s = fs.readFileSync(path, 'utf8');

function once(from, to, label) {
  if (!s.includes(from)) throw new Error(`Missing ${label}`);
  s = s.replace(from, to);
}

once(
"  const [branch, setBranch] = useState('دواء الشامي');\n  const [coverageDays, setCoverageDays] = useState(7);",
"  const [branch, setBranch] = useState('دواء الشامي');\n  const [creationTitle, setCreationTitle] = useState('');\n  const [editingTitle, setEditingTitle] = useState('');\n  const [coverageDays, setCoverageDays] = useState(7);",
'states');

once(
"      const created = await smartPurchaseApi.createOrder({ import_id: imported.id, branch, title: `طلبية ${branch}` });",
"      const title = creationTitle.trim() || `طلبية ${branch}`;\n      const created = await smartPurchaseApi.createOrder({ import_id: imported.id, branch, title });",
'create title');

once(
"      setPreview([]); setRawRows([]); setHeaders([]); setFileName(''); setShowImport(false); setCreationBudget('');",
"      setPreview([]); setRawRows([]); setHeaders([]); setFileName(''); setShowImport(false); setCreationBudget(''); setCreationTitle('');",
'clear title');

once(
"        <label className=\"text-sm\">الفرع<select value={branch}",
"        <label className=\"text-sm\">اسم الطلبية<input type=\"text\" maxLength=\"120\" value={creationTitle} onChange={(event) => setCreationTitle(event.target.value)} placeholder=\"مثال: طلبية أول أغسطس — فرع الشامي\" className=\"mt-1 w-full rounded-lg border p-2\" /><span className=\"text-[11px] text-slate-500\">اسم واضح للمراجعة والبحث، والكود المرجعي سيظهر تحته.</span></label>\n        <label className=\"text-sm\">الفرع<select value={branch}",
'creation field');

s = s.replace('className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3"', 'className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3"');

s = s.replace(
"<div className=\"font-semibold\">{order.order_number}</div><div className=\"text-xs text-slate-500 mt-1\">{order.branch} • {normStatus(order.status)}</div>",
"<div className=\"font-bold text-base\">{order.title || `طلبية ${order.branch}`}</div><div className=\"text-[11px] text-slate-400 mt-1 font-mono\">{order.order_number}</div><div className=\"text-xs text-slate-500 mt-1\">{order.branch} • {normStatus(order.status)}</div>"
);

s = s.replace(
"<div><h2 className=\"text-xl font-bold\">{selected.order.order_number}</h2><p className=\"text-sm text-slate-500\">{selected.order.branch} • {status}</p></div>",
"<div className=\"min-w-[260px]\"><div className=\"flex flex-wrap items-center gap-2\"><input value={editingTitle || selected.order.title || `طلبية ${selected.order.branch}`} onFocus={() => setEditingTitle(selected.order.title || `طلبية ${selected.order.branch}`)} onChange={(event) => setEditingTitle(event.target.value)} disabled={['مغلقة', 'تمت مطابقة الفاتورة'].includes(status)} className=\"min-w-[260px] rounded-lg border px-3 py-2 text-xl font-bold disabled:bg-transparent disabled:border-transparent\" /><button type=\"button\" disabled={!editingTitle.trim() || editingTitle.trim() === (selected.order.title || `طلبية ${selected.order.branch}`) || ['مغلقة', 'تمت مطابقة الفاتورة'].includes(status)} onClick={() => run(() => unified.updateOrderTitle(selected.order.id, editingTitle.trim()), 'تم تحديث اسم الطلبية.', selected.order.id)} className=\"rounded-lg border px-3 py-2 text-sm disabled:opacity-40\">حفظ الاسم</button></div><div className=\"mt-1 text-xs text-slate-400 font-mono\">المرجع: {selected.order.order_number}</div><p className=\"text-sm text-slate-500 mt-1\">{selected.order.branch} • {status}</p></div>"
);

s = s.replaceAll("`${order.order_number || 'طلبية'}_مراجعة_داخلية.xlsx`", "`${String(order.title || order.order_number || 'طلبية').replace(/[\\/:*?\"<>|]/g, '-')}_${order.order_number || ''}_مراجعة_داخلية.xlsx`");
s = s.replaceAll("`${order.order_number || 'طلبية'}_جاهز_للإرسال.xlsx`", "`${String(order.title || order.order_number || 'طلبية').replace(/[\\/:*?\"<>|]/g, '-')}_${order.order_number || ''}_جاهز_للإرسال.xlsx`");

fs.writeFileSync(path, s);
console.log('Purchase order titles applied');
