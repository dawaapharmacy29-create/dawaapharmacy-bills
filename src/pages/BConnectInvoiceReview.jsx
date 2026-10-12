import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, CircleDollarSign, FilePlus2, Layers3, Search, ShieldAlert, Upload } from 'lucide-react';
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

const laneConfig = {
  approve: { label: 'اعتماد', tone: 'green' },
  correct: { label: 'تصحيح', tone: 'amber' },
  explain: { label: 'راجع الفرق', tone: 'red' },
  register: { label: 'تسجيل', tone: 'blue' },
  investigate: { label: 'تحقيق', tone: 'red' },
  clean: { label: 'سليم', tone: 'slate' },
};

const laneTone = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  red: 'border-rose-200 bg-rose-50 text-rose-800',
  blue: 'border-sky-200 bg-sky-50 text-sky-800',
  slate: 'border-slate-200 bg-white text-slate-700',
};

const confidenceTone = {
  very_high: 'text-emerald-700',
  high: 'text-teal-700',
  high_explanation: 'text-amber-700',
  medium: 'text-amber-700',
  low: 'text-rose-700',
  blocked: 'text-slate-500',
};

const primaryViews = {
  approve: { label: 'جاهز للاعتماد', icon: CheckCircle2, tone: 'green' },
  needs: { label: 'يحتاج قرار', icon: CircleDollarSign, tone: 'amber' },
  investigate: { label: 'تحقيق', icon: ShieldAlert, tone: 'red' },
  done: { label: 'مكتمل', icon: CheckCircle2, tone: 'slate' },
};

const needsFilters = [
  { key: 'all', label: 'الكل' },
  { key: 'correct', label: 'تصحيح' },
  { key: 'explain', label: 'فرق مالي' },
  { key: 'register', label: 'تسجيل' },
];

function DecisionMark({ view }) {
  const tone = laneConfig[view.lane]?.tone || 'slate';
  return <div className="flex items-center gap-2">
    <span className={`rounded-lg border px-2.5 py-1 text-xs font-black ${laneTone[tone]}`}>{laneConfig[view.lane]?.label || view.label}</span>
    <span className={`text-[11px] font-black ${confidenceTone[view.confidence?.code] || confidenceTone.low}`}>{view.confidence?.score ?? 0}%</span>
  </div>;
}

function CoreFacts({ view }) {
  const facts = [];
  if (view.financialDifference !== null && view.financialDifference !== 0) facts.push({ text: `فرق ${money(Math.abs(view.financialDifference))} ج`, className: 'text-rose-700' });
  if (view.evidence?.label && facts.length < 3) facts.push({ text: view.evidence.label, className: view.evidenceConfidence === 'high' ? 'text-emerald-700' : 'text-amber-700' });
  if (view.supplierMismatch && facts.length < 3) facts.push({ text: 'مورد مختلف', className: 'text-amber-700' });
  if (view.dateMismatch && facts.length < 3) facts.push({ text: view.dateDifferenceDays === null ? 'تاريخ مختلف' : `فرق تاريخ ${Math.abs(view.dateDifferenceDays)} يوم`, className: 'text-amber-700' });
  if (view.hasReturn && facts.length < 3) facts.push({ text: `مرتجع ${money(view.returnedValue ?? view.sourceReturnValue)} ج`, className: 'text-sky-700' });
  if (view.hasNote && facts.length < 3) facts.push({ text: 'ملاحظة', className: 'text-violet-700' });
  return <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-black">
    {facts.slice(0, 3).map((fact) => <span key={fact.text} className={fact.className}>{fact.text}</span>)}
    {!facts.length && <span className="text-slate-400">لا فرق مؤثر</span>}
  </div>;
}

export default function BConnectInvoiceReview() {
  const [state, setState] = useState({ loading: false, error: '', fileName: '', rows: [], meta: null });
  const [activeView, setActiveView] = useState('approve');
  const [needsFilter, setNeedsFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
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

  const operationalCounts = useMemo(() => {
    const counts = { approve: 0, needs: 0, investigate: 0, done: 0, correct: 0, explain: 0, register: 0 };
    state.rows.forEach((row) => {
      const action = decisions[rowKey(row)]?.action;
      const view = buildBConnectPurchaseDecision(row);
      if (action === 'accepted' || view.lane === 'clean') {
        counts.done += 1;
        return;
      }
      if (view.lane === 'approve') counts.approve += 1;
      else if (view.lane === 'investigate') counts.investigate += 1;
      else if (['correct', 'explain', 'register'].includes(view.lane)) {
        counts.needs += 1;
        counts[view.lane] += 1;
      }
    });
    return counts;
  }, [state.rows, decisions]);

  const visible = useMemo(() => state.rows.filter((row) => {
    const key = rowKey(row);
    const action = decisions[key]?.action;
    const view = buildBConnectPurchaseDecision(row);

    if (activeView === 'approve') {
      if (action === 'accepted' || view.lane !== 'approve') return false;
    } else if (activeView === 'needs') {
      if (action === 'accepted' || !['correct', 'explain', 'register'].includes(view.lane)) return false;
      if (needsFilter !== 'all' && view.lane !== needsFilter) return false;
    } else if (activeView === 'investigate') {
      if (action === 'accepted' || view.lane !== 'investigate') return false;
    } else if (activeView === 'done') {
      if (action !== 'accepted' && view.lane !== 'clean') return false;
    }

    const branch = normalizeBranch(row.bconnect?.branch || row.app?.branch);
    if (branchFilter !== 'all' && branch !== branchFilter) return false;
    const query = search.trim().toLowerCase();
    return !query || [row.number, row.bconnect?.supplier, row.app?.supplier_name, row.bconnect?.user, row.app?.entered_by_name, row.app?.entered_by, view.note].some((value) => String(value ?? '').toLowerCase().includes(query));
  }), [state.rows, activeView, needsFilter, branchFilter, search, decisions]);

  const markReviewed = (row) => {
    if (!row) return;
    const key = rowKey(row);
    setDecisions((old) => ({ ...old, [key]: { action: 'reviewed', note: 'تمت المراجعة داخل نافذة B-Connect', source_id: row.app?.id || null } }));
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
        } else {
          failed.push(String(row.number || 'غير معروف'));
        }
      });
    }

    const message = failed.length
      ? `تم اعتماد ${success}/${candidates.length}. لم تُعتمد: ${failed.join('، ')}`
      : `تم اعتماد ${success}/${candidates.length} بنجاح.`;
    setBulkState({ key: '', running: false, message });
    setState((old) => ({ ...old, error: failed.length ? message : '' }));
  };

  const acceptGroup = (group) => acceptRows(group?.rows || [], group?.key || 'group');
  const acceptAllSafe = () => acceptRows(safeBulkRows, 'all_safe');

  const verifiedSave = (updatedRow) => {
    const key = rowKey(updatedRow);
    setState((old) => ({ ...old, rows: old.rows.map((item) => rowKey(item) === key ? updatedRow : item) }));
    setDecisions((old) => ({ ...old, [key]: { action: 'saved', note: 'تم الحفظ الذري والتحقق بإعادة القراءة', source_id: updatedRow.app?.id || null } }));
    setReviewRow(updatedRow);
  };

  const reviewFile = async (file) => {
    if (!file) return;
    setState({ loading: true, error: '', fileName: file.name, rows: [], meta: null });
    setDecisions({}); setReviewRow(null); setActiveView('approve'); setNeedsFilter('all'); setSearch(''); setBranchFilter('all'); setBulkState({ key: '', running: false, message: '' }); setShowBulkGroups(false);
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

      const initialCounts = { approve: 0, needs: 0, investigate: 0 };
      rows.forEach((row) => {
        const view = buildBConnectPurchaseDecision(row);
        if (view.lane === 'approve') initialCounts.approve += 1;
        else if (['correct', 'explain', 'register'].includes(view.lane)) initialCounts.needs += 1;
        else if (view.lane === 'investigate') initialCounts.investigate += 1;
      });
      setActiveView(initialCounts.approve ? 'approve' : initialCounts.needs ? 'needs' : initialCounts.investigate ? 'investigate' : 'done');
      setState({ loading: false, error: '', fileName: file.name, rows, meta: { ...parsed.meta, global_lookup: true, branch_scoped_identity: true, atomic_edit_enabled: true, atomic_create_enabled: true, persistent_acceptance_enabled: true } });
    } catch (error) {
      setState({ loading: false, error: error?.message || 'تعذر مراجعة الملف.', fileName: file.name, rows: [], meta: null });
    }
  };

  return <div dir="rtl" className="space-y-3 p-3 md:p-5">
    <div className="flex items-center justify-between gap-3">
      <div><h1 className="text-xl font-black text-slate-900">قرارات مشتريات B-Connect</h1>{state.fileName && <div className="mt-0.5 text-xs text-slate-400">{state.fileName} · {state.rows.length} فاتورة</div>}</div>
      <div className="flex items-center gap-2"><Button asChild variant="outline" size="sm"><Link to="/invoices">الفواتير <ChevronLeft className="mr-1 h-4 w-4" /></Link></Button><label className="inline-flex h-9 cursor-pointer items-center rounded-md bg-slate-900 px-3 text-xs font-black text-white hover:bg-slate-800"><Upload className="ml-1.5 h-4 w-4" />{state.fileName ? 'ملف جديد' : 'اختيار ملف'}<input type="file" accept=".xlsx,.xls" className="hidden" disabled={state.loading} onChange={(event) => reviewFile(event.target.files?.[0])} /></label></div>
    </div>

    {state.loading && <Card className="p-4 text-center text-sm font-bold text-slate-600">جاري تحليل الملف...</Card>}
    {state.error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{state.error}</div>}

    {!!state.rows.length && <>
      <Card className="overflow-hidden border-slate-200">
        <div className="flex flex-wrap items-center gap-1.5 p-2">
          {Object.entries(primaryViews).map(([key, item]) => {
            const Icon = item.icon;
            return <button key={key} type="button" onClick={() => setActiveView(key)} className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-black transition ${activeView === key ? laneTone[item.tone] : 'border-transparent bg-white text-slate-500 hover:bg-slate-50'}`}><Icon className="h-3.5 w-3.5" /><span>{item.label}</span><strong className="rounded-md bg-black/5 px-1.5 py-0.5">{operationalCounts[key]}</strong></button>;
          })}
          <div className="mr-auto flex items-center gap-2">
            <label className="relative hidden sm:block"><Search className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث..." className="h-9 w-44 rounded-lg border bg-white pr-8 pl-2 text-xs" /></label>
            <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="h-9 rounded-lg border bg-white px-2 text-xs font-bold"><option value="all">كل الفروع</option>{branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}</select>
          </div>
        </div>
        {activeView === 'needs' && <div className="flex flex-wrap items-center gap-1.5 border-t bg-slate-50/60 px-2 py-1.5">{needsFilters.map((item) => <button key={item.key} type="button" onClick={() => setNeedsFilter(item.key)} className={`rounded-md px-2.5 py-1.5 text-[11px] font-black ${needsFilter === item.key ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-white'}`}>{item.label}{item.key !== 'all' && <span className="mr-1 opacity-70">{operationalCounts[item.key]}</span>}</button>)}</div>}
      </Card>

      {activeView === 'approve' && safeBulkRows.length > 0 && <Card className="overflow-hidden border-emerald-200">
        <div className="flex flex-wrap items-center gap-3 bg-emerald-50 px-3 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2"><Layers3 className="h-4 w-4 shrink-0 text-emerald-700" /><div className="min-w-0"><div className="truncate text-sm font-black text-emerald-950">{safeBulkRows.length} فاتورة جاهزة للاعتماد الآمن</div><div className="text-[11px] font-bold text-emerald-700">لا فرق مالي · لا تكرار · نفس قواعد الأمان</div></div></div>
          {bulkState.message && <span className="text-xs font-bold text-slate-600">{bulkState.message}</span>}
          <button type="button" onClick={() => setShowBulkGroups((old) => !old)} className="text-xs font-black text-emerald-800 underline-offset-2 hover:underline">{showBulkGroups ? 'إخفاء المجموعات' : `راجع المجموعات (${decisionGroups.length})`}</button>
          <Button type="button" size="sm" disabled={bulkState.running} onClick={acceptAllSafe}>{bulkState.running && bulkState.key === 'all_safe' ? 'جاري الاعتماد...' : `اعتماد الـ${safeBulkRows.length} الآمنة`}</Button>
        </div>
        {showBulkGroups && <div className="divide-y border-t">{decisionGroups.map((group) => <div key={group.key} className="flex flex-wrap items-center gap-2 px-3 py-2"><div className="min-w-0 flex-1 text-xs"><strong className="text-slate-900">{group.rows.length} فاتورة</strong><span className="mr-2 text-slate-500">{group.description}</span><span className="mr-2 text-slate-400">{group.branch}</span></div><Button type="button" size="sm" variant="outline" disabled={bulkState.running} onClick={() => acceptGroup(group)}>{bulkState.running && bulkState.key === group.key ? 'جاري...' : `اعتماد ${group.rows.length}`}</Button></div>)}</div>}
      </Card>}

      <Card className="overflow-hidden border-slate-200">
        <div className="divide-y">{visible.map((row, index) => {
          const key = rowKey(row);
          const view = buildBConnectPurchaseDecision(row);
          const accepted = decisions[key]?.action === 'accepted';
          const actionLabel = view.fastAccept && !accepted ? 'اعتماد' : view.lane === 'register' ? 'تسجيل' : view.lane === 'correct' ? 'تصحيح' : view.lane === 'explain' ? 'راجع الفرق' : view.lane === 'investigate' ? 'تحقيق' : 'تفاصيل';
          return <div key={`${key}-${index}`} role="button" tabIndex={0} onClick={() => setReviewRow(row)} onKeyDown={(event) => { if (event.key === 'Enter') setReviewRow(row); }} className="grid cursor-pointer gap-2 bg-white px-3 py-2.5 transition hover:bg-slate-50 md:grid-cols-[190px_110px_minmax(260px,1fr)] md:items-center">
            <div className="flex items-center gap-2 md:flex-col md:items-stretch">
              <DecisionMark view={view} />
              <Button type="button" size="sm" className="h-8 md:w-full" variant={view.fastAccept && !accepted ? 'default' : 'outline'} onClick={(event) => { event.stopPropagation(); if (view.fastAccept && !accepted) acceptAsIs(row); else setReviewRow(row); }}>{actionLabel}</Button>
            </div>
            <div><div className="font-mono text-base font-black text-slate-950">{row.number}</div><div className="text-[11px] font-bold text-slate-400">{normalizeBranch(row.bconnect?.branch || row.app?.branch) || 'فرع غير معروف'}</div>{accepted && <div className="mt-0.5 text-[10px] font-black text-emerald-700">✓ محفوظ</div>}</div>
            <div className="min-w-0"><div className="truncate text-sm font-black text-slate-800">{row.bconnect?.supplier || row.app?.supplier_name || 'مورد غير معروف'}</div><div className="mt-0.5 text-[11px] text-slate-500"><strong>{money(view.bconnectTotal)} ج</strong> · {formatArabicDate(row.bconnect?.date)}</div><div className="mt-1"><CoreFacts view={view} /></div></div>
          </div>;
        })}{!visible.length && <div className="px-4 py-12 text-center text-sm font-bold text-slate-400">لا توجد حالات هنا.</div>}</div>
      </Card>
    </>}

    {!state.rows.length && !state.loading && <Card className="border-dashed p-10 text-center"><Upload className="mx-auto h-7 w-7 text-slate-300" /><div className="mt-2 font-black text-slate-700">ارفع ملف B-Connect</div><div className="mt-1 text-xs text-slate-400">ستظهر القرارات مباشرة بدون خطوات إضافية.</div></Card>}

    <BConnectReviewModal row={reviewRow} onClose={() => setReviewRow(null)} onMarkReviewed={markReviewed} onAcceptAsIs={acceptAsIs} onVerifiedSave={verifiedSave} />
  </div>;
}
