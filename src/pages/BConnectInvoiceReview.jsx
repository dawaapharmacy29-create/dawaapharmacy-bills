import { Fragment, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileSearch, Upload, XCircle } from 'lucide-react';
import { performanceApi } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { parseBConnectWorkbook } from '@/lib/bconnectPurchaseInvoiceParser';
import { reconcilePurchaseInvoice } from '@/lib/purchaseInvoiceReconciliation';
import { normalizeInvoiceNumber, normalizeMoney } from '@/lib/purchaseInvoiceTruth';
import { classifyBConnectReviewRow } from '@/lib/bconnectReviewDecisionPolicy';
import { buildBConnectFormHandoff } from '@/lib/bconnectInvoiceFormHandoff';

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
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: false, error: '', fileName: '', rows: [], meta: null });
  const [problemsOnly, setProblemsOnly] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [decisions, setDecisions] = useState({});
  const [decisionNote, setDecisionNote] = useState('');
  const [selectedNumbers, setSelectedNumbers] = useState([]);
  const [expandedNumber, setExpandedNumber] = useState(null);
  const undoDecision = (number) => setDecisions((previous) => { const next = { ...previous }; delete next[number]; return next; });
  const exportDecisions = () => {
    const rows = state.rows.filter((r) => decisions[r.number]).map((r) => ({
      invoice_number: r.number, decision: decisions[r.number].action,
      reason: decisions[r.number].note, app_record_id: r.app?.id || null,
      branch_bconnect: r.bconnect?.branch || null, branch_app: r.app?.branch || null,
      supplier_bconnect: r.bconnect?.supplier || null, supplier_app: r.app?.supplier_name || null,
      gross_bconnect: normalizeMoney(r.bconnect?.invoice_value), gross_app: normalizeMoney(r.app?.total_value),
      difference: r.financial?.difference ?? null,
      return_bconnect: normalizeMoney(r.bconnect?.return_value), return_app: normalizeMoney(r.app?.returned_value),
      source_user: r.bconnect?.user || null, app_entered_by: r.app?.entered_by_name || r.app?.entered_by || null,
      findings: r.reasons || [],
    }));
    if (!rows.length) return;
    const data = { schema: 'bconnect-review-decisions-v1', file_name: state.fileName, exported_at: new Date().toISOString(), execution_status: 'NOT_EXECUTED', decisions: rows };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'bconnect-review-decisions.json'; a.click();
    URL.revokeObjectURL(url);
  };
  const decide = (action) => {
    const eligible = state.rows.filter((r) => selectedNumbers.includes(r.number) && classifyBConnectReviewRow(r).selectable);
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
  const decisionCounts = useMemo(() => state.rows.reduce((a, r) => { const code = classifyBConnectReviewRow(r).code; a[code] = (a[code] || 0) + 1; return a; }, {}), [state.rows]);
  const counts = useMemo(() => state.rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), { clean: 0, review: 0, problem: 0 }), [state.rows]);

  const reviewFile = async (file) => {
    if (!file) return;
    setState({ loading: true, error: '', fileName: file.name, rows: [], meta: null });
    setDecisions({});
    setSelectedNumbers([]);
    setExpandedNumber(null);
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
          <Button type="button" variant="outline" disabled={!Object.keys(decisions).length} onClick={exportDecisions}>تصدير قرارات المراجعة</Button>
          <Button type="button" disabled title="التنفيذ الفعلي غير متاح قبل التحقق الخادمي والصلاحيات">تنفيذ التعديلات (غير مفعل)</Button>
        </div>
        <p className="text-xs text-gray-500">قرارات مؤقتة: {Object.keys(decisions).length} — تختفي عند رفع ملف جديد أو تحديث الصفحة.</p>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4"><div className="text-xs text-gray-500">تكرارات تتطلب تحقيقًا</div><div className="text-xl font-bold">{decisionCounts.duplicate || 0}</div></Card>
        <Card className="p-4"><div className="text-xs text-gray-500">فواتير ناقصة للتسجيل</div><div className="text-xl font-bold">{decisionCounts.missing || 0}</div></Card>
        <Card className="p-4"><div className="text-xs text-gray-500">اختلافات قابلة للمراجعة</div><div className="text-xl font-bold">{decisionCounts.proposed || 0}</div></Card>
        <Card className="p-4"><div className="text-xs text-gray-500">حالات محجوبة لنقص الأدلة</div><div className="text-xl font-bold">{decisionCounts.blocked || 0}</div></Card>
      </div>
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
        <div className="overflow-x-auto"><table className="w-full min-w-[1400px] text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="p-3 text-right">فتح الفاتورة</th><th className="p-3 text-right">التفاصيل</th><th className="p-3 text-right">اختيار</th><th className="p-3 text-right">قرار المراجعة</th><th className="p-3 text-right">التشخيص</th><th className="p-3 text-right">الحالة</th><th className="p-3 text-right">رقم البرنامج</th><th className="p-3 text-right">المورد B-Connect</th><th className="p-3 text-right">تاريخ B-Connect</th><th className="p-3 text-right">مدخل B-Connect</th><th className="p-3 text-right">قيمة B-Connect</th><th className="p-3 text-right">قيمة التطبيق</th><th className="p-3 text-right">الفرق</th><th className="p-3 text-right">مدخل التطبيق</th><th className="p-3 text-right">الدليل</th></tr></thead>
          <tbody>{visible.map((r, i) => { const Icon = icons[r.status]; return <Fragment key={r.number + '-' + i}><tr className="border-b align-top">
            <td className="p-3">{buildBConnectFormHandoff(r) && <Button type="button" size="sm" onClick={() => navigate("/invoices", { state: { bconnectHandoff: buildBConnectFormHandoff(r) } })}>{r.identity === "missing" ? "إضافة الفاتورة" : "مراجعة وتعديل"}</Button>}</td><td className="p-3"><Button type="button" variant="outline" size="sm" onClick={() => setExpandedNumber(expandedNumber === r.number ? null : r.number)}>{expandedNumber === r.number ? 'إخفاء' : 'عرض'}</Button></td><td className="p-3"><input type="checkbox" aria-label={`اختيار فاتورة ${r.number}`} disabled={!classifyBConnectReviewRow(r).selectable} checked={selectedNumbers.includes(r.number)} onChange={(e) => setSelectedNumbers((old) => e.target.checked ? [...old, r.number] : old.filter((n) => n !== r.number))} /></td><td className="p-3 text-xs">{decisions[r.number]?.action === "approved" ? "اعتماد مبدئي" : decisions[r.number]?.action === "excluded" ? `مستبعد: ${decisions[r.number].note}` : "لم يُتخذ قرار"}{decisions[r.number] && <Button type="button" variant="ghost" size="sm" onClick={() => undoDecision(r.number)}>تراجع عن القرار</Button>}</td><td className="p-3 text-xs font-medium">{classifyBConnectReviewRow(r).label}</td><td className="p-3"><span className="inline-flex items-center gap-1 font-semibold"><Icon className="h-4 w-4"/>{labels[r.status]}</span></td>
            <td className="p-3 font-mono font-bold">{r.number}</td><td className="p-3">{r.bconnect?.supplier || '—'}</td>
            <td className="p-3 whitespace-nowrap">{r.bconnect?.date || "—"}</td><td className="p-3">{r.bconnect?.user || "—"}</td><td className="p-3">{money(r.bconnect?.invoice_value)}{money(r.bconnect?.invoice_value) === '—' ? '' : ' ج'}</td><td className="p-3">{r.app ? (money(r.app.total_value) === '—' ? '—' : money(r.app.total_value) + ' ج') : '—'}</td>
            <td className="p-3">{money(r.financial?.difference) === '—' ? '—' : money(r.financial.difference) + ' ج'}</td>
            <td className="p-3">{r.app?.entered_by_name || r.app?.entered_by || "غير متاح في بيانات المطابقة"}</td><td className="max-w-[420px] p-3 text-xs leading-6 text-gray-600">{(r.reasons || []).join(' ')}</td>
          </tr>{expandedNumber === r.number && <tr className="border-b bg-slate-50"><td colSpan={15} className="p-4"><div className="grid gap-3 md:grid-cols-3"><div><strong>هوية الفاتورة</strong><p>الفرع B-Connect: {r.bconnect?.branch || 'غير متاح'}</p><p>الفرع في التطبيق: {r.app?.branch || 'غير متاح'}</p><p>المورد في التطبيق: {r.app?.supplier_name || 'غير متاح'}</p></div><div><strong>التفاصيل المالية</strong><p>الإجمالي B-Connect: {money(r.bconnect?.invoice_value)} ج</p><p>الإجمالي في التطبيق: {money(r.app?.total_value)} ج</p><p>المرتجع B-Connect: {money(r.bconnect?.return_value)} ج</p><p>المرتجع في التطبيق: {money(r.app?.returned_value)} ج</p></div><div><strong>الأدلة والقرار</strong><p>تاريخ التطبيق: {r.app?.invoice_date || 'غير متاح'}</p><p>رقم سجل التطبيق: {r.app?.id || 'غير متاح'}</p><p>التشخيص: {classifyBConnectReviewRow(r).label}</p><p>{(r.reasons || []).join(' — ')}</p></div></div></td></tr>}</Fragment>; })}{!visible.length && <tr><td colSpan={14} className="p-10 text-center text-gray-400">لا توجد نتائج ضمن الفلتر الحالي.</td></tr>}</tbody>
        </table></div>
      </Card>
    </>}
  </div>;
}
