import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  RefreshCw,
  Store,
  WalletCards,
} from 'lucide-react';
import { buildSupplierGroups } from '@/lib/purchaseSupplierFinancials';

const money = (value) =>
  new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(value || 0));

const qty = (value) =>
  new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(value || 0));

const sourceLabel = {
  historical_average: 'متوسط تاريخي',
  historical_last: 'آخر تكلفة تاريخية',
  missing: 'بدون تكلفة',
};

const confidenceLabel = {
  high: 'عالية',
  medium: 'متوسطة',
  low: 'منخفضة',
  missing: 'غير متاحة',
};

const confidenceClass = {
  high: 'bg-emerald-100 text-emerald-800',
  medium: 'bg-blue-100 text-blue-800',
  low: 'bg-amber-100 text-amber-800',
  missing: 'bg-red-100 text-red-800',
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

function exportRow(row) {
  return {
    الفرع: row.branch,
    'كود الصنف': row.product_code || '',
    الصنف: row.product_name,
    الكمية: Number(row.quantity || 0),
    المورد: row.supplier_name || 'غير محدد',
    'ثقة التاريخ': confidenceLabel[row.historical_confidence] || row.historical_confidence || 'غير متاحة',
    'عدد مرات الشراء': Number(row.historical_purchase_events || 0),
    'آخر شراء': row.historical_last_purchase_date || '',
    'مصدر التكلفة': sourceLabel[row.cost_source] || row.cost_source || '',
    'تكلفة الوحدة': Number(row.unit_cost || 0),
    'قيمة السطر': Number(row.cash_cost || 0),
  };
}

export default function CleanSupplierFinancialWorkspace({
  rows = [],
  loading = false,
  applying = '',
  message = '',
  error = '',
  draftTotals = {},
  historicalApplied = false,
  onRefresh = null,
}) {
  const [branchFilter, setBranchFilter] = useState('all');

  const summary = useMemo(() => {
    const total = rows.reduce((sum, row) => sum + Number(row.cash_cost || 0), 0);
    const historical = rows.filter((row) =>
      row.cost_source === 'historical_average' || row.cost_source === 'historical_last'
    ).length;
    const missing = rows.filter((row) => Number(row.unit_cost || 0) <= 0).length;
    return { total, historical, missing };
  }, [rows]);

  const storedDraftTotal = Number(draftTotals?.shokry || 0) + Number(draftTotals?.shamy || 0);
  const historicalComparisonTotal =
    historicalApplied && storedDraftTotal > 0 ? storedDraftTotal : summary.total;
  const draftFinancialGap = storedDraftTotal - historicalComparisonTotal;
  const draftFinancialGapPercent =
    historicalComparisonTotal > 0 ? (draftFinancialGap / historicalComparisonTotal) * 100 : 0;

  const splitRows = useMemo(() => (
    branchFilter === 'all'
      ? rows
      : rows.filter((row) => row.branch === branchFilter)
  ), [branchFilter, rows]);

  const splitGroups = useMemo(() => buildSupplierGroups(splitRows), [splitRows]);

  const topSupplierGroups = useMemo(() => (
    splitGroups
      .filter((group) => String(group.supplier_name || '').trim() && group.supplier_name !== 'غير محدد')
      .slice(0, 5)
  ), [splitGroups]);

  function exportWorkbook() {
    const workbook = XLSX.utils.book_new();
    const used = new Set();

    const summaryRows = splitGroups.map((group) => ({
      المورد: group.supplier_name,
      'عدد الأصناف': group.items_count,
      الوحدات: Number(group.units || 0),
      'قيمة الطلب': Number(group.estimated_cash_total || 0),
      'أصناف بتاريخ شراء': group.historical_reference_items,
      'بدون تكلفة': group.missing_cost_items,
    }));
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    addAutoWidth(summarySheet, summaryRows);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'ملخص الموردين');
    used.add('ملخص الموردين');

    for (const group of splitGroups) {
      const data = group.items.map(exportRow);
      const sheet = XLSX.utils.json_to_sheet(data);
      addAutoWidth(sheet, data);
      XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(group.supplier_name, used));
    }

    const allRows = splitRows.map(exportRow);
    const allSheet = XLSX.utils.json_to_sheet(allRows);
    addAutoWidth(allSheet, allRows);
    XLSX.utils.book_append_sheet(workbook, allSheet, safeSheetName('كل الأصناف', used));

    const branchName = branchFilter === 'all' ? 'الفرعين' : branchFilter.replace('دواء ', '');
    XLSX.writeFile(workbook, `طلبية_تاريخية_${branchName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm font-bold text-blue-800">
        جاري تحليل فواتير المشتريات واختيار أفضل مورد تاريخي لكل صنف...
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="font-black">تعذر تحميل تحليل الموردين.</div>
            <div className="mt-1">{error}</div>
            <div className="mt-1 text-xs">المسودتان لم تتغيرا.</div>
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
            تحليل الموردين من فواتير المشتريات
          </h2>
          <p className="mt-1 text-sm text-indigo-800">
            الاختيار هنا تاريخي فقط: تكرار الشراء، حداثة التعامل، ثم التكلفة الفعلية.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onRefresh?.()}
          disabled={!onRefresh || loading || applying}
          className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-40"
        >
          <RefreshCw className="h-4 w-4" />
          إعادة التحليل
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <Metric icon={WalletCards} label="إجمالي المسودتين" value={`${money(storedDraftTotal)} ج`} />
        <Metric
          icon={WalletCards}
          label={historicalApplied ? 'القيمة التاريخية المثبتة' : 'القيمة التاريخية المقترحة'}
          value={`${money(historicalComparisonTotal)} ج`}
        />
        <Metric
          icon={AlertTriangle}
          label={historicalApplied ? 'فرق بعد التثبيت' : 'فرق عن المسودتين'}
          value={`${money(Math.abs(draftFinancialGap))} ج • ${qty(Math.abs(draftFinancialGapPercent))}%`}
        />
        <Metric icon={CheckCircle2} label="تغطية تاريخية" value={`${summary.historical}/${rows.length}`} />
        <Metric icon={Store} label="الموردون" value={splitGroups.filter((g) => g.supplier_name !== 'غير محدد').length} />
      </div>

      {summary.historical === rows.length && summary.missing === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900">
          ✓ كل أصناف الطلبية لها مورد وتكلفة من سجل المشتريات.
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">
          التغطية التاريخية مكتملة لـ {summary.historical} من {rows.length} صنف؛ راجع غير المغطى قبل التثبيت.
        </div>
      )}

      {message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
          {message}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {[
            ['all', 'الكل'],
            ['دواء شكري', 'شكري'],
            ['دواء الشامي', 'الشامي'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setBranchFilter(value)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-black ${
                branchFilter === value
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={exportWorkbook}
          className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white"
        >
          <FileSpreadsheet className="h-4 w-4" />
          تصدير Excel
        </button>
      </div>

      {topSupplierGroups.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {topSupplierGroups.map((group) => (
            <div key={group.supplier_name} className="rounded-xl border bg-white p-3 shadow-sm">
              <div className="truncate font-black text-indigo-950" title={group.supplier_name}>
                {group.supplier_name}
              </div>
              <div className="mt-2 text-xl font-black text-slate-900">{money(group.estimated_cash_total)} ج</div>
              <div className="mt-2 text-xs text-slate-600">{group.items_count} صنف • {qty(group.units)} وحدة</div>
            </div>
          ))}
        </div>
      )}

      <details className="rounded-xl border bg-white">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-bold text-slate-800">
          كل الموردين • {splitGroups.length}
        </summary>
        <div className="overflow-auto border-t">
          <table className="min-w-[760px] w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['المورد','الأصناف','الوحدات','تغطية تاريخية','بدون تكلفة','القيمة'].map((head) => (
                  <th key={head} className="p-2 text-right">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {splitGroups.map((group) => (
                <tr key={group.supplier_name} className="border-t">
                  <td className="p-2 font-black text-indigo-900">{group.supplier_name}</td>
                  <td className="p-2">{group.items_count}</td>
                  <td className="p-2">{qty(group.units)}</td>
                  <td className="p-2 text-emerald-700">{group.historical_reference_items}</td>
                  <td className="p-2 text-red-700">{group.missing_cost_items}</td>
                  <td className="p-2 font-bold">{money(group.estimated_cash_total)} ج</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="rounded-xl border bg-white">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-bold text-slate-800">
          تفاصيل الأصناف • {splitRows.length} صنف
        </summary>
        <div className="overflow-auto border-t">
          <table className="min-w-[1250px] w-full text-sm">
            <thead className="bg-indigo-50/60">
              <tr>
                {['الفرع','الصنف','الكمية','المورد','الثقة','مرات الشراء','آخر شراء','تكلفة الوحدة','القيمة'].map((head) => (
                  <th key={head} className="p-2 text-right">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {splitRows.slice(0, 150).map((row) => (
                <tr key={`${row.branch}-${row.item_id || row.product_code || row.product_name}`} className="border-t">
                  <td className="p-2">{row.branch}</td>
                  <td className="p-2">
                    <div className="font-bold">{row.product_name}</div>
                    <div className="text-xs text-slate-400">{row.product_code || 'بدون كود'}</div>
                  </td>
                  <td className="p-2">{qty(row.quantity)}</td>
                  <td className="p-2 font-black text-indigo-900">{row.supplier_name || 'غير محدد'}</td>
                  <td className="p-2">
                    <span className={`rounded-full px-2 py-1 text-xs font-black ${confidenceClass[row.historical_confidence] || confidenceClass.missing}`}>
                      {confidenceLabel[row.historical_confidence] || confidenceLabel.missing}
                    </span>
                  </td>
                  <td className="p-2">{row.historical_purchase_events || 0}</td>
                  <td className="p-2">{row.historical_last_purchase_date || '—'}</td>
                  <td className="p-2">{money(row.unit_cost)} ج</td>
                  <td className="p-2 font-bold">{money(row.cash_cost)} ج</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {splitRows.length > 150 && (
        <div className="text-xs text-indigo-700">
          المعاينة تعرض أول 150 صنف فقط؛ ملف Excel يحتوي كل الأصناف.
        </div>
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
