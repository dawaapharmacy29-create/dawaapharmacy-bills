import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  Upload,
} from 'lucide-react';
import { smartPurchaseUnifiedApi as purchaseApi } from '@/api/smartPurchaseUnifiedApi';
import { smartPurchaseOrderManagementApi as orderManagementApi } from '@/api/smartPurchaseOrderManagementApi';
import { normalizeDualBranchStockRows } from '@/lib/dualBranchStockMaster';
import { orderMatchesPurchasePlan } from '@/lib/purchaseDraftRecovery';
import CleanSupplierFinancialWorkspace from '@/components/purchases/CleanSupplierFinancialWorkspace';
import {
  buildSingleSupplierScenarios,
  buildSafeCurrentOfferPlan,
  buildSupplierFinancialRows,
  buildSupplierGroups,
  combineSingleSupplierScenarioSets,
  mergePlanWithHistory,
} from '@/lib/purchaseSupplierFinancials';

const money = (value) =>
  new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(value || 0));

const qty = (value) =>
  new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(value || 0));

const BRANCH_META = {
  shokry: { label: 'دواء شكري' },
  shamy: { label: 'دواء الشامي' },
};

const JOURNEY_RESUME_KEY = 'purchase-center-clean-resume-v1';
const JOURNEY_RESUME_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function readJourneyResume() {
  try {
    const raw = window.localStorage.getItem(JOURNEY_RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.stock_sync_id || !parsed?.saved_at) return null;
    if (Date.now() - Number(parsed.saved_at) > JOURNEY_RESUME_MAX_AGE_MS) {
      window.localStorage.removeItem(JOURNEY_RESUME_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeJourneyResume(payload) {
  try {
    window.localStorage.setItem(JOURNEY_RESUME_KEY, JSON.stringify({
      ...payload,
      saved_at: Date.now(),
    }));
  } catch {
    // Local resume is optional; purchase data remains safely stored server-side.
  }
}

function clearJourneyResume() {
  try {
    window.localStorage.removeItem(JOURNEY_RESUME_KEY);
  } catch {
    // No-op.
  }
}

function modeLabel(mode) {
  if (mode === 'critical') return 'حرج — حماية الحد الأدنى';
  if (mode === 'comfortable') return 'مريح — يسمح بالتعزيز حتى Max';
  return 'متوازن — الوصول لنقطة إعادة الطلب';
}

function BranchPlanCard({ branchKey, data, mode }) {
  const meta = BRANCH_META[branchKey];
  const summary = data?.summary || {};
  const plan = Array.isArray(data?.plan) ? data.plan : [];
  const buyRows = plan
    .filter((row) => Number(row.buy_quantity || 0) > 0)
    .sort((a, b) => Number(b.planning_reference_total || b.buy_estimated_cost || 0) - Number(a.planning_reference_total || a.buy_estimated_cost || 0));
  const financialReferenceValue = buyRows.reduce(
    (sum, row) => sum + Number(row.planning_reference_total || row.buy_estimated_cost || 0),
    0
  );
  const historicalReferenceItems = buyRows.filter((row) =>
    ['historical_average', 'historical_last'].includes(row.planning_cost_source)
  ).length;

  return (
    <section className="rounded-2xl border bg-white shadow-sm overflow-hidden">
      <div className="border-b bg-slate-50/80 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-900">{meta.label}</h2>
            <p className="mt-1 text-sm text-slate-500">{modeLabel(mode?.mode)}</p>
          </div>
          <div className="rounded-xl border bg-white px-4 py-2 text-left">
            <div className="text-xs text-slate-500">تكلفة مرجعية محسّنة</div>
            <div className="text-xl font-black text-teal-700">{money(financialReferenceValue)} ج</div>
            <div className="mt-1 text-[10px] text-slate-400">V10: {money(summary.suggested_buy_value)} ج</div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-7">
        <Metric label="أصناف شراء" value={summary.buy_now_items || 0} />
        <Metric label="نواقص حرجة" value={(summary.stockout_items || 0) + (summary.below_min_items || 0)} />
        <Metric label="احتياج الفترة" value={`${money(summary.period_need_value)} ج`} />
        <Metric label="قيمة V10" value={`${money(summary.suggested_buy_value)} ج`} />
        <Metric label="تكلفة مرجعية" value={`${money(financialReferenceValue)} ج`} />
        <Metric label="بتاريخ تكلفة" value={historicalReferenceItems} />
        <Metric label="Safe Order Today" value={`${money(mode?.safe_order_today)} ج`} />
      </div>
      <div className="mx-4 mb-4 flex flex-wrap gap-2 text-xs">
        <span className={`rounded-full border px-2 py-1 ${data?.method?.data_quality?.stock_snapshot_fresh ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          مزامنة الرصيد {data?.method?.data_quality?.stock_snapshot_fresh ? 'حديثة' : 'قديمة'}
        </span>
        <span className={`rounded-full border px-2 py-1 ${data?.method?.data_quality?.movement_snapshot_fresh ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          الحركة {data?.method?.data_quality?.movement_snapshot_fresh ? 'حديثة' : 'قديمة'}
        </span>
        <span className={`rounded-full border px-2 py-1 ${data?.method?.data_quality?.financial_snapshot_fresh ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          الوضع المالي {data?.method?.data_quality?.financial_snapshot_fresh ? 'حديث' : 'قديم'}
        </span>
        <span className={`rounded-full border px-2 py-1 ${data?.method?.data_quality?.profile_snapshot_fresh ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          Min / Reorder / Max {data?.method?.data_quality?.profile_snapshot_fresh ? 'حديثة' : 'قديمة'}
        </span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600">
          الهدف المالي: {summary.financial_target === 'min' ? 'Min' : summary.financial_target === 'max' ? 'Max' : 'Reorder'}
        </span>
      </div>

      <div className="border-t p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-slate-800">أعلى أصناف الشراء تكلفة</h3>
          <span className="text-xs text-slate-400">عرض أول 20 صنف للمراجعة السريعة</span>
        </div>
        <div className="overflow-auto rounded-xl border">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-2 text-right">الصنف</th>
                <th className="p-2 text-right">الوحدة</th>
                <th className="p-2 text-right">الرصيد</th>
                <th className="p-2 text-right">Min</th>
                <th className="p-2 text-right">Reorder</th>
                <th className="p-2 text-right">Max</th>
                <th className="p-2 text-right">الشراء</th>
                <th className="p-2 text-right">التحويل</th>
                <th className="p-2 text-right">المورد المرجعي</th>
                <th className="p-2 text-right">تكلفة الوحدة</th>
                <th className="p-2 text-right">القيمة المرجعية</th>
                <th className="p-2 text-right">القرار</th>
              </tr>
            </thead>
            <tbody>
              {buyRows.slice(0, 20).map((row) => (
                <tr key={row.product_key || row.product_code || row.product_name} className="border-t">
                  <td className="p-2">
                    <div className="font-semibold text-slate-800">{row.product_name}</div>
                    <div className="text-xs text-slate-400">{row.product_code || 'بدون كود'}</div>
                  </td>
                  <td className="p-2">{row.stock_unit || '—'}</td>
                  <td className="p-2">{qty(row.current_stock)}</td>
                  <td className="p-2">{qty(row.min_stock)}</td>
                  <td className="p-2">{qty(row.reorder_stock)}</td>
                  <td className="p-2">{qty(row.max_stock)}</td>
                  <td className="p-2 font-bold text-teal-700">{qty(row.buy_quantity)}</td>
                  <td className="p-2">{qty(row.suggested_transfer_qty)}</td>
                  <td className="p-2 text-xs font-bold text-indigo-800">{row.historical_supplier || '—'}</td>
                  <td className="p-2">
                    <div className="font-semibold">{money(row.planning_reference_unit_cost || row.unit_cost)} ج</div>
                    <div className="text-[10px] text-slate-400">
                      {row.planning_cost_source === 'historical_average' ? 'متوسط تاريخي' :
                       row.planning_cost_source === 'historical_last' ? 'آخر شراء' :
                       row.planning_cost_source === 'planner_reference' ? 'مرجع الخطة' : '—'}
                    </div>
                  </td>
                  <td className="p-2 font-semibold">{money(row.planning_reference_total || row.buy_estimated_cost)} ج</td>
                  <td className="p-2 text-xs text-slate-500">{row.reason || row.decision}</td>
                </tr>
              ))}
              {!buyRows.length && (
                <tr><td colSpan="12" className="p-8 text-center text-slate-400">لا يوجد شراء خارجي مقترح لهذا الفرع.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value, tone = 'slate', emphasis = false, helper = '' }) {
  const tones = {
    slate: 'border-slate-200 bg-slate-50/70 text-slate-900',
    teal: 'border-teal-200 bg-teal-50/70 text-teal-950',
    emerald: 'border-emerald-200 bg-emerald-50/70 text-emerald-950',
    amber: 'border-amber-200 bg-amber-50/70 text-amber-950',
    indigo: 'border-indigo-200 bg-indigo-50/70 text-indigo-950',
    red: 'border-red-200 bg-red-50/70 text-red-950',
  };
  return (
    <div className={`rounded-xl border p-3 ${tones[tone] || tones.slate} ${emphasis ? 'shadow-sm' : ''}`}>
      <div className="text-xs font-bold opacity-60">{label}</div>
      <div className={`mt-1 font-black ${emphasis ? 'text-2xl' : 'text-lg'}`}>{value}</div>
      {helper ? <div className="mt-1 text-[11px] opacity-60">{helper}</div> : null}
    </div>
  );
}

function PurchaseJourneyTabs({
  activeStep,
  onStepChange,
  plan,
  draftResult,
  supplierReady,
  quickReviewCount,
  supplierLoading,
  supplierError,
  supplierDecision,
}) {
  const planBlocked = Boolean(plan) && !draftResult && plan?.creation_guard?.can_create_dual === false;
  const steps = [
    {
      id: 1,
      label: 'رفع الرصيد',
      ready: true,
      done: Boolean(plan),
      status: plan ? 'تم' : 'ابدأ هنا',
    },
    {
      id: 2,
      label: 'مراجعة الخطة',
      ready: Boolean(plan),
      done: Boolean(draftResult),
      status: draftResult
        ? 'تم'
        : planBlocked
          ? 'تحتاج حل'
          : quickReviewCount > 0
            ? `${quickReviewCount} مراجعة`
            : plan
              ? 'جاهزة'
              : 'مقفلة',
    },
    {
      id: 3,
      label: 'إنشاء المسودتين',
      ready: Boolean(plan),
      done: Boolean(draftResult),
      status: draftResult
        ? 'تم'
        : planBlocked
          ? 'متوقفة'
          : plan
            ? 'جاهزة'
            : 'مقفلة',
    },
    {
      id: 4,
      label: 'تحليل تاريخ المشتريات',
      ready: Boolean(draftResult),
      done: Boolean(supplierReady),
      status: supplierLoading
        ? 'جاري التحميل'
        : supplierError
          ? 'تحتاج مراجعة'
          : supplierReady
            ? supplierDecision?.historicalCoverageComplete
              ? 'تاريخي مكتمل'
              : 'تاريخي ناقص'
            : draftResult
              ? 'جاهزة'
              : 'مقفلة',
    },
    {
      id: 5,
      label: 'المراجعة النهائية',
      ready: Boolean(draftResult && supplierReady),
      done: false,
      status: supplierReady
        ? supplierDecision?.readyForSupplierConfirmation
          ? 'جاهزة'
          : 'تحتاج تأكيد'
        : 'مقفلة',
    },
  ];

  return (
    <nav className="sticky top-2 z-30 rounded-2xl border bg-white/95 p-2 shadow-md backdrop-blur" aria-label="رحلة تجهيز الطلبية">
      <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 md:grid md:grid-cols-5 md:overflow-visible md:pb-0">
        {steps.map((step) => {
          const active = step.id === activeStep;
          return (
            <button
              key={step.id}
              type="button"
              disabled={!step.ready}
              onClick={() => step.ready && onStepChange(step.id)}
              className={`min-w-[180px] snap-start flex items-center gap-3 rounded-xl border px-3 py-3 text-right transition md:min-w-0 ${
                active
                  ? 'border-teal-600 bg-teal-700 text-white shadow-sm'
                  : step.done
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : step.ready
                      ? 'border-slate-200 bg-white text-slate-700 hover:border-teal-300'
                      : 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300'
              }`}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-black ${
                active
                  ? 'border-white/40 bg-white/15'
                  : step.done
                    ? 'border-emerald-300 bg-emerald-100'
                    : 'border-slate-200 bg-white'
              }`}>
                {active ? step.id : step.done ? '✓' : step.id}
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] font-bold opacity-70">الخطوة {step.id}</span>
                <span className="block truncate text-sm font-black">{step.label}</span>
                <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${
                  active
                    ? 'bg-white/15 text-white'
                    : step.done
                      ? 'bg-emerald-100 text-emerald-700'
                      : /متوقفة|تحتاج حل/.test(step.status)
                        ? 'bg-red-50 text-red-700'
                        : /مراجعة|تأكيد/.test(step.status)
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-slate-100 text-slate-600'
                }`}>
                  {step.status}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function CurrentStepGuide({ step }) {
  const guides = {
    1: ['ارفع ملف الرصيد', 'ملف واحد يحتوي رصيد شكري والشامي؛ الحفظ والتحليل يبدأان تلقائيًا.'],
    2: ['راجع الخطة', 'راجع الإجمالي وشكري والشامي فقط. افتح التفاصيل أو التنبيهات عند الحاجة ثم اضغط التالي.'],
    3: ['أنشئ المسودتين', 'ضغطة واحدة تنشئ مسودتي الفرعين من نفس الخطة بدون اعتماد أو إرسال.'],
    4: ['راجع تحليل تاريخ المشتريات', 'راجع أفضل الموردين والتكلفة المستنتجة من فواتير المشتريات السابقة، ثم انتقل للمراجعة النهائية.'],
    5: ['راجع القرار النهائي', 'راجع القيمة والموردين والنواقص في شاشة واحدة قبل أي اعتماد أو إرسال لاحقًا.'],
  };
  const [title, description] = guides[step] || guides[1];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm">
      <span className="font-black text-slate-900">المطلوب منك الآن: {title}</span>
      <span className="text-slate-600">{description}</span>
    </div>
  );
}

function JourneyActionBar({
  step,
  busy,
  plan,
  saveResult,
  draftResult,
  supplierReady,
  onStepChange,
  onReplan,
  onCreateDrafts,
}) {
  if (step === 1) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-[1100px] rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur md:inset-x-auto md:left-1/2 md:w-[min(1100px,calc(100vw-3rem))] md:-translate-x-1/2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold text-slate-500">
          الخطوة {step} من 5
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {step === 2 && (
            <button
              type="button"
              disabled={!plan || busy}
              onClick={() => onStepChange(3)}
              className="rounded-xl bg-teal-700 px-5 py-2.5 font-black text-white shadow-sm disabled:opacity-40"
            >
              التالي: إنشاء المسودتين
            </button>
          )}

          {step === 3 && !draftResult && (
            <>
              <button
                type="button"
                disabled={busy || !saveResult || Boolean(draftResult)}
                onClick={onReplan}
                className="rounded-xl border border-amber-300 bg-white px-4 py-2.5 font-bold text-amber-900 disabled:opacity-40"
              >
                إعادة التحليل
              </button>
              <button
                type="button"
                disabled={busy || !plan?.creation_guard?.can_create_dual || Boolean(draftResult)}
                onClick={onCreateDrafts}
                className="rounded-xl bg-teal-700 px-5 py-2.5 font-black text-white shadow-sm disabled:opacity-40"
              >
                إنشاء مسودتي شكري والشامي
              </button>
            </>
          )}

          {step === 4 && (
            <button
              type="button"
              disabled={!supplierReady}
              onClick={() => onStepChange(5)}
              className="rounded-xl bg-slate-900 px-5 py-2.5 font-black text-white shadow-sm disabled:opacity-40"
            >
              التالي: المراجعة النهائية
            </button>
          )}

          {step === 5 && (
            <button
              type="button"
              onClick={() => onStepChange(4)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-bold text-slate-700"
            >
              رجوع للموردين والأسعار
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PurchaseCenterClean() {
  const [fileName, setFileName] = useState('');
  const [fileModifiedAt, setFileModifiedAt] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [saveResult, setSaveResult] = useState(null);
  const [plan, setPlan] = useState(null);
  const [draftResult, setDraftResult] = useState(null);
  const [historyByBranch, setHistoryByBranch] = useState({ shokry: [], shamy: [] });
  const [supplierWorkspace, setSupplierWorkspace] = useState({
    loading: false,
    applying: '',
    message: '',
    error: '',
    rows: [],
    groups: [],
    scenarios: [],
    currentOfferPlans: {},
    draftTotals: {},
  });
  const [timings, setTimings] = useState({ readMs: 0, saveMs: 0, planMs: 0, totalMs: 0 });
  const [saveProgress, setSaveProgress] = useState({ staged: 0, total: 0, percent: 0, chunk: 0, totalChunks: 0 });
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const [activeStep, setActiveStep] = useState(1);
  const runRef = useRef(false);
  const resumeAttemptedRef = useRef(false);

  const transfers = useMemo(() => {
    if (!plan) return [];
    const rows = [];
    for (const [branchKey, branchData] of [['shokry', plan.shokry], ['shamy', plan.shamy]]) {
      const toBranch = BRANCH_META[branchKey].label;
      for (const item of branchData?.plan || []) {
        const transferQuantity = Number(item.suggested_transfer_qty || 0);
        if (transferQuantity <= 0) continue;
        rows.push({
          key: `${branchKey}-${item.product_key || item.product_code || item.product_name}`,
          product_code: item.product_code,
          product_name: item.product_name,
          stock_unit: item.stock_unit,
          company_name: item.company_name,
          from: item.transfer_from_branch,
          to: toBranch,
          quantity: transferQuantity,
          buy_quantity: Number(item.buy_quantity || 0),
        });
      }
    }
    return rows;
  }, [plan]);

  const quickReviewRows = useMemo(() => {
    if (!plan) return [];
    const rows = [];
    for (const [branchKey, branchData] of [['shokry', plan.shokry], ['shamy', plan.shamy]]) {
      for (const item of branchData?.plan || []) {
        if (!item.requires_quick_review || Number(item.buy_quantity || 0) <= 0) continue;
        rows.push({
          ...item,
          branch: BRANCH_META[branchKey].label,
        });
      }
    }
    return rows.sort((a, b) => Number(b.buy_estimated_cost || 0) - Number(a.buy_estimated_cost || 0));
  }, [plan]);

  const reviewWatchlistRows = useMemo(() => {
    if (!plan) return [];
    return [
      ...(plan.review_watchlist?.shokry?.items || []).map((row) => ({ ...row, branch: 'دواء شكري' })),
      ...(plan.review_watchlist?.shamy?.items || []).map((row) => ({ ...row, branch: 'دواء الشامي' })),
    ].sort((a, b) =>
      Number(b.review_priority || 0) - Number(a.review_priority || 0)
      || Number(b.customers_30d || 0) - Number(a.customers_30d || 0)
      || Number(b.invoices_30d || 0) - Number(a.invoices_30d || 0)
    );
  }, [plan]);

  const reviewWatchlistCounts = {
    shokry: Number(plan?.review_watchlist?.shokry?.total_active_review_stockouts || 0),
    shamy: Number(plan?.review_watchlist?.shamy?.total_active_review_stockouts || 0),
  };

  const movementOnlyWatchlistRows = useMemo(() => {
    if (!plan) return [];
    return [
      ...(plan.movement_only_watchlist?.shokry?.items || []).map((row) => ({ ...row, branch: 'دواء شكري' })),
      ...(plan.movement_only_watchlist?.shamy?.items || []).map((row) => ({ ...row, branch: 'دواء الشامي' })),
    ].sort((a, b) => Number(b.smart_monthly_consumption || 0) - Number(a.smart_monthly_consumption || 0));
  }, [plan]);

  const movementOnlyWatchlistCounts = {
    shokry: Number(plan?.movement_only_watchlist?.shokry?.total || 0),
    shamy: Number(plan?.movement_only_watchlist?.shamy?.total || 0),
  };

  const executionPendingUnits =
    Number(plan?.execution_pending?.shokry?.units || 0)
    + Number(plan?.execution_pending?.shamy?.units || 0);

  const financialReferenceTotal = useMemo(() => {
    if (!plan) return 0;
    return ['shokry', 'shamy'].reduce((total, branchKey) => (
      total + (plan?.[branchKey]?.plan || []).reduce((sum, row) => (
        sum + (Number(row.buy_quantity || 0) > 0
          ? Number(row.planning_reference_total || row.buy_estimated_cost || 0)
          : 0)
      ), 0)
    ), 0);
  }, [plan]);

  const financialHistoryCoverage = useMemo(() => {
    if (!plan) return { history: 0, total: 0 };
    const rows = ['shokry', 'shamy'].flatMap((branchKey) =>
      (plan?.[branchKey]?.plan || []).filter((row) => Number(row.buy_quantity || 0) > 0)
    );
    return {
      total: rows.length,
      history: rows.filter((row) => ['historical_average', 'historical_last'].includes(row.planning_cost_source)).length,
    };
  }, [plan]);

  const draftOrderTotal = useMemo(() => {
    const persisted =
      Number(supplierWorkspace.draftTotals?.shokry || 0)
      + Number(supplierWorkspace.draftTotals?.shamy || 0);
    return persisted > 0 ? persisted : Number(plan?.totals?.buy_value || 0);
  }, [plan, supplierWorkspace.draftTotals]);

  const liveReferenceTotal = useMemo(() => {
    if (supplierWorkspace.rows?.length) {
      return supplierWorkspace.rows.reduce((sum, row) => sum + Number(row.cash_cost || 0), 0);
    }
    return financialReferenceTotal;
  }, [financialReferenceTotal, supplierWorkspace.rows]);

  const estimatedPurchaseGap = Math.max(0, draftOrderTotal - liveReferenceTotal);
  const reviewAlertsTotal =
    quickReviewRows.length
    + reviewWatchlistCounts.shokry
    + reviewWatchlistCounts.shamy
    + movementOnlyWatchlistCounts.shokry
    + movementOnlyWatchlistCounts.shamy;

  function countPlanQuickReviews(currentPlan) {
    return ['shokry', 'shamy'].reduce((total, branchKey) => (
      total + (currentPlan?.[branchKey]?.plan || []).filter(
        (row) => row.requires_quick_review && Number(row.buy_quantity || 0) > 0
      ).length
    ), 0);
  }

  async function readWorkbook(file) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('ملف Excel لا يحتوي على Sheet قابلة للقراءة.');
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: false });
    return normalizeDualBranchStockRows(rows, file.name);
  }

  async function recoverMatchingOpenDrafts(currentPlan) {
    const guard = currentPlan?.creation_guard || {};
    const isDraft = (order) => ['draft', 'مسودة'].includes(String(order?.status || '').trim());
    const shokryCandidates = (guard.shokry_open_orders || []).filter(isDraft);
    const shamyCandidates = (guard.shamy_open_orders || []).filter(isDraft);
    if (shokryCandidates.length !== 1 || shamyCandidates.length !== 1) return null;

    const [shokryOrder, shamyOrder] = await Promise.all([
      purchaseApi.getOrder(shokryCandidates[0].id),
      purchaseApi.getOrder(shamyCandidates[0].id),
    ]);

    const shokryMatches = orderMatchesPurchasePlan(shokryOrder, currentPlan?.shokry?.plan || []);
    const shamyMatches = orderMatchesPurchasePlan(shamyOrder, currentPlan?.shamy?.plan || []);
    if (!shokryMatches || !shamyMatches) return null;

    return {
      already_created: true,
      recovered_existing: true,
      content_verified: true,
      shokry_order_id: shokryCandidates[0].id,
      shamy_order_id: shamyCandidates[0].id,
    };
  }

  async function runPlannerOnly(expectedSyncId = saveResult?.stock_sync_id) {
    setPhase('planning');
    const startedAt = performance.now();
    await purchaseApi.refreshDecisionDailySnapshot('all');
    const result = await purchaseApi.dualBranchInstantPlan();
    if (result?.planner !== 'dual_branch_instant_plan_v1') {
      throw new Error('لم يتم تشغيل مخطط الفرعين المعتمد.');
    }
    if (expectedSyncId && result?.stock_sync_id !== expectedSyncId) {
      throw new Error('تم إيقاف الخطة لأن التحليل لا يطابق نفس نسخة ملف الرصيد المحفوظ.');
    }

    let history = { shokry: [], shamy: [] };
    try {
      const [shokryHistory, shamyHistory] = await Promise.all([
        purchaseApi.historyEnrichRows('دواء شكري', result?.shokry?.plan || []),
        purchaseApi.historyEnrichRows('دواء الشامي', result?.shamy?.plan || []),
      ]);
      history = {
        shokry: shokryHistory?.rows || [],
        shamy: shamyHistory?.rows || [],
      };
    } catch {
      history = { shokry: [], shamy: [] };
    }

    const financialPlan = {
      ...result,
      shokry: {
        ...(result.shokry || {}),
        plan: mergePlanWithHistory(result?.shokry?.plan || [], history.shokry),
      },
      shamy: {
        ...(result.shamy || {}),
        plan: mergePlanWithHistory(result?.shamy?.plan || [], history.shamy),
      },
    };

    let recoveredDrafts = null;
    if (result?.creation_guard?.can_create_dual === false) {
      try {
        recoveredDrafts = await recoverMatchingOpenDrafts(result);
      } catch {
        recoveredDrafts = null;
      }
    }

    setHistoryByBranch(history);
    setPlan(financialPlan);
    if (recoveredDrafts) {
      setDraftResult(recoveredDrafts);
      setActiveStep(4);
      void loadSupplierWorkspace(recoveredDrafts);
    } else {
      const quickReviewCount = countPlanQuickReviews(result);
      const fastPathReady = result?.creation_guard?.can_create_dual === true && quickReviewCount === 0;
      setActiveStep(fastPathReady ? 3 : 2);
    }
    setTimings((current) => ({ ...current, planMs: Math.round(performance.now() - startedAt) }));
    setPhase('ready');
    return result;
  }

  async function saveAndPlan(stockMaster, flowStartedAt = performance.now()) {
    if (runRef.current) return;
    runRef.current = true;
    setError('');
    setPlan(null);
    setDraftResult(null);
    setSaveResult(null);
    setHistoryByBranch({ shokry: [], shamy: [] });
    setSupplierWorkspace({ loading: false, applying: '', message: '', error: '', rows: [], groups: [], scenarios: [], currentOfferPlans: {}, draftTotals: {} });

    try {
      setPhase('saving');
      const saveStartedAt = performance.now();
      setSaveProgress({ staged: 0, total: stockMaster.rows.length, percent: 0, chunk: 0, totalChunks: 0 });
      const saved = await purchaseApi.saveDualBranchStockMasterClean({
        rows: stockMaster.rows,
        onProgress: setSaveProgress,
      });
      const saveMs = Math.round(performance.now() - saveStartedAt);
      setTimings((current) => ({ ...current, saveMs }));
      if (!saved?.dual_atomic_finalize || !saved?.row_count_verified) {
        throw new Error('تم إيقاف التحليل لأن حفظ الرصيد الموحد لم يكتمل Transactionally للفرعين.');
      }
      setSaveResult(saved);
      writeJourneyResume({
        stock_sync_id: saved.stock_sync_id,
        file_name: fileName || stockMaster.source_file || 'آخر رصيد محفوظ',
        file_modified_at: fileModifiedAt?.toISOString?.() || null,
        rows_count: Number(stockMaster.rows_count || stockMaster.rows?.length || 0),
        inventory_rows: Number(stockMaster.inventory_rows || 0),
        quality: stockMaster.quality || {},
        save_result: saved,
      });
      await runPlannerOnly(saved.stock_sync_id);
      setTimings((current) => ({ ...current, totalMs: Math.round(performance.now() - flowStartedAt) }));
    } catch (err) {
      setError(err?.message || 'تعذر تجهيز خطة المشتريات.');
      setPhase('error');
    } finally {
      runRef.current = false;
    }
  }

  function startNewJourney() {
    if (runRef.current) return;
    clearJourneyResume();
    setActiveStep(1);
    setFileName('');
    setFileModifiedAt(null);
    setParsed(null);
    setSaveResult(null);
    setPlan(null);
    setDraftResult(null);
    setHistoryByBranch({ shokry: [], shamy: [] });
    setSupplierWorkspace({
      loading: false,
      applying: '',
      message: '',
      error: '',
      rows: [],
      groups: [],
      scenarios: [],
      currentOfferPlans: {},
      draftTotals: {},
    });
    setTimings({ readMs: 0, saveMs: 0, planMs: 0, totalMs: 0 });
    setSaveProgress({ staged: 0, total: 0, percent: 0, chunk: 0, totalChunks: 0 });
    setError('');
    setPhase('idle');
  }

  useEffect(() => {
    if (resumeAttemptedRef.current) return;
    resumeAttemptedRef.current = true;
    const resume = readJourneyResume();
    if (!resume?.stock_sync_id || runRef.current) return;

    runRef.current = true;
    setFileName(resume.file_name || 'آخر رصيد محفوظ');
    setFileModifiedAt(resume.file_modified_at ? new Date(resume.file_modified_at) : null);
    setParsed({
      rows_count: Number(resume.rows_count || 0),
      source_rows_count: Number(resume.rows_count || 0),
      inventory_rows: Number(resume.inventory_rows || 0),
      quality: resume.quality || {},
    });
    setSaveResult(resume.save_result || {
      stock_sync_id: resume.stock_sync_id,
      dual_atomic_finalize: true,
      row_count_verified: true,
    });
    setError('');

    void runPlannerOnly(resume.stock_sync_id)
      .catch((err) => {
        clearJourneyResume();
        setError(err?.message || 'تعذر استكمال آخر رحلة شراء محفوظة.');
        setPhase('error');
        setActiveStep(1);
      })
      .finally(() => {
        runRef.current = false;
      });
  }, []);

  async function replan() {
    if (runRef.current || !saveResult || draftResult) return;
    runRef.current = true;
    setError('');
    try {
      await runPlannerOnly();
    } catch (err) {
      setError(err?.message || 'تعذر إعادة التحليل.');
      setPhase('error');
    } finally {
      runRef.current = false;
    }
  }

  async function handleFile(file) {
    if (!file) return;
    setActiveStep(1);
    setFileName(file.name);
    setFileModifiedAt(file.lastModified ? new Date(file.lastModified) : null);
    setParsed(null);
    setPlan(null);
    setDraftResult(null);
    setSaveResult(null);
    setHistoryByBranch({ shokry: [], shamy: [] });
    setSupplierWorkspace({ loading: false, applying: '', message: '', error: '', rows: [], groups: [], scenarios: [], currentOfferPlans: {}, draftTotals: {} });
    setError('');
    setSaveProgress({ staged: 0, total: 0, percent: 0, chunk: 0, totalChunks: 0 });
    setPhase('reading');
    const flowStartedAt = performance.now();

    try {
      const readStartedAt = performance.now();
      const stockMaster = await readWorkbook(file);
      const readMs = Math.round(performance.now() - readStartedAt);
      setTimings({ readMs, saveMs: 0, planMs: 0, totalMs: 0 });
      setParsed(stockMaster);
      await saveAndPlan(stockMaster, flowStartedAt);
    } catch (err) {
      setError(err?.message || 'تعذر قراءة ملف الرصيد.');
      setPhase('error');
    }
  }

  async function loadSupplierWorkspace(result) {
    const shokryOrderId = result?.shokry_order_id;
    const shamyOrderId = result?.shamy_order_id;
    if (!shokryOrderId || !shamyOrderId) return;

    setSupplierWorkspace((current) => ({
      ...current,
      loading: true,
      applying: '',
      message: '',
      error: '',
      rows: [],
      groups: [],
      scenarios: [],
      currentOfferPlans: {},
      draftTotals: {},
    }));
    try {
      const [shokryDecision, shamyDecision, shokryOrder, shamyOrder] = await Promise.all([
        purchaseApi.supplierDecision(shokryOrderId),
        purchaseApi.supplierDecision(shamyOrderId),
        purchaseApi.getOrder(shokryOrderId),
        purchaseApi.getOrder(shamyOrderId),
      ]);

      const [shokryHistory, shamyHistory] = await Promise.all([
        purchaseApi.historyEnrichRows('دواء شكري', shokryOrder?.items || []),
        purchaseApi.historyEnrichRows('دواء الشامي', shamyOrder?.items || []),
      ]);
      const freshHistory = {
        shokry: shokryHistory?.rows || [],
        shamy: shamyHistory?.rows || [],
      };
      setHistoryByBranch(freshHistory);

      const rows = [
        ...buildSupplierFinancialRows({
          decision: shokryDecision,
          historyRows: freshHistory.shokry,
          orderItems: shokryOrder?.items || [],
          branch: 'دواء شكري',
          historicalOnly: true,
        }),
        ...buildSupplierFinancialRows({
          decision: shamyDecision,
          historyRows: freshHistory.shamy,
          orderItems: shamyOrder?.items || [],
          branch: 'دواء الشامي',
          historicalOnly: true,
        }),
      ];

      const scenarios = combineSingleSupplierScenarioSets([
        buildSingleSupplierScenarios({
          decision: shokryDecision,
          historyRows: freshHistory.shokry,
          branch: 'دواء شكري',
          historicalOnly: true,
        }),
        buildSingleSupplierScenarios({
          decision: shamyDecision,
          historyRows: freshHistory.shamy,
          branch: 'دواء الشامي',
          historicalOnly: true,
        }),
      ]);

      const currentOfferPlans = {};

      setSupplierWorkspace({
        loading: false,
        applying: '',
        message: '',
        error: '',
        rows,
        groups: buildSupplierGroups(rows),
        scenarios,
        currentOfferPlans,
        draftTotals: {
          shokry: Number(shokryOrder?.order?.approved_total || shokryOrder?.order?.expected_total || 0),
          shamy: Number(shamyOrder?.order?.approved_total || shamyOrder?.order?.expected_total || 0),
        },
      });
    } catch (err) {
      setSupplierWorkspace({
        loading: false,
        applying: '',
        message: '',
        error: err?.message || 'تعذر حساب أفضل الموردين.',
        rows: [],
        groups: [],
        scenarios: [],
        currentOfferPlans: {},
        draftTotals: {},
      });
    }
  }

  async function applyCurrentOffersForBranch(branchKey) {
    if (!draftResult || supplierWorkspace.loading || supplierWorkspace.applying) return;
    const planToApply = supplierWorkspace.currentOfferPlans?.[branchKey];
    if (!planToApply?.orderId || !planToApply?.items?.length) return;

    setSupplierWorkspace((current) => ({
      ...current,
      applying: branchKey,
      message: '',
      error: '',
    }));

    try {
      await orderManagementApi.applySupplierPlan(planToApply.orderId, planToApply.items);
      await loadSupplierWorkspace(draftResult);
      setSupplierWorkspace((current) => ({
        ...current,
        applying: '',
        message: `تم تثبيت أفضل العروض الحالية الآمنة لـ ${planToApply.branch} بدون تغيير كميات V10.`,
      }));
    } catch (err) {
      setSupplierWorkspace((current) => ({
        ...current,
        applying: '',
        error: err?.message || `تعذر تثبيت عروض ${planToApply.branch}.`,
      }));
    }
  }

  async function createDrafts() {
    if (runRef.current || !plan?.stock_sync_id || !plan?.plan_hash) return;
    runRef.current = true;
    setError('');
    setPhase('creating');
    try {
      const result = await purchaseApi.createDualDrafts({
        stockSyncId: plan.stock_sync_id,
        planHash: plan.plan_hash,
      });
      setDraftResult(result);
      setActiveStep(4);
      setPhase('ready');
      void loadSupplierWorkspace(result);
    } catch (err) {
      setError(err?.message || 'تعذر إنشاء مسودتي الفرعين.');
      setPhase('error');
    } finally {
      runRef.current = false;
    }
  }

  const busy = ['reading', 'saving', 'planning', 'creating'].includes(phase);
  const statusText =
    phase === 'reading' ? 'جاري قراءة ملف الرصيد والتحقق من الأعمدة...' :
    phase === 'saving' ? 'جاري حفظ رصيد الفرعين بأمان...' :
    phase === 'planning' ? 'جاري بناء طلبية شكري والشامي والتحويلات...' :
    phase === 'creating' ? 'جاري إنشاء مسودتي شكري والشامي من نفس الخطة...' :
    '';

  const supplierReady =
    Boolean(draftResult)
    && !supplierWorkspace.loading
    && !supplierWorkspace.error
    && supplierWorkspace.rows.length > 0;

  const supplierDecision = useMemo(() => {
    const rows = supplierWorkspace.rows || [];
    const currentOfferItems = 0;
    const historicalItems = rows.filter((row) =>
      row.cost_source === 'historical_average' || row.cost_source === 'historical_last'
    ).length;
    const historicalCoverageComplete = rows.length > 0 && historicalItems === rows.length;
    const missingSupplierItems = rows.filter((row) => !String(row.supplier_name || '').trim()).length;
    const missingCostItems = rows.filter((row) => Number(row.unit_cost || 0) <= 0).length;
    const topGroups = [...(supplierWorkspace.groups || [])]
      .filter((group) => String(group.supplier_name || '').trim() && group.supplier_name !== 'غير محدد')
      .sort((a, b) => Number(b.estimated_cash_total || 0) - Number(a.estimated_cash_total || 0))
      .slice(0, 6);

    return {
      currentOfferItems,
      historicalItems,
      historicalCoverageComplete,
      totalItems: rows.length,
      missingSupplierItems,
      missingCostItems,
      supplierCount: topGroups.length,
      topGroups,
      readyForFinalReview: rows.length > 0 && missingCostItems === 0,
      readyForSupplierConfirmation: rows.length > 0 && missingSupplierItems === 0 && missingCostItems === 0,
    };
  }, [supplierWorkspace.groups, supplierWorkspace.rows]);

  const supplierBranchDecision = useMemo(() => {
    const rows = supplierWorkspace.rows || [];
    return ['دواء شكري', 'دواء الشامي'].map((branchName) => {
      const branchRows = rows.filter((row) => row.branch === branchName);
      const suppliers = new Set(
        branchRows
          .map((row) => String(row.supplier_name || '').trim())
          .filter(Boolean)
      );
      return {
        branch: branchName,
        items: branchRows.length,
        value: branchRows.reduce((sum, row) => sum + Number(row.cash_cost || 0), 0),
        current: branchRows.filter((row) => row.cost_source === 'current_offer').length,
        historical: branchRows.filter((row) =>
          row.cost_source === 'historical_average' || row.cost_source === 'historical_last'
        ).length,
        missingSupplier: branchRows.filter((row) => !String(row.supplier_name || '').trim()).length,
        missingCost: branchRows.filter((row) => Number(row.unit_cost || 0) <= 0).length,
        suppliers: suppliers.size,
      };
    });
  }, [supplierWorkspace.rows]);

  const supplierMissingRows = useMemo(() => (
    (supplierWorkspace.rows || [])
      .filter((row) => !String(row.supplier_name || '').trim() || Number(row.unit_cost || 0) <= 0)
      .slice(0, 12)
  ), [supplierWorkspace.rows]);

  return (
    <div dir="rtl" className="mx-auto max-w-[1600px] space-y-5 p-3 pb-28 md:p-5 md:pb-28">
      <header className={`rounded-3xl border bg-gradient-to-l from-white to-teal-50/70 shadow-sm ${plan ? 'p-3' : 'p-5'}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-teal-700">
              <ShoppingCart className="h-5 w-5" />
              <span className="text-sm font-bold">مركز المشتريات الجديد</span>
            </div>
            {!plan ? (
              <>
                <h1 className="mt-2 text-2xl font-black text-slate-900 md:text-3xl">ارفع الرصيد مرة واحدة — استلم خطتي الفرعين فورًا</h1>
                <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
                  نفس عقل Min / Reorder / Max المعتمد، مع التحويل بين الفرعين والوضع المالي، بدون إعادة حساب الكميات بعد التحليل.
                </p>
              </>
            ) : (
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-black text-slate-900">الطلبية الحالية: {money(draftOrderTotal)} ج</span>
                <span className="text-slate-500">{plan.totals?.buy_items || 0} صنف</span>
                <span className="text-slate-500">شكري {money(plan.shokry?.summary?.suggested_buy_value)} ج</span>
                <span className="text-slate-500">الشامي {money(plan.shamy?.summary?.suggested_buy_value)} ج</span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={startNewJourney}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:border-teal-300 disabled:opacity-40"
            >
              بدء طلبية جديدة
            </button>
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
              <ShieldCheck className="h-4 w-4" />
              Atomic + Guards
            </div>
          </div>
        </div>
      </header>

      <PurchaseJourneyTabs
        activeStep={activeStep}
        onStepChange={setActiveStep}
        plan={plan}
        draftResult={draftResult}
        supplierReady={supplierReady}
        quickReviewCount={quickReviewRows.length}
        supplierLoading={supplierWorkspace.loading}
        supplierError={supplierWorkspace.error}
        supplierDecision={supplierDecision}
      />

      <CurrentStepGuide step={activeStep} />

      {activeStep === 1 && (
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        {!plan ? (
          <label className={`flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition ${busy ? 'pointer-events-none opacity-60' : 'hover:border-teal-400 hover:bg-teal-50/30'}`}>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                void handleFile(file);
              }}
            />
            <Upload className="mb-3 h-9 w-9 text-teal-600" />
            <div className="text-lg font-black text-slate-800">{fileName || 'اختر ملف رصيد شكري والشامي'}</div>
            <div className="mt-2 text-sm text-slate-500">بمجرد اختيار الملف يبدأ الحفظ والتحليل تلقائيًا.</div>
          </label>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <span className="font-black text-slate-900">الرصيد معتمد Atomic</span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                  {parsed?.rows_count || 0} صف
                </span>
                {(parsed?.quality?.negative_shokry > 0 || parsed?.quality?.negative_shamy > 0) && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
                    السالب عومل كصفر • شكري {parsed?.quality?.negative_shokry || 0} • الشامي {parsed?.quality?.negative_shamy || 0}
                  </span>
                )}
              </div>
              <div className="mt-1 truncate text-sm text-slate-500">{fileName || 'ملف الرصيد الحالي'}</div>
              {saveResult?.stock_sync_id && (
                <div className="mt-1 font-mono text-[10px] text-slate-400">{saveResult.stock_sync_id}</div>
              )}
            </div>
            <label className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-bold text-teal-800 ${busy ? 'pointer-events-none opacity-50' : 'hover:bg-teal-100'}`}>
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  void handleFile(file);
                }}
              />
              <Upload className="h-4 w-4" />
              رفع رصيد جديد
            </label>
          </div>
        )}

        {parsed && !plan && (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="صفوف المصدر" value={parsed.source_rows_count ?? parsed.rows_count} />
              <Metric label="صفوف معتمدة" value={parsed.rows_count} />
              <Metric label="أصناف مخزنية" value={parsed.inventory_rows} />
              <Metric label="آخر تعديل للملف" value={fileModifiedAt ? fileModifiedAt.toLocaleString('ar-EG') : 'غير متاح'} />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4 text-xs">
              <div className="rounded-lg border bg-slate-50 p-2">كسور شكري: <strong>{parsed.quality?.fractional_shokry || 0}</strong></div>
              <div className="rounded-lg border bg-slate-50 p-2">كسور الشامي: <strong>{parsed.quality?.fractional_shamy || 0}</strong></div>
              <div className={`rounded-lg border p-2 ${parsed.quality?.negative_shokry ? 'border-amber-300 bg-amber-50 text-amber-800' : 'bg-slate-50'}`}>
                رصيد سالب شكري: <strong>{parsed.quality?.negative_shokry || 0}</strong>
              </div>
              <div className={`rounded-lg border p-2 ${parsed.quality?.negative_shamy ? 'border-amber-300 bg-amber-50 text-amber-800' : 'bg-slate-50'}`}>
                رصيد سالب الشامي: <strong>{parsed.quality?.negative_shamy || 0}</strong>
              </div>
            </div>
            {(parsed.quality?.negative_shokry > 0 || parsed.quality?.negative_shamy > 0) && (
              <div className="mt-3 flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <span>تمت معاملة الأرصدة السالبة كصفر في الفرع المتأثر فقط، وسيستمر التحليل وإنشاء المسودتين. الحالات محفوظة بعلامة للمراجعة في B-Connect.</span>
              </div>
            )}
          </>
        )}

        {busy && (
          <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50 p-3 text-teal-800">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="font-bold">{statusText}</span>
            </div>
            {phase === 'saving' && saveProgress.total > 0 && (
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-xs font-semibold">
                  <span>{saveProgress.staged} / {saveProgress.total} صنف</span>
                  <span>{saveProgress.percent}% • دفعة {saveProgress.chunk}/{saveProgress.totalChunks || '—'}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-teal-100">
                  <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${saveProgress.percent}%` }} />
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {saveResult && !plan && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <div className="flex items-center gap-2 font-bold">
              <CheckCircle2 className="h-5 w-5" />
              تم اعتماد الرصيد Atomic: شكري {saveResult.shokry_saved} صف • الشامي {saveResult.shamy_saved} صف
            </div>
            <div className="font-mono text-[11px] opacity-70">{saveResult.stock_sync_id}</div>
          </div>
        )}
      </section>
      )}

      {plan && (
        <>
          {activeStep === 2 && (
          <>
          <section className="rounded-2xl border border-teal-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-900">ملخص الطلبية الآن</h2>
                <p className="mt-1 text-sm text-slate-500">الأرقام المهمة للقرار فقط. باقي التفاصيل موجودة بالأسفل عند الحاجة.</p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-bold ${draftResult ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                {draftResult ? 'المسودتان جاهزتان للمراجعة' : 'الخطة جاهزة للمراجعة'}
              </span>
            </div>
            <div className="grid gap-3 lg:grid-cols-12">
              <div className="lg:col-span-4">
                <Metric
                  label="إجمالي الطلبية"
                  value={`${money(draftOrderTotal)} ج`}
                  tone="teal"
                  emphasis
                  helper={`${plan.totals?.buy_items || 0} صنف شراء`}
                />
              </div>
              <div className="lg:col-span-4">
                <Metric
                  label="شكري"
                  value={`${money(plan.shokry?.summary?.suggested_buy_value)} ج`}
                  tone="indigo"
                  emphasis
                  helper={`${(plan.shokry?.plan || []).filter((row) => Number(row.buy_quantity || 0) > 0).length} صنف`}
                />
              </div>
              <div className="lg:col-span-4">
                <Metric
                  label="الشامي"
                  value={`${money(plan.shamy?.summary?.suggested_buy_value)} ج`}
                  tone="indigo"
                  emphasis
                  helper={`${(plan.shamy?.plan || []).filter((row) => Number(row.buy_quantity || 0) > 0).length} صنف`}
                />
              </div>
              <div className="lg:col-span-4">
                <Metric label="مرجع التكلفة" value={`${money(liveReferenceTotal)} ج`} tone="slate" />
              </div>
              <div className="lg:col-span-4">
                <Metric
                  label="فرق تقديري"
                  value={`${money(estimatedPurchaseGap)} ج`}
                  tone={estimatedPurchaseGap > 0 ? 'amber' : 'emerald'}
                />
              </div>
              <div className="lg:col-span-4">
                <Metric
                  label="مراجعات داخل الطلبية"
                  value={quickReviewRows.length}
                  tone={quickReviewRows.length ? 'amber' : 'emerald'}
                />
              </div>
            </div>
            {plan.creation_guard?.can_create_dual === true && quickReviewRows.length === 0 && (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-800">
                ✓ Fast Path: لا توجد أصناف داخل الطلبية تحتاج مراجعة سريعة، والـGuards تسمح بإنشاء المسودتين مباشرة.
              </div>
            )}
          </section>

          <details className={`rounded-2xl border border-slate-200 bg-white shadow-sm`}>
            <summary className="cursor-pointer select-none px-4 py-3 font-bold text-slate-700">
              تفاصيل تقنية وتشغيلية
            </summary>
            <div className="border-t p-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <Metric label="أصناف التحويل" value={plan.totals?.transfer_items || 0} />
                <Metric label="في الطريق" value={`${qty(executionPendingUnits)} وحدة`} />
                <Metric
                  label="تغطية تاريخ التكلفة"
                  value={financialHistoryCoverage.total ? `${financialHistoryCoverage.history}/${financialHistoryCoverage.total}` : '0/0'}
                />
                <Metric label="تاريخ إنشاء الخطة" value={new Date(plan.generated_at).toLocaleString('ar-EG')} />
                <Metric label="معرّف الخطة" value={String(plan.plan_hash || '').slice(0, 12) || '—'} />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="قراءة الملف" value={`${timings.readMs} ms`} />
                <Metric label="حفظ الفرعين" value={`${timings.saveMs} ms`} />
                <Metric label="بناء الخطة" value={`${timings.planMs} ms`} />
                <Metric label="الزمن الكلي" value={timings.totalMs ? `${(timings.totalMs / 1000).toFixed(2)} ثانية` : '—'} />
              </div>
            </div>
          </details>

          <details className={`rounded-2xl border border-amber-200 bg-white shadow-sm`}>
            <summary className="cursor-pointer select-none px-4 py-3 font-bold text-slate-800">
              مراجعات لا تعطل الطلبية • داخل الطلبية {quickReviewRows.length} • Watchlist خارجي {reviewWatchlistCounts.shokry + reviewWatchlistCounts.shamy + movementOnlyWatchlistCounts.shokry + movementOnlyWatchlistCounts.shamy}
            </summary>
            <div className="space-y-4 border-t p-4">
          {(Number(plan.execution_pending?.shokry?.items || 0) > 0 || Number(plan.execution_pending?.shamy?.items || 0) > 0) && (
            <section className="rounded-2xl border border-cyan-200 bg-cyan-50/60 p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-black text-cyan-900">كميات مرسلة للمورد وما زالت في الطريق</h2>
                  <p className="mt-1 text-sm text-cyan-700">تم خصمها تلقائيًا من الاحتياج والـMin / Reorder / Max حتى لا نكرر شراء نفس الصنف.</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-bold">
                  <span className="rounded-full border border-cyan-200 bg-white px-3 py-1">
                    شكري: {plan.execution_pending?.shokry?.items || 0} صنف • {qty(plan.execution_pending?.shokry?.units)} وحدة
                  </span>
                  <span className="rounded-full border border-cyan-200 bg-white px-3 py-1">
                    الشامي: {plan.execution_pending?.shamy?.items || 0} صنف • {qty(plan.execution_pending?.shamy?.units)} وحدة
                  </span>
                </div>
              </div>
            </section>
          )}

          {(movementOnlyWatchlistCounts.shokry > 0 || movementOnlyWatchlistCounts.shamy > 0) && (
            <section className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-black text-sky-900">Movement-only Watchlist — حركة 3 شهور بدون دليل عملاء كافٍ</h2>
                  <p className="mt-1 text-sm leading-6 text-sky-700">
                    الأصناف دي رصيدها صفر ولها حركة متكررة في B-Connect، لكن لسه مش عندنا Customer Intelligence كافي يسمح بشراء آلي. تظهر للمراجعة فقط ولا تدخل كميات المسودتين.
                  </p>
                </div>
                <div className="flex gap-2 text-xs font-bold">
                  <span className="rounded-full border border-sky-200 bg-white px-3 py-1">شكري: {movementOnlyWatchlistCounts.shokry}</span>
                  <span className="rounded-full border border-sky-200 bg-white px-3 py-1">الشامي: {movementOnlyWatchlistCounts.shamy}</span>
                </div>
              </div>
              <div className="overflow-auto rounded-xl border border-sky-100 bg-white">
                <table className="min-w-[980px] w-full text-sm">
                  <thead className="bg-sky-50/70">
                    <tr>
                      <th className="p-2 text-right">الفرع</th>
                      <th className="p-2 text-right">الصنف</th>
                      <th className="p-2 text-right">الوحدة</th>
                      <th className="p-2 text-right">Smart Monthly</th>
                      <th className="p-2 text-right">الثبات</th>
                      <th className="p-2 text-right">الثقة</th>
                      <th className="p-2 text-right">آخر تكلفة</th>
                      <th className="p-2 text-right">النمط</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movementOnlyWatchlistRows.map((row) => (
                      <tr key={`${row.branch}-${row.product_key}`} className="border-t">
                        <td className="p-2 font-semibold">{row.branch}</td>
                        <td className="p-2">
                          <div className="font-semibold">{row.product_name}</div>
                          <div className="text-xs text-slate-400">{row.product_code || 'بدون كود'}{row.company_name ? ` • ${row.company_name}` : ''}</div>
                        </td>
                        <td className="p-2">{row.stock_unit || '—'}</td>
                        <td className="p-2">{qty(row.smart_monthly_consumption)}</td>
                        <td className="p-2">{qty(row.demand_stability_score)}%</td>
                        <td className="p-2">{qty(row.confidence_score)}%</td>
                        <td className="p-2">{money(row.unit_cost)} ج</td>
                        <td className="p-2 text-xs">
                          {row.behavior_class === 'movement_only_recurring_stable' ? 'متكرر ومستقر' : 'متكرر'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-xs text-sky-700">يتم عرض أعلى 15 صنف فقط من كل فرع؛ العدد الكلي ظاهر أعلى الكارت.</div>
            </section>
          )}

          {(reviewWatchlistCounts.shokry > 0 || reviewWatchlistCounts.shamy > 0) && (
            <section className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-black text-violet-900">Watchlist — أصناف تحتاج عين بشرية وليست شراء آلي</h2>
                  <p className="mt-1 text-sm text-violet-700">
                    رصيدها صفر وعليها طلب حديث، لكن ثقة السياسة لم تصل لمستوى الشراء التلقائي. لا يتم إضافة أي كمية منها للمسودتين.
                  </p>
                </div>
                <div className="flex gap-2 text-xs font-bold">
                  <span className="rounded-full border border-violet-200 bg-white px-3 py-1">شكري: {reviewWatchlistCounts.shokry}</span>
                  <span className="rounded-full border border-violet-200 bg-white px-3 py-1">الشامي: {reviewWatchlistCounts.shamy}</span>
                </div>
              </div>
              <div className="overflow-auto rounded-xl border border-violet-100 bg-white">
                <table className="min-w-[980px] w-full text-sm">
                  <thead className="bg-violet-50/70">
                    <tr>
                      <th className="p-2 text-right">الفرع</th>
                      <th className="p-2 text-right">الصنف</th>
                      <th className="p-2 text-right">الوحدة</th>
                      <th className="p-2 text-right">Smart Monthly</th>
                      <th className="p-2 text-right">عملاء 30 يوم</th>
                      <th className="p-2 text-right">فواتير 30 يوم</th>
                      <th className="p-2 text-right">الثقة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewWatchlistRows.map((row) => (
                      <tr key={`${row.branch}-${row.product_key}`} className="border-t">
                        <td className="p-2 font-semibold">{row.branch}</td>
                        <td className="p-2">
                          <div className="font-semibold">{row.product_name}</div>
                          <div className="text-xs text-slate-400">{row.product_code || 'بدون كود'}</div>
                        </td>
                        <td className="p-2">{row.stock_unit || '—'}</td>
                        <td className="p-2">{qty(row.smart_monthly_consumption)}</td>
                        <td className="p-2">{row.customers_30d || 0}</td>
                        <td className="p-2">{row.invoices_30d || 0}</td>
                        <td className="p-2">{qty(row.confidence_score)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-xs text-violet-700">يتم عرض أعلى 25 صنف فقط من كل فرع حسب قوة الطلب وانتشار العملاء، مع إبقاء العدد الكلي ظاهرًا.</div>
            </section>
          )}

          {quickReviewRows.length > 0 && (
            <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-black text-amber-900">مراجعة سريعة قبل إنشاء المسودتين</h2>
                  <p className="mt-1 text-sm text-amber-800">أصناف لا يتم استبعادها تلقائيًا، لكنها تستحق نظرة سريعة بسبب القيمة أو نمط الطلب.</p>
                </div>
                <span className="rounded-full border border-amber-300 bg-white px-3 py-1 text-sm font-black text-amber-900">{quickReviewRows.length} صنف</span>
              </div>
              <div className="overflow-auto rounded-xl border border-amber-200 bg-white">
                <table className="min-w-[980px] w-full text-sm">
                  <thead className="bg-amber-50/70">
                    <tr>
                      <th className="p-2 text-right">الفرع</th>
                      <th className="p-2 text-right">الصنف</th>
                      <th className="p-2 text-right">الشراء</th>
                      <th className="p-2 text-right">القيمة</th>
                      <th className="p-2 text-right">Smart Monthly</th>
                      <th className="p-2 text-right">السبب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quickReviewRows.map((row) => {
                      const reasons = (row.quick_review_reasons || []).map((reason) => ({
                        high_line_value: 'قيمة السطر مرتفعة',
                        qty_above_smart_monthly: 'الكمية أعلى من الاستهلاك الشهري الذكي',
                        dominant_customer: 'اعتماد مرتفع على عميل واحد',
                        high_outlier_share: 'نسبة Outlier مرتفعة',
                      }[reason] || reason));
                      return (
                        <tr key={`${row.branch}-${row.product_key || row.product_code || row.product_name}`} className="border-t">
                          <td className="p-2 font-semibold">{row.branch}</td>
                          <td className="p-2">
                            <div className="font-semibold">{row.product_name}</div>
                            <div className="text-xs text-slate-400">{row.product_code || 'بدون كود'}</div>
                          </td>
                          <td className="p-2 font-black text-teal-700">{qty(row.buy_quantity)}</td>
                          <td className="p-2 font-bold">{money(row.buy_estimated_cost)} ج</td>
                          <td className="p-2">{qty(row.smart_monthly_consumption)}</td>
                          <td className="p-2 text-xs text-amber-800">{reasons.join(' • ')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

            </div>
          </details>

          <details className={`rounded-2xl border border-slate-200 bg-white shadow-sm`}>
            <summary className="cursor-pointer select-none px-4 py-3 font-bold text-slate-800">
              تفاصيل خطة شكري والشامي
            </summary>
            <div className="grid gap-5 border-t p-4 xl:grid-cols-2">
              <BranchPlanCard branchKey="shokry" data={plan.shokry} mode={plan.modes?.['دواء شكري']} />
              <BranchPlanCard branchKey="shamy" data={plan.shamy} mode={plan.modes?.['دواء الشامي']} />
            </div>
          </details>

          {(plan.creation_guard?.legacy_stale_orders || []).length > 0 && (
            <details className={`rounded-2xl border border-slate-200 bg-white shadow-sm`}>
              <summary className="cursor-pointer select-none px-4 py-3 font-bold text-slate-700">
                طلبيات قديمة لا تمنع الشراء • {(plan.creation_guard?.legacy_stale_orders || []).length}
              </summary>
              <section className="border-t bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
                <div className="min-w-0 flex-1">
                  <h2 className="font-black text-slate-800">طلبيات قديمة غير منفذة — للمراجعة فقط</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    أقدم من 30 يومًا ولا يوجد لها إرسال مورد أو استلام مسجل، لذلك لا تمنع إنشاء الخطة الجديدة.
                  </p>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {(plan.creation_guard?.legacy_stale_orders || []).map((order) => (
                      <div key={order.id} className="rounded-xl border bg-white p-3 text-sm">
                        <div className="font-mono font-bold text-slate-700">{order.order_number}</div>
                        <div className="mt-1 text-slate-600">{order.branch} • {order.status}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {new Date(order.created_at).toLocaleDateString('ar-EG')}
                          {order.title ? ` • ${order.title}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              </section>
            </details>
          )}

          <details className={`rounded-2xl border border-indigo-200 bg-white shadow-sm`}>
            <summary className="cursor-pointer select-none px-4 py-3 font-bold text-slate-800">
              التحويلات بين الفروع • {transfers.length} حركة
            </summary>
            <section className="border-t p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="h-5 w-5 text-indigo-600" />
                  <h2 className="text-lg font-black">التحويلات قبل الشراء الخارجي</h2>
              </div>
              <span className="text-sm text-slate-500">{transfers.length} حركة مقترحة</span>
            </div>
            <div className="overflow-auto rounded-xl border">
              <table className="min-w-[760px] w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="p-2 text-right">الصنف</th>
                    <th className="p-2 text-right">الوحدة</th>
                    <th className="p-2 text-right">من</th>
                    <th className="p-2 text-right">إلى</th>
                    <th className="p-2 text-right">التحويل</th>
                    <th className="p-2 text-right">شراء بعد التحويل</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.map((row) => (
                    <tr key={row.key} className="border-t">
                      <td className="p-2">
                        <div className="font-semibold">{row.product_name}</div>
                        <div className="text-xs text-slate-400">{row.product_code || 'بدون كود'}</div>
                      </td>
                      <td className="p-2">{row.stock_unit || '—'}</td>
                      <td className="p-2">{row.from || '—'}</td>
                      <td className="p-2">{row.to}</td>
                      <td className="p-2 font-bold text-indigo-700">{qty(row.quantity)}</td>
                      <td className="p-2">{qty(row.buy_quantity)}</td>
                    </tr>
                  ))}
                  {!transfers.length && (
                    <tr><td colSpan="6" className="p-8 text-center text-slate-400">لا توجد تحويلات مطلوبة بين الفرعين.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            </section>
          </details>
          </>
          )}

          {activeStep === 3 && (
          <section className={`rounded-2xl border p-4 ${draftResult ? 'border-emerald-200 bg-emerald-50' : plan.creation_guard?.can_create_dual ? 'border-teal-200 bg-teal-50/60' : 'border-red-200 bg-red-50/60'}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-black text-slate-900">إنشاء مسودتي شكري والشامي</h2>
                  <span className={`rounded-full border bg-white px-2.5 py-1 text-xs font-black ${
                    draftResult
                      ? 'border-emerald-200 text-emerald-700'
                      : plan.creation_guard?.can_create_dual
                        ? 'border-teal-200 text-teal-700'
                        : 'border-red-200 text-red-700'
                  }`}>
                    {draftResult ? 'تم ✓' : plan.creation_guard?.can_create_dual ? 'جاهزة للإنشاء' : 'متوقفة'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  نفس كميات الخطة بدون إعادة حساب، وبدون اعتماد أو إرسال للمورد.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label="إجمالي الطلبية" value={`${money(draftOrderTotal)} ج`} tone="teal" />
                  <Metric label="شكري" value={`${money(plan.shokry?.summary?.suggested_buy_value)} ج`} tone="indigo" />
                  <Metric label="الشامي" value={`${money(plan.shamy?.summary?.suggested_buy_value)} ج`} tone="indigo" />
                  <Metric label="أصناف الشراء" value={plan.totals?.buy_items || 0} tone="slate" />
                </div>
                {plan.creation_guard?.can_create_dual === false && !draftResult && (
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <div className="font-black">إنشاء المسودتين متوقف مؤقتًا.</div>
                    {(!plan.creation_guard?.shokry_data_ready || !plan.creation_guard?.shamy_data_ready) && (
                      <div className="mt-2 rounded border border-red-100 bg-white/70 px-2 py-1">
                        بيانات التشغيل تحتاج تحديث:
                        {!plan.creation_guard?.shokry_data_ready ? ' شكري غير جاهز.' : ''}
                        {!plan.creation_guard?.shamy_data_ready ? ' الشامي غير جاهز.' : ''}
                      </div>
                    )}
                    {(plan.creation_guard?.shokry_open_order || plan.creation_guard?.shamy_open_order) && (
                      <>
                        <div className="mt-2 font-bold">طلبيات مفتوحة تمنع إنشاء مسودة جديدة:</div>
                        <div className="mt-1 space-y-1">
                          {[...(plan.creation_guard?.shokry_open_orders || []), ...(plan.creation_guard?.shamy_open_orders || [])].map((order) => (
                            <div key={order.id} className="rounded border border-red-100 bg-white/70 px-2 py-1">
                              <span className="font-mono">{order.order_number}</span>
                              {' • '}{order.status}
                              {' • '}{new Date(order.created_at).toLocaleDateString('ar-EG')}
                              {order.title ? ` • ${order.title}` : ''}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
                {draftResult && (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
                    {draftResult.recovered_existing
                      ? 'تم استعادة مسودتي شكري والشامي الموجودتين لأن محتواهما يطابق الخطة الحالية بندًا بندًا.'
                      : draftResult.already_created
                        ? 'المسودتان كانتا منشأتين بالفعل من نفس الخطة.'
                        : 'تم إنشاء المسودتين بنجاح من نفس الخطة.'}
                    {draftResult.content_verified && (
                      <div className="mt-1 font-bold">✓ تم التحقق حسابيًا أن محتوى المسودتين يطابق خطة V10 بدون أي اختلاف.</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
          )}

          {draftResult && activeStep === 4 && (
            <CleanSupplierFinancialWorkspace
              rows={supplierWorkspace.rows}
              groups={supplierWorkspace.groups}
              scenarios={supplierWorkspace.scenarios}
              loading={supplierWorkspace.loading}
              error={supplierWorkspace.error}
              message={supplierWorkspace.message}
              applying={supplierWorkspace.applying}
              currentOfferPlans={supplierWorkspace.currentOfferPlans}
              draftTotals={supplierWorkspace.draftTotals}
              onApplyCurrentOffers={applyCurrentOffersForBranch}
              onRefresh={() => loadSupplierWorkspace(draftResult)}
            />
          )}

          {activeStep === 5 && draftResult && (
            <section className="space-y-4">
              <div className={`rounded-2xl border p-5 shadow-sm ${
                supplierDecision.readyForSupplierConfirmation
                  ? 'border-emerald-200 bg-emerald-50/60'
                  : 'border-amber-200 bg-amber-50/70'
              }`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-black text-slate-950">المراجعة النهائية للطلبية</h2>
                    <p className="mt-1 text-sm text-slate-700">
                      راجع القرار في شاشة واحدة. لا يوجد اعتماد أو إرسال تلقائي من هذه الخطوة.
                    </p>
                  </div>
                  <span className={`rounded-full border bg-white px-3 py-1 text-xs font-black ${
                    supplierDecision.readyForSupplierConfirmation
                      ? 'border-emerald-200 text-emerald-800'
                      : 'border-amber-200 text-amber-800'
                  }`}>
                    {supplierDecision.readyForSupplierConfirmation
                      ? 'الموردون والتكلفة مكتملان للمراجعة'
                      : 'تحتاج تأكيد مورد/سعر قبل الاعتماد'}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                  <Metric label="إجمالي الطلبية" value={`${money(draftOrderTotal)} ج`} />
                  <Metric label="مرجع التكلفة" value={`${money(liveReferenceTotal)} ج`} />
                  <Metric label="فرق تقديري" value={`${money(estimatedPurchaseGap)} ج`} />
                  <Metric label="أصناف الطلبية" value={plan?.totals?.buy_items || 0} />
                  <Metric label="تغطية التحليل التاريخي" value={`${supplierDecision.historicalItems}/${supplierDecision.totalItems}`} />
                  <Metric label="المصدر المعتمد" value="فواتير المشتريات" />
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {supplierBranchDecision.map((branch) => (
                    <div key={branch.branch} className="rounded-xl border bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-black text-slate-900">{branch.branch}</div>
                        <div className="text-lg font-black text-teal-800">{money(branch.value)} ج</div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                        <div><span className="text-slate-400">أصناف</span><div className="font-black">{branch.items}</div></div>
                        <div><span className="text-slate-400">موردون</span><div className="font-black">{branch.suppliers}</div></div>
                        <div><span className="text-slate-400">حالي</span><div className="font-black text-emerald-700">{branch.current}</div></div>
                        <div><span className="text-slate-400">تاريخي</span><div className="font-black text-amber-700">{branch.historical}</div></div>
                        <div><span className="text-slate-400">ناقص</span><div className={`font-black ${branch.missingSupplier || branch.missingCost ? 'text-red-700' : 'text-emerald-700'}`}>{branch.missingSupplier + branch.missingCost}</div></div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label="موردون مقترحون" value={supplierWorkspace.groups.filter((group) => group.supplier_name !== 'غير محدد').length} />
                  <Metric label="بدون مورد فعلي" value={supplierDecision.missingSupplierItems} />
                  <Metric label="بدون تكلفة" value={supplierDecision.missingCostItems} />
                  <Metric label="مطابقة المسودتين للخطة" value={draftResult.content_verified ? 'مؤكدة ✓' : 'تحتاج مراجعة'} />
                </div>

                {!supplierDecision.readyForSupplierConfirmation && (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm text-amber-900">
                    {supplierDecision.missingSupplierItems > 0 && (
                      <div className="font-bold">• {supplierDecision.missingSupplierItems} صنف بدون مورد فعلي محدد.</div>
                    )}
                    {supplierDecision.missingCostItems > 0 && (
                      <div className="mt-1 font-bold">• {supplierDecision.missingCostItems} صنف بدون تكلفة صالحة.</div>
                    )}
                    {supplierMissingRows.length > 0 && (
                      <div className="mt-3 grid gap-1 md:grid-cols-2">
                        {supplierMissingRows.map((row) => (
                          <div key={`${row.branch}-${row.item_id || row.product_code || row.product_name}`} className="rounded-lg border border-amber-100 bg-amber-50/40 px-2 py-1.5 text-xs">
                            <span className="font-black">{row.product_name}</span>
                            <span className="text-slate-500"> • {row.branch}</span>
                            {row.product_code ? <span className="text-slate-400"> • {row.product_code}</span> : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <section className="rounded-2xl border bg-white p-4 shadow-sm">
                <div className="mb-3 font-black text-slate-900">Checklist الجاهزية</div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {[
                    {
                      label: 'مطابقة المسودتين للخطة',
                      ok: Boolean(draftResult.content_verified),
                      note: draftResult.content_verified ? 'مطابقة مؤكدة' : 'تحتاج مراجعة',
                    },
                    {
                      label: 'التكلفة مكتملة',
                      ok: supplierDecision.missingCostItems === 0,
                      note: supplierDecision.missingCostItems === 0 ? 'لا توجد تكلفة مفقودة' : `${supplierDecision.missingCostItems} صنف ناقص تكلفة`,
                    },
                    {
                      label: 'الموردون محددون',
                      ok: supplierDecision.missingSupplierItems === 0,
                      note: supplierDecision.missingSupplierItems === 0 ? 'كل الأصناف لها مورد' : `${supplierDecision.missingSupplierItems} صنف بدون مورد`,
                    },
                    {
                      label: 'التحليل التاريخي',
                      ok: supplierDecision.historicalCoverageComplete,
                      warn: !supplierDecision.historicalCoverageComplete,
                      note: supplierDecision.historicalCoverageComplete
                        ? `مكتمل ${supplierDecision.historicalItems}/${supplierDecision.totalItems}`
                        : `مغطى ${supplierDecision.historicalItems}/${supplierDecision.totalItems}`,
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className={`rounded-xl border p-3 ${
                        item.ok
                          ? 'border-emerald-200 bg-emerald-50'
                          : item.warn
                            ? 'border-amber-200 bg-amber-50'
                            : 'border-red-200 bg-red-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-black text-slate-900">{item.label}</span>
                        <span className={`text-lg font-black ${
                          item.ok ? 'text-emerald-700' : item.warn ? 'text-amber-700' : 'text-red-700'
                        }`}>
                          {item.ok ? '✓' : item.warn ? '!' : '×'}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-600">{item.note}</div>
                    </div>
                  ))}
                </div>
              </section>

              {supplierDecision.topGroups.length > 0 && (
                <section className="rounded-2xl border bg-white p-4 shadow-sm">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-black text-slate-900">أهم الموردين المقترحين</h3>
                      <p className="mt-1 text-xs text-slate-500">أعلى الموردين حسب القيمة المرجعية الحالية.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveStep(4)}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700"
                    >
                      تعديل توزيع الموردين
                    </button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {supplierDecision.topGroups.map((group) => (
                      <div key={group.supplier_name} className="rounded-xl border bg-slate-50/70 p-3">
                        <div className="font-black text-slate-900">{group.supplier_name}</div>
                        <div className="mt-2 flex items-center justify-between text-sm text-slate-600">
                          <span>{group.items_count} صنف • {qty(group.units)} وحدة</span>
                          <span className="font-black text-slate-900">{money(group.estimated_cash_total)} ج</span>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          تاريخ مشتريات {group.historical_reference_items} صنف
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <div className="flex flex-wrap justify-between gap-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-600">
                  الخطوة التالية لاحقًا: اعتماد مقصود ثم إرسال المورد — غير تلقائي
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {activeStep === 1 && !plan && !busy && !error && (
        <section className="rounded-2xl border border-dashed bg-white p-10 text-center text-slate-400">
          <FileSpreadsheet className="mx-auto mb-3 h-10 w-10" />
          ارفع ملف الرصيد لبدء الرحلة الجديدة.
        </section>
      )}

      <JourneyActionBar
        step={activeStep}
        busy={busy}
        plan={plan}
        saveResult={saveResult}
        draftResult={draftResult}
        supplierReady={supplierReady}
        onStepChange={setActiveStep}
        onReplan={replan}
        onCreateDrafts={createDrafts}
      />
    </div>
  );
}
