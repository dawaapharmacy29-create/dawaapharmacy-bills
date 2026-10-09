import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldCheck, X, XCircle } from 'lucide-react';
import { base44, performanceApi } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { prepareBconnectWriteCommand } from '@/lib/bconnectAtomicInvoiceCommand';
import { buildBConnectFormHandoff } from '@/lib/bconnectInvoiceFormHandoff';
import { classifyBConnectReviewRow } from '@/lib/bconnectReviewDecisionPolicy';
import { reconcilePurchaseInvoice } from '@/lib/purchaseInvoiceReconciliation';
import { normalizeBranch, normalizeInvoiceNumber, normalizeMoney } from '@/lib/purchaseInvoiceTruth';

const labels = { clean: 'سليم', review: 'تحتاج مراجعة', problem: 'مشكلة' };
const icons = { clean: CheckCircle2, review: AlertTriangle, problem: XCircle };
const dateOnly = (value) => String(value || '').slice(0, 10);
const fieldText = (value) => value === null || value === undefined ? '' : String(value);
const nullableMoney = (value) => value === '' || value === null || value === undefined ? null : normalizeMoney(value);

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
  return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function writeErrorText(error) {
  const code = String(error?.message || error || '');
  const map = {
    stale_revision: 'الفاتورة اتعدلت من مكان آخر. أعد رفع الملف أو افتحها من جديد قبل الحفظ.',
    legacy_identity_collision: 'الحفظ محجوب لأن رقم الفاتورة مكرر داخل نفس الفرع. يلزم تحقيق يدوي.',
    forbidden_edit: 'صلاحيتك الحالية لا تسمح بتعديل هذه الفاتورة في حالتها الحالية.',
    forbidden_branch: 'صلاحيتك لا تشمل فرع هذه الفاتورة.',
    invalid_supplier: 'المورد غير مؤكد في سجل الموردين. اختر موردًا مسجلًا ثم أعد الحفظ.',
    source_review_required: 'مصدر الفاتورة يحتاج مراجعة قبل السماح بالتعديل.',
    identity_change_forbidden: 'رقم الفاتورة والفرع ثابتان ولا يمكن تغيير هوية الفاتورة.',
    invalid_invoice: 'راجع التاريخ والإجمالي والمرتجع والنقدي قبل الحفظ.',
    invalid_request: 'بيانات الحفظ غير مكتملة أو غير صالحة.',
    invalid_session: 'انتهت جلسة الدخول. سجل الدخول مرة أخرى.',
    idempotency_conflict: 'تم اكتشاف تعارض في محاولة الحفظ. أعد فتح الفاتورة.',
    empty_edit_patch: 'لا يوجد تعديل جديد للحفظ.',
  };
  return map[code] || code || 'تعذر حفظ الفاتورة.';
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
  const tone = !comparable ? 'border-slate-200 bg-slate-50/60' : same ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50/50';
  const format = (value, known) => {
    if (!known) return 'غير متاح';
    if (display) return display(value);
    if (moneyValue) return money(value) === '—' ? 'غير متاح' : `${money(value)} ج`;
    return value || 'غير متاح';
  };
  const displayDiffers = sourceKnown && currentKnown && String(format(source, true)) !== String(format(current, true));
  return <div className={`grid gap-2 rounded-xl border p-3 md:grid-cols-[140px_1fr_1fr] ${tone}`}>
    <div className="font-bold text-slate-700">{label}</div>
    <div><div className="text-[11px] text-slate-400">B-Connect</div><div className="mt-1 break-words font-medium">{format(source, sourceKnown)}</div></div>
    <div><div className="text-[11px] text-slate-400">المسجل في التطبيق</div><div className="mt-1 break-words font-medium">{format(current, currentKnown)}</div></div>
    {!comparable && <div className="md:col-start-2 md:col-span-2 text-[11px] text-slate-500">لا يُعتبر اختلافًا مؤكدًا لأن القيمة غير متاحة في أحد المصدرين.</div>}
    {comparison === 'match' && displayDiffers && <div className="md:col-start-2 md:col-span-2 text-[11px] text-teal-700">مطابق حسب هوية/تطبيع البيانات المعتمد، حتى لو اختلف شكل النص الظاهر.</div>}
  </div>;
}

function buildChangedPatch(app, draft) {
  const patch = {};
  if (String(draft.supplier_id || '') !== String(app.supplier_id || '') || String(draft.supplier_name || '') !== String(app.supplier_name || '')) {
    patch.supplier_id = String(draft.supplier_id || '');
    patch.supplier_name = String(draft.supplier_name || '');
  }
  if (dateOnly(draft.invoice_date) !== dateOnly(app.invoice_date)) patch.invoice_date = draft.invoice_date;
  if (nullableMoney(draft.total_value) !== nullableMoney(app.total_value)) patch.total_value = draft.total_value;
  if (nullableMoney(draft.returned_value) !== nullableMoney(app.returned_value)) patch.returned_value = draft.returned_value === '' ? null : draft.returned_value;
  if (nullableMoney(draft.cash_amount) !== nullableMoney(app.cash_amount)) patch.cash_amount = draft.cash_amount === '' ? null : draft.cash_amount;
  if (String(draft.payment_type || '') !== String(app.payment_type || '')) patch.payment_type = draft.payment_type || null;
  if (String(draft.notes || '') !== String(app.notes || '')) patch.notes = draft.notes || null;
  return patch;
}

export default function BConnectReviewModal({ row, onClose, onMarkReviewed, onVerifiedSave }) {
  const [draft, setDraft] = useState({ supplier_id: '', supplier_name: '', invoice_date: '', total_value: '', returned_value: '', cash_amount: '', payment_type: '', notes: '' });
  const [suppliers, setSuppliers] = useState([]);
  const [supplierError, setSupplierError] = useState('');
  const [saveState, setSaveState] = useState({ saving: false, error: '', success: '' });

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
  const supplierComparison = row.checks?.supplier || 'unknown';
  const supplierChoices = app.supplier_id && !suppliers.some((supplier) => String(supplier.id) === String(app.supplier_id))
    ? [{ id: app.supplier_id, name: app.supplier_name || 'المورد المسجل' }, ...suppliers]
    : suppliers;
  const fieldsDisabled = blocked || readOnly || isCreate || saveState.saving;
  const changedPatch = buildChangedPatch(app, draft);
  const hasChanges = Object.keys(changedPatch).length > 0;
  const canSave = !fieldsDisabled && !!app.id && hasRevision && hasChanges && !!draft.supplier_id && !!draft.supplier_name;
  const modeLabel = readOnly ? 'عرض التفاصيل فقط' : isCreate ? 'مراجعة بيانات التسجيل المقترحة' : blocked ? 'عرض وتحقيق فقط' : 'مراجعة وتعديل وحفظ آمن';

  const chooseSupplier = (supplierId) => {
    const supplier = supplierChoices.find((item) => String(item.id) === String(supplierId));
    setDraft((old) => ({ ...old, supplier_id: supplier?.id || '', supplier_name: supplier?.name || '' }));
  };

  const save = async () => {
    const branch = normalizeBranch(source.branch || app.branch);
    setSaveState({ saving: true, error: '', success: '' });
    try {
      const operationId = `bconnect_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`}`;
      const invoice = buildChangedPatch(app, draft);
      if (!Object.keys(invoice).length) throw new Error('empty_edit_patch');
      const command = prepareBconnectWriteCommand({ operationId, mode: 'edit', invoice, recordId: String(app.id || ''), expectedRevision: revision });
      const result = await performanceApi.bconnectAtomicEdit({
        operationId: command.operation_id,
        invoiceId: command.record_id,
        expectedRevision: command.expected_revision,
        patch: command.invoice,
      });
      if (!result?.ok || !Number.isSafeInteger(Number(result.revision))) throw new Error('تعذر تأكيد نتيجة الحفظ.');

      const checked = await performanceApi.bconnectInvoiceNumbers([row.number]);
      const gate = Array.isArray(checked) ? checked.find((entry) => normalizeInvoiceNumber(entry?.number) === normalizeInvoiceNumber(row.number)) : null;
      const refreshedApp = Array.isArray(gate?.rows) ? gate.rows.find((item) => String(item?.id) === String(app.id) && normalizeBranch(item?.branch) === branch) : null;
      if (!refreshedApp) throw new Error('تم الحفظ لكن تعذرت إعادة قراءة نفس الفاتورة للتحقق.');
      if (Number(refreshedApp.bconnect_revision_v1) !== Number(result.revision)) throw new Error('تم الحفظ لكن رقم النسخة المقروءة لا يطابق نتيجة الحفظ.');

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
      setSaveState({ saving: false, error: '', success: 'تم حفظ الحقول التي عدّلتها فقط، والتحقق منها بإعادة قراءة الفاتورة من قاعدة البيانات.' });
    } catch (error) {
      setSaveState({ saving: false, error: writeErrorText(error), success: '' });
    }
  };

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !saveState.saving) onClose(); }}>
    <div dir="rtl" className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border bg-white shadow-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-slate-50 px-5 py-4 md:px-7">
        <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-black">مراجعة الفاتورة {row.number}</h2><StatusBadge row={row} /></div><p className="mt-1 text-sm text-slate-500">{normalizeBranch(source.branch || app.branch) || 'فرع غير معروف'} — {modeLabel}</p></div>
        <Button type="button" variant="outline" size="sm" disabled={saveState.saving} onClick={onClose}><X className="ml-1 h-4 w-4" />إغلاق</Button>
      </div>
      <div className="overflow-y-auto px-5 py-5 md:px-7">
        <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2"><h3 className="font-black">المقارنة</h3><span className="text-xs text-slate-400">الاختلافات المؤكدة فقط تحتاج قرارًا</span></div>
            <CompareValue label="الفرع" source={source.branch} current={app.branch} normalize={normalizeBranch} display={(value) => normalizeBranch(value) || 'غير متاح'} comparison={row.checks?.branch} />
            <CompareValue label="المورد" source={source.supplier} current={app.supplier_name} comparison={supplierComparison} />
            <CompareValue label="التاريخ" source={dateOnly(source.date)} current={dateOnly(app.invoice_date)} display={formatArabicDate} comparison={row.checks?.invoice_date} />
            <CompareValue label="الإجمالي" source={source.invoice_value} current={app.total_value} moneyValue normalize={normalizeMoney} comparison={row.financial?.comparable ? (row.financial?.match ? 'match' : 'mismatch') : 'unknown'} />
            <CompareValue label="المرتجع" source={source.return_value} current={app.returned_value} moneyValue normalize={normalizeMoney} />
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-950"><div className="font-black">سبب المراجعة</div><div>{(row.reasons || []).join(' — ') || 'لا توجد اختلافات مسجلة.'}</div></div>
          </section>
          <section className="rounded-2xl border bg-slate-50/70 p-4 md:p-5">
            <div className="mb-4 flex items-center justify-between gap-2"><div><h3 className="font-black">{isCreate ? 'بيانات التسجيل المقترحة' : 'البيانات المسجلة'}</h3><p className="mt-1 text-xs text-slate-500">{isCreate ? 'الإضافة الفعلية ما زالت محجوبة.' : readOnly ? 'هذه الفاتورة سليمة؛ البيانات للعرض فقط.' : 'رقم الفاتورة والفرع ثابتان، ولا يُحفظ إلا الحقل الذي عدّلته.'}</p></div><ShieldCheck className="h-5 w-5 text-teal-600" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5"><span className="text-xs font-bold text-slate-600">رقم الفاتورة</span><input disabled value={row.number || ''} className="h-10 w-full rounded-xl border bg-slate-100 px-3 text-sm font-bold text-slate-500" /></label>
              <label className="space-y-1.5"><span className="text-xs font-bold text-slate-600">الفرع</span><input disabled value={normalizeBranch(source.branch || app.branch) || ''} className="h-10 w-full rounded-xl border bg-slate-100 px-3 text-sm font-bold text-slate-500" /></label>
              <div className="sm:col-span-2 rounded-xl border bg-white p-3">
                <div className="text-xs font-bold text-slate-600">المورد المسجل</div>
                {isCreate || blocked || readOnly ? <div className="mt-1 font-bold">{isCreate ? (source.supplier || 'غير متاح') : (app.supplier_name || 'غير محدد')}</div> : <select value={draft.supplier_id || ''} onChange={(event) => chooseSupplier(event.target.value)} disabled={saveState.saving} className="mt-2 h-10 w-full rounded-xl border bg-white px-3 text-sm"><option value="">اختر المورد المسجل</option>{supplierChoices.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select>}
                {!isCreate && <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">اسم المورد في B-Connect: <strong>{source.supplier || 'غير متاح'}</strong></div>}
                {supplierError && !isCreate && !blocked && !readOnly && <div className="mt-2 text-xs text-rose-600">تعذر تحميل قائمة الموردين: {supplierError}</div>}
              </div>
              <label className="space-y-1.5"><span className="text-xs font-bold text-slate-600">التاريخ</span><input type="date" value={draft.invoice_date} onChange={(e) => setDraft((old) => ({ ...old, invoice_date: e.target.value }))} disabled={fieldsDisabled} className="h-10 w-full rounded-xl border bg-white px-3 text-sm disabled:bg-slate-100" /><span className="block text-[11px] text-slate-500">{formatArabicDate(draft.invoice_date)}</span></label>
              <label className="space-y-1.5"><span className="text-xs font-bold text-slate-600">الإجمالي</span><input inputMode="decimal" value={draft.total_value} onChange={(e) => setDraft((old) => ({ ...old, total_value: e.target.value }))} disabled={fieldsDisabled} className="h-10 w-full rounded-xl border bg-white px-3 text-sm disabled:bg-slate-100" /></label>
              <label className="space-y-1.5"><span className="text-xs font-bold text-slate-600">المرتجع</span><input inputMode="decimal" placeholder="غير متاح" value={draft.returned_value} onChange={(e) => setDraft((old) => ({ ...old, returned_value: e.target.value }))} disabled={fieldsDisabled} className="h-10 w-full rounded-xl border bg-white px-3 text-sm disabled:bg-slate-100" /></label>
              <label className="space-y-1.5"><span className="text-xs font-bold text-slate-600">النقدي</span><input inputMode="decimal" placeholder="غير متاح" value={draft.cash_amount} onChange={(e) => setDraft((old) => ({ ...old, cash_amount: e.target.value }))} disabled={fieldsDisabled} className="h-10 w-full rounded-xl border bg-white px-3 text-sm disabled:bg-slate-100" /></label>
              <label className="space-y-1.5 sm:col-span-2"><span className="text-xs font-bold text-slate-600">طريقة الدفع</span><input value={draft.payment_type} onChange={(e) => setDraft((old) => ({ ...old, payment_type: e.target.value }))} disabled={fieldsDisabled} className="h-10 w-full rounded-xl border bg-white px-3 text-sm disabled:bg-slate-100" /></label>
              <label className="space-y-1.5 sm:col-span-2"><span className="text-xs font-bold text-slate-600">ملاحظات</span><textarea rows={3} value={draft.notes} onChange={(e) => setDraft((old) => ({ ...old, notes: e.target.value }))} disabled={fieldsDisabled} className="w-full rounded-xl border bg-white px-3 py-2 text-sm disabled:bg-slate-100" /></label>
            </div>
            {blocked && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">هذه الحالة محجوبة من التعديل الآمن.</div>}
            {isCreate && !blocked && <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800">إضافة الفواتير الناقصة غير مفعّلة.</div>}
            {readOnly && !blocked && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">الفاتورة سليمة؛ العرض فقط.</div>}
            {!blocked && !readOnly && !isCreate && !hasRevision && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">رقم النسخة غير متاح. أعد رفع ملف B-Connect.</div>}
            {!blocked && !readOnly && !isCreate && hasRevision && <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs text-teal-800">الحفظ الفعلي مفعّل للفواتير الموجودة فقط. القيم غير المتاحة تظل غير متاحة ما لم تغيّرها بنفسك.</div>}
            {!blocked && !readOnly && !isCreate && hasRevision && !hasChanges && <div className="mt-3 text-xs text-slate-500">عدّل حقلًا واحدًا على الأقل لتفعيل زر الحفظ.</div>}
            {saveState.error && <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{saveState.error}</div>}
            {saveState.success && <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">{saveState.success}</div>}
          </section>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-white px-5 py-4 md:px-7">
        <div className="text-xs text-slate-500">{isCreate ? 'لا يوجد رقم سجل بعد.' : <>رقم السجل: <span className="font-mono">{app.id || 'غير موجود'}</span>{hasRevision && <span className="mr-2">نسخة: {revision}</span>}</>}</div>
        <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={saveState.saving} onClick={onClose}>إلغاء</Button><Button type="button" variant="outline" disabled={saveState.saving} onClick={() => onMarkReviewed(row)}>تمت المراجعة</Button>{isCreate || blocked || readOnly ? <Button type="button" disabled>{isCreate ? 'الإضافة غير مفعّلة' : 'لا يوجد حفظ مطلوب'}</Button> : <Button type="button" disabled={!canSave} onClick={save}>{saveState.saving ? 'جاري الحفظ والتحقق...' : 'حفظ التعديل'}</Button>}</div>
      </div>
    </div>
  </div>;
}
