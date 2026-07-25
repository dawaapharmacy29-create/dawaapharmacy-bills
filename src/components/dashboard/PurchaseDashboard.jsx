import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import {
  calculatePurchaseSummary,
  isInvoiceExcluded,
  getInvoiceCashAmount,
  getInvoiceCreditAmount,
} from "@/lib/purchaseCalculations";
import {
  Package, Ban, ArrowRightLeft, Stethoscope, FileText,
  AlertTriangle, Wallet, CreditCard, TrendingUp,
  ArrowDownRight, ArrowUpRight, DollarSign,
} from "lucide-react";
import BranchSelector from "./BranchSelector";
import DashboardDetailModal from "./DashboardDetailModal";

const fmt = (n) => (n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 0 });

export default function PurchaseDashboard({ invoices, suppliers, branch, onBranchChange, dateFilter, isLoading }) {
  const [detail, setDetail] = useState({ open: false, title: "", invoices: [], formula: "" });

  const summary = useMemo(
    () => calculatePurchaseSummary(invoices, suppliers, { dateFrom: dateFilter.from, dateTo: dateFilter.to }),
    [invoices, suppliers, dateFilter]
  );

  const transfers = invoices.filter((i) => i.transaction_type === "internal_transfer");
  const incoming = branch !== "all" ? transfers.filter((i) => i.destination_branch === branch) : [];
  const outgoing = branch !== "all" ? transfers.filter((i) => i.source_branch === branch) : [];
  const shokryToShamy = transfers.filter((i) => i.source_branch === "دواء شكري" && i.destination_branch === "دواء الشامي");
  const shamyToShokry = transfers.filter((i) => i.source_branch === "دواء الشامي" && i.destination_branch === "دواء شكري");
  const incomplete = transfers.filter((i) => !i.source_branch || !i.destination_branch);

  const excludedInv = invoices.filter((i) => isInvoiceExcluded(i, suppliers).excluded);
  const excInternal = excludedInv.filter((i) => isInvoiceExcluded(i, suppliers).reason === "internal_transfer");
  const excManual = excludedInv.filter((i) => isInvoiceExcluded(i, suppliers).source === "manual");
  const excSupplier = excludedInv.filter((i) => isInvoiceExcluded(i, suppliers).source === "supplier");

  const nonExcluded = invoices.filter((i) => !isInvoiceExcluded(i, suppliers).excluded);
  const cashInv = nonExcluded.filter((i) => i.payment_type === "كاش");
  const creditInv = nonExcluded.filter((i) => i.payment_type === "آجل");
  const mixedInv = nonExcluded.filter((i) => i.payment_type === "مختلط");
  const totalPaid = invoices.reduce((s, i) => s + (i.paid_value || 0), 0);
  const totalRemaining = summary.gross_purchases - totalPaid;
  const netCredit = nonExcluded.reduce((s, i) => s + getInvoiceCreditAmount(i), 0);

  const medInv = nonExcluded.filter((i) => (i.purchase_category || "unclassified") === "medicines");
  const supInv = nonExcluded.filter((i) => i.purchase_category === "supplies_accessories");
  const uncInv = nonExcluded.filter((i) => (i.purchase_category || "unclassified") === "unclassified");

  const openDetail = (title, invs, formula) => setDetail({ open: true, title, invoices: invs, formula });
  const closeDetail = () => setDetail({ ...detail, open: false });

  const title = branch === "all" ? "تحليل مشتريات صيدليات دواء" : `تحليل مشتريات ${branch}`;
  const catTotal = summary.medicines_purchases + summary.supplies_accessories_purchases + summary.unclassified_purchases;

  if (isLoading) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-gray-200 border-t-teal-600 rounded-full animate-spin"></div>
          <span className="text-gray-400 mr-2">جاري تحميل البيانات...</span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-4">
      <div>
        <h3 className="font-bold text-gray-800 text-base">{title}</h3>
        <p className="text-xs text-gray-400">من {dateFilter.from} إلى {dateFilter.to}</p>
      </div>

      <BranchSelector value={branch} onChange={onBranchChange} />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="إجمالي المشتريات" value={fmt(summary.gross_purchases)} sub={`${summary.invoice_count} فاتورة`} icon={TrendingUp} color="text-blue-600" bg="bg-blue-50" onClick={() => openDetail("إجمالي المشتريات", invoices, "مجموع قيم جميع الفواتير")} />
        <StatCard label="صافي المشتريات" value={fmt(summary.net_purchases)} sub={`${nonExcluded.length} فاتورة`} icon={Package} color="text-green-600" bg="bg-green-50" onClick={() => openDetail("صافي المشتريات", nonExcluded, "إجمالي المشتريات - المستثنى")} />
        <StatCard label="إجمالي المستثنى" value={fmt(summary.excluded_purchases)} sub={`${excludedInv.length} فاتورة`} icon={Ban} color="text-red-600" bg="bg-red-50" onClick={() => openDetail("الفواتير المستثناة", excludedInv, "فواتير لا تدخل في صافي المشتريات")} />
        <StatCard label="عدد الفواتير" value={summary.invoice_count} sub={`${nonExcluded.length} صافي`} icon={FileText} color="text-teal-600" bg="bg-teal-50" isCurrency={false} onClick={() => openDetail("جميع الفواتير", invoices, "جميع فواتير الفترة")} />
      </div>

      {/* Category Breakdown */}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-2">تصنيف المشتريات (الصافي)</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <CategoryCard label="الأدوية" value={fmt(summary.medicines_purchases)} count={medInv.length} pct={catTotal > 0 ? (summary.medicines_purchases / catTotal) * 100 : 0} icon={Stethoscope} color="text-teal-600" bg="bg-teal-50" barColor="bg-teal-500" onClick={() => openDetail("مشتريات الأدوية", medInv, "فواتير مصنفة كأدوية (غير مستثناة)")} />
          <CategoryCard label="مستلزمات وإكسسوار" value={fmt(summary.supplies_accessories_purchases)} count={supInv.length} pct={catTotal > 0 ? (summary.supplies_accessories_purchases / catTotal) * 100 : 0} icon={Package} color="text-indigo-600" bg="bg-indigo-50" barColor="bg-indigo-500" onClick={() => openDetail("مشتريات المستلزمات والإكسسوار", supInv, "فواتير مصنفة كمستلزمات وإكسسوار (غير مستثناة)")} />
          <CategoryCard label="غير مصنفة" value={fmt(summary.unclassified_purchases)} count={uncInv.length} pct={catTotal > 0 ? (summary.unclassified_purchases / catTotal) * 100 : 0} icon={AlertTriangle} color="text-gray-600" bg="bg-gray-50" barColor="bg-gray-400" onClick={() => openDetail("فواتير غير مصنفة", uncInv, "فواتير تحتاج إلى تصنيف")} />
        </div>
        {uncInv.length > 0 && (
          <div className="mt-2 p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-amber-800 flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" />
              يوجد {uncInv.length} فاتورة بقيمة {fmt(summary.unclassified_purchases)} ج تحتاج إلى تصنيف
            </p>
            <Link to={`/invoices?branch=${encodeURIComponent(branch)}&category=unclassified`} className="text-xs px-3 py-1.5 bg-amber-600 text-white rounded-md hover:bg-amber-700 whitespace-nowrap">
              مراجعة الفواتير غير المصنفة
            </Link>
          </div>
        )}
      </div>

      {/* Internal Transfers */}
      {summary.internal_transfers_count > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
            <ArrowRightLeft className="w-3.5 h-3.5" /> التحويلات الداخلية
          </p>
          {branch !== "all" ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <MiniCard label={`تحويلات واردة إلى ${branch}`} value={fmt(incoming.reduce((s, i) => s + (i.total_value || 0), 0))} count={incoming.length} icon={ArrowDownRight} color="text-green-600" bg="bg-green-50" onClick={() => openDetail(`التحويلات الواردة إلى ${branch}`, incoming)} />
              <MiniCard label={`تحويلات صادرة من ${branch}`} value={fmt(outgoing.reduce((s, i) => s + (i.total_value || 0), 0))} count={outgoing.length} icon={ArrowUpRight} color="text-orange-600" bg="bg-orange-50" onClick={() => openDetail(`التحويلات الصادرة من ${branch}`, outgoing)} />
              <MiniCard label="صافي حركة التحويلات" value={fmt(incoming.reduce((s, i) => s + (i.total_value || 0), 0) - outgoing.reduce((s, i) => s + (i.total_value || 0), 0))} count={incoming.length + outgoing.length} icon={ArrowRightLeft} color="text-purple-600" bg="bg-purple-50" onClick={() => openDetail("جميع التحويلات", transfers)} />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <MiniCard label="إجمالي حركات التحويل" value={fmt(summary.internal_transfers)} count={summary.internal_transfers_count} icon={ArrowRightLeft} color="text-purple-600" bg="bg-purple-50" onClick={() => openDetail("جميع التحويلات الداخلية", transfers)} />
              <MiniCard label="تحويل من شكري إلى الشامي" value={fmt(shokryToShamy.reduce((s, i) => s + (i.total_value || 0), 0))} count={shokryToShamy.length} icon={ArrowDownRight} color="text-green-600" bg="bg-green-50" onClick={() => openDetail("تحويلات من شكري إلى الشامي", shokryToShamy)} />
              <MiniCard label="تحويل من الشامي إلى شكري" value={fmt(shamyToShokry.reduce((s, i) => s + (i.total_value || 0), 0))} count={shamyToShokry.length} icon={ArrowUpRight} color="text-orange-600" bg="bg-orange-50" onClick={() => openDetail("تحويلات من الشامي إلى شكري", shamyToShokry)} />
            </div>
          )}
          {incomplete.length > 0 && (
            <p className="text-xs text-amber-600 mt-1">⚠️ {incomplete.length} تحويل غير مكتمل (ناقص الفرع المصدر أو المستلم)</p>
          )}
        </div>
      )}

      {/* Excluded Breakdown */}
      {excludedInv.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
            <Ban className="w-3.5 h-3.5" /> الفواتير المستثناة من صافي المشتريات
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MiniCard label="إجمالي المستثنى" value={fmt(summary.excluded_purchases)} count={excludedInv.length} color="text-red-600" bg="bg-red-50" onClick={() => openDetail("جميع الفواتير المستثناة", excludedInv)} />
            <MiniCard label="استثناء يدوي" value={fmt(excManual.reduce((s, i) => s + (i.total_value || 0), 0))} count={excManual.length} color="text-amber-600" bg="bg-amber-50" onClick={() => openDetail("الفواتير المستثناة يدويًا", excManual)} />
            <MiniCard label="بسبب إعداد المورد" value={fmt(excSupplier.reduce((s, i) => s + (i.total_value || 0), 0))} count={excSupplier.length} color="text-orange-600" bg="bg-orange-50" onClick={() => openDetail("فواتير مستثناة بسبب المورد", excSupplier)} />
            <MiniCard label="تحويلات داخلية" value={fmt(excInternal.reduce((s, i) => s + (i.total_value || 0), 0))} count={excInternal.length} color="text-purple-600" bg="bg-purple-50" onClick={() => openDetail("التحويلات الداخلية المستثناة", excInternal)} />
          </div>
        </div>
      )}

      {/* Payment Details */}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
          <DollarSign className="w-3.5 h-3.5" /> تفاصيل الدفع
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MiniCard label="صافي مشتريات الكاش" value={fmt(summary.net_cash_purchases)} count={cashInv.length} icon={Wallet} color="text-green-600" bg="bg-green-50" onClick={() => openDetail("مشتريات الكاش (صافي)", cashInv, "كاش + انستا + فودافون (غير مستثناة)")} />
          <MiniCard label="صافي مشتريات الآجل" value={fmt(netCredit)} count={creditInv.length} icon={CreditCard} color="text-blue-600" bg="bg-blue-50" onClick={() => openDetail("مشتريات الآجل (صافي)", creditInv, "فواتير آجلة (غير مستثناة)")} />
          <MiniCard label="إجمالي المدفوع" value={fmt(totalPaid)} count={invoices.length} color="text-teal-600" bg="bg-teal-50" onClick={() => openDetail("المدفوعات", invoices, "مجموع المدفوع لجميع الفواتير")} />
          <MiniCard label="إجمالي المتبقي" value={fmt(totalRemaining)} count={invoices.length} color="text-orange-600" bg="bg-orange-50" onClick={() => openDetail("المتبقي", invoices, "إجمالي المشتريات - المدفوع")} />
        </div>
        {mixedInv.length > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            💡 يوجد {mixedInv.length} فاتورة مختلطة (كاش + آجل) — يتم احتساب الجزء الكاش فقط في مشتريات الكاش
          </p>
        )}
      </div>

      <DashboardDetailModal
        open={detail.open}
        onClose={closeDetail}
        title={detail.title}
        branch={branch}
        period={dateFilter}
        invoices={detail.invoices}
        formula={detail.formula}
      />
    </Card>
  );
}

function StatCard({ label, value, sub, icon: Icon, color, bg, onClick, isCurrency = true }) {
  return (
    <div onClick={onClick} className="p-3 rounded-lg border bg-white hover:shadow-md cursor-pointer transition-all">
      <div className="flex items-center gap-2 mb-1">
        <div className={`p-1.5 rounded ${bg}`}><Icon className={`w-4 h-4 ${color}`} /></div>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="text-lg font-bold text-gray-800">{value}{isCurrency && " ج"}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function CategoryCard({ label, value, count, pct, icon: Icon, color, bg, barColor, onClick }) {
  return (
    <div onClick={onClick} className="p-3 rounded-lg border bg-white hover:shadow-md cursor-pointer transition-all">
      <div className="flex items-center gap-2 mb-2">
        <div className={`p-1.5 rounded ${bg}`}><Icon className={`w-4 h-4 ${color}`} /></div>
        <span className="text-sm font-medium text-gray-700">{label}</span>
      </div>
      <p className="text-lg font-bold text-gray-800">{value} ج</p>
      <div className="flex items-center justify-between text-xs text-gray-400 mt-1">
        <span>{count} فاتورة</span>
        <span>{pct.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mt-1">
        <div className={`h-full ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

function MiniCard({ label, value, count, icon: Icon, color, bg, onClick }) {
  return (
    <div onClick={onClick} className="p-2.5 rounded-lg border bg-white hover:shadow-md cursor-pointer transition-all">
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <div className={`p-1 rounded ${bg}`}><Icon className={`w-3 h-3 ${color}`} /></div>}
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="text-sm font-bold text-gray-800">{value} ج</p>
      <p className="text-xs text-gray-400">{count} فاتورة</p>
    </div>
  );
}