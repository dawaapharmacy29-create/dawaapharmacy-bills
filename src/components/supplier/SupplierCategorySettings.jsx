import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wand2, AlertTriangle, CheckCircle, XCircle, Layers, Calendar } from "lucide-react";
import {
  SUPPLIER_CATEGORY_MODE_LABELS,
  SUPPLIER_CATEGORY_MODE_COLORS,
  CATEGORY_LABELS,
} from "@/lib/purchaseCalculations";

const START_DATE = "2026-07-15";

const fmt = (n) => (n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 0 });

export default function SupplierCategorySettings({ supplier }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [skipManual, setSkipManual] = useState(true);
  const [extraConfirm, setExtraConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const queryClient = useQueryClient();

  const mode = supplier?.default_purchase_category || "none";
  const isMixed = mode === "mixed" || mode === "none";
  const targetCategory = mode === "medicines" ? "medicines" : mode === "supplies_accessories" ? "supplies_accessories" : null;

  const fetchPreview = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke("applySupplierCategoryFromDate", {
        supplier_id: supplier.id,
        category: targetCategory,
        start_date: START_DATE,
        manual_invoice_policy: skipManual ? "skip_manual" : "override_all",
        confirmed: false,
      });
      setPreview(res.data?.preview || null);
    } catch (err) {
      setError(err.message || "حدث خطأ أثناء المعاينة");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (previewOpen && targetCategory) {
      setExtraConfirm(false);
      setResult(null);
      fetchPreview();
    }
  }, [previewOpen, skipManual]);

  const handleApply = async () => {
    if (!skipManual && !extraConfirm) return;
    setApplying(true);
    setError(null);
    try {
      const res = await base44.functions.invoke("applySupplierCategoryFromDate", {
        supplier_id: supplier.id,
        category: targetCategory,
        start_date: START_DATE,
        manual_invoice_policy: skipManual ? "skip_manual" : "override_all",
        confirmed: true,
      });
      setResult(res.data);
      queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-invoices-cat"] });
      fetchPreview();
    } catch (err) {
      setError(err.message || "حدث خطأ أثناء التطبيق");
    }
    setApplying(false);
  };

  return (
    <div className="border rounded-lg p-3 bg-slate-50/50 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-slate-700">إعدادات تصنيف المورد</p>
        <Badge className={`${SUPPLIER_CATEGORY_MODE_COLORS[mode]} border-0 text-xs`}>
          {SUPPLIER_CATEGORY_MODE_LABELS[mode]}
        </Badge>
      </div>

      {isMixed && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <p className="text-xs text-amber-700">هذا المورد مختلط، لذلك لا يتم تطبيق تصنيف موحد تلقائيًا. يجب اختيار التصنيف يدويًا لكل فاتورة.</p>
        </div>
      )}

      {!isMixed && targetCategory && (
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2 border-teal-300 text-teal-700 hover:bg-teal-50"
          onClick={() => setPreviewOpen(true)}
        >
          <Wand2 className="w-4 h-4" />
          تطبيق تصنيف المورد على الفواتير من {START_DATE}
        </Button>
      )}

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right text-base">تطبيق تصنيف المورد على الفواتير من {START_DATE}</DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="text-center py-8 text-gray-400">
              <div className="w-6 h-6 border-2 border-gray-200 border-t-teal-600 rounded-full animate-spin mx-auto mb-2" />
              جاري تحميل المعاينة...
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-600" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          ) : preview ? (
            <div className="space-y-3">
              {/* Supplier info */}
              <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">المورد:</span>
                  <span className="font-semibold">{preview.supplier_name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">تصنيف المورد:</span>
                  <Badge className={`${SUPPLIER_CATEGORY_MODE_COLORS[preview.supplier_category]} border-0 text-xs`}>{SUPPLIER_CATEGORY_MODE_LABELS[preview.supplier_category]}</Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">التصنيف المستهدف:</span>
                  <span className="font-semibold text-teal-700">{CATEGORY_LABELS[preview.target_category]}</span>
                </div>
                <div className="flex justify-between text-sm items-center">
                  <span className="text-gray-500">تاريخ بداية التطبيق:</span>
                  <span className="font-semibold text-blue-700 flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{preview.start_date}</span>
                </div>
              </div>

              {/* Current stats */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <StatBox label="إجمالي الفواتير" value={preview.total_invoices} />
                <StatBox label="إجمالي القيمة" value={`${fmt(preview.total_value)} ج`} />
                <StatBox label="مصنفة أدوية" value={preview.medicines_count} />
                <StatBox label="مصنفة مستلزمات" value={preview.supplies_count} />
                <StatBox label="غير مصنفة" value={preview.unclassified_count} highlight={preview.unclassified_count > 0} />
                <StatBox label="مصنفة يدويًا" value={preview.manual_count} />
              </div>

              {/* Will change */}
              <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 space-y-1">
                <p className="text-sm font-semibold text-teal-800 flex items-center gap-1">
                  <Layers className="w-4 h-4" /> الفواتير التي ستتغير فعليًا
                </p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-gray-500">العدد:</span> <span className="font-bold">{preview.will_change_count}</span></div>
                  <div><span className="text-gray-500">القيمة:</span> <span className="font-bold">{fmt(preview.will_change_value)} ج</span></div>
                  <div><span className="text-gray-500">الفروع:</span> <span className="text-xs">{Object.entries(preview.branch_distribution || {}).map(([b, c]) => `${b}: ${c}`).join("، ") || "—"}</span></div>
                  <div><span className="text-gray-500">أقدم فاتورة:</span> <span className="text-xs">{preview.oldest_invoice_date || "—"}</span></div>
                  <div><span className="text-gray-500">أحدث فاتورة:</span> <span className="text-xs">{preview.newest_invoice_date || "—"}</span></div>
                  <div><span className="text-gray-500">يدوية محفوظة:</span> <span className="font-bold text-green-600">{preview.manual_preserved_count}</span></div>
                </div>
              </div>

              {/* Manual policy */}
              <div className="space-y-2">
                <p className="text-sm font-semibold text-gray-700">التعامل مع الفواتير المصنفة يدويًا:</p>
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="radio" name="manualPolicy" checked={skipManual} onChange={() => setSkipManual(true)} className="w-4 h-4 accent-teal-600" />
                  تطبيق على غير المصنفة والتلقائية فقط <span className="text-xs text-gray-400">(افتراضي)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="radio" name="manualPolicy" checked={!skipManual} onChange={() => setSkipManual(false)} className="w-4 h-4 accent-teal-600" />
                  تطبيق على جميع الفواتير بما فيها المصنفة يدويًا
                </label>
              </div>

              {/* Warning for override all */}
              {!skipManual && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700 font-semibold">سيتم إلغاء الاستثناءات اليدوية السابقة وتطبيق تصنيف المورد على جميع فواتيره من {START_DATE}.</p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer text-sm bg-white rounded-md p-2 border border-red-200">
                    <input type="checkbox" checked={extraConfirm} onChange={(e) => setExtraConfirm(e.target.checked)} className="w-4 h-4 accent-red-600" />
                    <span className="text-red-700 font-medium">أؤكد أنني أفهم أنه سيتم إلغاء جميع الاستثناءات اليدوية.</span>
                  </label>
                  {preview.manual_overridden_count > 0 && (
                    <p className="text-xs text-red-600">عدد الفواتير اليدوية التي سيتم استبدالها: {preview.manual_overridden_count}</p>
                  )}
                </div>
              )}

              {/* Result */}
              {result?.applied && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <div className="text-sm text-green-700">
                    <p className="font-semibold">تم تطبيق التصنيف على {result.updated_count} فاتورة بقيمة {fmt(result.total_value)} ج بنجاح</p>
                    <p className="text-xs mt-0.5">Batch ID: {result.batch_id}</p>
                    <p className="text-xs">نفذها: {result.performed_by} — {new Date(result.timestamp).toLocaleString("ar-EG")}</p>
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
                  <XCircle className="w-5 h-5 text-red-600" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <DialogFooter className="gap-2 flex-row-reverse">
                <Button
                  onClick={handleApply}
                  disabled={applying || preview.will_change_count === 0 || (!skipManual && !extraConfirm)}
                  className="bg-teal-600 hover:bg-teal-700 gap-2"
                >
                  {applying ? (
                    <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> جاري التطبيق...</>
                  ) : (
                    <><Wand2 className="w-4 h-4" /> تأكيد تطبيق تصنيف المورد من {START_DATE}</>
                  )}
                </Button>
                <Button variant="outline" onClick={() => setPreviewOpen(false)}>إغلاق</Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatBox({ label, value, color = "", highlight = false }) {
  return (
    <div className={`rounded-md p-2 ${highlight ? "bg-amber-50 border border-amber-200" : "bg-white border border-gray-100"}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`font-bold ${color}`}>{value}</p>
    </div>
  );
}