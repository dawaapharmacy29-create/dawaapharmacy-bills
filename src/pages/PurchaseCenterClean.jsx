import { useMemo, useRef, useState } from 'react';
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
import { normalizeDualBranchStockRows } from '@/lib/dualBranchStockMaster';

const money = (value) =>
  new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(value || 0));

const qty = (value) =>
  new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(value || 0));

const BRANCH_META = {
  shokry: { label: 'دواء شكري' },
  shamy: { label: 'دواء الشامي' },
};

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
    .sort((a, b) => Number(b.buy_estimated_cost || 0) - Number(a.buy_estimated_cost || 0));

  return (
    <section className="rounded-2xl border bg-white shadow-sm overflow-hidden">
      <div className="border-b bg-slate-50/80 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-900">{meta.label}</h2>
            <p className="mt-1 text-sm text-slate-500">{modeLabel(mode?.mode)}</p>
          </div>
          <div className="rounded-xl border bg-white px-4 py-2 text-left">
            <div className="text-xs text-slate-500">شراء مقترح</div>
            <div className="text-xl font-black text-teal-700">{money(summary.suggested_buy_value)} ج</div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="أصناف شراء" value={summary.buy_now_items || 0} />
        <Metric label="نواقص حرجة" value={(summary.stockout_items || 0) + (summary.below_min_items || 0)} />
        <Metric label="احتياج الفترة" value={`${money(summary.period_need_value)} ج`} />
        <Metric label="شراء اليوم" value={`${money(summary.suggested_buy_value)} ج`} />
        <Metric label="تحويلات" value={(summary.transfer_only_items || 0) + (summary.transfer_then_buy_items || 0)} />
        <Metric label="Safe Order Today" value={`${money(mode?.safe_order_today)} ج`} />
      </div>
      <div className="mx-4 mb-4 flex flex-wrap gap-2 text-xs">
        <span className={`rounded-full border px-2 py-1 ${data?.method?.data_quality?.stock_snapshot_fresh ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          الرصيد {data?.method?.data_quality?.stock_snapshot_fresh ? 'حديث' : 'قديم'}
        </span>
        <span className={`rounded-full border px-2 py-1 ${data?.method?.data_quality?.movement_snapshot_fresh ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          الحركة {data?.method?.data_quality?.movement_snapshot_fresh ? 'حديثة' : 'قديمة'}
        </span>
        <span className={`rounded-full border px-2 py-1 ${data?.method?.data_quality?.financial_snapshot_fresh ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          الوضع المالي {data?.method?.data_quality?.financial_snapshot_fresh ? 'حديث' : 'قديم'}
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
                <th className="p-2 text-right">الرصيد</th>
                <th className="p-2 text-right">Min</th>
                <th className="p-2 text-right">Reorder</th>
                <th className="p-2 text-right">Max</th>
                <th className="p-2 text-right">الشراء</th>
                <th className="p-2 text-right">التحويل</th>
                <th className="p-2 text-right">القيمة</th>
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
                  <td className="p-2">{qty(row.current_stock)}</td>
                  <td className="p-2">{qty(row.min_stock)}</td>
                  <td className="p-2">{qty(row.reorder_stock)}</td>
                  <td className="p-2">{qty(row.max_stock)}</td>
                  <td className="p-2 font-bold text-teal-700">{qty(row.buy_quantity)}</td>
                  <td className="p-2">{qty(row.suggested_transfer_qty)}</td>
                  <td className="p-2 font-semibold">{money(row.buy_estimated_cost)} ج</td>
                  <td className="p-2 text-xs text-slate-500">{row.reason || row.decision}</td>
                </tr>
              ))}
              {!buyRows.length && (
                <tr><td colSpan="9" className="p-8 text-center text-slate-400">لا يوجد شراء خارجي مقترح لهذا الفرع.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-xl border bg-slate-50/60 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-black text-slate-800">{value}</div>
    </div>
  );
}

export default function PurchaseCenterClean() {
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState(null);
  const [saveResult, setSaveResult] = useState(null);
  const [plan, setPlan] = useState(null);
  const [draftResult, setDraftResult] = useState(null);
  const [timings, setTimings] = useState({ readMs: 0, saveMs: 0, planMs: 0, totalMs: 0 });
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const runRef = useRef(false);

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
          from: item.transfer_from_branch,
          to: toBranch,
          quantity: transferQuantity,
          buy_quantity: Number(item.buy_quantity || 0),
        });
      }
    }
    return rows;
  }, [plan]);

  async function readWorkbook(file) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('ملف Excel لا يحتوي على Sheet قابلة للقراءة.');
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: false });
    return normalizeDualBranchStockRows(rows, file.name);
  }

  async function runPlannerOnly(expectedSyncId = saveResult?.stock_sync_id) {
    setPhase('planning');
    const startedAt = performance.now();
    const result = await purchaseApi.dualBranchInstantPlan();
    if (result?.planner !== 'dual_branch_instant_plan_v1') {
      throw new Error('لم يتم تشغيل مخطط الفرعين المعتمد.');
    }
    if (expectedSyncId && result?.stock_sync_id !== expectedSyncId) {
      throw new Error('تم إيقاف الخطة لأن التحليل لا يطابق نفس نسخة ملف الرصيد المحفوظ.');
    }
    setPlan(result);
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

    try {
      setPhase('saving');
      const saveStartedAt = performance.now();
      const saved = await purchaseApi.saveDualBranchStockMaster(stockMaster);
      const saveMs = Math.round(performance.now() - saveStartedAt);
      setTimings((current) => ({ ...current, saveMs }));
      if (!saved?.shamy_atomic_finalize || !saved?.shokry_atomic_finalize) {
        throw new Error('تم إيقاف التحليل لأن حفظ الرصيد لم يكتمل بطريقة Atomic للفرعين.');
      }
      setSaveResult(saved);
      await runPlannerOnly(saved.stock_sync_id);
      setTimings((current) => ({ ...current, totalMs: Math.round(performance.now() - flowStartedAt) }));
    } catch (err) {
      setError(err?.message || 'تعذر تجهيز خطة المشتريات.');
      setPhase('error');
    } finally {
      runRef.current = false;
    }
  }

  async function replan() {
    if (runRef.current || !saveResult) return;
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
    setFileName(file.name);
    setParsed(null);
    setPlan(null);
    setDraftResult(null);
    setSaveResult(null);
    setError('');
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
      setPhase('ready');
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

  return (
    <div dir="rtl" className="mx-auto max-w-[1600px] space-y-5 p-3 md:p-5">
      <header className="rounded-3xl border bg-gradient-to-l from-white to-teal-50/70 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-teal-700">
              <ShoppingCart className="h-6 w-6" />
              <span className="text-sm font-bold">مركز المشتريات الجديد</span>
            </div>
            <h1 className="text-2xl font-black text-slate-900 md:text-3xl">ارفع الرصيد مرة واحدة — استلم خطتي الفرعين فورًا</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
              نفس عقل Min / Reorder / Max المعتمد، مع التحويل بين الفرعين والوضع المالي، بدون مسارات التغطية القديمة وبدون إعادة حساب بعد التحليل.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
            <ShieldCheck className="h-5 w-5" />
            Atomic Stock Sync + Integrity Guards
          </div>
        </div>
      </header>

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <label className={`flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition ${busy ? 'pointer-events-none opacity-60' : 'hover:border-teal-400 hover:bg-teal-50/30'}`}>
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            disabled={busy}
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
          <Upload className="mb-3 h-9 w-9 text-teal-600" />
          <div className="text-lg font-black text-slate-800">{fileName || 'اختر ملف رصيد شكري والشامي'}</div>
          <div className="mt-2 text-sm text-slate-500">بمجرد اختيار الملف يبدأ الحفظ والتحليل تلقائيًا.</div>
        </label>

        {parsed && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Metric label="صفوف الملف" value={parsed.rows_count} />
            <Metric label="أصناف مخزنية" value={parsed.inventory_rows} />
            <Metric label="الفرعين" value="شكري + الشامي" />
          </div>
        )}

        {busy && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-teal-200 bg-teal-50 p-3 text-teal-800">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="font-bold">{statusText}</span>
          </div>
        )}

        {error && (
          <div className="mt-4 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {saveResult && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <div className="flex items-center gap-2 font-bold">
              <CheckCircle2 className="h-5 w-5" />
              تم اعتماد الرصيد Atomic: شكري {saveResult.shokry_saved} صف • الشامي {saveResult.shamy_saved} صف
            </div>
            <div className="font-mono text-[11px] opacity-70">{saveResult.stock_sync_id}</div>
          </div>
        )}
      </section>

      {plan && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="إجمالي قيمة الشراء" value={`${money(plan.totals?.buy_value)} ج`} />
            <Metric label="إجمالي أصناف الشراء" value={plan.totals?.buy_items || 0} />
            <Metric label="أصناف التحويل" value={plan.totals?.transfer_items || 0} />
            <Metric label="تاريخ إنشاء الخطة" value={new Date(plan.generated_at).toLocaleString('ar-EG')} />
            <Metric label="معرّف الخطة" value={String(plan.plan_hash || '').slice(0, 12) || '—'} />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="قراءة الملف" value={`${timings.readMs} ms`} />
            <Metric label="حفظ الفرعين" value={`${timings.saveMs} ms`} />
            <Metric label="بناء الخطة" value={`${timings.planMs} ms`} />
            <Metric label="الزمن الكلي" value={timings.totalMs ? `${(timings.totalMs / 1000).toFixed(2)} ثانية` : '—'} />
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <BranchPlanCard branchKey="shokry" data={plan.shokry} mode={plan.modes?.['دواء شكري']} />
            <BranchPlanCard branchKey="shamy" data={plan.shamy} mode={plan.modes?.['دواء الشامي']} />
          </div>

          <section className="rounded-2xl border bg-white p-4 shadow-sm">
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
                      <td className="p-2">{row.from || '—'}</td>
                      <td className="p-2">{row.to}</td>
                      <td className="p-2 font-bold text-indigo-700">{qty(row.quantity)}</td>
                      <td className="p-2">{qty(row.buy_quantity)}</td>
                    </tr>
                  ))}
                  {!transfers.length && (
                    <tr><td colSpan="5" className="p-8 text-center text-slate-400">لا توجد تحويلات مطلوبة بين الفرعين.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="font-black text-amber-900">المرحلة الحالية: مراجعة الخطة ثم إنشاء المسودتين</div>
                <div className="mt-1 text-sm text-amber-800">
                  المسودتان ستُنشآن من نفس plan_hash بدون إعادة حساب الكميات. لا يوجد اعتماد أو إرسال للمورد في هذه الخطوة.
                </div>
                {plan.creation_guard?.can_create_dual === false && (
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
                    {draftResult.already_created ? 'المسودتان كانتا منشأتين بالفعل من نفس الخطة.' : 'تم إنشاء المسودتين بنجاح من نفس الخطة.'}
                    <div className="mt-1 font-mono text-[11px]">
                      شكري: {draftResult.shokry_order_id || '—'} • الشامي: {draftResult.shamy_order_id || '—'}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || !saveResult}
                  onClick={replan}
                  className="flex items-center gap-2 rounded-xl border border-amber-300 bg-white px-4 py-2 font-bold text-amber-900 disabled:opacity-40"
                >
                  <RefreshCw className="h-4 w-4" />
                  إعادة التحليل
                </button>
                <button
                  type="button"
                  disabled={busy || !plan.creation_guard?.can_create_dual || Boolean(draftResult)}
                  onClick={createDrafts}
                  className="flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 font-bold text-white disabled:opacity-40"
                >
                  <ShoppingCart className="h-4 w-4" />
                  إنشاء مسودتي شكري والشامي
                </button>
              </div>
            </div>
          </section>
        </>
      )}

      {!plan && !busy && !error && (
        <section className="rounded-2xl border border-dashed bg-white p-10 text-center text-slate-400">
          <FileSpreadsheet className="mx-auto mb-3 h-10 w-10" />
          ارفع ملف الرصيد لبدء الرحلة الجديدة.
        </section>
      )}
    </div>
  );
}
