import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeftRight, CheckCircle2, ChevronLeft, CircleDollarSign, FilePlus2, FileSearch, Filter, Search, ShieldAlert, Sparkles, Upload } from 'lucide-react';
import { performanceApi } from '@/api/base44Client';
import { bconnectAcceptanceFingerprint, loadBconnectAcceptances, saveBconnectAcceptance } from '@/api/bconnectReviewAcceptanceClient';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import BConnectReviewModal from '@/components/bconnect/BConnectReviewModal';
import { parseBConnectWorkbook } from '@/lib/bconnectPurchaseInvoiceParser';
import { reconcilePurchaseInvoice } from '@/lib/purchaseInvoiceReconciliation';
import { normalizeBranch, normalizeInvoiceNumber, normalizeMoney } from '@/lib/purchaseInvoiceTruth';
import { buildBConnectPurchaseDecision, countBConnectDecisionLanes } from '@/lib/bconnectPurchaseDecisionView';

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
  return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

const laneConfig = {
  all: { label: 'الكل', hint: 'كل الملف', tone: 'slate', icon: FileSearch },
  approve: { label: 'اعتماد سريع', hint: 'القيمة سليمة والفرق بسيط', tone: 'green', icon: CheckCircle2 },
  correct: { label: 'تصحيح سريع', hint: 'اختلاف واضح يحتاج تعديل', tone: 'amber', icon: ArrowLeftRight },
  explain: { label: 'فرق مالي', hint: 'يحتاج تفسير سريع', tone: 'red', icon: CircleDollarSign },
  register: { label: 'ناقصة للتسجيل', hint: 'جهّز وسجّل', tone: 'blue', icon: FilePlus2 },
  investigate: { label: 'تحقيق يدوي', hint: 'تكرار أو دليل ناقص', tone: 'red', icon: ShieldAlert },
  accepted: { label: 'تم اعتمادها', hint: 'قرارات محفوظة', tone: 'green', icon: CheckCircle2 },
  clean: { label: 'سليم', hint: 'لا يحتاج إجراء', tone: 'slate', icon: CheckCircle2 },
};

const laneTone = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  red: 'border-rose-200 bg-rose-50 text-rose-800',
  blue: 'border-sky-200 bg-sky-50 text-sky-800',
  slate: 'border-slate-200 bg-white text-slate-700',
};

function DecisionChip({ view }) {
  const tone = laneConfig[view.lane]?.tone || 'slate';
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-black ${laneTone[tone]}`}>{view.label}</span>;
}

function DifferenceBadges({ row, view }) {
  return <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
    {view.financialDifference !== null && view.financialDifference !== 0 && <span className="rounded-full bg-rose-100 px-2 py-1 text-rose-700">فرق {money(Math.abs(view.financialDifference))} ج</span>}
    {view.supplierMismatch && <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">مورد مختلف</span>}
    {view.dateMismatch && <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">{view.dateDifferenceDays === null ? 'تاريخ مختلف' : `فرق تاريخ ${Math.abs(view.dateDifferenceDays)} يوم`}</span>}
    {view.hasNote && <span className="rounded-full bg-violet-100 px-2 py-1 text-violet-700">ملاحظة موجودة</span>}
    {view.hasReturn && <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-700">مرتجع {money(view.returnedValue ?? view.sourceReturnValue)} ج</span>}
    {!view.supplierMismatch && !view.dateMismatch && !view.hasNote && !view.hasReturn && (!view.financialDifference || view.financialDifference === 0) && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-500">لا فروق إضافية</span>}
  </div>;
}

export default function BConnectInvoiceReview() {
  const [state, setState] = useState({ loading: false, error: '', fileName: '', rows: [], meta: null });
  const [activeLane, setActiveLane] = useState('approve');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [decisions, setDecisions] = useState({});
  const [reviewRow, setReviewRow] = useState(null);

  const laneCounts = useMemo(() => countBConnectDecisionLanes(state.rows), [state.rows]);
  const acceptedCount = useMemo(() => Object.values(decisions).filter((decision) => decision?.action === 'accepted').length, [decisions]);
  const branches = useMemo(() => [...new Set(state.rows.map((row) => normalizeBranch(row.bconnect?.branch || row.app?.branch)).filter(Boolean))], [state.rows]);

  const visible = useMemo(() => state.rows.filter((row) => {
    const key = rowKey(row);
    const action = decisions[key]?.action;
    const view = buildBConnectPurchaseDecision(row);
    if (activeLane === 'accepted') {
      if (action !== 'accepted') return false;
    } else if (activeLane !== 'all') {
      if (action === 'accepted') return false;
      if (view.lane !== activeLane) return false;
    }
    const branch = normalizeBranch(row.bconnect?.branch || row.app?.branch);
    if (branchFilter !== 'all' && branch !== branchFilter) return false;
    const query = search.trim().toLowerCase();
    return !query || [row.number, row.bconnect?.supplier, row.app?.supplier_name, row.bconnect?.user, row.app?.entered_by_name, row.app?.entered_by, view.note].some((value) => String(value ?? '').toLowerCase().includes(query));
  }), [state.rows, activeLane, branchFilter, search, decisions]);

  const markReviewed = (row) => {
    if (!row) return;
    const key = rowKey(row);
    setDecisions((old) => ({ ...old, [key]: { action: 'reviewed', note: 'تمت المراجعة داخل نافذة B-Connect', source_id: row.app?.id || null } }));
    setReviewRow(null);
  };

  const acceptAsIs = async (row) => {
    if (!row) return;
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

  const verifiedSave = (updatedRow) => {
    const key = rowKey(updatedRow);
    setState((old) => ({ ...old, rows: old.rows.map((item) => rowKey(item) === key ? updatedRow : item) }));
    setDecisions((old) => ({ ...old, [key]: { action: 'saved', note: 'تم الحفظ الذري والتحقق بإعادة القراءة', source_id: updatedRow.app?.id || null } }));
    setReviewRow(updatedRow);
  };

  const reviewFile = async (file) => {
    if (!file) return;
    setState({ loading: true, error: '', fileName: file.name, rows: [], meta: null });
    setDecisions({}); setReviewRow(null); setActiveLane('approve'); setSearch(''); setBranchFilter('all');
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
      const counts = countBConnectDecisionLanes(rows);
      const firstLane = ['approve', 'correct', 'explain', 'register', 'investigate', 'clean'].find((lane) => counts[lane] > 0) || 'all';
      setActiveLane(firstLane);
      setState({ loading: false, error: '', fileName: file.name, rows, meta: { ...parsed.meta, global_lookup: true, branch_scoped_identity: true, atomic_edit_enabled: true, atomic_create_enabled: true, persistent_acceptance_enabled: true } });
    } catch (error) {
      setState({ loading: false, error: error?.message || 'تعذر مراجعة الملف.', fileName: file.name, rows: [], meta: null });
    }
  };

  const lanes = ['approve', 'correct', 'explain', 'register', 'investigate', 'accepted', 'clean', 'all'];
  const countFor = (lane) => lane === 'accepted' ? acceptedCount : lane === 'all' ? state.rows.length : laneCounts[lane] || 0;

  return <div dir="rtl" className="space-y-4 p-3 md:p-5 lg:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><div className="flex items-center gap-2"><h1 className="text-2xl font-black text-slate-900">مركز قرار المشتريات — B-Connect</h1><span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-black text-teal-700"><Sparkles className="ml-1 inline h-3.5 w-3.5" />قرار سريع</span></div><p className="mt-1 text-sm text-slate-500">ابدأ بالحالات السريعة. كل بطاقة تعرض القرار والأثر المالي والدليل المهم قبل فتح التفاصيل.</p></div>
      <Button asChild variant="outline"><Link to="/invoices">العودة للفواتير <ChevronLeft className="mr-1 h-4 w-4" /></Link></Button>
    </div>

    <Card className="overflow-hidden border-slate-200"><label className="flex cursor-pointer items-center gap-4 p-4 transition hover:bg-slate-50 md:p-5"><div className="rounded-2xl bg-teal-50 p-3 text-teal-600"><Upload className="h-6 w-6" /></div><div className="min-w-0 flex-1"><div className="font-black">{state.loading ? 'جاري تحليل الملف واتخاذ صورة القرار...' : state.fileName ? 'الملف جاهز لاتخاذ القرار' : 'اختر ملف B-Connect'}</div><div className="mt-1 text-xs text-slate-500">{state.fileName ? `${state.rows.length || 'جاري التحليل'} فاتورة — اضغط على أي بطاقة للتفاصيل والتصحيح` : 'يراجع الهوية والفرع والقيمة والمورد والتاريخ والملاحظات قبل عرض القرار.'}</div></div><span className="rounded-xl border bg-white px-3 py-2 text-xs font-bold text-slate-600">اختيار ملف</span><input type="file" accept=".xlsx,.xls" className="hidden" disabled={state.loading} onChange={(event) => reviewFile(event.target.files?.[0])} /></label>{state.error && <div className="border-t border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{state.error}</div>}</Card>

    {!!state.rows.length && <>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {['approve', 'correct', 'explain', 'register', 'investigate'].map((lane) => { const item = laneConfig[lane]; const Icon = item.icon; return <button key={lane} type="button" onClick={() => setActiveLane(lane)} className={`rounded-2xl border p-3 text-right transition hover:-translate-y-0.5 hover:shadow-sm ${activeLane === lane ? `${laneTone[item.tone]} ring-2 ring-current/10` : 'border-slate-200 bg-white'}`}><div className="flex items-center justify-between gap-2"><div className="rounded-xl bg-white/70 p-2"><Icon className="h-4 w-4" /></div><strong className="text-2xl">{countFor(lane)}</strong></div><div className="mt-2 font-black">{item.label}</div><div className="mt-0.5 text-[11px] opacity-70">{item.hint}</div></button>; })}
      </div>

      <Card className="overflow-hidden border-slate-200">
        <div className="flex flex-wrap gap-2 border-b bg-white p-3">{lanes.map((lane) => { const item = laneConfig[lane]; return <button key={lane} type="button" onClick={() => setActiveLane(lane)} className={`rounded-full border px-3 py-2 text-xs font-black transition ${activeLane === lane ? laneTone[item.tone] : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>{item.label} <span className="mr-1 opacity-70">{countFor(lane)}</span></button>; })}</div>
        <div className="grid gap-3 border-b bg-slate-50/70 p-3 md:grid-cols-[1fr_190px_auto]"><label className="relative block"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="رقم الفاتورة، المورد، الموظف، الملاحظة..." className="h-10 w-full rounded-xl border bg-white pr-10 pl-3 text-sm" /></label><select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="h-10 rounded-xl border bg-white px-3 text-sm"><option value="all">كل الفروع</option>{branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}</select><div className="flex h-10 items-center gap-2 rounded-xl border bg-white px-3 text-xs font-bold text-slate-500"><Filter className="h-4 w-4" />{visible.length} حالة</div></div>

        <div className="divide-y bg-slate-50/30">{visible.map((row, index) => {
          const key = rowKey(row); const view = buildBConnectPurchaseDecision(row); const accepted = decisions[key]?.action === 'accepted';
          return <div key={`${key}-${index}`} role="button" tabIndex={0} onClick={() => setReviewRow(row)} onKeyDown={(event) => { if (event.key === 'Enter') setReviewRow(row); }} className="group grid cursor-pointer gap-3 bg-white p-3 transition hover:bg-slate-50 md:grid-cols-[160px_minmax(220px,1fr)_minmax(250px,1.2fr)_180px] md:items-center md:p-4">
            <div><div className="font-mono text-lg font-black text-slate-900">{row.number}</div><div className="mt-1 text-xs font-bold text-slate-500">{normalizeBranch(row.bconnect?.branch || row.app?.branch) || 'فرع غير معروف'}</div><div className="mt-2"><DecisionChip view={view} /></div></div>
            <div className="min-w-0"><div className="truncate font-black text-slate-800">{row.bconnect?.supplier || row.app?.supplier_name || 'مورد غير معروف'}</div>{view.supplierMismatch && row.app?.supplier_name && <div className="mt-1 truncate text-xs text-amber-700">المسجل: {row.app.supplier_name}</div>}<div className="mt-2 text-xs text-slate-500">B-Connect: <strong className="text-slate-800">{money(view.bconnectTotal)} ج</strong> {view.appTotal !== null && <>← التطبيق: <strong className="text-slate-800">{money(view.appTotal)} ج</strong></>}</div><div className="mt-1 text-[11px] text-slate-400">{formatArabicDate(row.bconnect?.date)}{view.dateMismatch && row.app?.invoice_date ? ` ← ${formatArabicDate(row.app.invoice_date)}` : ''}</div></div>
            <div className="min-w-0"><div className="font-black text-slate-900">{view.instruction}</div><div className="mt-2"><DifferenceBadges row={row} view={view} /></div>{view.hasNote && <div className="mt-2 line-clamp-2 rounded-lg border border-violet-100 bg-violet-50 px-2.5 py-2 text-xs leading-5 text-violet-900"><strong>ملاحظة:</strong> {view.note}</div>}{accepted && <div className="mt-2 text-xs font-black text-emerald-700">✓ تم اعتمادها وحفظ القرار</div>}</div>
            <div className="flex flex-col gap-2 md:items-stretch"><Button type="button" size="sm" variant={view.fastAccept && !accepted ? 'default' : 'outline'} onClick={(event) => { event.stopPropagation(); if (view.fastAccept && !accepted) acceptAsIs(row); else setReviewRow(row); }}>{view.fastAccept && !accepted ? 'اعتماد الآن' : view.lane === 'register' ? 'فتح وتسجيل' : view.lane === 'correct' ? 'فتح وتصحيح' : view.lane === 'explain' ? 'عرض سبب الفرق' : view.lane === 'investigate' ? 'فتح التحقيق' : 'عرض التفاصيل'}</Button><div className="text-center text-[10px] text-slate-400">اضغط على البطاقة للتفاصيل الكاملة</div></div>
          </div>;
        })}{!visible.length && <div className="px-4 py-14 text-center text-slate-400"><FileSearch className="mx-auto mb-2 h-7 w-7" />لا توجد حالات في هذا المسار الآن.</div>}</div>
      </Card>
    </>}

    <BConnectReviewModal row={reviewRow} onClose={() => setReviewRow(null)} onMarkReviewed={markReviewed} onAcceptAsIs={acceptAsIs} onVerifiedSave={verifiedSave} />
  </div>;
}
