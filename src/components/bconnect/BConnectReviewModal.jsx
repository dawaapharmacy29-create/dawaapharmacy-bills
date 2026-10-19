import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ShieldCheck, Sparkles, X, XCircle } from 'lucide-react';
import { base44, performanceApi } from '@/api/base44Client';
import { bconnectAtomicCreate } from '@/api/bconnectAtomicCreateClient';
import { Button } from '@/components/ui/button';
import BConnectSupplierSuggestions from '@/components/bconnect/BConnectSupplierSuggestions';
import BConnectInvoiceItems from '@/components/bconnect/BConnectInvoiceItems';
import { hasUploadedReturns } from '@/lib/bconnectReviewQueue';
import { prepareBconnectWriteCommand } from '@/lib/bconnectAtomicInvoiceCommand';
import { buildBConnectFormHandoff } from '@/lib/bconnectInvoiceFormHandoff';
import { classifyBConnectReviewRow } from '@/lib/bconnectReviewDecisionPolicy';
import { buildBConnectPurchaseDecision } from '@/lib/bconnectPurchaseDecisionView';
import { reconcilePurchaseInvoice } from '@/lib/purchaseInvoiceReconciliation';
import { normalizeBranch, normalizeInvoiceNumber, normalizeMoney } from '@/lib/purchaseInvoiceTruth';

const labels = { clean: 'سليم', review: 'تحتاج مراجعة', problem: 'مشكلة' };
const icons = { clean: CheckCircle2, review: AlertTriangle, problem: XCircle };
const dateOnly = (value) => String(value || '').slice(0, 10);
const fieldText = (value) => value === null || value === undefined ? '' : String(value);
const normalizedMoneyOrNull = (value) => value === '' || value === null || value === undefined ? null : normalizeMoney(value);
const normalizeUserName = (value) => String(value ?? '')
  .normalize('NFKC')
  .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
  .replace(/[أإآ]/g, 'ا')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const money = (value) => {
  const normalized = normalizeMoney(value);
  if (normalized === null) return '—';
  return normalized.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
};

function formatArabicDate(value) {
  const iso = dateOnly(value);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value || '—';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function writeErrorText(error) {
  const code = String(error?.message || error || '');
  const map = {
    stale_revision: 'الفاتورة اتعدلت من مكان آخر. أعد فتحها قبل الحفظ.',
    legacy_identity_collision: 'رقم الفاتورة مكرر داخل نفس الفرع؛ يلزم تحقيق يدوي.',
    invoice_already_exists: 'الفاتورة اتسجلت بالفعل في نفس الفرع. أعد رفع الملف.',
    invalid_payment_type: 'اختر طريقة الدفع: آجل أو كاش.',
    forbidden: 'صلاحيتك الحالية لا تسمح بهذه العملية.',
    forbidden_edit: 'صلاحيتك الحالية لا تسمح بتعديل هذه الفاتورة.',
    forbidden_branch: 'صلاحيتك لا تشمل هذا الفرع.',
    invalid_supplier: 'اختر موردًا مسجلًا ومؤكدًا.',
    source_review_required: 'مصدر الفاتورة يحتاج مراجعة قبل التعديل.',
    identity_change_forbidden: 'رقم الفاتورة والفرع ثابتان ولا يمكن تغييرهما.',
    invalid_invoice: 'راجع التاريخ والإجمالي والمرتجع والنقدي.',
    invalid_request: 'بيانات الحفظ غير مكتملة أو غير صالحة.',
    invalid_session: 'انتهت جلسة الدخول. سجل الدخول مرة أخرى.',
    idempotency_conflict: 'حدث تعارض أثناء الحفظ. أعد فتح الفاتورة.',
    empty_edit_patch: 'لا يوجد تعديل جديد للحفظ.',
  };
  return map[code] || code || 'تعذر حفظ الفاتورة.';
}

function StatusBadge({ row }) {
  const decision = classifyBConnectReviewRow(row);
  const Icon = icons[row.status] || AlertTriangle;
  const special = decision.code === 'missing'
    ? { label: 'ناقصة', style: 'bg-sky-50 text-sky-700 border-sky-200' }
    : decision.code === 'duplicate'
      ? { label: 'تكرار', style: 'bg-rose-50 text-rose-700 border-rose-200' }
      : decision.code === 'blocked'
        ? { label: 'محجوبة', style: 'bg-slate-100 text-slate-700 border-slate-300' }
        : null;
  const base = {
    clean: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    review: 'bg-amber-50 text-amber-700 border-amber-200',
    problem: 'bg-rose-50 text-rose-700 border-rose-200',
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${special?.style || base[row.status]}`}>
    <Icon className="h-3.5 w-3.5" />{special?.label || labels[row.status]}
  </span>;
}

function CompareValue({ label, source, current, moneyValue = false, normalize, display, comparison }) {
  const sourceKnown = source !== null && source !== undefined && source !== '';
  const currentKnown = current !== null && current !== undefined && current !== '';
  const normalizedSource = sourceKnown ? (normalize ? normalize(source) : source) : null;
  const normalizedCurrent = currentKnown ? (normalize ? normalize(current) : current) : null;
  const comparable = comparison ? comparison !== 'unknown' : sourceKnown && currentKnown && normalizedSource !== null && normalizedCurrent !== null;
  const same = comparison ? comparison === 'match' : comparable && String(normalizedSource) === String(normalizedCurrent);
  const acceptable = comparison === 'acceptable';
  const format = (value, known) => {
    if (!known) return 'غير متاح';
    if (display) return display(value);
    if (moneyValue) return money(value) === '—' ? 'غير متاح' : `${money(value)} ج`;
    return value || 'غير متاح';
  };
  return <div className={`grid gap-2 rounded-xl border px-3 py-2.5 md:grid-cols-[110px_1fr_1fr] ${!comparable ? 'border-slate-200 bg-slate-50' : acceptable ? 'border-teal-200 bg-teal-50/40' : same ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50/60'}`}>
    <div className="text-xs font-black text-slate-700">{label}</div>
    <div><div className="text-[10px] text-slate-400">B-Connect</div><div className="mt-0.5 break-words text-sm font-bold">{format(source, sourceKnown)}</div></div>
    <div><div className="text-[10px] text-slate-400">التطبيق</div><div className="mt-0.5 break-words text-sm font-bold">{format(current, currentKnown)}</div></div>
  </div>;
}

function buildChangedPatch(app, draft) {
  const patch = {};
  if (String(draft.supplier_id || '') !== String(app.supplier_id || '') || String(draft.supplier_name || '') !== String(app.supplier_name || '')) {
    patch.supplier_id = String(draft.supplier_id || '');
    patch.supplier_name = String(draft.supplier_name || '');
  }
  if (dateOnly(draft.invoice_date) !== dateOnly(app.invoice_date)) patch.invoice_date = draft.invoice_date;
  if (normalizedMoneyOrNull(draft.total_value) !== normalizedMoneyOrNull(app.total_value)) patch.total_value = draft.total_value;
  if (draft.returned_value !== '' && normalizedMoneyOrNull(draft.returned_value) !== normalizedMoneyOrNull(app.returned_value)) patch.returned_value = draft.returned_value;
  if (draft.cash_amount !== '' && normalizedMoneyOrNull(draft.cash_amount) !== normalizedMoneyOrNull(app.cash_amount)) patch.cash_amount = draft.cash_amount;
  if (String(draft.payment_type || '') !== String(app.payment_type || '')) patch.payment_type = draft.payment_type || null;
  if (String(draft.notes || '') !== String(app.notes || '')) patch.notes = draft.notes || null;
  return patch;
}

function buildCreatePayload(row, draft) {
  return {
    system_invoice_number: row.number,
    branch: normalizeBranch(row.bconnect?.branch),
    supplier_id: draft.supplier_id,
    supplier_name: draft.supplier_name,
    invoice_date: draft.invoice_date,
    total_value: draft.total_value,
    returned_value: draft.returned_value === '' ? 0 : draft.returned_value,
    cash_amount: draft.cash_amount === '' ? 0 : draft.cash_amount,
    payment_type: draft.payment_type,
    notes: draft.notes || 'تم التسجيل من مراجعة B-Connect.',
  };
}

export default function BConnectReviewModal({ row, onClose, onMarkReviewed, onAcceptAsIs, onVerifiedSave }) {
  const [draft, setDraft] = useState({ supplier_id: '', supplier_name: '', invoice_date: '', total_value: '', returned_value: '', cash_amount: '', payment_type: '', notes: '' });
  const [suppliers, setSuppliers] = useState([]);
  const [supplierError, setSupplierError] = useState('');
  const [saveState, setSaveState] = useState({ saving: false, error: '', success: '' });
  const [showAllDetails, setShowAllDetails] = useState(false);

  useEffect(() => {
    if (!row) return;
    const app = row.app || {};
    const source = row.bconnect || {};
    const existing = !!app.id;
    setDraft({
      supplier_id: app.supplier_id || '',
      supplier_name: app.supplier_name || '',
      invoice_date: existing ? dateOnly(app.invoice_date) : dateOnly(source.date),
      total_value: existing ? fieldText(app.total_value) : fieldText(source.invoice_value),
      returned_value: existing ? fieldText(app.returned_value) : fieldText(source.return_value),
      cash_amount: existing ? fieldText(app.cash_amount) : '',
      payment_type: app.payment_type || '',
      notes: app.notes || '',
    });
    setSaveState({ saving: false, error: '', success: '' });
    setShowAllDetails(false);
  }, [row]);

  useEffect(() => {
    let active = true;
    base44.entities.Supplier.list('name', 5000, 0)
      .then((rows) => { if (active) setSuppliers(Array.isArray(rows) ? rows.filter((item) => item?.id && item?.name) : []); })
      .catch((error) => { if (active) setSupplierError(error?.message || 'تعذر تحميل الموردين'); });
    return () => { active = false; };
  }, []);

  const context = useMemo(() => {
    if (!row) return null;
    const handoff = buildBConnectFormHandoff(row);
    const blocked = !handoff || ['duplicate_app', 'duplicate_bconnect', 'unverified', 'unauthorized_or_incomplete', 'conflict'].includes(row.identity);
    const readOnly = row.status === 'clean';
    const isCreate = handoff?.mode === 'create';
    const revision = Number(row.app?.bconnect_revision_v1);
    return { handoff, blocked, readOnly, isCreate, revision, hasRevision: Number.isSafeInteger(revision) && revision >= 1 };
  }, [row]);

  if (!row || !context) return null;
  const { blocked, readOnly, isCreate, revision, hasRevision } = context;
  const app = row.app || {};
  const source = row.bconnect || {};
  const decisionView = buildBConnectPurchaseDecision(row);
  const returnInspection = hasUploadedReturns(row);
  const canMarkReturnInspected = context.readOnly && returnInspection;
  const appEnteredBy = app.entered_by_name || app.entered_by || '';
  const supplierComparison = row.checks?.supplier || 'unknown';
  const supplierChoices = app.supplier_id && !suppliers.some((supplier) => String(supplier.id) === String(app.supplier_id))
    ? [{ id: app.supplier_id, name: app.supplier_name || 'المورد المسجل' }, ...suppliers]
    : suppliers;
  const fieldsDisabled = blocked || readOnly || saveState.saving;
  const changedPatch = buildChangedPatch(app, draft);
  const changedCount = Object.keys(changedPatch).length;
  const hasChanges = changedCount > 0;
  const canSave = !isCreate && !fieldsDisabled && !!app.id && hasRevision && hasChanges && !!draft.supplier_id && !!draft.supplier_name;
  const createMissingRequirements = isCreate ? [
    !draft.supplier_id || !draft.supplier_name ? 'اختر المورد' : null,
    !draft.invoice_date ? 'حدد التاريخ' : null,
    draft.total_value === '' ? 'راجع الإجمالي' : null,
    !['كاش', 'آجل'].includes(draft.payment_type) ? 'اختر طريقة الدفع' : null,
  ].filter(Boolean) : [];
  const canCreate = isCreate && !blocked && !saveState.saving && createMissingRequirements.length === 0;
  const canAcceptAsIs = decisionView.fastAccept === true && !blocked && !readOnly && !isCreate && !!app.id;

  const sourceReturn = normalizedMoneyOrNull(source.return_value);
  const appReturn = normalizedMoneyOrNull(app.returned_value);
  const returnMismatch = sourceReturn !== null && appReturn !== null && sourceReturn !== appReturn;
  const financialMismatch = decisionView.financialDifference !== null && decisionView.financialDifference !== 0;

  const showBranchCompare = showAllDetails || blocked || row.checks?.branch !== 'match';
  const showSupplierCompare = showAllDetails || decisionView.supplierMismatch;
  const showDateCompare = showAllDetails || decisionView.dateMismatch;
  const showTotalCompare = showAllDetails || financialMismatch;
  const showReturnCompare = showAllDetails || returnMismatch || decisionView.hasReturn;
  const hasFocusedDifference = showBranchCompare || showSupplierCompare || showDateCompare || showTotalCompare || showReturnCompare;

  const showSupplierEditor = isCreate || showAllDetails || decisionView.supplierMismatch;
  const showDateEditor = isCreate || showAllDetails || decisionView.dateMismatch;
  const showTotalEditor = isCreate || showAllDetails || financialMismatch;
  const showReturnEditor = isCreate || showAllDetails || returnMismatch || decisionView.hasReturn;
  const showPaymentEditor = isCreate || showAllDetails;
  const showNotesEditor = isCreate || showAllDetails || decisionView.hasNote;

  const chooseSupplier = (supplierId) => {
    const supplier = supplierChoices.find((item) => String(item.id) === String(supplierId));
    setDraft((old) => ({ ...old, supplier_id: supplier?.id || '', supplier_name: supplier?.name || '' }));
  };

  const applySourceValues = () => {
    if (fieldsDisabled || isCreate) return;
    setDraft((old) => ({
      ...old,
      invoice_date: source.date ? dateOnly(source.date) : old.invoice_date,
      // Do not overwrite an accepted ±5 EGP discrepancy when preparing another correction.
      total_value: decisionView.toleranceAccepted ? old.total_value :
        (source.invoice_value !== null && source.invoice_value !== undefined ? fieldText(source.invoice_value) : old.total_value),
      returned_value: source.return_value !== null && source.return_value !== undefined ? fieldText(source.return_value) : old.returned_value,
    }));
    setSaveState({ saving: false, error: '', success: 'تم تجهيز قيم B-Connect. لو مناسبة اضغط حفظ.' });
  };

  const restoreAppValues = () => {
    if (isCreate) return;
    setDraft({
      supplier_id: app.supplier_id || '',
      supplier_name: app.supplier_name || '',
      invoice_date: dateOnly(app.invoice_date),
      total_value: fieldText(app.total_value),
      returned_value: fieldText(app.returned_value),
      cash_amount: fieldText(app.cash_amount),
      payment_type: app.payment_type || '',
      notes: app.notes || '',
    });
    setSaveState({ saving: false, error: '', success: '' });
  };

  const verifyReadback = async ({ invoiceId, expectedRevision, branch }) => {
    const checked = await performanceApi.bconnectInvoiceNumbers([row.number]);
    const gate = Array.isArray(checked) ? checked.find((entry) => normalizeInvoiceNumber(entry?.number) === normalizeInvoiceNumber(row.number)) : null;
    const refreshedApp = Array.isArray(gate?.rows) ? gate.rows.find((item) => String(item?.id) === String(invoiceId) && normalizeBranch(item?.branch) === branch) : null;
    if (!refreshedApp) throw new Error('تم الحفظ لكن تعذرت إعادة قراءة نفس الفاتورة للتحقق.');
    if (Number(refreshedApp.bconnect_revision_v1) !== Number(expectedRevision)) throw new Error('تم الحفظ لكن رقم النسخة المقروءة لا يطابق نتيجة الحفظ.');
    return refreshedApp;
  };

  const applyVerifiedRow = (refreshedApp) => {
    const reconciled = reconcilePurchaseInvoice(refreshedApp, source);
    const updatedRow = { number: row.number, bconnect: source, app: refreshedApp, ...reconciled };
    onVerifiedSave(updatedRow);
    setDraft({
      supplier_id: refreshedApp.supplier_id || '',
      supplier_name: refreshedApp.supplier_name || '',
      invoice_date: dateOnly(refreshedApp.invoice_date),
      total_value: fieldText(refreshedApp.total_value),
      returned_value: fieldText(refreshedApp.returned_value),
      cash_amount: fieldText(refreshedApp.cash_amount),
      payment_type: refreshedApp.payment_type || '',
      notes: refreshedApp.notes || '',
    });
  };

  const save = async () => {
    const branch = normalizeBranch(source.branch || app.branch);
    setSaveState({ saving: true, error: '', success: '' });
    try {
      const operationId = `bconnect_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`}`;
      const invoice = buildChangedPatch(app, draft);
      if (!Object.keys(invoice).length) throw new Error('empty_edit_patch');
      const command = prepareBconnectWriteCommand({ operationId, mode: 'edit', invoice, recordId: String(app.id || ''), expectedRevision: revision });
      const result = await performanceApi.bconnectAtomicEdit({ operationId: command.operation_id, invoiceId: command.record_id, expectedRevision: command.expected_revision, patch: command.invoice });
      if (!result?.ok || !Number.isSafeInteger(Number(result.revision))) throw new Error('تعذر تأكيد نتيجة الحفظ.');
      const refreshedApp = await verifyReadback({ invoiceId: app.id, expectedRevision: result.revision, branch });
      applyVerifiedRow(refreshedApp);
      setSaveState({ saving: false, error: '', success: 'تم الحفظ والتحقق.' });
    } catch (error) {
      setSaveState({ saving: false, error: writeErrorText(error), success: '' });
    }
  };

  const createMissing = async () => {
    const branch = normalizeBranch(source.branch);
    setSaveState({ saving: true, error: '', success: '' });
    try {
      const operationId = `bconnect_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`}`;
      const command = prepareBconnectWriteCommand({ operationId, mode: 'create', invoice: buildCreatePayload(row, draft) });
      const result = await bconnectAtomicCreate({ operationId: command.operation_id, invoice: command.invoice });
      if (!result?.ok || !result.invoice_id || !Number.isSafeInteger(Number(result.revision))) throw new Error('تعذر تأكيد نتيجة التسجيل.');
      const refreshedApp = await verifyReadback({ invoiceId: result.invoice_id, expectedRevision: result.revision, branch });
      applyVerifiedRow(refreshedApp);
      setSaveState({ saving: false, error: '', success: 'تم التسجيل والتحقق.' });
    } catch (error) {
      setSaveState({ saving: false, error: writeErrorText(error), success: '' });
    }
  };

  return <div className="fixed inset-0 z-[100] flex justify-end bg-slate-950/35 backdrop-blur-[1px]" onMouseDown={(event) => { if (event.target === event.currentTarget && !saveState.saving) onClose(); }}>
    <div dir="rtl" className="flex h-full w-full max-w-5xl flex-col overflow-hidden border-r bg-white shadow-2xl">
      <div className="flex items-center justify-between gap-3 border-b bg-white px-4 py-3 md:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-black">فاتورة {row.number}</h2><StatusBadge row={row} /><span className="text-xs font-bold text-slate-500">{normalizeBranch(source.branch || app.branch) || 'فرع غير معروف'}</span></div>
        </div>
        <Button type="button" variant="ghost" size="sm" disabled={saveState.saving} onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>

      <div className="overflow-y-auto p-4 md:p-5">
        <div className={`rounded-2xl border p-3 ${decisionView.confidence?.code === 'blocked' || decisionView.confidence?.code === 'low' ? 'border-rose-200 bg-rose-50/60' : decisionView.confidence?.code === 'high_explanation' || decisionView.confidence?.code === 'medium' ? 'border-amber-200 bg-amber-50/60' : 'border-emerald-200 bg-emerald-50/60'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><Sparkles className="h-4 w-4" /><strong className="text-base">{decisionView.label}</strong><span className="rounded-full bg-white px-2 py-1 text-[11px] font-black">{decisionView.confidence?.label || 'ثقة منخفضة'}{Number.isFinite(decisionView.confidence?.score) ? ` ${decisionView.confidence.score}%` : ''}</span></div>
              <div className="mt-1 text-sm font-bold text-slate-700">{canMarkReturnInspected ? 'القيم المطابقة سليمة، لكن لازم تراجع أصناف المرتجع وكمياته قبل إغلاق الفحص.' : decisionView.instruction}</div>
              {row.reasons?.length > 0 && <div className="mt-2 text-[11px] leading-5 text-slate-600">{row.reasons.slice(0, 2).join(' · ')}</div>}
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
                {financialMismatch && <span className={`rounded-full px-2 py-1 ${decisionView.toleranceAccepted ? 'bg-teal-100 text-teal-800' : 'bg-rose-100 text-rose-700'}`}>{decisionView.toleranceAccepted ? 'فرق مقبول' : 'فرق'} {money(Math.abs(decisionView.financialDifference))} ج{decisionView.toleranceAccepted ? ' · سماحية ±5 ج' : ''}</span>}
                {decisionView.supplierMismatch && <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">مورد</span>}
                {decisionView.dateMismatch && <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">تاريخ {decisionView.dateDifferenceDays == null ? '' : `${Math.abs(decisionView.dateDifferenceDays)} يوم`}</span>}
                {decisionView.evidence?.label && <span className="rounded-full bg-white px-2 py-1 text-slate-700">{decisionView.evidence.label}</span>}
                {decisionView.hasNote && <span className="rounded-full bg-violet-100 px-2 py-1 text-violet-700">ملاحظة</span>}
                {decisionView.hasReturn && <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-700">مرتجع</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {canAcceptAsIs && <Button type="button" size="sm" disabled={saveState.saving} onClick={() => onAcceptAsIs(row)}>اعتماد الآن</Button>}
              {!isCreate && !blocked && !readOnly && !canAcceptAsIs && <Button type="button" size="sm" variant="outline" disabled={saveState.saving} onClick={applySourceValues}>جهّز التصحيح</Button>}
              {hasChanges && !isCreate && <Button type="button" size="sm" variant="ghost" disabled={saveState.saving} onClick={restoreAppValues}>تراجع</Button>}
            </div>
          </div>
        </div>

        {canMarkReturnInspected && <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900">فحص المرتجع لا يعدّل الفاتورة ولا يُسجّل حركة مخزون. علامة «تم الفحص» مؤقتة لهذه الجلسة فقط.</div>}
        <BConnectInvoiceItems invoice={row} />
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-black">الاختلافات المؤثرة</h3>
              <button type="button" onClick={() => setShowAllDetails((value) => !value)} className="inline-flex items-center gap-1 text-xs font-black text-teal-700">{showAllDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}{showAllDetails ? 'إخفاء المطابق' : 'عرض كل البيانات'}</button>
            </div>

            {!hasFocusedDifference && !showAllDetails && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-bold text-emerald-800">لا توجد فروق مؤثرة إضافية.</div>}
            {showBranchCompare && <CompareValue label="الفرع" source={source.branch} current={app.branch} normalize={normalizeBranch} display={(value) => normalizeBranch(value) || 'غير متاح'} comparison={row.checks?.branch} />}
            {showSupplierCompare && <CompareValue label="المورد" source={source.supplier} current={app.supplier_name} comparison={supplierComparison} />}
            {showDateCompare && <CompareValue label="التاريخ" source={dateOnly(source.date)} current={dateOnly(app.invoice_date)} display={formatArabicDate} comparison={row.checks?.invoice_date} />}
            {showTotalCompare && <CompareValue label="الإجمالي" source={source.invoice_value} current={app.total_value} moneyValue normalize={normalizeMoney} comparison={row.financial?.comparable ? (row.financial?.match ? 'match' : decisionView.toleranceAccepted ? 'acceptable' : 'mismatch') : 'unknown'} />}
            {showReturnCompare && <CompareValue label="المرتجع" source={source.return_value} current={app.returned_value} moneyValue normalize={normalizeMoney} />}
            {showAllDetails && <CompareValue label="المستخدم" source={source.user} current={appEnteredBy} normalize={normalizeUserName} />}
            {showAllDetails && row.reasons?.length > 0 && <div className="rounded-xl border bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-600">{row.reasons.join(' — ')}</div>}
            {decisionView.note && <div className="rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-xs leading-6 text-violet-900"><strong>الملاحظة:</strong> {decisionView.note}</div>}
          </section>

          <section className="rounded-2xl border bg-slate-50/70 p-3 md:p-4">
            <div className="mb-3 flex items-center justify-between gap-2"><div><h3 className="font-black">{isCreate ? 'تسجيل سريع' : 'تصحيح سريع'}</h3><p className="mt-0.5 text-[11px] text-slate-500">تظهر الحقول التي تحتاج قرارك فقط.</p></div><ShieldCheck className="h-5 w-5 text-teal-600" /></div>

            <div className="grid gap-3 sm:grid-cols-2">
              {showAllDetails && <><label className="space-y-1"><span className="text-xs font-bold">رقم الفاتورة</span><input disabled value={row.number || ''} className="h-9 w-full rounded-lg border bg-slate-100 px-3 text-sm" /></label><label className="space-y-1"><span className="text-xs font-bold">الفرع</span><input disabled value={normalizeBranch(source.branch || app.branch) || ''} className="h-9 w-full rounded-lg border bg-slate-100 px-3 text-sm" /></label></>}

              {showSupplierEditor && <div className="sm:col-span-2 rounded-xl border bg-white p-3"><div className="text-xs font-black">المورد</div>{blocked || readOnly ? <div className="mt-1 font-bold">{app.supplier_name || source.supplier || 'غير محدد'}</div> : <select value={draft.supplier_id || ''} onChange={(event) => chooseSupplier(event.target.value)} disabled={saveState.saving} className="mt-2 h-9 w-full rounded-lg border bg-white px-3 text-sm"><option value="">اختر المورد</option>{supplierChoices.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select>}{!blocked && !readOnly && <BConnectSupplierSuggestions sourceName={source.supplier} suppliers={supplierChoices} selectedId={draft.supplier_id} onSelect={chooseSupplier} disabled={saveState.saving} />}{supplierError && <div className="mt-2 text-xs text-rose-600">{supplierError}</div>}</div>}

              {showDateEditor && <label className="space-y-1"><span className="flex items-center justify-between gap-2 text-xs font-bold"><span>التاريخ</span>{!fieldsDisabled && source.date && dateOnly(source.date) !== dateOnly(draft.invoice_date) && <button type="button" onClick={() => setDraft((old) => ({ ...old, invoice_date: dateOnly(source.date) }))} className="text-[11px] font-black text-teal-700">استخدم B-Connect</button>}</span><input type="date" value={draft.invoice_date} onChange={(e) => setDraft((old) => ({ ...old, invoice_date: e.target.value }))} disabled={fieldsDisabled} className="h-9 w-full rounded-lg border bg-white px-3 text-sm disabled:bg-slate-100" /></label>}

              {showTotalEditor && <label className="space-y-1"><span className="flex items-center justify-between gap-2 text-xs font-bold"><span>الإجمالي</span>{!fieldsDisabled && source.invoice_value !== null && source.invoice_value !== undefined && normalizedMoneyOrNull(source.invoice_value) !== normalizedMoneyOrNull(draft.total_value) && <button type="button" onClick={() => setDraft((old) => ({ ...old, total_value: fieldText(source.invoice_value) }))} className="text-[11px] font-black text-teal-700">استخدم B-Connect</button>}</span><input inputMode="decimal" value={draft.total_value} onChange={(e) => setDraft((old) => ({ ...old, total_value: e.target.value }))} disabled={fieldsDisabled} className="h-9 w-full rounded-lg border bg-white px-3 text-sm disabled:bg-slate-100" /></label>}

              {showReturnEditor && <label className="space-y-1"><span className="flex items-center justify-between gap-2 text-xs font-bold"><span>المرتجع</span>{!fieldsDisabled && source.return_value !== null && source.return_value !== undefined && normalizedMoneyOrNull(source.return_value) !== normalizedMoneyOrNull(draft.returned_value) && <button type="button" onClick={() => setDraft((old) => ({ ...old, returned_value: fieldText(source.return_value) }))} className="text-[11px] font-black text-teal-700">استخدم B-Connect</button>}</span><input inputMode="decimal" value={draft.returned_value} onChange={(e) => setDraft((old) => ({ ...old, returned_value: e.target.value }))} disabled={fieldsDisabled} className="h-9 w-full rounded-lg border bg-white px-3 text-sm disabled:bg-slate-100" /></label>}

              {showPaymentEditor && <><label className="space-y-1"><span className="text-xs font-bold">النقدي</span><input inputMode="decimal" value={draft.cash_amount} onChange={(e) => setDraft((old) => ({ ...old, cash_amount: e.target.value }))} disabled={fieldsDisabled} className="h-9 w-full rounded-lg border bg-white px-3 text-sm disabled:bg-slate-100" /></label><label className="space-y-1"><span className="text-xs font-bold">طريقة الدفع</span><select value={draft.payment_type} onChange={(e) => setDraft((old) => ({ ...old, payment_type: e.target.value }))} disabled={fieldsDisabled} className="h-9 w-full rounded-lg border bg-white px-3 text-sm disabled:bg-slate-100"><option value="">اختر</option><option value="آجل">آجل</option><option value="كاش">كاش</option></select></label></>}

              {showNotesEditor && <label className="space-y-1 sm:col-span-2"><span className="text-xs font-bold">ملاحظات</span><textarea rows={2} value={draft.notes} onChange={(e) => setDraft((old) => ({ ...old, notes: e.target.value }))} disabled={fieldsDisabled} className="w-full rounded-lg border bg-white px-3 py-2 text-sm disabled:bg-slate-100" /></label>}
            </div>

            {blocked && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs font-bold text-rose-700">الحفظ محجوب لهذه الحالة.</div>}
            {isCreate && !blocked && !canCreate && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">ناقص: {createMissingRequirements.join(' — ')}</div>}
            {saveState.error && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">{saveState.error}</div>}
            {saveState.success && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs font-bold text-emerald-700">{saveState.success}</div>}
          </section>
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t bg-white px-4 py-3 md:px-5">
        <div className="text-xs text-slate-400">{showAllDetails && !isCreate ? <>السجل: <span className="font-mono">{app.id || '—'}</span>{hasRevision ? ` · نسخة ${revision}` : ''}</> : hasChanges ? `${changedCount} تعديل جاهز للحفظ` : 'راجع القرار ثم نفّذ'}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={saveState.saving} onClick={onClose}>إغلاق</Button>
          {!isCreate && !canAcceptAsIs && !blocked && (!readOnly || canMarkReturnInspected) && <Button type="button" variant={canMarkReturnInspected ? 'default' : 'ghost'} size="sm" disabled={saveState.saving} onClick={() => onMarkReviewed(row)}>{canMarkReturnInspected ? 'تم فحص المرتجع' : 'تمت المراجعة'}</Button>}
          {canAcceptAsIs && <Button type="button" size="sm" disabled={saveState.saving} onClick={() => onAcceptAsIs(row)}>اعتماد الآن</Button>}
          {isCreate && !blocked ? <Button type="button" size="sm" disabled={!canCreate} onClick={createMissing}>{saveState.saving ? 'جاري التسجيل...' : 'اعتماد وتسجيل'}</Button> : blocked || readOnly || canAcceptAsIs ? null : <Button type="button" size="sm" disabled={!canSave} onClick={save}>{saveState.saving ? 'جاري الحفظ...' : hasChanges ? `حفظ ${changedCount} تعديل` : 'حفظ'}</Button>}
        </div>
      </div>
    </div>
  </div>;
}
