import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, CircleDollarSign, Layers3, Search, Upload } from 'lucide-react';
import { performanceApi } from '@/api/base44Client';
import { bconnectAcceptanceFingerprint, loadBconnectAcceptances, saveBconnectAcceptance } from '@/api/bconnectReviewAcceptanceClient';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import BConnectReviewModal from '@/components/bconnect/BConnectReviewModal';
import { parseBConnectWorkbook } from '@/lib/bconnectPurchaseInvoiceParser';
import { reconcilePurchaseInvoice } from '@/lib/purchaseInvoiceReconciliation';
import { normalizeBranch, normalizeInvoiceNumber, normalizeMoney } from '@/lib/purchaseInvoiceTruth';
import { buildBConnectDecisionGroups, buildBConnectPurchaseDecision } from '@/lib/bconnectPurchaseDecisionView';

const invoiceScopeKey = (branch, number) => `${normalizeBranch(branch) || 'unknown'}::${normalizeInvoiceNumber(number) || 'unknown'}`;
const rowKey = (row) => invoiceScopeKey(row?.bconnect?.branch || row?.app?.branch, row?.number);

const money = (value) => {
  const normalized = normalizeMoney(value);
  if (normalized === null) return '—';
  return normalized.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

function formatArabicDate(value) {
  const iso = String(value || '').slice(0, 10);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value || '—';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
}

const laneMeta = {
  approve: { label: 'اعتماد', tone: 'emerald' },
  correct: { label: 'تصحيح', tone: 'amber' },
  explain: { label: 'فرق مالي', tone: 'rose' },
  register: { label: 'تسجيل', tone: 'sky' },
  investigate: { label: 'تحقيق', tone: 'rose' },
  clean: { label: 'سليم', tone: 'slate' },
};

const toneClasses = {
  emerald: 'border-emerald-100 bg-emerald-50/60 text-emerald-800',
  amber: 'border-amber-100 bg-amber-50/60 text-amber-800',
  rose: 'border-rose-100 bg-rose-50/60 text-rose-800',
  sky: 'border-sky-100 bg-sky-50/60 text-sky-800',
  slate: 'border-slate-200 bg-slate-50 text-slate-600',
};

function DecisionBadge({ view, large = false }) {
  const meta = laneMeta[view.lane] || laneMeta.clean;
  return <span className={`inline-flex items-center gap-2 rounded-full border font-black ${toneClasses[meta.tone]} ${large ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-xs'}`}>
    {meta.label}<span className="opacity-60">{view.confidence?.score ?? 0}%</span>
  </span>;
}

function DecisionFacts({ view, large = false }) {
  const facts = [];
  if (view.financialDifference !== null && view.financialDifference !== 0) facts.push({ text: `فرق مالي ${money(Math.abs(view.financialDifference))} ج`, tone: 'text-rose-700' });
  if (view.evidence?.label && facts.length < 3) facts.push({ text: view.evidence.label, tone: view.evidenceConfidence === 'high' ? 'text-emerald-700' : 'text-amber-700' });
  if (view.supplierMismatch && facts.length < 3) facts.push({ text: 'مورد مختلف', tone: 'text-amber-700' });
  if (view.dateMismatch && facts.length < 3) facts.push({ text: view.dateDifferenceDays === null ? 'تاريخ مختلف' : `التاريخ ${Math.abs(view.dateDifferenceDays)} يوم`, tone: 'text-amber-700' });
  if (view.hasReturn && facts.length < 3) facts.push({ text: `مرتجع ${money(view.returnedValue ?? view.sourceReturnValue)} ج`, tone: 'text-sky-700' });
  if (view.hasNote && facts.length < 3) facts.push({ text: 'يوجد ملاحظة', tone: 'text-violet-700' });
  return <div className={`flex flex-wrap gap-2 font-black ${large ? 'text-sm' : 'text-[11px]'}`}>
    {facts.map((fact) => <span key={fact.text} className={`rounded-full border border-slate-100 bg-slate-50 px-2.5 py-1 ${fact.tone}`}>{fact.text}</span>)}
    {!facts.length && <span className="rounded-full border border-slate-100 bg-slate-50 px-2.5 py-1 text-slate-400">لا فرق مؤثر</span>}
  </div>;
}

export default function BConnectInvoiceReview() {
  const [state, setState] = useState({ loading: false, error: '', fileName: '', rows: [], meta: null });
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [queueFilter, setQueueFilter] = useState('actionable');
  const [selectedKey, setSelectedKey] = useState('');
  const [decisions, setDecisions] = useState({});
  const [reviewRow, setReviewRow] = useState(null);
  const [bulkState, setBulkState] = useState({ key: '', running: false, message: '' });
  const [showBulkGroups, setShowBulkGroups] = useState(false);

  const branches = useMemo(() => [...new Set(state.rows.map((row) => normalizeBranch(row.bconnect?.branch || row.app?.branch)).filter(Boolean))], [state.rows]);
  const unacceptedRows = useMemo(() => state.rows.filter((row) => decisions[rowKey(row)]?.action !== 'accepted'), [state.rows, decisions]);
  const decisionGroups = useMemo(() => buildBConnectDecisionGroups(unacceptedRows), [unacceptedRows]);
  const safeBulkRows = useMemo(() => {
    const seen = new Set();
    const rows = [];
    decisionGroups.forEach((group) => group.rows.forEach((row) => {
      const key = rowKey(row);
      if (!seen.has(key)) {
        seen.add(key);
        rows.push(row);
      }
    }));
    return rows;
  }, [decisionGroups]);
  const safeBulkKeys = useMemo(() => new Set(safeBulkRows.map(rowKey)), [safeBulkRows]);

  const counts = useMemo(() => {
    const result = { approve: 0, needs: 0, investigate: 0, done: 0 };
    state.rows.forEach((row) => {
      const action = decisions[rowKey(row)]?.action;
      const view = buildBConnectPurchaseDecision(row);
      if (action === 'accepted' || view.lane === 'clean') result.done += 1;
      else if (view.lane === 'approve') result.approve += 1;
      else if (view.lane === 'investigate') result.investigate += 1;
      else if (['correct', 'explain', 'register'].includes(view.lane)) result.needs += 1;
    });
    return result;
  }, [state.rows, decisions]);

  const individualApproveCount = Math.max(0, counts.approve - safeBulkRows.length);

  const queueRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return state.rows.filter((row) => {
      const key = rowKey(row);
      const action = decisions[key]?.action;
      const view = buildBConnectPurchaseDecision(row);
      const branch = normalizeBranch(row.bconnect?.branch || row.app?.branch);
      if (branchFilter !== 'all' && branch !== branchFilter) return false;
      if (query && ![row.number, row.bconnect?.supplier, row.app?.supplier_name, row.bconnect?.user, row.app?.entered_by_name, row.app?.entered_by, view.note].some((value) => String(value ?? '').toLowerCase().includes(query))) return false;
      if (queueFilter === 'done') return action === 'accepted' || view.lane === 'clean';
      if (action === 'accepted' || view.lane === 'clean') return false;
      if (queueFilter === 'needs') return ['correct', 'explain', 'register'].includes(view.lane);
      if (queueFilter === 'investigate') return view.lane === 'investigate';
      if (queueFilter === 'approve') return view.lane === 'approve' && !safeBulkKeys.has(key);
      return ['correct', 'explain', 'register', 'investigate'].includes(view.lane) || (view.lane === 'approve' && !safeBulkKeys.has(key));
    }).sort((a, b) => {
      const priority = { explain: 0, correct: 1, register: 2, investigate: 3, approve: 4, clean: 9 };
      return (priority[buildBConnectPurchaseDecision(a).lane] ?? 8) - (priority[buildBConnectPurchaseDecision(b).lane] ?? 8);
    });
  }, [state.rows, decisions, branchFilter, search, queueFilter, safeBulkKeys]);

  const selectedRow = useMemo(() => queueRows.find((row) => rowKey(row) === selectedKey) || queueRows[0] || null, [queueRows, selectedKey]);

  const selectNext = (row) => {
    if (!row || !queueRows.length) return;
    const index = Math.max(0, queueRows.findIndex((item) => rowKey(item) === rowKey(row)));
    const next = queueRows[index + 1] || queueRows[index - 1] || null;
    setSelectedKey(next ? rowKey(next) : '');
  };

  const markReviewed = (row) => {
    if (!row) return;
    const key = rowKey(row);
    setDecisions((old) => ({ ...old, [key]: { action: 'reviewed', note: 'تمت المراجعة داخل نافذة B-Connect', source_id: row.app?.id || null } }));
    selectNext(row);
    setReviewRow(null);
  };

  const acceptAsIs = async (row) => {
    if (!row) return;
    const view = buildBConnectPurchaseDecision(row);
    if (!view.fastAccept) {
      setState((old) => ({ ...old, error: 'تم إيقاف الاعتماد لأن الحالة لم تعد مستوفية لشروط الاعتماد الآمن.' }));
      return;
    }
    try {
      await saveBconnectAcceptance(row);
      const key = rowKey(row);
      setDecisions((old) => ({ ...old, [key]: { action: 'accepted', note: 'اعتماد دائم: تم قبول اختلاف المورد/التاريخ كما هو', source_id: row.app?.id || null } }));
      selectNext(row);
      setReviewRow(null);
      setState((old) => ({ ...old, error: '' }));
    } catch (error) {
      setState((old) => ({ ...old, error: `تعذر حفظ الاعتماد الدائم: ${error?.message || 'خطأ غير معروف'}` }));
    }
  };

  const acceptRows = async (rows, bulkKey) => {
    if (!rows?.length || bulkState.running) return;
    const candidates = rows.filter((row) => {
      const view = buildBConnectPurchaseDecision(row);
      return view.bulkEligible && decisions[rowKey(row)]?.action !== 'accepted';
    });
    if (!candidates.length) return;

    setBulkState({ key: bulkKey, running: true, message: `جاري اعتماد ${candidates.length} فاتورة...` });
    let success = 0;
    const failed = [];
    for (let i = 0; i < candidates.length; i += 4) {
      const batch = candidates.slice(i, i + 4);
      const results = await Promise.allSettled(batch.map(async (row) => {
        const freshView = buildBConnectPurchaseDecision(row);
        if (!freshView.bulkEligible) throw new Error('لم تعد مستوفية لشروط الاعتماد الجماعي');
        await saveBconnectAcceptance(row);
        return row;
      }));
      results.forEach((result, index) => {
        const row = batch[index];
        if (result.status === 'fulfilled') {
          success += 1;
          const key = rowKey(row);
          setDecisions((old) => ({ ...old, [key]: { action: 'accepted', note: 'اعتماد جماعي آمن: نفس بصمة القرار', source_id: row.app?.id || null, persistent: true } }));
        } else failed.push(String(row.number || 'غير معروف'));
      });
    }
    const message = failed.length ? `تم اعتماد ${success}/${candidates.length}. لم تُعتمد: ${failed.join('، ')}` : `تم اعتماد ${success}/${candidates.length} بنجاح.`;
    setBulkState({ key: '', running: false, message });
    setState((old) => ({ ...old, error: failed.length ? message : '' }));
  };

  const acceptAllSafe = () => acceptRows(safeBulkRows, 'all_safe');
  const acceptGroup = (group) => acceptRows(group?.rows || [], group?.key || 'group');

  const verifiedSave = (updatedRow) => {
    const key = rowKey(updatedRow);
    setState((old) => ({ ...old, rows: old.rows.map((item) => rowKey(item) === key ? updatedRow : item) }));
    setDecisions((old) => ({ ...old, [key]: { action: 'saved', note: 'تم الحفظ الذري والتحقق بإعادة القراءة', source_id: updatedRow.app?.id || null } }));
    selectNext(updatedRow);
    setReviewRow(null);
  };

  const reviewFile = async (file) => {
    if (!file) return;
    setState({ loading: true, error: '', fileName: file.name, rows: [], meta: null });
    setDecisions({}); setReviewRow(null); setSelectedKey(''); setQueueFilter('actionable'); setSearch(''); setBranchFilter('all'); setBulkState({ key: '', running: false, message: '' }); setShowBulkGroups(false);
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

      const acceptedFingerprints = await loadBconnectAcceptances(rows);
      const restoredDecisions = {};
      rows.forEach((row) => {
        const fingerprint = bconnectAcceptanceFingerprint(row);
        if (fingerprint && acceptedFingerprints.has(fingerprint)) restoredDecisions[rowKey(row)] = { action: 'accepted', note: 'اعتماد محفوظ سابقًا', source_id: row.app?.id || null, persistent: true };
      });
      setDecisions(restoredDecisions);
      setState({ loading: false, error: '', fileName: file.name, rows, meta: { ...parsed.meta, global_lookup: true, branch_scoped_identity: true, atomic_edit_enabled: true, atomic_create_enabled: true, persistent_acceptance_enabled: true } });
    } catch (error) {
      setState({ loading: false, error: error?.message || 'تعذر مراجعة الملف.', fileName: file.name, rows: [], meta: null });
    }
  };

  const renderFocus = () => {
    if (!selectedRow) return <Card className="flex min-h-[360px] items-center justify-center border-slate-200 bg-white"><div className="text-center"><CheckCircle2 className="mx-auto h-9 w-9 text-emerald-500" /><div className="mt-3 text-base font-black text-slate-700">لا توجد حالات في هذا المسار</div><div className="mt-1 text-xs text-slate-400">غيّر الفلتر أو ابدأ بملف جديد.</div></div></Card>;
    const view = buildBConnectPurchaseDecision(selectedRow);
    const branch = normalizeBranch(selectedRow.bconnect?.branch || selectedRow.app?.branch) || 'فرع غير معروف';
    const actionLabel = view.fastAccept ? 'اعتماد وانتقل' : view.lane === 'correct' ? 'فتح التصحيح' : view.lane === 'explain' ? 'مراجعة الفرق' : view.lane === 'register' ? 'تسجيل الفاتورة' : view.lane === 'investigate' ? 'فتح التحقيق' : 'فتح التفاصيل';
    const appSupplier = selectedRow.app?.supplier_name || '—';
    const sourceSupplier = selectedRow.bconnect?.supplier || '—';

    return <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-white px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3"><span className="font-mono text-3xl font-black text-slate-950">{selectedRow.number}</span><DecisionBadge view={view} large /></div>
            <div className="mt-2 text-xl font-black text-slate-900">{sourceSupplier}</div>
            <div className="mt-1 text-xs font-bold text-slate-400">{branch}</div>
          </div>
          <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-left text-xs font-bold text-slate-500">{formatArabicDate(selectedRow.bconnect?.date)}</div>
        </div>
      </div>

      <div className="space-y-4 p-5 md:p-6">
        <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3"><DecisionFacts view={view} large /></div>

        {view.financialDifference !== null && view.financialDifference !== 0 && <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[11px] font-bold text-slate-400">B-Connect</div><div className="mt-1 text-xl font-black text-slate-900">{money(view.bconnectTotal)} ج</div></div>
          <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[11px] font-bold text-slate-400">التطبيق</div><div className="mt-1 text-xl font-black text-slate-900">{money(view.appTotal)} ج</div></div>
          <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-3"><div className="text-[11px] font-bold text-rose-500">الفرق</div><div className="mt-1 text-xl font-black text-rose-700">{money(Math.abs(view.financialDifference))} ج</div></div>
        </div>}

        {(view.supplierMismatch || view.dateMismatch) && <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {view.supplierMismatch && <div className="grid gap-2 px-4 py-3 md:grid-cols-[100px_1fr_1fr]"><div className="text-xs font-black text-slate-500">المورد</div><div><span className="text-[10px] text-slate-400">B-Connect</span><div className="text-sm font-black text-slate-800">{sourceSupplier}</div></div><div><span className="text-[10px] text-slate-400">التطبيق</span><div className="text-sm font-black text-slate-800">{appSupplier}</div></div></div>}
          {view.dateMismatch && <div className="grid gap-2 px-4 py-3 md:grid-cols-[100px_1fr_1fr]"><div className="text-xs font-black text-slate-500">التاريخ</div><div className="text-sm font-black text-slate-800">{formatArabicDate(selectedRow.bconnect?.date)}</div><div className="text-sm font-black text-slate-800">{formatArabicDate(selectedRow.app?.invoice_date)}</div></div>}
        </div>}

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <Button type="button" size="lg" className="min-w-48 bg-teal-700 text-white hover:bg-teal-800" disabled={bulkState.running} onClick={() => view.fastAccept ? acceptAsIs(selectedRow) : setReviewRow(selectedRow)}>{actionLabel}</Button>
          <Button type="button" variant="outline" className="border-slate-200 text-slate-600" onClick={() => {
            const index = queueRows.findIndex((row) => rowKey(row) === rowKey(selectedRow));
            const next = queueRows[index + 1] || queueRows[index - 1];
            if (next) setSelectedKey(rowKey(next));
          }}>تخطي الآن</Button>
        </div>
      </div>
    </Card>;
  };

  return <div dir="rtl" className="min-h-full space-y-3 bg-slate-50/40 p-3 md:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-black text-slate-950">مراجعة B-Connect</h1>{state.fileName && <div className="mt-1 text-xs font-bold text-slate-400">{state.fileName} · {state.rows.length} فاتورة</div>}</div>
      <div className="flex items-center gap-2"><Button asChild variant="outline" size="sm" className="border-slate-200 bg-white"><Link to="/invoices">الفواتير <ChevronLeft className="mr-1 h-4 w-4" /></Link></Button><label className="inline-flex h-9 cursor-pointer items-center rounded-md bg-teal-700 px-3 text-xs font-black text-white hover:bg-teal-800"><Upload className="ml-1.5 h-4 w-4" />{state.fileName ? 'ملف جديد' : 'اختيار ملف'}<input type="file" accept=".xlsx,.xls" className="hidden" disabled={state.loading} onChange={(event) => reviewFile(event.target.files?.[0])} /></label></div>
    </div>

    {state.loading && <Card className="border-slate-200 bg-white p-5 text-center text-sm font-bold text-slate-600">جاري تحليل الملف...</Card>}
    {state.error && <div className="rounded-xl border border-rose-100 bg-rose-50/60 px-4 py-3 text-sm font-bold text-rose-700">{state.error}</div>}

    {!!state.rows.length && <>
      <Card className="overflow-hidden border-slate-200 bg-white shadow-none">
        <div className="grid divide-y divide-slate-100 md:grid-cols-4 md:divide-x md:divide-x-reverse md:divide-y-0">
          <div className="p-4">
            <div className="text-[11px] font-black text-slate-500">اعتماد جماعي آمن</div>
            <div className="mt-1 flex items-end justify-between gap-3"><div><div className="text-3xl font-black text-emerald-700">{safeBulkRows.length}</div><div className="mt-0.5 text-[10px] font-bold text-slate-400">من {counts.approve} حالة اعتماد</div></div><Button type="button" size="sm" className="bg-teal-700 text-white hover:bg-teal-800" disabled={!safeBulkRows.length || bulkState.running} onClick={acceptAllSafe}>{bulkState.running && bulkState.key === 'all_safe' ? 'جاري...' : safeBulkRows.length ? `اعتماد ${safeBulkRows.length}` : 'لا يوجد'}</Button></div>
          </div>
          <button type="button" onClick={() => setQueueFilter('approve')} className="p-4 text-right transition hover:bg-slate-50"><div className="text-[11px] font-black text-slate-500">اعتماد فردي</div><div className="mt-1 text-3xl font-black text-slate-800">{individualApproveCount}</div></button>
          <button type="button" onClick={() => setQueueFilter('needs')} className="p-4 text-right transition hover:bg-slate-50"><div className="text-[11px] font-black text-slate-500">تحتاج قرار</div><div className="mt-1 text-3xl font-black text-amber-700">{counts.needs}</div></button>
          <button type="button" onClick={() => setQueueFilter('investigate')} className="p-4 text-right transition hover:bg-slate-50"><div className="text-[11px] font-black text-slate-500">تحقيق</div><div className="mt-1 text-3xl font-black text-rose-700">{counts.investigate}</div><div className="mt-0.5 text-[10px] font-bold text-slate-400">مكتمل {counts.done}</div></button>
        </div>
      </Card>

      {bulkState.message && <div className="rounded-lg border border-slate-100 bg-white px-4 py-2 text-xs font-bold text-slate-600">{bulkState.message}</div>}

      {decisionGroups.length > 0 && <div className="flex justify-end"><button type="button" onClick={() => setShowBulkGroups((old) => !old)} className="text-xs font-black text-slate-500 transition hover:text-slate-800"><Layers3 className="ml-1 inline h-4 w-4" />{showBulkGroups ? 'إخفاء تفاصيل الاعتماد الجماعي' : `مراجعة مجموعات الاعتماد (${decisionGroups.length})`}</button></div>}

      {showBulkGroups && <Card className="overflow-hidden border-slate-200 bg-white shadow-none"><div className="divide-y divide-slate-100">{decisionGroups.map((group) => <div key={group.key} className="flex flex-wrap items-center gap-3 px-4 py-3"><div className="min-w-0 flex-1"><div className="text-sm font-black text-slate-800">{group.rows.length} فاتورة · {group.description}</div><div className="mt-0.5 text-[11px] text-slate-400">{group.branch}</div></div><Button type="button" size="sm" variant="outline" className="border-slate-200 text-teal-700" disabled={bulkState.running} onClick={() => acceptGroup(group)}>{`اعتماد ${group.rows.length}`}</Button></div>)}</div></Card>}

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="overflow-hidden border-slate-200 bg-white shadow-none lg:sticky lg:top-3 lg:self-start">
          <div className="border-b border-slate-100 bg-white p-3">
            <div className="flex items-center justify-between"><div><div className="text-sm font-black text-slate-900">طابور القرار</div><div className="text-[11px] font-bold text-slate-400">{queueRows.length} حالة ظاهرة</div></div><CircleDollarSign className="h-5 w-5 text-slate-300" /></div>
            <div className="mt-3 grid grid-cols-4 gap-1 text-[10px] font-black">
              {[['actionable','المهم'],['needs','قرار'],['approve','اعتماد'],['investigate','تحقيق']].map(([key,label]) => <button key={key} type="button" onClick={() => { setQueueFilter(key); setSelectedKey(''); }} className={`rounded-lg px-2 py-2 transition ${queueFilter === key ? 'bg-teal-50 text-teal-800 ring-1 ring-teal-200' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>{label}</button>)}
            </div>
            <div className="mt-2 flex gap-2"><label className="relative flex-1"><Search className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث" className="h-9 w-full rounded-lg border border-slate-200 bg-white pr-8 pl-2 text-xs outline-none focus:border-teal-300" /></label><select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="h-9 max-w-28 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-600"><option value="all">كل الفروع</option>{branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}</select></div>
          </div>
          <div className="max-h-[620px] divide-y divide-slate-100 overflow-y-auto">{queueRows.map((row) => {
            const view = buildBConnectPurchaseDecision(row);
            const active = selectedRow && rowKey(selectedRow) === rowKey(row);
            return <button key={rowKey(row)} type="button" onClick={() => setSelectedKey(rowKey(row))} className={`w-full border-r-2 px-3 py-3 text-right transition ${active ? 'border-teal-500 bg-teal-50/60' : 'border-transparent bg-white hover:bg-slate-50'}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-mono text-sm font-black text-slate-900">{row.number}</div><div className="mt-1 truncate text-xs font-black text-slate-700">{row.bconnect?.supplier || row.app?.supplier_name || 'مورد غير معروف'}</div></div><DecisionBadge view={view} /></div><div className="mt-2"><DecisionFacts view={view} /></div></button>;
          })}{!queueRows.length && <div className="p-8 text-center text-xs font-bold text-slate-400">لا توجد حالات هنا.</div>}</div>
        </Card>

        {renderFocus()}
      </div>
    </>}

    {!state.rows.length && !state.loading && <Card className="border-slate-200 bg-white p-14 text-center shadow-none"><Upload className="mx-auto h-9 w-9 text-slate-300" /><div className="mt-3 text-lg font-black text-slate-800">ارفع ملف B-Connect</div><div className="mt-1 text-xs text-slate-400">هتظهر أمامك القرارات المهمة مباشرة، بدون جدول مزدحم.</div></Card>}

    <BConnectReviewModal row={reviewRow} onClose={() => setReviewRow(null)} onMarkReviewed={markReviewed} onAcceptAsIs={acceptAsIs} onVerifiedSave={verifiedSave} />
  </div>;
}