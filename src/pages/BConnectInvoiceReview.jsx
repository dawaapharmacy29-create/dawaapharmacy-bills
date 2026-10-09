import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileSearch, Upload, XCircle } from 'lucide-react';
import { performanceApi } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { parseBConnectWorkbook } from '@/lib/bconnectPurchaseInvoiceParser';
import { reconcilePurchaseInvoice } from '@/lib/purchaseInvoiceReconciliation';
import { normalizeInvoiceNumber, normalizeMoney } from '@/lib/purchaseInvoiceTruth';

const labels = { clean: 'سليم', review: 'راجعها', problem: 'مشكلة' };
const icons = { clean: CheckCircle2, review: AlertTriangle, problem: XCircle };
const money = (v) => {
  const value = normalizeMoney(v);
  if (value === null) return '—';
  // Show sub-milliunit differences instead of displaying a nonzero difference as 0.000.
  const decimals = value !== 0 && Math.abs(value) < 0.001 ? 10 : 3;
  return value.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: decimals });
};

export default function BConnectInvoiceReview() {
  const [state, setState] = useState({ loading: false, error: '', fileName: '', rows: [], meta: null });
  const [problemsOnly, setProblemsOnly] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [decisions, setDecisions] = useState({});
  const [decisionNote, setDecisionNote] = useState('');
  const [selectedNumbers, setSelectedNumbers] = useState([]);
  const decide = (action) => {
    const eligible = state.rows.filter((r) => selectedNumbers.includes(r.number) && r.status !== 'clean');
    if (!eligible.length) return;
    if (action === 'excluded' && !decisionNote.trim()) return;
    setDecisions((old) => Object.fromEntries([...Object.entries(old), ...eligible.map((r) => [r.number, { action, note: decisionNote.trim(), source_id: r.app?.id || null }])]));
    setSelectedNumbers([]);
    setDecisionNote('');
  };

  const visible = useMemo(() => state.rows.filter((r) => {
    if (problemsOnly && r.status === 'clean') return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    return !q || [r.number, r.bconnect?.supplier, r.app?.supplier_name, r.bconnect?.user, r.app?.entered_by].some((v) => String(v ?? '').toLowerCase().includes(q));
  }), [state.rows, problemsOnly, statusFilter, search]);
  const counts = useMemo(() => state.rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), { clean: 0, review: 0, problem: 0 }), [state.rows]);

  const reviewFile = async (file) => {
    if (!file) return;
    setState({ loading: true, error: '', fileName: file.name, rows: [], meta: null });
    setDecisions({});
    setSelectedNumbers([]);
    try {
      const parsed = parseBConnectWorkbook(await file.arrayBuffer());
      if (!parsed.valid) throw new Error(parsed.warnings?.join(' ') || 'ملف B-Connect غير صالح.');
      const numbers = [...new Set(parsed.invoices.map((r) => normalizeInvoiceNumber(r.serial)).filter(Boolean))];
      if (numbers.length === 0) throw new Error('الملف لا يحتوي على أرقام فواتير صالحة للمراجعة.');
      if (numbers.length > 500) throw new Error('الملف يحتوي على أكثر من 500 رقم فاتورة مختلف. قسّمه إلى ملفات أصغر قبل المراجعة.');
      // Global lookup is the only authority for uniqueness and matching.
      // Never fall back to a date-limited scan: failure must fail closed.
      const checked = await performanceApi.bconnectInvoiceNumbers(numbers);
      if (!Array.isArray(checked)) throw new Error('تعذر التحقق العالمي من أرقام الفواتير؛ لم يتم إصدار أحكام.');
      const pairs = checked.map((entry) => [normalizeInvoiceNumber(entry?.number), entry]);
      const returned = pairs.map(([number]) => number);
      if (returned.length !== numbers.length || new Set(returned).size !== returned.length ||
          returned.some((number) => !number || !numbers.includes(number))) {
        throw new Error('نتيجة البحث العالمي ناقصة أو متعارضة؛ لا يمكن اعتماد المطابقة.');
      }
      const globalGate = new Map(pairs);
      const fileCounts = new Map();
      parsed.invoices.forEach((r) => {
        const key = normalizeInvoiceNumber(r.serial);
        if (key) fileCounts.set(key, (fileCounts.get(key) || 0) + 1);
      });
      const rows = parsed.invoices.map((b) => {
        const number = normalizeInvoiceNumber(b.serial);
        const gate = globalGate.get(number);
        const recordCount = gate?.record_count == null ? NaN : Number(gate.record_count);
        const authorizedRows = Array.isArray(gate?.rows) ? gate.rows : [];
        const problem = (identity, reason) => ({
          number, bconnect: b, app: null, status: 'problem', identity,
          reasons: [reason], financial: { difference: null },
        });
        if (!gate || !Number.isSafeInteger(recordCount) || recordCount < 0)
          return problem('unverified', 'التحقق العالمي غير مكتمل لهذا الرقم؛ ممنوع اعتماد الفاتورة.');
        if ((fileCounts.get(number) || 0) > 1)
          return problem('duplicate_bconnect', 'رقم الفاتورة مكرر داخل ملف B-Connect.');
        if (recordCount > 1)
          return problem('duplicate_app', 'رقم الفاتورة مكرر عالميًا في التطبيق؛ ممنوع الاعتماد.');
        if (!Array.isArray(gate?.rows) || authorizedRows.length > recordCount)
          return problem('unverified', 'تفاصيل الاستجابة العالمية غير مكتملة أو تتجاوز العدد المؤكد؛ ممنوع الاعتماد.');
        if (recordCount === 0 && authorizedRows.length !== 0)
          return problem('unverified', 'استجابة البحث متعارضة: لا توجد سجلات عالميًا لكن ظهرت تفاصيل؛ ممنوع الاعتماد.');
        if (recordCount === 0)
          return problem('missing', 'الفاتورة غير موجودة في التطبيق.');
        if (authorizedRows.length !== 1)
          return problem('unauthorized_or_incomplete', 'الفاتورة موجودة لكن تفاصيلها غير متاحة أو غير مكتملة ضمن صلاحياتك.');
        const app = authorizedRows[0];
        // A single visible entry is not sufficient evidence if the RPC payload
        // omits the underlying record identity or returns malformed details.
        if (!app || typeof app !== 'object' || Array.isArray(app) ||
            !app.id || !normalizeInvoiceNumber(app.system_invoice_number) ||
            normalizeInvoiceNumber(app.system_invoice_number) !== number) {
          return problem('unverified', 'تفاصيل الفاتورة المرجعية غير مكتملة أو رقمها متعارض؛ ممنوع الاعتماد.');
        }
        const result = reconcilePurchaseInvoice(app, b);
        return { number, bconnect: b, app, ...result };
      });
      setState({ loading: false, error: '', fileName: file.name, rows, meta: { ...parsed.meta, global_gate: true } });
    } catch (error) {
      setState({ loading: false, error: error?.message || 'تعذر مراجعة الملف.', fileName: file.name, rows: [], meta: null });
    }
  };

  return <div dir="rtl" className="space-y-4 p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">مراجعة B-Connect</h1><p className="mt-1 text-sm text-gray-500">مقارنة قراءة فقط — لا يتم تعديل أو إنشاء أو حذف أي فاتورة.</p></div>
      <Button asChild variant="outline"><Link to="/invoices">العودة للفواتير</Link></Button>
    </div>
    <Card className="p-5">
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center hover:bg-gray-50">
        <Upload className="h-7 w-7 text-teal-600" /><strong>{state.loading ? 'جاري التحليل والمقارنة...' : 'اختر ملف B-Connect Excel'}</strong>
        <span className="text-xs text-gray-500">قراءة فقط. الأخضر يتطلب تحققًا عالميًا من تفرد رقم الفاتورة + الفرع + القيمة.</span>
        <input type="file" accept=".xlsx,.xls" className="hidden" disabled={state.loading} onChange={(e) => reviewFile(e.target.files?.[0])} />
      </label>
      {state.error && <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</div>}
    </Card>
    {!!state.rows.length && <>
      <Card className="space-y-3 border-amber-200 p-4">
        <div><strong>قرارات المراجعة — تحضير فقط</strong><p className="text-xs text-gray-600">الاعتماد والاستبعاد هنا قرارات مؤقتة داخل الصفحة، لا تحفظ على الخادم ولا تعدّل الفواتير. التنفيذ الفعلي متوقف لحين تأمين مسار الحفظ والمراجعة.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">المحدد: {selectedNumbers.length}</span>
          <Button type="button" variant="outline" disabled={!selectedNumbers.length} onClick={() => decide('approved')}>اعتماد مقترح للتنفيذ</Button>
          <input aria-label="سبب استبعاد التعديل" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} placeholder="سبب الاستبعاد (إلزامي)" className="h-9 min-w-[180px] rounded-lg border px-3 text-sm" />
          <Button type="button" variant="outline" disabled={!selectedNumbers.length || !decisionNote.trim()} onClick={() => decide('excluded')}>استبعاد المقترح</Button>
          <Button type="button" disabled title="التنفيذ الفعلي غير متاح قبل التحقق الخادمي والصلاحيات">تنفيذ التعديلات (غير مفعل)</Button>
        </div>
        <p className="text-xs text-gray-500">قرارات مؤقتة: {Object.keys(decisions).length} — تختفي عند رفع ملف جديد أو تحديث الصفحة.</p>
      </Card>
      <div className="grid gap-3 md:grid-cols-4">
        <Card className="p-4"><div className="text-xs text-gray-500">فواتير B-Connect</div><div className="text-2xl font-bold">{state.rows.length}</div></Card>
        <Card className="p-4"><div className="text-xs text-gray-500">🟢 سليم</div><div className="text-2xl font-bold">{counts.clean}</div></Card>
        <Card className="p-4"><div className="text-xs text-gray-500">🟡 راجعها</div><div className="text-2xl font-bold">{counts.review}</div></Card>
        <Card className="p-4"><div className="text-xs text-gray-500">🔴 مشكلة</div><div className="text-2xl font-bold">{counts.problem}</div></Card>
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div className="flex items-center gap-2"><FileSearch className="h-4 w-4"/><strong>{state.fileName}</strong></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)}/> المشاكل فقط</label>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b bg-slate-50/50 px-4 py-3">
          <input aria-label="بحث برقم الفاتورة أو المورد أو الموظف" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث برقم الفاتورة، المورد، الموظف..." className="h-9 min-w-[220px] flex-1 rounded-lg border bg-white px-3 text-sm" />
          <select aria-label="تصفية حسب الحالة" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-lg border bg-white px-3 text-sm"><option value="all">كل الحالات</option><option value="clean">سليم</option><option value="review">تحتاج مراجعة</option><option value="problem">مشكلة</option></select>
          <span className="text-xs text-gray-600">المعروض {visible.length} من {state.rows.length} فاتورة</span>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="p-3 text-right">اختيار</th><th className="p-3 text-right">قرار المراجعة</th><th className="p-3 text-right">الحالة</th><th className="p-3 text-right">رقم البرنامج</th><th className="p-3 text-right">المورد B-Connect</th><th className="p-3 text-right">تاريخ B-Connect</th><th className="p-3 text-right">مدخل B-Connect</th><th className="p-3 text-right">قيمة B-Connect</th><th className="p-3 text-right">قيمة التطبيق</th><th className="p-3 text-right">الفرق</th><th className="p-3 text-right">مدخل التطبيق</th><th className="p-3 text-right">الدليل</th></tr></thead>
          <tbody>{visible.map((r, i) => { const Icon = icons[r.status]; return <tr key={r.number + '-' + i} className="border-b align-top">
            <td className="p-3"><input type="checkbox" aria-label={`اختيار فاتورة ${r.number}`} disabled={r.status === "clean" || r.identity === "duplicate_app" || r.identity === "duplicate_bconnect" || r.identity === "unverified" || r.identity === "unauthorized_or_incomplete"} checked={selectedNumbers.includes(r.number)} onChange={(e) => setSelectedNumbers((old) => e.target.checked ? [...old, r.number] : old.filter((n) => n !== r.number))} /></td><td className="p-3 text-xs">{decisions[r.number]?.action === "approved" ? "اعتماد مبدئي" : decisions[r.number]?.action === "excluded" ? `مستبعد: ${decisions[r.number].note}` : "لم يُتخذ قرار"}</td><td className="p-3"><span className="inline-flex items-center gap-1 font-semibold"><Icon className="h-4 w-4"/>{labels[r.status]}</span></td>
            <td className="p-3 font-mono font-bold">{r.number}</td><td className="p-3">{r.bconnect?.supplier || '—'}</td>
            <td className="p-3 whitespace-nowrap">{r.bconnect?.date || "—"}</td><td className="p-3">{r.bconnect?.user || "—"}</td><td className="p-3">{money(r.bconnect?.invoice_value)}{money(r.bconnect?.invoice_value) === '—' ? '' : ' ج'}</td><td className="p-3">{r.app ? (money(r.app.total_value) === '—' ? '—' : money(r.app.total_value) + ' ج') : '—'}</td>
            <td className="p-3">{money(r.financial?.difference) === '—' ? '—' : money(r.financial.difference) + ' ج'}</td>
            <td className="p-3">{r.app?.entered_by_name || r.app?.entered_by || "غير متاح في بيانات المطابقة"}</td><td className="max-w-[420px] p-3 text-xs leading-6 text-gray-600">{(r.reasons || []).join(' ')}</td>
          </tr>; })}{!visible.length && <tr><td colSpan={12} className="p-10 text-center text-gray-400">لا توجد نتائج ضمن الفلتر الحالي.</td></tr>}</tbody>
        </table></div>
      </Card>
    </>}
  </div>;
}
