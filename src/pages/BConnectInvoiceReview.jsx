import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronLeft, FileSearch, Filter, Search, Upload, XCircle } from 'lucide-react';
import { performanceApi } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import BConnectReviewModal from '@/components/bconnect/BConnectReviewModal';
import { parseBConnectWorkbook } from '@/lib/bconnectPurchaseInvoiceParser';
import { reconcilePurchaseInvoice } from '@/lib/purchaseInvoiceReconciliation';
import { normalizeBranch, normalizeInvoiceNumber, normalizeMoney } from '@/lib/purchaseInvoiceTruth';
import { classifyBConnectReviewRow } from '@/lib/bconnectReviewDecisionPolicy';

const labels = { clean: 'سليم', review: 'تحتاج مراجعة', problem: 'مشكلة' };
const icons = { clean: CheckCircle2, review: AlertTriangle, problem: XCircle };
const invoiceScopeKey = (branch, number) => `${normalizeBranch(branch) || 'unknown'}::${normalizeInvoiceNumber(number) || 'unknown'}`;
const rowKey = (row) => invoiceScopeKey(row?.bconnect?.branch || row?.app?.branch, row?.number);

const money = (value) => {
  const normalized = normalizeMoney(value);
  if (normalized === null) return '—';
  return normalized.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
};

function formatArabicDate(value) {
  const iso = String(value || '').slice(0, 10);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value || '—';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function issueKinds(row) {
  const kinds = new Set();
  const decision = classifyBConnectReviewRow(row);
  const text = (row.reasons || []).join(' ').toLowerCase();
  if (decision.code === 'missing') kinds.add('missing');
  if (decision.code === 'duplicate') kinds.add('duplicate');
  if (decision.code === 'blocked') kinds.add('blocked');
  if (text.includes('المورد')) kinds.add('supplier');
  if (text.includes('التاريخ')) kinds.add('date');
  if (text.includes('قيمة') || text.includes('إجمالي') || text.includes('مالي')) kinds.add('amount');
  if (!kinds.size) kinds.add('other');
  return [...kinds];
}

function tabMatches(row, tab) {
  if (tab === 'all') return true;
  if (tab === 'clean') return row.status === 'clean';
  if (tab === 'review') return row.status === 'review';
  if (tab === 'problem') return row.status === 'problem';
  if (tab === 'missing') return classifyBConnectReviewRow(row).code === 'missing';
  if (tab === 'duplicate') return classifyBConnectReviewRow(row).code === 'duplicate';
  return true;
}

function StatusBadge({ row }) {
  const decision = classifyBConnectReviewRow(row);
  const Icon = icons[row.status] || AlertTriangle;
  const special = decision.code === 'missing'
    ? { label: 'ناقصة للتسجيل', style: 'bg-sky-50 text-sky-700 border-sky-200' }
    : decision.code === 'duplicate'
      ? { label: 'تكرار — تحقيق يدوي', style: 'bg-rose-50 text-rose-700 border-rose-200' }
      : decision.code === 'blocked'
        ? { label: 'محجوبة', style: 'bg-slate-100 text-slate-700 border-slate-300' }
        : null;
  const base = {
    clean: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    review: 'bg-amber-50 text-amber-700 border-amber-200',
    problem: 'bg-rose-50 text-rose-700 border-rose-200',
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${special?.style || base[row.status]}`}><Icon className="h-3.5 w-3.5" />{special?.label || labels[row.status]}</span>;
}

function Metric({ label, value, tone = 'slate' }) {
  const tones = { slate: 'border-slate-200 bg-white', green: 'border-emerald-200 bg-emerald-50/60', amber: 'border-amber-200 bg-amber-50/60', red: 'border-rose-200 bg-rose-50/60' };
  return <div className={`rounded-2xl border px-4 py-3 ${tones[tone]}`}><div className="text-xs font-medium text-slate-500">{label}</div><div className="mt-1 text-2xl font-black text-slate-900">{value}</div></div>;
}

export default function BConnectInvoiceReview() {
  const [state, setState] = useState({ loading: false, error: '', fileName: '', rows: [], meta: null });
  const [activeTab, setActiveTab] = useState('review');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [issueFilter, setIssueFilter] = useState('all');
  const [decisions, setDecisions] = useState({});
  const [reviewRow, setReviewRow] = useState(null);

  const decisionCounts = useMemo(() => state.rows.reduce((acc, row) => {
    const code = classifyBConnectReviewRow(row).code;
    acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {}), [state.rows]);
  const counts = useMemo(() => state.rows.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] || 0) + 1 }), { clean: 0, review: 0, problem: 0 }), [state.rows]);
  const branches = useMemo(() => [...new Set(state.rows.map((row) => normalizeBranch(row.bconnect?.branch || row.app?.branch)).filter(Boolean))], [state.rows]);
  const tabCounts = useMemo(() => ({ all: state.rows.length, clean: counts.clean, review: counts.review, problem: counts.problem, missing: decisionCounts.missing || 0, duplicate: decisionCounts.duplicate || 0 }), [state.rows.length, counts, decisionCounts]);
  const visible = useMemo(() => state.rows.filter((row) => {
    if (!tabMatches(row, activeTab)) return false;
    const branch = normalizeBranch(row.bconnect?.branch || row.app?.branch);
    if (branchFilter !== 'all' && branch !== branchFilter) return false;
    if (issueFilter !== 'all' && !issueKinds(row).includes(issueFilter)) return false;
    const query = search.trim().toLowerCase();
    return !query || [row.number, row.bconnect?.branch, row.bconnect?.supplier, row.app?.supplier_name, row.bconnect?.user, row.app?.entered_by_name, row.app?.entered_by].some((value) => String(value ?? '').toLowerCase().includes(query));
  }), [state.rows, activeTab, branchFilter, issueFilter, search]);

  const markReviewed = (row) => {
    if (!row) return;
    const key = rowKey(row);
    setDecisions((old) => ({ ...old, [key]: { action: 'reviewed', note: 'تمت المراجعة داخل نافذة B-Connect', source_id: row.app?.id || null } }));
    setReviewRow(null);
  };

  const verifiedSave = (updatedRow) => {
    const key = rowKey(updatedRow);
    setState((old) => ({ ...old, rows: old.rows.map((item) => rowKey(item) === key ? updatedRow : item) }));
    setDecisions((old) => ({ ...old, [key]: { action: 'saved', note: 'تم الحفظ الذري والتحقق بإعادة القراءة', source_id: updatedRow.app?.id || null } }));
    setReviewRow(updatedRow);
  };

  const reviewFile = async (file) => {
    if (!file) return;
    setState({ loading: true, error: '', fileName: file.name, rows: [], meta: null });
    setDecisions({}); setReviewRow(null); setActiveTab('review'); setSearch(''); setBranchFilter('all'); setIssueFilter('all');
    try {
      const parsed = parseBConnectWorkbook(await file.arrayBuffer());
      if (!parsed.valid) throw new Error(parsed.warnings?.join(' ') || 'ملف B-Connect غير صالح.');
      const numbers = [...new Set(parsed.invoices.map((row) => normalizeInvoiceNumber(row.serial)).filter(Boolean))];
      if (!numbers.length) throw new Error('الملف لا يحتوي على أرقام فواتير صالحة للمراجعة.');
      if (numbers.length > 500) throw new Error('الملف يحتوي على أكثر من 500 رقم فاتورة مختلف. قسّمه إلى ملفات أصغر.');
      const checked = await performanceApi.bconnectInvoiceNumbers(numbers);
      if (!Array.isArray(checked)) throw new Error('تعذر التحقق الشامل من أرقام الفواتير.');
      const pairs = checked.map((entry) => [normalizeInvoiceNumber(entry?.number), entry]);
      const returned = pairs.map(([number]) => number);
      if (returned.length !== numbers.length || new Set(returned).size !== returned.length || returned.some((number) => !number || !numbers.includes(number))) throw new Error('نتيجة البحث الشامل ناقصة أو متعارضة؛ لا يمكن اعتماد المطابقة.');

      const globalLookup = new Map(pairs);
      const fileCounts = new Map();
      parsed.invoices.forEach((source) => {
        const number = normalizeInvoiceNumber(source.serial);
        const branch = normalizeBranch(source.branch);
        if (number && branch) fileCounts.set(invoiceScopeKey(branch, number), (fileCounts.get(invoiceScopeKey(branch, number)) || 0) + 1);
      });

      const rows = parsed.invoices.map((source) => {
        const number = normalizeInvoiceNumber(source.serial);
        const branch = normalizeBranch(source.branch);
        const gate = globalLookup.get(number);
        const recordCount = gate?.record_count == null ? NaN : Number(gate.record_count);
        const authorizedRows = Array.isArray(gate?.rows) ? gate.rows : [];
        const problem = (identity, reason) => ({ number, bconnect: source, app: null, status: 'problem', identity, reasons: [reason], financial: { difference: null } });
        if (!branch) return problem('unverified', 'فرع B-Connect غير معروف؛ لا يمكن تكوين هوية الفاتورة بأمان.');
        if (!gate || !Number.isSafeInteger(recordCount) || recordCount < 0) return problem('unverified', 'التحقق الشامل غير مكتمل لهذا الرقم؛ ممنوع الاعتماد.');
        if (!Array.isArray(gate?.rows) || authorizedRows.length > recordCount) return problem('unverified', 'تفاصيل الاستجابة الشاملة غير مكتملة؛ ممنوع الاعتماد.');
        if ((fileCounts.get(invoiceScopeKey(branch, number)) || 0) > 1) return problem('duplicate_bconnect', 'رقم الفاتورة مكرر داخل نفس الفرع في ملف B-Connect.');
        const sameBranchRows = authorizedRows.filter((row) => normalizeBranch(row?.branch) === branch);
        if (sameBranchRows.length > 1) return problem('duplicate_app', 'رقم الفاتورة مكرر داخل نفس الفرع في التطبيق؛ ممنوع الاعتماد.');
        if (!sameBranchRows.length) {
          if (recordCount === 0 || authorizedRows.length === recordCount) return problem('missing', 'الفاتورة غير موجودة في هذا الفرع داخل التطبيق.');
          return problem('unauthorized_or_incomplete', 'لا يمكن إثبات غياب الفاتورة بسبب نطاق الصلاحيات.');
        }
        const app = sameBranchRows[0];
        if (!app?.id || normalizeInvoiceNumber(app.system_invoice_number) !== number || normalizeBranch(app.branch) !== branch || !Number.isSafeInteger(Number(app.bconnect_revision_v1))) return problem('unverified', 'تفاصيل الفاتورة المرجعية أو رقم نسختها غير مكتملة؛ ممنوع الاعتماد.');
        return { number, bconnect: source, app, ...reconcilePurchaseInvoice(app, source) };
      });
      setState({ loading: false, error: '', fileName: file.name, rows, meta: { ...parsed.meta, global_lookup: true, branch_scoped_identity: true, atomic_edit_enabled: true } });
    } catch (error) {
      setState({ loading: false, error: error?.message || 'تعذر مراجعة الملف.', fileName: file.name, rows: [], meta: null });
    }
  };

  const tabs = [['all', 'الكل'], ['review', 'تحتاج مراجعة'], ['problem', 'كل المشاكل'], ['missing', 'ناقصة للتسجيل'], ['duplicate', 'تكرارات'], ['clean', 'سليم']];

  return <div dir="rtl" className="space-y-4 p-3 md:p-5 lg:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><h1 className="text-2xl font-black text-slate-900">مركز مراجعة B-Connect</h1><span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-700">مطابقة ذكية</span></div><p className="mt-1 text-sm text-slate-500">راجع الاختلافات واتخذ القرار من نفس الصفحة. الحفظ الذري مفعّل للفواتير الموجودة فقط.</p></div><Button asChild variant="outline"><Link to="/invoices">العودة للفواتير <ChevronLeft className="mr-1 h-4 w-4" /></Link></Button></div>
    <Card className="overflow-hidden border-slate-200"><label className="flex cursor-pointer items-center gap-4 p-4 transition hover:bg-slate-50 md:p-5"><div className="rounded-2xl bg-teal-50 p-3 text-teal-600"><Upload className="h-6 w-6" /></div><div className="min-w-0 flex-1"><div className="font-black">{state.loading ? 'جاري تحليل الملف ومطابقته...' : state.fileName ? 'تم رفع ملف B-Connect بنجاح' : 'اختر ملف B-Connect'}</div><div className="mt-1 text-xs text-slate-500">{state.fileName ? `الملف جاهز للمراجعة — ${state.rows.length || 'جاري التحليل'} فاتورة` : 'رفع Excel فقط — نفس رقم الفاتورة مسموح بين الفرعين، والتكرار يُحجب داخل نفس الفرع.'}</div></div><span className="rounded-xl border bg-white px-3 py-2 text-xs font-bold text-slate-600">اختيار ملف</span><input type="file" accept=".xlsx,.xls" className="hidden" disabled={state.loading} onChange={(event) => reviewFile(event.target.files?.[0])} /></label>{state.error && <div className="border-t border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{state.error}</div>}</Card>
    {!!state.rows.length && <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="إجمالي الفواتير" value={state.rows.length} /><Metric label="سليم" value={counts.clean} tone="green" /><Metric label="تحتاج مراجعة" value={counts.review} tone="amber" /><Metric label="كل المشاكل" value={counts.problem} tone="red" /></div>
      <Card className="overflow-hidden border-slate-200">
        <div className="overflow-x-auto border-b bg-white px-3 pt-3"><div className="flex min-w-max gap-1.5">{tabs.map(([key, label]) => <button key={key} type="button" onClick={() => setActiveTab(key)} className={`rounded-t-xl border-b-2 px-4 py-3 text-sm font-bold transition ${activeTab === key ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-transparent text-slate-500 hover:bg-slate-50'}`}>{label}<span className="mr-2 rounded-full bg-white/80 px-2 py-0.5 text-[11px]">{tabCounts[key]}</span></button>)}</div></div>
        <div className="grid gap-3 border-b bg-slate-50/70 p-3 md:grid-cols-[1fr_180px_190px_auto] md:p-4"><label className="relative block"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="رقم الفاتورة، المورد، الموظف..." className="h-10 w-full rounded-xl border bg-white pr-10 pl-3 text-sm" /></label><select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="h-10 rounded-xl border bg-white px-3 text-sm"><option value="all">كل الفروع</option>{branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}</select><select value={issueFilter} onChange={(event) => setIssueFilter(event.target.value)} className="h-10 rounded-xl border bg-white px-3 text-sm"><option value="all">كل أنواع الاختلاف</option><option value="supplier">المورد</option><option value="date">التاريخ</option><option value="amount">القيمة المالية</option><option value="missing">ناقصة للتسجيل</option><option value="duplicate">تكرار</option><option value="blocked">محجوبة</option><option value="other">أخرى</option></select><div className="flex h-10 items-center gap-2 rounded-xl border bg-white px-3 text-xs font-bold text-slate-500"><Filter className="h-4 w-4" />{visible.length} نتيجة</div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead className="bg-white text-xs text-slate-500"><tr><th className="px-4 py-3 text-right">رقم الفاتورة</th><th className="px-4 py-3 text-right">الفرع</th><th className="px-4 py-3 text-right">المورد</th><th className="px-4 py-3 text-right">التاريخ</th><th className="px-4 py-3 text-right">الإجمالي</th><th className="px-4 py-3 text-right">الحالة</th><th className="px-4 py-3 text-right">سبب المراجعة</th><th className="px-4 py-3 text-right">الإجراء</th></tr></thead><tbody>{visible.map((row, index) => {
          const key = rowKey(row); const decision = classifyBConnectReviewRow(row); const supplierMismatch = row.checks?.supplier === 'mismatch'; const dateMismatch = row.checks?.invoice_date === 'mismatch';
          const actionLabel = row.identity === 'missing' ? 'مراجعة للإضافة' : decision.code === 'duplicate' ? 'تحقيق يدوي' : decision.code === 'blocked' || row.status === 'problem' ? 'عرض المشكلة' : row.status === 'clean' ? 'عرض التفاصيل' : 'مراجعة وتعديل';
          return <tr key={`${key}-${index}`} className="border-t align-middle transition hover:bg-slate-50/70"><td className="px-4 py-3 font-mono font-black">{row.number}</td><td className="px-4 py-3">{normalizeBranch(row.bconnect?.branch || row.app?.branch) || '—'}</td><td className="max-w-[230px] px-4 py-3"><div className="truncate font-medium">{row.bconnect?.supplier || row.app?.supplier_name || '—'}</div>{supplierMismatch && row.app?.supplier_name && <div className="mt-1 truncate text-[11px] text-amber-600">المسجل: {row.app.supplier_name}</div>}</td><td className="whitespace-nowrap px-4 py-3"><div>{formatArabicDate(row.bconnect?.date)}</div>{dateMismatch && row.app?.invoice_date && <div className="mt-1 text-[11px] text-amber-600">المسجل: {formatArabicDate(row.app.invoice_date)}</div>}</td><td className="whitespace-nowrap px-4 py-3 font-bold">{money(row.bconnect?.invoice_value)}{money(row.bconnect?.invoice_value) === '—' ? '' : ' ج'}</td><td className="px-4 py-3"><StatusBadge row={row} /></td><td className="max-w-[360px] px-4 py-3 text-xs leading-6 text-slate-600"><div className="line-clamp-2">{(row.reasons || []).join(' — ') || decision.label}</div>{decisions[key]?.action === 'reviewed' && <div className="mt-1 font-bold text-teal-600">✓ تمت المراجعة</div>}{decisions[key]?.action === 'saved' && <div className="mt-1 font-bold text-emerald-600">✓ تم الحفظ والتحقق</div>}</td><td className="px-4 py-3"><Button type="button" size="sm" variant={row.status === 'clean' || decision.code === 'blocked' || decision.code === 'duplicate' ? 'outline' : 'default'} onClick={() => setReviewRow(row)}>{actionLabel}</Button></td></tr>;
        })}{!visible.length && <tr><td colSpan={8} className="px-4 py-14 text-center text-slate-400"><FileSearch className="mx-auto mb-2 h-7 w-7" />لا توجد نتائج ضمن الفلاتر الحالية.</td></tr>}</tbody></table></div>
      </Card>
      <div className="grid gap-3 md:grid-cols-4"><div className="rounded-xl border bg-white p-3 text-sm"><span className="text-slate-500">تكرارات تحتاج تحقيقًا</span><strong className="float-left text-lg">{decisionCounts.duplicate || 0}</strong></div><div className="rounded-xl border bg-white p-3 text-sm"><span className="text-slate-500">ناقصة للتسجيل</span><strong className="float-left text-lg">{decisionCounts.missing || 0}</strong></div><div className="rounded-xl border bg-white p-3 text-sm"><span className="text-slate-500">قابلة للمراجعة</span><strong className="float-left text-lg">{decisionCounts.proposed || 0}</strong></div><div className="rounded-xl border bg-white p-3 text-sm"><span className="text-slate-500">محجوبة لنقص الأدلة</span><strong className="float-left text-lg">{decisionCounts.blocked || 0}</strong></div></div>
    </>}
    <BConnectReviewModal row={reviewRow} onClose={() => setReviewRow(null)} onMarkReviewed={markReviewed} onVerifiedSave={verifiedSave} />
  </div>;
}
