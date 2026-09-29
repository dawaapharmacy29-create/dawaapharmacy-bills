import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Layers3,
  Store,
  WalletCards,
} from 'lucide-react';

const money = (value) =>
  new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(value || 0));

const qty = (value) =>
  new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(value || 0));

const sourceLabel = {
  current_offer: 'عرض حالي',
  historical_average: 'متوسط مشتريات تاريخي',
  historical_last: 'آخر تكلفة تاريخية',
  draft_saved_cost: 'تكلفة محفوظة في المسودة',
  planner_reference: 'مرجع الخطة',
  missing: 'بدون تكلفة',
};

const coverageLabel = {
  current_offer: 'عرض حالي',
  historical_reference: 'مرجع تاريخي',
  missing: 'يحتاج سعر',
};

function safeSheetName(value, used) {
  const base = String(value || 'غير محدد')
    .replace(/[\\/?*\[\]:]/g, ' ')
    .trim()
    .slice(0, 28) || 'غير محدد';
  let name = base;
  let suffix = 2;
  while (used.has(name)) {
    name = `${base.slice(0, 25)} ${suffix}`;
    suffix += 1;
  }
  used.add(name);
  return name;
}

function addAutoWidth(sheet, rows) {
  const headers = Object.keys(rows[0] || {});
  sheet['!cols'] = headers.map((header) => ({
    wch: Math.min(
      42,
      Math.max(
        10,
        String(header).length + 2,
        ...rows.slice(0, 300).map((row) => String(row[header] ?? '').length + 2)
      )
    ),
  }));
}

function splitExportRow(row) {
  return {
    الفرع: row.branch,
    'كود الصنف': row.product_code || '',
    الصنف: row.product_name,
    الكمية: Number(row.quantity || 0),
    المورد: row.supplier_name || 'غير محدد',
    'مصدر السعر': sourceLabel[row.cost_source] || row.cost_source,
    'تكلفة الوحدة النقدية': Number(row.cash_unit_cost || row.unit_cost || 0),
    'التكلفة الفعالة بعد البونص': Number(row.effective_unit_cost || row.unit_cost || 0),
    'قيمة السطر النقدية': Number(row.cash_cost || 0),
    'بونص متوقع': Number(row.bonus_units || 0),
    'خصم أساسي %': row.discount_percent ?? '',
    'خصم إضافي %': row.extra_discount_percent ?? '',
    'وفر فعلي تقديري %': row.effective_saving_percent == null ? '' : Number(row.effective_saving_percent.toFixed(2)),
    'أفضل مورد تاريخي': row.historical_supplier || '',
    'متوسط التكلفة التاريخية': Number(row.historical_effective_unit_cost || 0),
    'آخر شراء تاريخي': row.historical_last_purchase_date || '',
    'سبب اختيار المورد المالي': row.financial_supplier_reason || '',
    'المورد الموصى به تشغيليًا': row.operational_recommended_supplier || '',
    'سبب التوصية التشغيلية': row.operational_recommendation_reason || '',
    'بدائل حالية': (row.alternatives || []).map((alt) => `${alt.supplier_name || '—'} (${Number(alt.effective_unit_cost || 0).toFixed(2)})`).join(' | '),
    'يوجد عرض حالي': row.current_offer ? 'نعم' : 'لا',
    'مثبت في المسودة': row.current_offer_applied ? 'نعم' : 'لا',
  };
}

function singleExportRow(row) {
  return {
    الفرع: row.branch,
    'كود الصنف': row.product_code || '',
    الصنف: row.product_name,
    الكمية: Number(row.quantity || 0),
    المورد: row.supplier_name || '',
    التغطية: coverageLabel[row.coverage] || row.coverage,
    'تكلفة الوحدة النقدية': Number(row.cash_unit_cost || row.unit_cost || 0),
    'التكلفة الفعالة بعد البونص': Number(row.effective_unit_cost || row.unit_cost || 0),
    'قيمة نقدية تقديرية': Number(row.cash_cost || 0),
    'بونص متوقع': Number(row.bonus_units || 0),
    ملاحظة:
      row.coverage === 'current_offer'
        ? 'يوجد عرض حالي لهذا المورد'
        : row.coverage === 'historical_reference'
          ? 'السعر من تاريخ المشتريات ويحتاج تأكيد قبل الإرسال'
          : row.constraint === 'offer_changes_v10_quantity'
            ? 'يوجد عرض لكن MOQ يغيّر كمية V10 — يحتاج تفاوض'
            : row.constraint === 'insufficient_availability'
              ? 'يوجد عرض لكن التوافر لا يغطي كمية V10'
              : 'لا يوجد سعر/عرض كافٍ لهذا المورد — يحتاج تواصل يدوي',
  };
}

export default function CleanSupplierFinancialWorkspace({
  rows = [],
  groups = [],
  scenarios = [],
  loading = false,
  applying = '',
  message = '',
  error = '',
  currentOfferPlans = {},
  draftTotals = {},
  onApplyCurrentOffers = null,
}) {
  const [mode, setMode] = useState('split');
  const [supplierChoice, setSupplierChoice] = useState('');

  const selectedSupplier = supplierChoice || scenarios[0]?.supplier_name || '';
  const selectedScenario = scenarios.find((scenario) => scenario.supplier_name === selectedSupplier) || null;

  const summary = useMemo(() => {
    const total = rows.reduce((sum, row) => sum + Number(row.cash_cost || 0), 0);
    const currentRows = rows.filter((row) => row.cost_source === 'current_offer');
    const appliedRows = rows.filter((row) => row.current_offer_applied === true);
    const historicalRows = rows.filter((row) => ['historical_average', 'historical_last'].includes(row.cost_source));
    const draftRows = rows.filter((row) => row.cost_source === 'draft_saved_cost');
    const currentTotal = currentRows.reduce((sum, row) => sum + Number(row.cash_cost || 0), 0);
    const appliedTotal = appliedRows.reduce((sum, row) => sum + Number(row.cash_cost || 0), 0);
    const historicalTotal = historicalRows.reduce((sum, row) => sum + Number(row.cash_cost || 0), 0);
    const draftTotal = draftRows.reduce((sum, row) => sum + Number(row.cash_cost || 0), 0);
    const missing = rows.filter((row) => Number(row.unit_cost || 0) <= 0).length;
    return {
      total,
      current: currentRows.length,
      applied: appliedRows.length,
      historical: historicalRows.length,
      draft: draftRows.length,
      currentTotal,
      appliedTotal,
      historicalTotal,
      draftTotal,
      missing,
    };
  }, [rows]);

  const storedDraftTotal = Number(draftTotals?.shokry || 0) + Number(draftTotals?.shamy || 0);
  const draftFinancialGap = storedDraftTotal - summary.total;
  const draftFinancialGapPercent = summary.total > 0 ? (draftFinancialGap / summary.total) * 100 : 0;

  const singleSupplierComparison = useMemo(() => {
    if (!selectedScenario || selectedScenario.missing_items > 0 || summary.total <= 0) return null;
    const difference = Number(selectedScenario.estimated_total || 0) - summary.total;
    return {
      difference,
      percent: summary.total > 0 ? (difference / summary.total) * 100 : 0,
    };
  }, [selectedScenario, summary.total]);

  function exportSplitWorkbook() {
    const workbook = XLSX.utils.book_new();
    const used = new Set();

    const summaryRows = groups.map((group) => ({
      المورد: group.supplier_name,
      'عدد الأصناف': group.items_count,
      الوحدات: Number(group.units || 0),
      'قيمة تقديرية': Number(group.estimated_cash_total || 0),
      'بعرض حالي': group.current_offer_items,
      'بمرجع تاريخي': group.historical_reference_items,
      'بدون تكلفة': group.missing_cost_items,
      'وفر/خصم فعلي %': group.weighted_saving_percent == null ? '' : Number(group.weighted_saving_percent.toFixed(2)),
    }));
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    addAutoWidth(summarySheet, summaryRows);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'ملخص الموردين');
    used.add('ملخص الموردين');

    for (const group of groups) {
      const data = group.items.map(splitExportRow);
      const sheet = XLSX.utils.json_to_sheet(data);
      addAutoWidth(sheet, data);
      XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(group.supplier_name, used));
    }

    const allRows = rows.map(splitExportRow);
    const allSheet = XLSX.utils.json_to_sheet(allRows);
    addAutoWidth(allSheet, allRows);
    XLSX.utils.book_append_sheet(workbook, allSheet, safeSheetName('كل الأصناف', used));

    XLSX.writeFile(workbook, `طلبية_مقسمة_حسب_افضل_مورد_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportSingleSupplierWorkbook() {
    if (!selectedScenario) return;
    const workbook = XLSX.utils.book_new();
    const summaryRows = [{
      المورد: selectedScenario.supplier_name,
      'إجمالي الأصناف': selectedScenario.items_count,
      'عروض حالية': selectedScenario.current_offer_items,
      'مراجع تاريخية فقط': selectedScenario.historical_reference_items,
      'بدون تغطية سعرية': selectedScenario.missing_items,
      'تغطية بعروض حالية %': Number(selectedScenario.current_coverage_percent.toFixed(2)),
      'تغطية مع التاريخ %': Number(selectedScenario.reference_coverage_percent.toFixed(2)),
      'قيمة تقديرية': Number(selectedScenario.estimated_total || 0),
    }];
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    addAutoWidth(summarySheet, summaryRows);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'ملخص');

    const rowsForSheet = selectedScenario.rows.map(singleExportRow);
    const sheet = XLSX.utils.json_to_sheet(rowsForSheet);
    addAutoWidth(sheet, rowsForSheet);
    XLSX.utils.book_append_sheet(workbook, sheet, 'الطلبية الموحدة');

    XLSX.writeFile(
      workbook,
      `طلبية_موحدة_${String(selectedScenario.supplier_name).replace(/[^\p{L}\p{N}_-]+/gu, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm font-bold text-blue-800">
        جاري حساب أفضل مورد والتكلفة الحقيقية لكل صنف من العروض الحالية وتاريخ المشتريات...
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="font-black">تعذر تحميل ذكاء الموردين بالكامل.</div>
            <div className="mt-1">{error}</div>
            <div className="mt-1 text-xs">المسودتان لم تتغيرا، ويمكن إعادة تحميل تحليل الموردين لاحقًا.</div>
          </div>
        </div>
      </section>
    );
  }

  if (!rows.length) return null;

  return (
    <section className="space-y-4 rounded-3xl border border-indigo-200 bg-indigo-50/30 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black text-indigo-950">
            <WalletCards className="h-5 w-5" />
            التكلفة الحقيقية وتوزيع الموردين
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-indigo-800">
            الأولوية لعرض حالي يحافظ على كمية V10؛ وإلا نستخدم متوسط التكلفة الفعلية من تاريخ المشتريات كمرجع. القيمة النقدية تمثل المتوقع دفعه للمورد، أما التكلفة الفعالة فتأخذ البونص في الاعتبار. المرجع التاريخي لا يُعتبر سعرًا حاليًا مؤكدًا قبل الإرسال.
          </p>
        </div>
        <div className="flex rounded-xl border bg-white p-1 text-sm font-bold">
          <button
            type="button"
            onClick={() => setMode('split')}
            className={`rounded-lg px-3 py-2 ${mode === 'split' ? 'bg-indigo-700 text-white' : 'text-slate-600'}`}
          >
            أفضل مورد لكل صنف
          </button>
          <button
            type="button"
            onClick={() => setMode('single')}
            className={`rounded-lg px-3 py-2 ${mode === 'single' ? 'bg-indigo-700 text-white' : 'text-slate-600'}`}
          >
            مخزن واحد للطلبية
          </button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-8">
        <Metric icon={Layers3} label="أصناف لها توزيع" value={rows.length} />
        <Metric icon={CheckCircle2} label="لها عرض حالي صالح" value={`${summary.current} • ${money(summary.currentTotal)} ج`} />
        <Metric icon={CheckCircle2} label="مثبت فعليًا في المسودة" value={`${summary.applied} • ${money(summary.appliedTotal)} ج`} />
        <Metric icon={Store} label="متوسط تاريخي" value={`${summary.historical} • ${money(summary.historicalTotal)} ج`} />
        <Metric icon={WalletCards} label="تكلفة محفوظة بالمسودة" value={`${summary.draft} • ${money(summary.draftTotal)} ج`} />
        <Metric icon={AlertTriangle} label="بدون تكلفة" value={summary.missing} />
        <Metric icon={WalletCards} label="إجمالي تقديري" value={`${money(summary.total)} ج`} />
        <Metric icon={CheckCircle2} label="نسبة مثبتة" value={rows.length ? `${qty((summary.applied / rows.length) * 100)}%` : '0%'} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
          <div className="text-xs font-bold text-teal-700">إجمالي المسودة المخزن — شكري</div>
          <div className="mt-1 text-xl font-black">{money(draftTotals?.shokry)} ج</div>
        </div>
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
          <div className="text-xs font-bold text-teal-700">إجمالي المسودة المخزن — الشامي</div>
          <div className="mt-1 text-xl font-black">{money(draftTotals?.shamy)} ج</div>
        </div>
        <div className="rounded-xl border bg-white p-3 text-sm">
          <div className="text-xs font-bold text-slate-500">إجمالي المسودتين المخزن</div>
          <div className="mt-1 text-xl font-black text-slate-900">{money(storedDraftTotal)} ج</div>
        </div>
        <div className={`rounded-xl border p-3 text-sm ${
          Math.abs(draftFinancialGapPercent) <= 1
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : 'border-amber-200 bg-amber-50 text-amber-900'
        }`}>
          <div className="text-xs font-bold">فرق المسودة عن الحساب المالي المرجعي</div>
          <div className="mt-1 text-xl font-black">
            {draftFinancialGap >= 0 ? '+' : ''}{money(draftFinancialGap)} ج
          </div>
          <div className="text-xs">{draftFinancialGapPercent >= 0 ? '+' : ''}{qty(draftFinancialGapPercent)}%</div>
        </div>
      </div>

      {Math.abs(draftFinancialGapPercent) > 1 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          إجمالي المسودة المخزن مختلف عن أفضل تقدير مالي الحالي. ثبّت العروض الحالية الآمنة أولًا؛ الأصناف المعتمدة على التاريخ تظل تقديرية حتى تأكيد السعر.
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {[
          ['shokry', 'دواء شكري'],
          ['shamy', 'دواء الشامي'],
        ].map(([key, label]) => {
          const offerPlan = currentOfferPlans?.[key] || {};
          return (
            <div key={key} className="rounded-2xl border bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-black text-slate-900">{label} — تثبيت العروض الحالية</div>
                  <div className="mt-1 text-xs text-slate-500">
                    جديد آمن بدون تغيير كمية V10: <b>{offerPlan.safe_items || 0}</b>
                    {' • '}مثبت بالفعل: <b>{offerPlan.already_applied_items || 0}</b>
                    {' • '}يحتاج مراجعة/بدون عرض: <b>{offerPlan.review_items || 0}</b>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!onApplyCurrentOffers || applying || !(offerPlan.items || []).length}
                  onClick={() => onApplyCurrentOffers?.(key)}
                  className="rounded-xl bg-indigo-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                >
                  {applying === key ? 'جاري التثبيت...' : (offerPlan.items || []).length ? 'تثبيت أفضل العروض الحالية' : 'لا توجد عروض جديدة آمنة'}
                </button>
              </div>
              {(offerPlan.skipped || []).some((row) => row.reason === 'offer_changes_v10_quantity') && (
                <div className="mt-2 text-xs font-bold text-amber-700">
                  بعض العروض مستبعدة لأنها تفرض MOQ يغير كمية V10؛ لم يتم تعديلها تلقائيًا.
                </div>
              )}
              {(offerPlan.skipped || []).some((row) => row.reason === 'insufficient_availability') && (
                <div className="mt-1 text-xs font-bold text-amber-700">
                  بعض العروض مستبعدة لأن التوافر المعلن لا يغطي الكمية.
                </div>
              )}
            </div>
          );
        })}
      </div>

      {message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
          {message}
        </div>
      )}

      {mode === 'split' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-black text-slate-800">التقسيم المقترح حسب أفضل مورد لكل صنف</div>
            <button
              type="button"
              onClick={exportSplitWorkbook}
              className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Excel حسب كل مخزن
            </button>
          </div>

          <div className="overflow-auto rounded-xl border bg-white">
            <table className="min-w-[1100px] w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-2 text-right">المورد</th>
                  <th className="p-2 text-right">الأصناف</th>
                  <th className="p-2 text-right">الوحدات</th>
                  <th className="p-2 text-right">بعرض حالي</th>
                  <th className="p-2 text-right">مرجع تاريخي</th>
                  <th className="p-2 text-right">بدون تكلفة</th>
                  <th className="p-2 text-right">القيمة</th>
                  <th className="p-2 text-right">وفر/خصم فعلي</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.supplier_name} className="border-t">
                    <td className="p-2 font-black text-indigo-900">{group.supplier_name}</td>
                    <td className="p-2">{group.items_count}</td>
                    <td className="p-2">{qty(group.units)}</td>
                    <td className="p-2 text-emerald-700">{group.current_offer_items}</td>
                    <td className="p-2 text-amber-700">{group.historical_reference_items}</td>
                    <td className="p-2 text-red-700">{group.missing_cost_items}</td>
                    <td className="p-2 font-bold">{money(group.estimated_cash_total)} ج</td>
                    <td className="p-2">{group.weighted_saving_percent == null ? '—' : `${qty(group.weighted_saving_percent)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-auto rounded-xl border bg-white">
            <table className="min-w-[2100px] w-full text-sm">
              <thead className="bg-indigo-50/60">
                <tr>
                  {['الفرع','الصنف','الكمية','أفضل مورد مالي','مصدر التكلفة','تكلفة نقدية/وحدة','فعالة بعد البونص','القيمة النقدية','خصم مسجل','خصم إضافي','وفر فعلي تقديري','بونص','سبب الاختيار المالي','بدائل حالية','المورد التاريخي'].map((head) => (
                    <th key={head} className="p-2 text-right">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((row) => (
                  <tr key={`${row.branch}-${row.item_id || row.product_code || row.product_name}`} className="border-t">
                    <td className="p-2">{row.branch}</td>
                    <td className="p-2">
                      <div className="font-bold">{row.product_name}</div>
                      <div className="text-xs text-slate-400">{row.product_code || 'بدون كود'}</div>
                    </td>
                    <td className="p-2">{qty(row.quantity)}</td>
                    <td className="p-2 font-black text-indigo-900">{row.supplier_name || 'غير محدد'}</td>
                    <td className="p-2 text-xs">{sourceLabel[row.cost_source] || row.cost_source}</td>
                    <td className="p-2">{money(row.cash_unit_cost || row.unit_cost)} ج</td>
                    <td className="p-2">{money(row.effective_unit_cost || row.unit_cost)} ج</td>
                    <td className="p-2 font-bold">{money(row.cash_cost)} ج</td>
                    <td className="p-2">{row.discount_percent == null ? '—' : `${qty(row.discount_percent)}%`}</td>
                    <td className="p-2">{row.extra_discount_percent == null ? '—' : `${qty(row.extra_discount_percent)}%`}</td>
                    <td className="p-2">{row.effective_saving_percent == null ? '—' : `${qty(row.effective_saving_percent)}%`}</td>
                    <td className="p-2">{qty(row.bonus_units)}</td>
                    <td className="p-2 max-w-[300px] text-xs text-slate-600">
                      {row.financial_supplier_reason || '—'}
                    </td>
                    <td className="p-2 max-w-[260px] text-xs text-slate-500">
                      {(row.alternatives || []).slice(0, 2).map((alt) =>
                        `${alt.supplier_name || '—'} • ${money(alt.effective_unit_cost || 0)} ج`
                      ).join(' | ') || '—'}
                    </td>
                    <td className="p-2 text-xs text-slate-500">{row.historical_supplier || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 100 && (
            <div className="text-xs text-indigo-700">المعاينة تعرض أول 100 صنف فقط؛ ملف Excel يحتوي كل الأصناف.</div>
          )}
        </>
      )}

      {mode === 'single' && (
        <>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
            هذا الوضع يجهز طلبية تفاوض/شراء موحدة على مخزن واحد للفرعين. لا يغيّر المورد أو السعر داخل المسودتين تلقائيًا؛ الأسعار التاريخية تظل مرجعًا حتى يرسل المورد سعرًا حاليًا.
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(260px,420px)_1fr]">
            <label className="text-sm font-bold text-slate-700">
              اختر المخزن الذي تريد تجميع الطلبية عليه
              <select
                value={selectedSupplier}
                onChange={(event) => setSupplierChoice(event.target.value)}
                className="mt-1 w-full rounded-xl border bg-white p-3"
              >
                {scenarios.map((scenario) => (
                  <option key={scenario.supplier_name} value={scenario.supplier_name}>
                    {scenario.supplier_name} — عروض حالية {scenario.current_offer_items}/{scenario.items_count}
                  </option>
                ))}
              </select>
            </label>

            {selectedScenario && (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                <Metric icon={Store} label="المخزن" value={selectedScenario.supplier_name} />
                <Metric icon={CheckCircle2} label="تغطية بعروض حالية" value={`${qty(selectedScenario.current_coverage_percent)}%`} />
                <Metric icon={Layers3} label="مرجع تاريخي إضافي" value={selectedScenario.historical_reference_items} />
                <Metric icon={AlertTriangle} label="أصناف بدون سعر" value={selectedScenario.missing_items} />
                <Metric icon={WalletCards} label="قيمة تقديرية" value={`${money(selectedScenario.estimated_total)} ج`} />
              </div>
            )}
          </div>

          {selectedScenario && singleSupplierComparison && (
            <div className={`rounded-xl border p-3 text-sm ${
              singleSupplierComparison.difference <= 0
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-amber-200 bg-amber-50 text-amber-900'
            }`}>
              مقارنة بالتقسيم على أفضل مورد لكل صنف:
              <strong className="mx-1">
                {singleSupplierComparison.difference >= 0 ? '+' : ''}
                {money(singleSupplierComparison.difference)} ج
              </strong>
              ({singleSupplierComparison.percent >= 0 ? '+' : ''}{qty(singleSupplierComparison.percent)}%).
            </div>
          )}

          {selectedScenario && selectedScenario.missing_items > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              لا يتم حساب فرق تكلفة “مخزن واحد” مقابل التقسيم لأن هناك أصنافًا بلا سعر موثوق لهذا المخزن؛ أي مقارنة رقمية الآن ستكون ناقصة.
            </div>
          )}

          {selectedScenario && selectedScenario.missing_items > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              المخزن المختار لا يملك عرضًا حاليًا أو تاريخ شراء كافيًا لكل الأصناف. الملف سيُظهر الأصناف الناقصة بوضوح ولن يخترع لها سعرًا.
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              disabled={!selectedScenario}
              onClick={exportSingleSupplierWorkbook}
              className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Excel طلبية موحدة على {selectedSupplier || 'مخزن واحد'}
            </button>
          </div>

          {selectedScenario && (
            <div className="overflow-auto rounded-xl border bg-white">
              <table className="min-w-[1100px] w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    {['الفرع','الصنف','الكمية','التغطية','تكلفة نقدية/وحدة','فعالة بعد البونص','القيمة النقدية','بونص','ملاحظة'].map((head) => (
                      <th key={head} className="p-2 text-right">{head}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedScenario.rows.slice(0, 120).map((row) => (
                    <tr key={`${row.branch}-${row.product_code || row.product_name}`} className="border-t">
                      <td className="p-2">{row.branch}</td>
                      <td className="p-2">
                        <div className="font-bold">{row.product_name}</div>
                        <div className="text-xs text-slate-400">{row.product_code || 'بدون كود'}</div>
                      </td>
                      <td className="p-2">{qty(row.quantity)}</td>
                      <td className="p-2">
                        <span className={`rounded-full px-2 py-1 text-xs font-bold ${
                          row.coverage === 'current_offer'
                            ? 'bg-emerald-100 text-emerald-800'
                            : row.coverage === 'historical_reference'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-red-100 text-red-800'
                        }`}>
                          {coverageLabel[row.coverage]}
                        </span>
                      </td>
                      <td className="p-2">{row.cash_unit_cost > 0 ? `${money(row.cash_unit_cost)} ج` : '—'}</td>
                      <td className="p-2">{row.effective_unit_cost > 0 ? `${money(row.effective_unit_cost)} ج` : '—'}</td>
                      <td className="p-2 font-bold">{row.cash_cost > 0 ? `${money(row.cash_cost)} ج` : '—'}</td>
                      <td className="p-2">{qty(row.bonus_units)}</td>
                      <td className="p-2 text-xs text-slate-500">
                        {row.coverage === 'current_offer'
                          ? 'عرض حالي يحافظ على كمية V10'
                          : row.coverage === 'historical_reference'
                            ? 'من تاريخ المشتريات — يحتاج تأكيد السعر'
                            : row.constraint === 'offer_changes_v10_quantity'
                              ? 'يوجد عرض لكن MOQ يغيّر كمية V10 — يحتاج تفاوض'
                              : row.constraint === 'insufficient_availability'
                                ? 'يوجد عرض لكن التوافر لا يغطي كمية V10'
                                : 'تواصل مع المورد لتسعير الصنف'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border bg-white p-3">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {Icon ? <Icon className="h-4 w-4 text-indigo-700" /> : null}
        {label}
      </div>
      <div className="mt-1 font-black text-slate-900">{value}</div>
    </div>
  );
}
