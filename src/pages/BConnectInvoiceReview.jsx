import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  FileSearch,
  Filter,
  Search,
  ShieldCheck,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { performanceApi } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { parseBConnectWorkbook } from '@/lib/bconnectPurchaseInvoiceParser';
import { reconcilePurchaseInvoice } from '@/lib/purchaseInvoiceReconciliation';
import { normalizeBranch, normalizeInvoiceNumber, normalizeMoney } from '@/lib/purchaseInvoiceTruth';
import { classifyBConnectReviewRow } from '@/lib/bconnectReviewDecisionPolicy';
import { buildBConnectFormHandoff } from '@/lib/bconnectInvoiceFormHandoff';

const labels = { clean: 'سليم', review: 'تحتاج مراجعة', problem: 'مشكلة' };
const icons = { clean: CheckCircle2, review: AlertTriangle, problem: XCircle };

const money = (value) => {
  const normalized = normalizeMoney(value);
  if (normalized === null) return '—';
  const decimals = normalized !== 0 && Math.abs(normalized) < 0.001 ? 10 : 3;
  return normalized.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: decimals });
};

const invoiceScopeKey = (branch, number) => `${normalizeBranch(branch) || 'unknown'}::${normalizeInvoiceNumber(number) || 'unknown'}`;
const rowKey = (row) => invoiceScopeKey(row?.bconnect?.branch || row?.app?.branch, row?.number);
const dateOnly = (value) => String(value || '').slice(0, 10);

function issueKind(row) {
  const decision = classifyBConnectReviewRow(row);
  if (decision.code === 'missing') return 'missing';
  if (decision.code === 'duplicate') return 'duplicate';
  const text = (row.reasons || []).join(' ').toLowerCase();
  if (text.includes('المورد')) return 'supplier';
  if (text.includes('التاريخ')) return 'date';
  if (text.includes('مرتجع')) return 'return';
  if (text.includes('قيمة') || text.includes('إجمالي') || text.includes('مالي')) return 'amount';
  if (decision.code === 'blocked') return 'blocked';
  return 'other';
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
  const Icon = icons[row.status];
  const styles = {
    clean: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    review: 'bg-amber-50 text-amber-700 border-amber-200',
    problem: 'bg-rose-50 text-rose-700 border-rose-200',
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${styles[row.status]}`}>
    <Icon className="h-3.5 w-3.5" />{labels[row.status]}
  </span>;
}

function Metric({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'border-slate-200 bg-white',
    green: 'border-emerald-200 bg-emerald-50/60',
    amber: 'border-amber-200 bg-amber-50/60',
    red: 'border-rose-200 bg-rose-50/60',
  };
  return <div className={`rounded-2xl border px-4 py-3 ${tones[tone]}`}>
    <div className="text-xs font-medium text-slate-500">{label}</div>
    <div className="mt-1 text-2xl font-black text-slate-900">{value}</div>
  </div>;
}

function CompareValue({ label, source, current, moneyValue = false }) {
  const format = (value) => moneyValue ? (money(value) === '—' ? '—' : `${money(value)} ج`) : (value || '—');
  const same = String(format(source)) === String(format(current));
  return <div className={`grid gap-2 rounded-xl border p-3 md:grid-cols-[140px_1fr_1fr] ${same ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50/50'}`}>
    <div className="font-bold text-slate-700">{label}</div>
    <div><div className="text-[11px] text-slate-400">B-Connect</div><div className="mt-1 break-words font-medium">{format(source)}</div></div>
    <div><div className="text-[11px] text-slate-400">المسجل في التطبيق</div><div className="mt-1 break-words font-medium">{format(current)}</div></div>
  </div>;
}

function ReviewModal({ row, draft, setDraft, onClose, onMarkReviewed }) {
  if (!row) return null;
  const handoff = buildBConnectFormHandoff(row);
  const blocked = !handoff || ['duplicate_app', 'duplicate_bconnect', 'unverified', 'unauthorized_or_incomplete', 'conflict'].includes(row.identity);
  const app = row.app || {};
  const source = row.bconnect || {};

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div dir="rtl" className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border bg-white shadow-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-slate-50 px-5 py-4 md:px-7">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-black">مراجعة الفاتورة {row.number}</h2>
            <StatusBadge row={row} />
          </div>
          <p className="mt-1 text-sm text-slate-500">{normalizeBranch(source.branch || app.branch) || 'فرع غير معروف'} — المراجعة والتعديل داخل نفس الصفحة</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onClose}><X className="ml-1 h-4 w-4" />إغلاق</Button>
      </div>

      <div className="overflow-y-auto px-5 py-5 md:px-7">
        <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2"><h3 className="font-black">المقارنة</h3><span className="text-xs text-slate-400">الاختلافات فقط تحتاج قرارًا</span></div>
            <CompareValue label="الفرع" source={source.branch} current={app.branch} />
            <CompareValue label="المورد" source={source.supplier} current={app.supplier_name} />
            <CompareValue label="التاريخ" source={dateOnly(source.date)} current={dateOnly(app.invoice_date)} />
            <CompareValue label="الإجمالي" source={source.invoice_value} current={app.total_value} moneyValue />
            <CompareValue label="المرتجع" source={source.return_value} current={app.returned_value} moneyValue />
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-950">
              <div className="font-black">سبب المراجعة</div>
              <div>{(row.reasons || []).join(' — ') || 'لا توجد اختلافات مسجلة.'}</div>
            </div>
          </section>

          <section className="rounded-2xl border bg-slate-50/70 p-4 md:p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div><h3 className="font-black">البيانات المسجلة</h3><p className="mt-1 text-xs text-slate-500">القيم الحالية ظاهرة ومعبأة مسبقًا. رقم الفاتورة والفرع ثابتان.</p></div>
              <ShieldCheck className="h-5 w-5 text-teal-600" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5"><span className="text-xs font-bold text-slate-600">رقم الفاتورة</span><input disabled value={row.number || ''} className="h-10 w-full rounded-xl border bg-slate-100 px-3 text-sm font-bold text-slate-500" /></label>
              <label className="space-y-1.5"><span className="text-xs font-bold text-slate-600">الفرع</span><input disabled value={normalizeBranch(source.branch || app.branch) || ''} className="h-10 w-full rounded-xl border bg-slate-100 px-3 text-sm font-bold text-slate-500" /></label>
              <label className="space-y-1.5 sm:col-span-2"><span className="text-xs font-bold text-slate-600">المورد</span><input value={draft.supplier_name} onChange={(e) => setDraft((old) => ({ ...old, supplier_name: e.target.value }))} disabled={blocked} className="h-10 w-full rounded-xl border bg-white px-3 text-sm disabled:bg-slate-100" /></label>
              <label className="space-y-1.5"><span className="text-xs font-bold text-slate-600">التاريخ</span><input type="date" value={draft.invoice_date} onChange={(e) => setDraft((old) => ({ ...old, invoice_date: e.target.value }))} disabled={blocked} className="h-10 w-full rounded-xl border bg-white px-3 text-sm disabled:bg-slate-100" /></label>
              <label className="space-y-1.5"><span className="text-xs font-bold text-slate-600">الإجمالي</span><input inputMode="decimal" value={draft.total_value} onChange={(e) => setDraft((old) => ({ ...old, total_value: e.target.value }))} disabled={blocked} className="h-10 w-full rounded-xl border bg-white px-3 text-sm disabled:bg-slate-100" /></label>
              <label className="space-y-1.5"><span className="text-xs font-bold text-slate-600">المرتجع</span><input inputMode="decimal" value={draft.returned_value} onChange={(e) => setDraft((old) => ({ ...old, returned_value: e.target.value }))} disabled={blocked} className="h-10 w-full rounded-xl border bg-white px-3 text-sm disabled:bg-slate-100" /></label>
              <label className="space-y-1.5"><span className="text-xs font-bold text-slate-600">النقدي</span><input inputMode="decimal" value={draft.cash_amount} onChange={(e) => setDraft((old) => ({ ...old, cash_amount: e.target.value }))} disabled={blocked} className="h-10 w-full rounded-xl border bg-white px-3 text-sm disabled:bg-slate-100" /></label>
              <label className="space-y-1.5 sm:col-span-2"><span className="text-xs font-bold text-slate-600">طريقة الدفع</span><input value={draft.payment_type} onChange={(e) => setDraft((old) => ({ ...old, payment_type: e.target.value }))} disabled={blocked} className="h-10 w-full rounded-xl border bg-white px-3 text-sm disabled:bg-slate-100" /></label>
              <label className="space-y-1.5 sm:col-span-2"><span className="text-xs font-bold text-slate-600">ملاحظات</span><textarea rows={3} value={draft.notes} onChange={(e) => setDraft((old) => ({ ...old, notes: e.target.value }))} disabled={blocked} className="w-full rounded-xl border bg-white px-3 py-2 text-sm disabled:bg-slate-100" /></label>
            </div>

            {blocked && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-6 text-rose-700">هذه الحالة محجوبة من التعديل الآمن لأن هوية الفاتورة أو الأدلة غير كافية. المراجعة فقط متاحة.</div>}
            {!blocked && <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs leading-6 text-teal-800">واجهة التعديل جاهزة، لكن الحفظ الفعلي على قاعدة البيانات سيظل محجوبًا حتى نشر مسار الحفظ الذري المعتمد في Production. لن نظهر نجاحًا وهميًا.</div>}
          </section>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-white px-5 py-4 md:px-7">
        <div className="text-xs text-slate-500">رقم السجل: <span className="font-mono">{app.id || 'غير موجود'}</span></div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onClose}>إلغاء</Button>
          <Button type="button" variant="outline" onClick={onMarkReviewed}>تمت المراجعة</Button>
          <Button type="button" disabled title="الحفظ الفعلي غير متاح قبل نشر المسار الذري">تم الحفظ</Button>
        </div>
      </div>
    </div>
  </div>;
}

export default function BConnectInvoiceReview() {
  const [state, setState] = useState({ loading: false, error: '', fileName: '', rows: [], meta: null });
  const [activeTab, setActiveTab] = useState('review');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [issueFilter, setIssueFilter] = useState('all');
  const [decisions, setDecisions] = useState({});
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [reviewRow, setReviewRow] = useState(null);
  const [draft, setDraft] = useState({ supplier_name: '', invoice_date: '', total_value: '', returned_value: '', cash_amount: '', payment_type: '', notes: '' });

  const decisionCounts = useMemo(() => state.rows.reduce((acc, row) => {
    const code = classifyBConnectReviewRow(row).code;
    acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {}), [state.rows]);

  const counts = useMemo(() => state.rows.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] || 0) + 1 }), { clean: 0, review: 0, problem: 0 }), [state.rows]);

  const branches = useMemo(() => [...new Set(state.rows.map((row) => normalizeBranch(row.bconnect?.branch || row.app?.branch)).filter(Boolean))], [state.rows]);

  const tabCounts = useMemo(() => ({
    all: state.rows.length,
    clean: counts.clean,
    review: counts.review,
    problem: counts.problem,
    missing: decisionCounts.missing || 0,
    duplicate: decisionCounts.duplicate || 0,
  }), [state.rows.length, counts, decisionCounts]);

  const visible = useMemo(() => state.rows.filter((row) => {
    if (!tabMatches(row, activeTab)) return false;
    const branch = normalizeBranch(row.bconnect?.branch || row.app?.branch);
    if (branchFilter !== 'all' && branch !== branchFilter) return false;
    if (issueFilter !== 'all' && issueKind(row) !== issueFilter) return false;
    const query = search.trim().toLowerCase();
    return !query || [row.number, row.bconnect?.branch, row.bconnect?.supplier, row.app?.supplier_name, row.bconnect?.user, row.app?.entered_by_name, row.app?.entered_by]
      .some((value) => String(value ?? '').toLowerCase().includes(query));
  }), [state.rows, activeTab, branchFilter, issueFilter, search]);

  const openReview = (row) => {
    const app = row.app || {};
    const source = row.bconnect || {};
    setDraft({
      supplier_name: app.supplier_name || source.supplier || '',
      invoice_date: dateOnly(app.invoice_date || source.date),
      total_value: String(app.total_value ?? source.invoice_value ?? ''),
      returned_value: String(app.returned_value ?? source.return_value ?? ''),
      cash_amount: String(app.cash_amount ?? app.cash ?? ''),
      payment_type: app.payment_type || '',
      notes: app.notes || '',
    });
    setReviewRow(row);
  };

  const markReviewed = () => {
    if (!reviewRow) return;
    const key = rowKey(reviewRow);
    setDecisions((old) => ({ ...old, [key]: { action: 'reviewed', note: 'تمت المراجعة داخل نافذة B-Connect', source_id: reviewRow.app?.id || null } }));
    setReviewRow(null);
  };

  const reviewFile = async (file) => {
    if (!file) return;
    setState({ loading: true, error: '', fileName: file.name, rows: [], meta: null });
    setDecisions({});
    setSelectedKeys([]);
    setReviewRow(null);
    setActiveTab('review');
    try {
      const parsed = parseBConnectWorkbook(await file.arrayBuffer());
      if (!parsed.valid) throw new Error(parsed.warnings?.join(' ') || 'ملف B-Connect غير صالح.');
      const numbers = [...new Set(parsed.invoices.map((row) => normalizeInvoiceNumber(row.serial)).filter(Boolean))];
      if (numbers.length === 0) throw new Error('الملف لا يحتوي على أرقام فواتير صالحة للمراجعة.');
      if (numbers.length > 500) throw new Error('الملف يحتوي على أكثر من 500 رقم فاتورة مختلف. قسّمه إلى ملفات أصغر قبل المراجعة.');

      const checked = await performanceApi.bconnectInvoiceNumbers(numbers);
      if (!Array.isArray(checked)) throw new Error('تعذر التحقق الشامل من أرقام الفواتير؛ لم يتم إصدار أحكام.');
      const pairs = checked.map((entry) => [normalizeInvoiceNumber(entry?.number), entry]);
      const returned = pairs.map(([number]) => number);
      if (returned.length !== numbers.length || new Set(returned).size !== returned.length || returned.some((number) => !number || !numbers.includes(number))) {
        throw new Error('نتيجة البحث الشامل ناقصة أو متعارضة؛ لا يمكن اعتماد المطابقة.');
      }

      const globalLookup = new Map(pairs);
      const fileCounts = new Map();
      parsed.invoices.forEach((row) => {
        const number = normalizeInvoiceNumber(row.serial);
        const branch = normalizeBranch(row.branch);
        if (number && branch) {
          const key = invoiceScopeKey(branch, number);
          fileCounts.set(key, (fileCounts.get(key) || 0) + 1);
        }
      });

      const rows = parsed.invoices.map((source) => {
        const number = normalizeInvoiceNumber(source.serial);
        const branch = normalizeBranch(source.branch);
        const gate = globalLookup.get(number);
        const recordCount = gate?.record_count == null ? NaN : Number(gate.record_count);
        const authorizedRows = Array.isArray(gate?.rows) ? gate.rows : [];
        const problem = (identity, reason) => ({ number, bconnect: source, app: null, status: 'problem', identity, reasons: [reason], financial: { difference: null } });

        if (!branch) return problem('unverified', 'فرع B-Connect غير معروف؛ لا يمكن تكوين هوية الفاتورة بأمان.');
        if (!gate || !Number.isSafeInteger(recordCount) || recordCount < 0) return problem('unverified', 'التحقق الشامل غير مكتمل لهذا الرقم؛ ممنوع اعتماد الفاتورة.');
        if (!Array.isArray(gate?.rows) || authorizedRows.length > recordCount) return problem('unverified', 'تفاصيل الاستجابة الشاملة غير مكتملة أو تتجاوز العدد المؤكد؛ ممنوع الاعتماد.');
        if (recordCount === 0 && authorizedRows.length !== 0) return problem('unverified', 'استجابة البحث متعارضة: لا توجد سجلات لكن ظهرت تفاصيل؛ ممنوع الاعتماد.');
        if ((fileCounts.get(invoiceScopeKey(branch, number)) || 0) > 1) return problem('duplicate_bconnect', 'رقم الفاتورة مكرر داخل نفس الفرع في ملف B-Connect.');

        const sameBranchRows = authorizedRows.filter((row) => normalizeBranch(row?.branch) === branch);
        if (sameBranchRows.length > 1) return problem('duplicate_app', 'رقم الفاتورة مكرر داخل نفس الفرع في التطبيق؛ ممنوع الاعتماد.');
        if (sameBranchRows.length === 0) {
          if (recordCount === 0 || authorizedRows.length === recordCount) return problem('missing', 'الفاتورة غير موجودة في هذا الفرع داخل التطبيق.');
          return problem('unauthorized_or_incomplete', 'لا يوجد سجل ظاهر لنفس الرقم داخل هذا الفرع، ولا يمكن إثبات غيابه بسبب نطاق الصلاحيات.');
        }

        const app = sameBranchRows[0];
        if (!app || typeof app !== 'object' || Array.isArray(app) || !app.id || normalizeInvoiceNumber(app.system_invoice_number) !== number || normalizeBranch(app.branch) !== branch) {
          return problem('unverified', 'تفاصيل الفاتورة المرجعية غير مكتملة أو هويتها متعارضة؛ ممنوع الاعتماد.');
        }
        const result = reconcilePurchaseInvoice(app, source);
        return { number, bconnect: source, app, ...result };
      });

      setState({ loading: false, error: '', fileName: file.name, rows, meta: { ...parsed.meta, global_lookup: true, branch_scoped_identity: true } });
    } catch (error) {
      setState({ loading: false, error: error?.message || 'تعذر مراجعة الملف.', fileName: file.name, rows: [], meta: null });
    }
  };

  const tabs = [
    ['all', 'الكل'],
    ['review', 'تحتاج مراجعة'],
    ['problem', 'مشكلة'],
    ['missing', 'ناقصة للتسجيل'],
    ['duplicate', 'تكرارات'],
    ['clean', 'سليم'],
  ];

  return <div dir="rtl" className="space-y-4 p-3 md:p-5 lg:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><h1 className="text-2xl font-black text-slate-900">مركز مراجعة B-Connect</h1><span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-700">مطابقة ذكية</span></div>
        <p className="mt-1 text-sm text-slate-500">راجع الاختلافات واتخذ القرار من نفس الصفحة، بدون التنقل بين الشاشات.</p>
      </div>
      <Button asChild variant="outline"><Link to="/invoices">العودة للفواتير <ChevronLeft className="mr-1 h-4 w-4" /></Link></Button>
    </div>

    <Card className="overflow-hidden border-slate-200">
      <label className="flex cursor-pointer items-center gap-4 p-4 transition hover:bg-slate-50 md:p-5">
        <div className="rounded-2xl bg-teal-50 p-3 text-teal-600"><Upload className="h-6 w-6" /></div>
        <div className="min-w-0 flex-1">
          <div className="font-black">{state.loading ? 'جاري تحليل الملف ومطابقته...' : state.fileName || 'اختر ملف B-Connect'}</div>
          <div className="mt-1 text-xs text-slate-500">رفع Excel فقط — نفس رقم الفاتورة مسموح بين الفرعين، والتكرار يُحجب داخل نفس الفرع.</div>
        </div>
        <span className="rounded-xl border bg-white px-3 py-2 text-xs font-bold text-slate-600">اختيار ملف</span>
        <input type="file" accept=".xlsx,.xls" className="hidden" disabled={state.loading} onChange={(event) => reviewFile(event.target.files?.[0])} />
      </label>
      {state.error && <div className="border-t border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{state.error}</div>}
    </Card>

    {!!state.rows.length && <>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Metric label="إجمالي الفواتير" value={state.rows.length} />
        <Metric label="سليم" value={counts.clean} tone="green" />
        <Metric label="تحتاج مراجعة" value={counts.review} tone="amber" />
        <Metric label="مشكلة" value={counts.problem} tone="red" />
      </div>

      <Card className="overflow-hidden border-slate-200">
        <div className="overflow-x-auto border-b bg-white px-3 pt-3">
          <div className="flex min-w-max gap-1.5">
            {tabs.map(([key, label]) => <button key={key} type="button" onClick={() => setActiveTab(key)} className={`rounded-t-xl border-b-2 px-4 py-3 text-sm font-bold transition ${activeTab === key ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}>
              {label}<span className="mr-2 rounded-full bg-white/80 px-2 py-0.5 text-[11px]">{tabCounts[key]}</span>
            </button>)}
          </div>
        </div>

        <div className="grid gap-3 border-b bg-slate-50/70 p-3 md:grid-cols-[1fr_180px_190px_auto] md:p-4">
          <label className="relative block"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input aria-label="بحث في فواتير B-Connect" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="رقم الفاتورة، المورد، الموظف..." className="h-10 w-full rounded-xl border bg-white pr-10 pl-3 text-sm" /></label>
          <select aria-label="تصفية حسب الفرع" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="h-10 rounded-xl border bg-white px-3 text-sm"><option value="all">كل الفروع</option>{branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}</select>
          <select aria-label="تصفية حسب نوع الاختلاف" value={issueFilter} onChange={(event) => setIssueFilter(event.target.value)} className="h-10 rounded-xl border bg-white px-3 text-sm">
            <option value="all">كل أنواع الاختلاف</option><option value="supplier">المورد</option><option value="date">التاريخ</option><option value="amount">القيمة المالية</option><option value="return">المرتجع</option><option value="missing">ناقصة للتسجيل</option><option value="duplicate">تكرار</option><option value="blocked">محجوبة</option><option value="other">أخرى</option>
          </select>
          <div className="flex h-10 items-center gap-2 rounded-xl border bg-white px-3 text-xs font-bold text-slate-500"><Filter className="h-4 w-4" />{visible.length} نتيجة</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-sm">
            <thead className="bg-white text-xs text-slate-500"><tr><th className="px-4 py-3 text-right">رقم الفاتورة</th><th className="px-4 py-3 text-right">الفرع</th><th className="px-4 py-3 text-right">المورد</th><th className="px-4 py-3 text-right">التاريخ</th><th className="px-4 py-3 text-right">الإجمالي</th><th className="px-4 py-3 text-right">الحالة</th><th className="px-4 py-3 text-right">سبب المراجعة</th><th className="px-4 py-3 text-right">الإجراء</th></tr></thead>
            <tbody>
              {visible.map((row, index) => {
                const key = rowKey(row);
                const decision = classifyBConnectReviewRow(row);
                return <tr key={`${key}-${index}`} className="border-t align-middle transition hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-mono font-black text-slate-900">{row.number}</td>
                  <td className="px-4 py-3">{normalizeBranch(row.bconnect?.branch || row.app?.branch) || '—'}</td>
                  <td className="max-w-[230px] px-4 py-3"><div className="truncate font-medium">{row.bconnect?.supplier || row.app?.supplier_name || '—'}</div>{row.bconnect?.supplier && row.app?.supplier_name && row.bconnect.supplier !== row.app.supplier_name && <div className="mt-1 truncate text-[11px] text-amber-600">المسجل: {row.app.supplier_name}</div>}</td>
                  <td className="px-4 py-3 whitespace-nowrap"><div>{dateOnly(row.bconnect?.date) || '—'}</div>{row.app?.invoice_date && dateOnly(row.bconnect?.date) !== dateOnly(row.app.invoice_date) && <div className="mt-1 text-[11px] text-amber-600">المسجل: {dateOnly(row.app.invoice_date)}</div>}</td>
                  <td className="px-4 py-3 whitespace-nowrap font-bold">{money(row.bconnect?.invoice_value)}{money(row.bconnect?.invoice_value) === '—' ? '' : ' ج'}</td>
                  <td className="px-4 py-3"><StatusBadge row={row} /></td>
                  <td className="max-w-[360px] px-4 py-3 text-xs leading-6 text-slate-600"><div className="line-clamp-2">{(row.reasons || []).join(' — ') || decision.label}</div>{decisions[key]?.action === 'reviewed' && <div className="mt-1 font-bold text-teal-600">✓ تمت المراجعة</div>}</td>
                  <td className="px-4 py-3"><Button type="button" size="sm" variant={row.status === 'clean' ? 'outline' : 'default'} onClick={() => openReview(row)}>{row.identity === 'missing' ? 'مراجعة للإضافة' : row.status === 'clean' ? 'عرض التفاصيل' : 'مراجعة وتعديل'}</Button></td>
                </tr>;
              })}
              {!visible.length && <tr><td colSpan={8} className="px-4 py-14 text-center text-slate-400"><FileSearch className="mx-auto mb-2 h-7 w-7" />لا توجد نتائج ضمن الفلاتر الحالية.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border bg-white p-3 text-sm"><span className="text-slate-500">تكرارات تحتاج تحقيقًا</span><strong className="float-left text-lg">{decisionCounts.duplicate || 0}</strong></div>
        <div className="rounded-xl border bg-white p-3 text-sm"><span className="text-slate-500">ناقصة للتسجيل</span><strong className="float-left text-lg">{decisionCounts.missing || 0}</strong></div>
        <div className="rounded-xl border bg-white p-3 text-sm"><span className="text-slate-500">قابلة للمراجعة</span><strong className="float-left text-lg">{decisionCounts.proposed || 0}</strong></div>
        <div className="rounded-xl border bg-white p-3 text-sm"><span className="text-slate-500">محجوبة لنقص الأدلة</span><strong className="float-left text-lg">{decisionCounts.blocked || 0}</strong></div>
      </div>
    </>}

    <ReviewModal row={reviewRow} draft={draft} setDraft={setDraft} onClose={() => setReviewRow(null)} onMarkReviewed={markReviewed} />
  </div>;
}
