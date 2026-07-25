import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Shield, ArrowRightLeft, AlertTriangle, CheckCircle, Loader2, FileSearch } from "lucide-react";
import { useUserRole } from "@/lib/useUserRole";
import { useToast } from "@/components/ui/use-toast";
import { logActivity } from "@/lib/activityLogger";

export default function SupplierRulesBackfill() {
  const { isAdmin } = useUserRole();
  const { toast } = useToast();
  const [preview, setPreview] = useState(null);
  const [sampleChanges, setSampleChanges] = useState([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [manualPolicy, setManualPolicy] = useState("skip_manual");
  const [applyCategory, setApplyCategory] = useState(true);
  const [applyTransaction, setApplyTransaction] = useState(true);
  const [result, setResult] = useState(null);

  const previewMutation = useMutation({
    mutationFn: async () => {
      return await base44.functions.invoke("applySupplierRulesBackfill", {
        confirmed: false,
        manual_policy: manualPolicy,
        apply_category: applyCategory,
        apply_transaction_type: applyTransaction,
      });
    },
    onSuccess: (data) => {
      setPreview(data.preview);
      setSampleChanges(data.sample_changes || []);
      setResult(null);
      logActivity({
        action_type: "bulk_update",
        entity_type: "invoice",
        reason: "preview_backfill",
        details: `معاينة: ${data.preview.total_will_change} فاتورة ستتغير من ${data.preview.total_invoices_reviewed}`,
      });
    },
    onError: (e) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      return await base44.functions.invoke("applySupplierRulesBackfill", {
        confirmed: true,
        manual_policy: manualPolicy,
        apply_category: applyCategory,
        apply_transaction_type: applyTransaction,
      });
    },
    onSuccess: (data) => {
      setResult(data);
      setConfirmOpen(false);
      toast({ title: "تم التطبيق", description: `تم تحديث ${data.updated_count} فاتورة` });
    },
    onError: (e) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  if (!isAdmin) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-gray-400">
        <Shield className="w-12 h-12" />
        <p className="text-lg font-medium">هذه الصفحة للمدير العام فقط</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <FileSearch className="w-6 h-6 text-teal-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-800">تطبيق قواعد الموردين والتحويلات الرجعي</h1>
          <p className="text-gray-500 text-sm mt-0.5">من 15-07-2026 حتى الآن — تصحيح التصنيف ونوع العملية فقط بدون تغيير القيم المالية</p>
        </div>
      </div>

      <Card className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-sm">سياسة الفواتير اليدوية</Label>
            <Select value={manualPolicy} onValueChange={setManualPolicy}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="skip_manual">الحفاظ على الاستثناء اليدوي (تخطّي)</SelectItem>
                <SelectItem value="override_all">تطبيق إعداد المورد على الكل</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">نطاق التطبيق</Label>
            <div className="flex flex-col gap-2 pt-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={applyCategory} onChange={(e) => setApplyCategory(e.target.checked)} className="w-4 h-4 accent-teal-600" />
                تصحيح التصنيف (أدوية / مستلزمات)
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={applyTransaction} onChange={(e) => setApplyTransaction(e.target.checked)} className="w-4 h-4 accent-teal-600" />
                تصحيح نوع العملية (تحويل داخلي)
              </label>
            </div>
          </div>
          <div className="flex items-end">
            <Button onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending} className="w-full bg-teal-600 hover:bg-teal-700 gap-2">
              {previewMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSearch className="w-4 h-4" />}
              معاينة التغييرات
            </Button>
          </div>
        </div>
      </Card>

      {preview && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="إجمالي المراجعة" value={preview.total_invoices_reviewed} color="text-gray-700" bg="bg-gray-50" />
            <StatCard label="فواتير ستتغير" value={preview.total_will_change} color="text-blue-600" bg="bg-blue-50" />
            <StatCard label="القيمة المتأثرة" value={preview.total_value_affected.toLocaleString('en-US', { maximumFractionDigits: 0 })} color="text-teal-600" bg="bg-teal-50" suffix=" ج" />
            <StatCard label="استثناءات يدوية محفوظة" value={preview.manual_preserved_count} color="text-green-600" bg="bg-green-50" icon={<CheckCircle className="w-4 h-4" />} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="تغييرات التصنيف" value={preview.category_changes} color="text-cyan-600" bg="bg-cyan-50" />
            <StatCard label="ستصبح أدوية" value={preview.medicines_changed} color="text-teal-600" bg="bg-teal-50" />
            <StatCard label="ستصبح مستلزمات" value={preview.supplies_changed} color="text-indigo-600" bg="bg-indigo-50" />
            <StatCard label="ستظل غير مصنفة" value={preview.unclassified_changed} color="text-gray-600" bg="bg-gray-50" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="تحويلات داخلية (إجمالي)" value={preview.total_internal_transfers} color="text-purple-600" bg="bg-purple-50" icon={<ArrowRightLeft className="w-4 h-4" />} />
            <StatCard label="تحويلات جديدة" value={preview.new_internal_transfers} color="text-violet-600" bg="bg-violet-50" />
            <StatCard label="شكري ← الشامي" value={preview.shukri_to_shami} color="text-indigo-600" bg="bg-indigo-50" />
            <StatCard label="الشامي ← شكري" value={preview.shami_to_shukri} color="text-fuchsia-600" bg="bg-fuchsia-50" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label="موردين مختلطين" value={preview.mixed_supplier_count} color="text-amber-600" bg="bg-amber-50" />
            <StatCard label="تحتاج تصنيف يدوي" value={preview.requires_manual_category_count} color="text-amber-600" bg="bg-amber-50" icon={<AlertTriangle className="w-4 h-4" />} />
            <StatCard label="تحتاج مراجعة" value={preview.requires_review_count} color="text-red-600" bg="bg-red-50" icon={<AlertTriangle className="w-4 h-4" />} />
          </div>

          {/* Validation check */}
          {!preview.category_stats_valid && (
            <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <div className="text-sm text-red-700">
                <strong>تعارض في إحصائيات التصنيف!</strong> مجموع التغييرات ({preview.medicines_changed} + {preview.supplies_changed} + {preview.unclassified_changed} = {preview.category_stats_sum}) لا يساوي إجمالي تغييرات التصنيف ({preview.category_changes}). لن يُسمح بالتطبيق حتى يتم إصلاح المنطق.
              </div>
            </div>
          )}
          {preview.category_stats_valid && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-sm text-green-700">إحصائيات التصنيف متطابقة: {preview.medicines_changed} + {preview.supplies_changed} + {preview.unclassified_changed} = {preview.category_changes} ✓</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">التوزيع حسب الفرع</h3>
              <div className="space-y-1.5">
                {Object.entries(preview.branch_distribution).map(([branch, count]) => (
                  <div key={branch} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{branch}</span>
                    <Badge className="bg-gray-100 text-gray-700 border-0">{count}</Badge>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">التوزيع حسب المورد</h3>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {Object.entries(preview.supplier_distribution).slice(0, 15).map(([supplier, count]) => (
                  <div key={supplier} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 truncate ml-2">{supplier}</span>
                    <Badge className="bg-gray-100 text-gray-700 border-0 shrink-0">{count}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {sampleChanges.length > 0 && (
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">عينة من التغييرات (أول 10)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr className="text-right text-gray-500">
                      <th className="p-2">رقم الفاتورة</th>
                      <th className="p-2">المورد</th>
                      <th className="p-2">الفرع</th>
                      <th className="p-2">الحالي</th>
                      <th className="p-2">الجديد</th>
                      <th className="p-2">نوع العملية</th>
                      <th className="p-2">المسار</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sampleChanges.map((c) => (
                      <tr key={c.id} className="border-b">
                        <td className="p-2 font-medium text-gray-700">{c.invoice_number}</td>
                        <td className="p-2 text-gray-600 truncate max-w-[120px]">{c.supplier_name}</td>
                        <td className="p-2 text-gray-600">{c.branch}</td>
                        <td className="p-2"><Badge variant="outline" className="text-xs">{c.current_category}</Badge></td>
                        <td className="p-2"><Badge className="bg-teal-50 text-teal-700 border-0 text-xs">{c.resolved_category}</Badge></td>
                        <td className="p-2"><Badge className={c.resolved_transaction_type === 'internal_transfer' ? 'bg-purple-50 text-purple-700 border-0 text-xs' : 'bg-gray-50 text-gray-600 border-0 text-xs'}>{c.resolved_transaction_type === 'internal_transfer' ? 'تحويل داخلي' : 'شراء خارجي'}</Badge></td>
                        <td className="p-2 text-gray-500 text-xs">{c.source_branch && c.destination_branch ? `${c.source_branch} ← ${c.destination_branch}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <div className="flex items-center justify-between gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center gap-2 text-amber-700 text-sm">
              <AlertTriangle className="w-5 h-5" />
              <span>سيتم تطبيق التغييرات على <strong>{preview.total_will_change}</strong> فاتورة. لن تتغير أي قيم مالية أو حالات مراجعة أو حفظ.</span>
            </div>
            <Button onClick={() => setConfirmOpen(true)} disabled={!preview.category_stats_valid} className="bg-amber-600 hover:bg-amber-700 gap-2 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed">
              <Shield className="w-4 h-4" /> تأكيد التطبيق
            </Button>
          </div>

          {result && (
            <Card className="p-5 bg-green-50 border-green-200">
              <div className="flex items-center gap-3 mb-3">
                <CheckCircle className="w-6 h-6 text-green-600" />
                <h3 className="font-bold text-green-800">تم التطبيق بنجاح</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><span className="text-gray-500">تم تحديث:</span> <strong>{result.updated_count}</strong></div>
                <div><span className="text-gray-500">فشل:</span> <strong>{result.failed_count}</strong></div>
                <div><span className="text-gray-500">تحويلات داخلية جديدة:</span> <strong>{result.new_internal_transfers}</strong></div>
                <div><span className="text-gray-500">Batch:</span> <strong className="text-xs">{result.batch_id?.slice(0, 20)}...</strong></div>
              </div>
            </Card>
          )}
        </>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Shield className="w-5 h-5 text-amber-600" /> تأكيد التطبيق الرجعي</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-gray-600">سيتم تطبيق قواعد الموردين والتحويلات على <strong>{preview?.total_will_change}</strong> فاتورة من تاريخ <strong>{preview?.start_date}</strong>.</p>
            <div className="bg-amber-50 p-3 rounded-lg text-xs text-amber-700 space-y-1">
              <p>• لن تتغير القيم المالية (الإجمالي، المدفوع، المرتجع).</p>
              <p>• لن تتغير حالة المراجعة أو الحفظ.</p>
              <p>• سيتم تسجيل العملية في سجل الأمان.</p>
              {manualPolicy === 'skip_manual' && <p>• سيتم الحفاظ على {preview?.manual_preserved_count} فاتورة مصنفة يدويًا.</p>}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>إلغاء</Button>
            <Button onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending} className="bg-amber-600 hover:bg-amber-700 gap-2">
              {applyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              تأكيد تطبيق القواعد من {preview?.start_date}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, color, bg, icon, suffix }) {
  return (
    <Card className={`p-3 ${bg}`}>
      <div className="flex items-center gap-2">
        {icon}
        <div className="min-w-0">
          <div className={`text-xl font-bold ${color}`}>{value}{suffix}</div>
          <div className="text-xs text-gray-500 truncate">{label}</div>
        </div>
      </div>
    </Card>
  );
}