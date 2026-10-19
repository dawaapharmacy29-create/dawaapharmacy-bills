import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, Layers3, Search, Upload } from 'lucide-react';
import { performanceApi } from '@/api/base44Client';
import { bconnectAcceptanceFingerprint, loadBconnectAcceptances, saveBconnectAcceptance } from '@/api/bconnectReviewAcceptanceClient';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import BConnectReviewModal from '@/components/bconnect/BConnectReviewModal';
import BConnectInvoiceIdentity from '@/components/bconnect/BConnectInvoiceIdentity';
import { describeBConnectInvoiceTimestamp } from '@/lib/bconnectInvoiceTimestamp';
import { parseBConnectWorkbook } from '@/lib/bconnectPurchaseInvoiceParser';
import { reconcilePurchaseInvoice } from '@/lib/purchaseInvoiceReconciliation';
import { normalizeBranch, normalizeInvoiceNumber, normalizeMoney } from '@/lib/purchaseInvoiceTruth';
import { buildBConnectDecisionGroups, buildBConnectPurchaseDecision } from '@/lib/bconnectPurchaseDecisionView';
import { hasUploadedReturns, matchesReviewSearch, needsReturnInspection, reviewAttentionSummary, reviewQueuePriority } from '@/lib/bconnectReviewQueue';

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
  approve: { label: 'اعتماد', dot: 'bg-teal-500', text: 'text-teal-800', bg: 'bg-teal-50' },
  correct: { label: 'تصحيح', dot: 'bg-amber-500', text: 'text-amber-800', bg: 'bg-amber-50' },
  explain: { label: 'فرق مالي', dot: 'bg-rose-500', text: 'text-rose-800', bg: 'bg-rose-50' },
  register: { label: 'تسجيل', dot: 'bg-sky-500', text: 'text-sky-800', bg: 'bg-sky-50' },
  investigate: { label: 'تحقيق', dot: 'bg-rose-600', text: 'text-rose-800', bg: 'bg-rose-50' },
  clean: { label: 'سليم', dot: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-slate-50' },
};

function DecisionBadge({ view, large = false }) {
  const meta = laneMeta[view.lane] || laneMeta.clean;
  return <span className={`inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white font-black text-slate-700 ${large ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-[11px]'}`}>
    <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
    {meta.label}
    <span className="font-bold text-slate-400">{view.confidence?.score ?? 0}%</span>
  </span>;
}

function DecisionFacts({ view, large = false }) {
  const facts = [];
  if (view.returnIssue) facts.push({ text: view.returnDifference === null ? 'مرتجع غير مؤكد بالتطبيق' : `فرق مرتجع ${money(Math.abs(view.returnDifference))} ج`, className: 'border-amber-200 bg-amber-50 text-amber-800' });
  if (view.financialDifference !== null && view.financialDifference !== 0 && facts.length < 3) facts.push(view.toleranceAccepted
    ? { text: `فرق مقبول ${money(Math.abs(view.financialDifference))} ج (±5 ج)`, className: 'border-teal-100 bg-teal-50 text-teal-800' }
    : { text: `فرق ${money(Math.abs(view.financialDifference))} ج`, className: 'border-rose-100 bg-rose-50 text-rose-700' });
  if (view.evidence?.label && facts.length < 3) facts.push({ text: view.evidence.label, className: 'border-slate-200 bg-slate-50 text-slate-600' });
  if (view.supplierMismatch && facts.length < 3) facts.push({ text: 'المورد مختلف', className: 'border-amber-100 bg-amber-50 text-amber-700' });
  if (view.dateMismatch && facts.length < 3) facts.push({ text: view.dateDifferenceDays === null ? 'التاريخ مختلف' : `التاريخ ±${Math.abs(view.dateDifferenceDays)} يوم`, className: 'border-amber-100 bg-amber-50 text-amber-700' });
  if (view.hasReturn && facts.length < 3) facts.push({ text: `مرتجع ${money(view.returnedValue ?? view.sourceReturnValue)} ج`, className: 'border-sky-100 bg-sky-50 text-sky-700' });
  if (view.hasNote && facts.length < 3) facts.push({ text: 'ملاحظة مسجلة', className: 'border-slate-200 bg-slate-50 text-slate-600' });
  return <div className={`flex flex-wrap gap-1.5 font-bold ${large ? 'text-xs' : 'text-[10px]'}`}>
    {facts.map((fact) => <span key={fact.text} className={`rounded-full border px-2.5 py-1 ${fact.className}`}>{fact.text}</span>)}
    {!facts.length && <span className={`rounded-full border px-2.5 py-1 ${view.lane === "investigate" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{view.lane === "investigate" ? "التحقيق بسبب أدلة الربط، وليس فرقًا ماليًا مؤكدًا" : view.lane === "clean" ? "لا اختلافات مؤثرة" : "راجع سبب القرار بالأعلى"}</span>}
  </div>;
}

function StatItem({ label, value, hint, active, onClick, action }) {
  const body = <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
    <div className={`min-w-9 text-center text-xl font-black tabular-nums ${active ? 'text-teal-700' : 'text-slate-900'}`}>{value}</div>
    <div className="min-w-0 flex-1">
      <div className="truncate text-[11px] font-black text-slate-600">{label}</div>
      {hint && <div className="mt-0.5 truncate text-[10px] font-bold text-slate-400">{hint}</div>}
    </div>
    {action}
  </div>;
  if (!onClick) return <div className="min-w-0">{body}</div>;
  return <button type="button" onClick={onClick} className={`min-w-0 text-right transition hover:bg-slate-50 ${active ? 'bg-teal-50/60' : ''}`}>{body}</button>;
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
  const [dragActive, setDragActive] = useState(false);

  const branches = useMemo(() => [...new Set(state.rows.map((row) => normalizeBranch(row.bconnect?.branch || row.app?.branch)).filter(Boolean))], [state.rows]);
  const unacceptedRows = useMemo(() => state.rows.filter((row) => decisions[rowKey(row)]?.action !== 'accepted'), [state.rows, decisions]);
  const decisionGroups = useMemo(() => buildBConnectDecisionGroups(unacceptedRows), [unacceptedRows]);
  const safeBulkRows = useMemo(() => {
    const seen = new Set();
    const rows = [];
    decisionGroups.forEach((group) => group.rows.forEach((row) => {
      const key = rowKey(row);
      if (!seen.has(key)) { seen.add(key); rows.push(row); }
    }));
    return rows;
  }, [decisionGroups]);
  const safeBulkKeys = useMemo(() => new Set(safeBulkRows.map(rowKey)), [safeBulkRows]);

  const counts = useMemo(() => {
    const result = { approve: 0, needs: 0, investigate: 0, done: 0 };
    state.rows.forEach((row) => {
      const action = decisions[rowKey(row)]?.action;
      const view = buildBConnectPurchaseDecision(row);
      if (action === 'accepted' || (view.lane === 'clean' && !needsReturnInspection(row, decisions, rowKey(row)))) result.done += 1;
      else if (view.lane === 'approve') result.approve += 1;
      else if (view.lane === 'investigate') result.investigate += 1;
      else if (['correct', 'explain', 'register'].includes(view.lane)) result.needs += 1;
    });
    return result;
  }, [state.rows, decisions]);

  const individualApproveCount = Math.max(0, counts.approve - safeBulkRows.length);
  const returnSummary = useMemo(
    () => reviewAttentionSummary(state.rows, decisions, rowKey),
    [state.rows, decisions]
  );

  const queueRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return state.rows.filter((row) => {
      const key = rowKey(row);
      const action = decisions[key]?.action;
      const view = buildBConnectPurchaseDecision(row);
      const branch = normalizeBranch(row.bconnect?.branch || row.app?.branch);
      if (branchFilter !== 'all' && branch !== branchFilter) return false;
      if (!matchesReviewSearch(row, query) && !String(view.note || '').toLowerCase().includes(query)) return false;
      const returnPending = needsReturnInspection(row, decisions, key);
      if (queueFilter === 'returns') return hasUploadedReturns(row);
      if (queueFilter === 'done') return action === 'accepted' || (view.lane === 'clean' && !returnPending);
      // Reviewing a disputed invoice is NOT a correction or acceptance.
      // Only clean returned invoices can leave the pending queue after inspection.
      if (action === 'accepted' || (view.lane === 'clean' && !returnPending)) return false;
      if (queueFilter === 'needs') return ['correct', 'explain', 'register'].includes(view.lane);
      if (queueFilter === 'investigate') return view.lane === 'investigate';
      if (queueFilter === 'approve') return view.lane === 'approve' && !safeBulkKeys.has(key) && !returnPending;
      return returnPending || ['correct', 'explain', 'register', 'investigate'].includes(view.lane) || (view.lane === 'approve' && !safeBulkKeys.has(key));
    }).sort((a, b) => {
      const aPriority = reviewQueuePriority(a, buildBConnectPurchaseDecision(a));
      const bPriority = reviewQueuePriority(b, buildBConnectPurchaseDecision(b));
      if (aPriority !== bPriority) return aPriority - bPriority;
      return String(a.number || '').localeCompare(String(b.number || ''), 'ar', { numeric: true });
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
    setDecisions((old) => ({ ...old, [key]: { action: 'reviewed', note: hasUploadedReturns(row) ? 'تم فحص المرتجع في جلسة المراجعة الحالية فقط' : 'تمت المراجعة داخل نافذة B-Connect', source_id: row.app?.id || null } }));
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
      setDecisions((old) => ({ ...old, [key]: { action: 'accepted', note: 'اعتماد دائم: مراجعة اختلاف المورد/التاريخ كما هو', source_id: row.app?.id || null } }));
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

  const reviewFiles = async (selectedFiles) => {
    const files = Array.from(selectedFiles || []);
    if (!files.length || state.loading) return;
    const fileName = files.length === 1 ? files[0].name : files.length + ' ملفات Excel';
    const invalidType = files.find((file) => !/\.xlsx?$/i.test(String(file.name || '')));
    if (invalidType) {
      setState((old) => ({ ...old, error: 'صيغة غير مدعومة: ' + invalidType.name + '. استخدم xlsx أو xls.' }));
      return;
    }
    setState({ loading: true, error: '', fileName, rows: [], meta: null });
    setDecisions({}); setReviewRow(null); setSelectedKey(''); setQueueFilter('actionable'); setSearch(''); setBranchFilter('all'); setBulkState({ key: '', running: false, message: '' }); setShowBulkGroups(false);

    try {
      const sources = [];
      const fileSummaries = [];
      for (const file of files) {
        let parsed;
        try { parsed = parseBConnectWorkbook(await file.arrayBuffer()); }
        catch (error) { throw new Error('تعذر قراءة "' + file.name + '": ' + (error?.message || 'صيغة ملف غير صالحة')); }
        if (!parsed.valid) throw new Error('الملف "' + file.name + '": ' + (parsed.warnings?.join(' ') || 'تقرير B-Connect غير صالح.'));
        fileSummaries.push({
          name: file.name, invoice_count: parsed.invoices.length,
          item_line_count: parsed.meta?.item_line_count || 0,
          returned_item_line_count: parsed.meta?.returned_item_line_count || 0,
          report_format: parsed.meta?.report_format || 'standard',
        });
        sources.push(...parsed.invoices.map((row) => ({ ...row, source_file: file.name })));
      }

      // Identity is (branch, invoice number), not file or supplier. Reject
      // overlapping files before reconciliation; never hide duplicate rows.
      const occurrences = new Map();
      for (const source of sources) {
        const key = invoiceScopeKey(source.branch, source.serial);
        occurrences.set(key, (occurrences.get(key) || 0) + 1);
      }
      const duplicateKeys = [...occurrences.entries()].filter(([, count]) => count > 1).map(([key]) => key);
      if (duplicateKeys.length) {
        throw new Error('فواتير مكررة بين الملفات أو داخلها (' + duplicateKeys.length + '): ' +
          duplicateKeys.slice(0, 12).join('، ') +
          (duplicateKeys.length > 12 ? ' …' : '') +
          '. راجع الملفات المتداخلة؛ لم تُعتمد أي فاتورة.');
      }

      const numbers = [...new Set(sources.map((row) => normalizeInvoiceNumber(row.serial)).filter(Boolean))];
      if (!numbers.length) throw new Error('الملفات لا تحتوي على أرقام فواتير صالحة للمراجعة.');
      const globalLookup = new Map();
      // The secure RPC has bounded request sizes. Verify every response;
      // never treat an incomplete chunk as proof that a record is missing.
      for (let offset = 0; offset < numbers.length; offset += 150) {
        const batch = numbers.slice(offset, offset + 150);
        const checked = await performanceApi.bconnectInvoiceNumbers(batch);
        if (!Array.isArray(checked)) throw new Error('تعذر التحقق الشامل من أرقام الفواتير.');
        const pairs = checked.map((entry) => [normalizeInvoiceNumber(entry?.number), entry]);
        const returned = pairs.map(([number]) => number);
        if (returned.length !== batch.length || new Set(returned).size !== returned.length ||
            returned.some((number) => !number || !batch.includes(number))) {
          throw new Error('نتيجة البحث الشامل ناقصة أو متعارضة؛ لا يمكن اعتماد المطابقة.');
        }
        pairs.forEach(([number, entry]) => globalLookup.set(number, entry));
      }

      const rows = sources.map((source) => {
        const number = normalizeInvoiceNumber(source.serial);
        const branch = normalizeBranch(source.branch);
        const gate = globalLookup.get(number);
        const recordCount = gate?.record_count == null ? NaN : Number(gate.record_count);
        const authorizedRows = Array.isArray(gate?.rows) ? gate.rows : [];
        const problem = (identity, reason) => ({ number, bconnect: source, app: null, status: 'problem', identity, reasons: [reason], financial: { difference: null } });
        if (!branch) return problem('unverified', 'فرع B-Connect غير معروف؛ لا يمكن تكوين هوية الفاتورة بأمان.');
        if (source.detail_total_difference !== null && source.detail_total_difference !== undefined && Math.abs(source.detail_total_difference) > 0.02) return problem('detail_total_mismatch', 'إجمالي تفاصيل الأصناف مختلف عن قيمة الفاتورة بفارق ' + Math.abs(source.detail_total_difference).toFixed(2) + ' ج؛ يلزم مراجعة الفاتورة قبل الاعتماد.');
        if (!gate || !Number.isSafeInteger(recordCount) || recordCount < 0) return problem('unverified', 'التحقق الشامل غير مكتمل لهذا الرقم؛ ممنوع الاعتماد.');
        if (!Array.isArray(gate?.rows) || authorizedRows.length > recordCount) return problem('unverified', 'تفاصيل الاستجابة الشاملة غير مكتملة؛ ممنوع الاعتماد.');
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

      const acceptedFingerprints = new Set();
      for (let offset = 0; offset < rows.length; offset += 150) {
        const accepted = await loadBconnectAcceptances(rows.slice(offset, offset + 150));
        accepted.forEach((fingerprint) => acceptedFingerprints.add(fingerprint));
      }
      const restoredDecisions = {};
      rows.forEach((row) => {
        const fingerprint = bconnectAcceptanceFingerprint(row);
        // A previously accepted supplier/date drift must never conceal newly
        // detected returns. Keep these rows visible for individual review.
        const view = buildBConnectPurchaseDecision(row);
        if (fingerprint && acceptedFingerprints.has(fingerprint) && !view.hasReturn &&
            (view.lane === 'approve' || view.lane === 'clean')) {
          restoredDecisions[rowKey(row)] = { action: 'accepted', note: 'اعتماد محفوظ سابقًا', source_id: row.app?.id || null, persistent: true };
        }
      });
      setDecisions(restoredDecisions);
      setState({
        loading: false, error: '', fileName, rows,
        meta: {
          files: fileSummaries, invoice_count: rows.length,
          item_line_count: fileSummaries.reduce((sum, file) => sum + file.item_line_count, 0),
          returned_item_line_count: fileSummaries.reduce((sum, file) => sum + file.returned_item_line_count, 0),
          global_lookup: true,
          branch_scoped_identity: true, atomic_edit_enabled: true, atomic_create_enabled: true,
          persistent_acceptance_enabled: true },
      });
    } catch (error) {
      setState({ loading: false, error: error?.message || 'تعذر مراجعة الملفات.', fileName, rows: [], meta: null });
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (state.loading) return;
    const files = event.dataTransfer?.files;
    if (files?.length) reviewFiles(files);
  };

  const renderFocus = () => {
    if (!selectedRow) return <Card className="flex min-h-[330px] items-center justify-center border-slate-200 bg-white shadow-none"><div className="text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-teal-500" /><div className="mt-3 text-sm font-black text-slate-700">لا توجد حالات في هذا المسار</div><div className="mt-1 text-xs text-slate-400">غيّر المسار أو ابدأ بملف جديد.</div></div></Card>;
    const view = buildBConnectPurchaseDecision(selectedRow);
    const meta = laneMeta[view.lane] || laneMeta.clean;
    const branch = normalizeBranch(selectedRow.bconnect?.branch || selectedRow.app?.branch) || 'فرع غير معروف';
    const pendingReturn = needsReturnInspection(selectedRow, decisions, rowKey(selectedRow));
    const actionLabel = pendingReturn && view.lane === 'clean' ? 'فحص تفاصيل المرتجع'
      : view.fastAccept ? 'اعتماد وانتقل'
      : view.lane === 'correct' ? 'فتح التصحيح' : view.lane === 'explain' ? 'مراجعة الفرق'
      : view.lane === 'register' ? 'تسجيل الفاتورة' : view.lane === 'investigate' ? 'فتح التحقيق' : 'فتح التفاصيل';
    const appSupplier = selectedRow.app?.supplier_name || '—';
    const sourceSupplier = selectedRow.bconnect?.supplier || '—';
    const sourceEnteredBy = selectedRow.bconnect?.user || 'غير مسجل';
    const appEnteredBy = selectedRow.app ? (selectedRow.app?.entered_by_name || selectedRow.app?.entered_by || 'غير مسجل') : 'الفاتورة غير موجودة بالتطبيق';

    return <Card className="overflow-hidden border-slate-200 bg-white shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5"><span className="font-mono text-2xl font-black text-slate-950">{selectedRow.number}</span><DecisionBadge view={view} large /></div>
          <div className="mt-1 text-[11px] font-bold text-slate-500">{branch} · المورد والتاريخ والتوقيت بالأسفل</div>
          <div className="mt-2 text-xs font-semibold text-slate-600">{pendingReturn && view.lane === 'clean' ? 'إجمالي الفاتورة مطابق؛ مرتجع المورد محتاج فحص السطور فقط.' : view.instruction}</div>
        </div>
        <div className={`rounded-full px-3 py-1 text-[11px] font-black ${meta.bg} ${meta.text}`}>القرار الآن: {meta.label}</div>
      </div>

      <div className="space-y-3 p-4 md:p-5">
        <BConnectInvoiceIdentity invoice={selectedRow} compact />
        <DecisionFacts view={view} large />
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs md:grid-cols-3">
          <div><div className="font-bold text-slate-400">أصناف الملف</div><div className="mt-1 font-black text-slate-800">{Array.isArray(selectedRow.bconnect?.items) ? selectedRow.bconnect.items.length : 'غير متاحة'}</div></div>
          <div><div className="font-bold text-slate-400">المرتجعات</div><div className={'mt-1 font-black ' + (hasUploadedReturns(selectedRow) ? 'text-rose-700' : 'text-slate-800')}>{hasUploadedReturns(selectedRow) ? (selectedRow.bconnect?.returned_items_count || 'موجودة') : 'لا يوجد في الملف'}</div></div>
          <div><div className="font-bold text-slate-400">الخطوة المقترحة</div><div className="mt-1 font-black text-teal-800">{actionLabel}</div></div>
        </div>
        {Array.isArray(selectedRow.bconnect?.items) && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-100 bg-teal-50/50 px-3 py-2">
          <span className="text-xs font-black text-teal-900">{selectedRow.bconnect.items.length} سطر صنف{selectedRow.bconnect.returned_items_count > 0 ? ' · ' + selectedRow.bconnect.returned_items_count + ' أصناف بها مرتجع' : ''}</span>
          <button type="button" onClick={() => setReviewRow(selectedRow)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-black text-teal-700 shadow-sm hover:bg-teal-100">عرض الأصناف والمرتجعات</button>
        </div>}

        {view.financialDifference !== null && view.financialDifference !== 0 && <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3">
          <div><span className="text-[10px] font-bold text-slate-400">B-Connect</span><div className="text-base font-black text-slate-900">{money(view.bconnectTotal)} ج</div></div>
          <div><span className="text-[10px] font-bold text-slate-400">التطبيق</span><div className="text-base font-black text-slate-900">{money(view.appTotal)} ج</div></div>
          <div className="mr-auto border-r border-slate-200 pr-5"><span className={`text-[10px] font-bold ${view.toleranceAccepted ? "text-teal-600" : "text-rose-500"}`}>{view.toleranceAccepted ? "فرق مقبول ±5 ج" : "الفرق"}</span><div className={`text-base font-black ${view.toleranceAccepted ? "text-teal-700" : "text-rose-700"}`}>{money(Math.abs(view.financialDifference))} ج</div></div>
        </div>}

        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {view.supplierMismatch && <div className="grid items-center gap-2 px-4 py-2.5 md:grid-cols-[80px_1fr_1fr]"><div className="text-[11px] font-black text-slate-500">المورد</div><div className="truncate text-xs font-black text-slate-800"><span className="ml-1 font-bold text-slate-400">B:</span>{sourceSupplier}</div><div className="truncate text-xs font-black text-slate-800"><span className="ml-1 font-bold text-slate-400">التطبيق:</span>{appSupplier}</div></div>}
          {view.dateMismatch && <div className="grid items-center gap-2 px-4 py-2.5 md:grid-cols-[80px_1fr_1fr]"><div className="text-[11px] font-black text-slate-500">التاريخ</div><div className="text-xs font-black text-slate-800">{formatArabicDate(selectedRow.bconnect?.date)}</div><div className="text-xs font-black text-slate-800">{formatArabicDate(selectedRow.app?.invoice_date)}</div></div>}
          <div className="grid items-center gap-2 px-4 py-2.5 md:grid-cols-[80px_1fr_1fr]">
            <div className="text-[11px] font-black text-slate-500">مدخل الفاتورة</div>
            <div className="truncate text-xs font-black text-slate-800"><span className="ml-1 font-bold text-slate-400">B-Connect:</span>{sourceEnteredBy}</div>
            <div className="truncate text-xs font-black text-slate-800"><span className="ml-1 font-bold text-slate-400">التطبيق:</span>{appEnteredBy}</div>
          </div>
        </div>

        <div className="sticky bottom-0 -mx-4 -mb-4 mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur md:-mx-5 md:-mb-5 md:px-5">
          <Button type="button" className="min-w-44 bg-teal-700 text-white hover:bg-teal-800" disabled={bulkState.running} onClick={() => view.fastAccept ? acceptAsIs(selectedRow) : setReviewRow(selectedRow)}>{actionLabel}</Button>
          <Button type="button" variant="ghost" className="text-slate-500 hover:bg-slate-50" onClick={() => {
            const index = queueRows.findIndex((row) => rowKey(row) === rowKey(selectedRow));
            const next = queueRows[index + 1] || queueRows[index - 1];
            if (next) setSelectedKey(rowKey(next));
          }}>تخطي</Button>
          <span className="mr-auto text-[10px] font-bold text-slate-400">{queueRows.length} حالة في المسار</span>
        </div>
      </div>
    </Card>;
  };

  return <div dir="rtl" className="min-h-full bg-slate-50/30 p-3 md:p-4">
    <div className="mx-auto max-w-[1500px] space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-black text-slate-950">مراجعة B-Connect</h1>{state.fileName && <div className="mt-0.5 text-[11px] font-bold text-slate-400">{state.fileName} · {state.rows.length} فاتورة{state.meta?.item_line_count ? ' · ' + state.meta.item_line_count + ' سطر صنف · ' + state.meta.returned_item_line_count + ' سطور مرتجع' : ''}</div>}{state.meta?.files?.length > 1 && <div className="mt-1 text-[10px] font-bold text-slate-500">{state.meta.files.map((file) => file.name + ' (' + file.invoice_count + ')').join(' · ')}</div>}</div>
        <div className="flex items-center gap-2"><Button asChild variant="ghost" size="sm" className="text-slate-600"><Link to="/invoices">الفواتير <ChevronLeft className="mr-1 h-4 w-4" /></Link></Button><label className="inline-flex h-9 cursor-pointer items-center rounded-lg bg-teal-700 px-3 text-xs font-black text-white transition hover:bg-teal-800"><Upload className="ml-1.5 h-4 w-4" />{state.fileName ? 'تغيير الملفات' : 'اختيار ملفات'}<input type="file" multiple accept=".xlsx,.xls" className="hidden" disabled={state.loading} onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; reviewFiles(files); }} /></label></div>
      </div>

      {state.loading && <Card className="border-slate-200 bg-white p-4 text-center text-sm font-bold text-slate-600 shadow-none">جاري تحليل الملفات والتحقق من الفواتير...</Card>}
      {state.error && <div className="rounded-lg border border-rose-100 bg-rose-50/70 px-4 py-2.5 text-xs font-bold text-rose-700">{state.error}</div>}

      {!!state.rows.length && <>
        <Card className="overflow-hidden border-slate-200 bg-white shadow-none">
          <div className="grid divide-y divide-slate-100 md:grid-cols-5 md:divide-x md:divide-x-reverse md:divide-y-0">
            <StatItem label="اعتماد جماعي آمن" value={safeBulkRows.length} hint={`من ${counts.approve} حالة اعتماد`} active={safeBulkRows.length > 0} action={<Button type="button" size="sm" className="h-8 bg-teal-700 px-3 text-[11px] text-white hover:bg-teal-800" disabled={!safeBulkRows.length || bulkState.running} onClick={acceptAllSafe}>{bulkState.running && bulkState.key === 'all_safe' ? 'جاري...' : 'اعتماد الكل'}</Button>} />
            <StatItem label="اعتماد فردي" value={individualApproveCount} active={queueFilter === 'approve'} onClick={() => { setQueueFilter('approve'); setSelectedKey(''); }} />
            <StatItem label="تحتاج قرار" value={counts.needs} active={queueFilter === 'needs'} onClick={() => { setQueueFilter('needs'); setSelectedKey(''); }} />
            <StatItem label="تحقيق" value={counts.investigate} hint={`مكتمل ${counts.done}`} active={queueFilter === 'investigate'} onClick={() => { setQueueFilter('investigate'); setSelectedKey(''); }} />
            <StatItem label="مرتجعات للفحص" value={returnSummary.returnsToInspect} hint={`من ${returnSummary.returnsTotal} فاتورة بها مرتجع`} active={queueFilter === 'returns'} onClick={() => { setQueueFilter('returns'); setSelectedKey(''); }} />
          </div>
        </Card>

        <div className="flex min-h-8 items-center justify-between gap-3">
          <div className="text-[11px] font-bold text-slate-500">{bulkState.message}</div>
          {decisionGroups.length > 0 && <button type="button" onClick={() => setShowBulkGroups((old) => !old)} className="text-[11px] font-black text-slate-500 transition hover:text-slate-800"><Layers3 className="ml-1 inline h-3.5 w-3.5" />{showBulkGroups ? 'إخفاء المجموعات' : `مجموعات الاعتماد ${decisionGroups.length}`}</button>}
        </div>

        {showBulkGroups && <Card className="overflow-hidden border-slate-200 bg-white shadow-none"><div className="divide-y divide-slate-100">{decisionGroups.map((group) => <div key={group.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5"><div className="min-w-0 flex-1"><div className="text-xs font-black text-slate-800">{group.rows.length} فاتورة · {group.description}</div><div className="mt-0.5 text-[10px] text-slate-400">{group.branch}</div></div><Button type="button" size="sm" variant="ghost" className="h-8 text-[11px] text-teal-700 hover:bg-teal-50" disabled={bulkState.running} onClick={() => acceptGroup(group)}>{`اعتماد ${group.rows.length}`}</Button></div>)}</div></Card>}

        <div className="grid gap-3 lg:grid-cols-[390px_minmax(0,1fr)]">
          <Card className="overflow-hidden border-slate-200 bg-white shadow-none lg:sticky lg:top-3 lg:self-start">
            <div className="border-b border-slate-100 p-3">
              <div className="flex items-center gap-2">
                <label className="relative min-w-0 flex-1"><Search className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="رقم فاتورة أو صنف أو كود أو مورد" className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50/50 pr-8 pl-2 text-xs outline-none transition focus:border-teal-300 focus:bg-white" /></label>
                <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="h-9 max-w-28 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-bold text-slate-600"><option value="all">كل الفروع</option>{branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}</select>
              </div>
              <div className="mt-2 flex items-center gap-1 overflow-x-auto text-[10px] font-black">
                {[['actionable','المهم'],['returns','مرتجعات'],['needs','قرار'],['approve','اعتماد'],['investigate','تحقيق'],['done','تم']].map(([key,label]) => <button key={key} type="button" onClick={() => { setQueueFilter(key); setSelectedKey(''); }} className={`whitespace-nowrap rounded-full px-3 py-1.5 transition ${queueFilter === key ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{label}</button>)}
                <span className="mr-auto whitespace-nowrap text-slate-400">{queueRows.length} حالة</span>
              </div>
            </div>
            <div className="max-h-[610px] divide-y divide-slate-100 overflow-y-auto">{queueRows.map((row) => {
              const view = buildBConnectPurchaseDecision(row);
              const invoiceStamp = describeBConnectInvoiceTimestamp(row.bconnect?.date);
              const active = selectedRow && rowKey(selectedRow) === rowKey(row);
              return <button key={rowKey(row)} type="button" onClick={() => setSelectedKey(rowKey(row))} className={`w-full border-r-[3px] px-3 py-2.5 text-right transition ${active ? 'border-teal-500 bg-teal-50/45' : 'border-transparent bg-white hover:bg-slate-50'}`}>
                <div className="flex items-start gap-2.5"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-mono text-sm font-black text-slate-900">{row.number}</span><DecisionBadge view={view} />{hasUploadedReturns(row) && <span className="rounded-md border border-rose-100 bg-rose-50 px-1.5 py-0.5 text-[10px] font-black text-rose-700">{decisions[rowKey(row)]?.action === 'reviewed' ? 'مرتجع فُحص' : 'مرتجع للفحص'}</span>}</div><div className="mt-1 truncate text-xs font-black text-slate-700" title={row.bconnect?.supplier || ''}><span className="font-semibold text-slate-400">المورد: </span>{row.bconnect?.supplier || row.app?.supplier_name || 'غير مسجل'}</div><div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-bold text-slate-500"><span>{invoiceStamp.date}</span><span>• {invoiceStamp.hasTime ? invoiceStamp.time : 'الوقت غير مسجل'}</span></div>{state.meta?.files?.length > 1 && <div className="mt-0.5 truncate text-[10px] text-slate-400">{row.bconnect?.source_file}</div>}{Array.isArray(row.bconnect?.items) && <div className="mt-0.5 text-[10px] font-bold text-teal-700">{row.bconnect.items.length} صنف{row.bconnect.returned_items_count > 0 ? ' · مرتجع ' + row.bconnect.returned_items_count : ''}</div>}<div className="mt-1.5"><DecisionFacts view={view} /></div></div></div>
              </button>;
            })}{!queueRows.length && <div className="p-8 text-center text-xs font-bold text-slate-400">لا توجد حالات هنا.</div>}</div>
          </Card>

          {renderFocus()}
        </div>
      </>}

      {!state.rows.length && !state.loading && <label
        className="block cursor-pointer"
        onDragEnter={(event) => { event.preventDefault(); event.stopPropagation(); setDragActive(true); }}
        onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setDragActive(true); }}
        onDragLeave={(event) => { event.preventDefault(); event.stopPropagation(); setDragActive(false); }}
        onDrop={handleDrop}
      >
        <Card className={`border-2 border-dashed p-12 text-center shadow-none transition-all ${dragActive ? 'border-teal-500 bg-teal-50/70 ring-4 ring-teal-100' : 'border-slate-200 bg-white hover:border-teal-300 hover:bg-teal-50/20'}`}>
          <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full transition ${dragActive ? 'bg-teal-100 text-teal-700' : 'bg-slate-50 text-slate-300'}`}><Upload className="h-6 w-6" /></div>
          <div className="mt-4 text-base font-black text-slate-800">{dragActive ? 'سيب الملفات هنا' : 'ارفع ملفات B-Connect'}</div>
          <div className="mt-1 text-xs font-bold text-slate-500">اسحب ملفات Excel هنا، أو اضغط لاختيار أكتر من ملف في نفس المرة</div>
          <div className="mt-2 text-[10px] font-bold text-slate-400">xlsx أو xls · فحص جماعي مع كشف الفواتير المكررة بين الملفات</div>
          <input type="file" multiple accept=".xlsx,.xls" className="hidden" disabled={state.loading} onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; reviewFiles(files); }} />
        </Card>
      </label>}

      <BConnectReviewModal row={reviewRow} onClose={() => setReviewRow(null)} onMarkReviewed={markReviewed} onAcceptAsIs={acceptAsIs} onVerifiedSave={verifiedSave} />
    </div>
  </div>;
}
