import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, AlertTriangle, CheckCircle2, Plus } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const METHODS = ["كاش", "تحويل بنكي", "إنستا باي", "فودافون كاش", "تسوية حساب", "أخرى"];
const emptyForm = () => ({
  source_branch: "",
  destination_branch: "",
  amount: "",
  payment_date: new Date().toISOString().slice(0, 10),
  payment_method: "تحويل بنكي",
  reference_number: "",
  notes: "",
});

const isSettlement = (p) => p.payment_kind === "branch_settlement" || p.transaction_type === "branch_settlement";
const isLegacyInternal = (p) => !isSettlement(p) && BRANCHES.includes(p.supplier_name);

export default function BranchSettlements() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState("");

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ["branch-settlements-source"],
    queryFn: () => base44.entities.SupplierPayment.list("-payment_date", 5000),
    staleTime: 30000,
  });

  const settlements = useMemo(() => payments.filter(isSettlement), [payments]);
  const legacy = useMemo(() => payments.filter(isLegacyInternal), [payments]);

  const createMutation = useMutation({
    mutationFn: (payload) => base44.entities.SupplierPayment.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branch-settlements-source"] });
      qc.invalidateQueries({ queryKey: ["supplier-payments"] });
      setOpen(false);
      setForm(emptyForm());
      setError("");
    },
  });

  const save = () => {
    const amount = Number(form.amount || 0);
    if (!form.source_branch || !form.destination_branch) return setError("حدد الفرع المرسل والفرع المستلم.");
    if (form.source_branch === form.destination_branch) return setError("لا يمكن أن يكون الفرع المرسل هو نفسه الفرع المستلم.");
    if (amount <= 0) return setError("قيمة التسوية يجب أن تكون أكبر من صفر.");
    setError("");
    createMutation.mutate({
      supplier_name: form.destination_branch,
      branch: form.source_branch,
      source_branch: form.source_branch,
      destination_branch: form.destination_branch,
      amount,
      payment_date: form.payment_date,
      payment_method: form.payment_method,
      reference_number: form.reference_number,
      notes: form.notes,
      payment_kind: "branch_settlement",
      transaction_type: "branch_settlement",
      invoice_id: null,
      invoice_number: "",
    });
  };

  const total = settlements.reduce((sum, x) => sum + Number(x.amount || 0), 0);
  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">تسويات وتحويلات الفروع</h1>
          <p className="text-sm text-gray-500 mt-1">مسار مستقل عن الموردين، ولا يدخل في مديونية أو مدفوعات الموردين.</p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2 bg-indigo-600 hover:bg-indigo-700"><Plus className="w-4 h-4" />تسوية جديدة</Button>
      </div>

      {legacy.length > 0 && (
        <Card className="p-4 border-amber-300 bg-amber-50 text-amber-800">
          <div className="flex gap-3 items-start"><AlertTriangle className="w-5 h-5 mt-0.5" /><div><p className="font-bold">{legacy.length} حركة قديمة تحتاج تصنيف</p><p className="text-xs mt-1">هذه الحركات مسجلة باسم فرع داخل سجل مدفوعات الموردين. تظهر هنا للمراجعة، لكنها لا تُعتبر تسويات مكتملة حتى يتم تحديد الفرع المرسل والمستلم.</p></div></div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4 text-center bg-indigo-50 border-indigo-100"><p className="text-xs text-gray-500">عدد التسويات الصحيحة</p><p className="text-2xl font-bold text-indigo-700 mt-1">{settlements.length}</p></Card>
        <Card className="p-4 text-center bg-emerald-50 border-emerald-100"><p className="text-xs text-gray-500">إجمالي الحركات</p><p className="text-2xl font-bold text-emerald-700 mt-1">{total.toLocaleString("ar-EG")} ج</p></Card>
      </div>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50 font-semibold text-sm">السجل</div>
        {isLoading ? <div className="p-10 text-center text-gray-400">جاري التحميل...</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50"><tr><th className="text-right p-3">التاريخ</th><th className="text-right p-3">من</th><th className="text-right p-3">إلى</th><th className="text-right p-3">الطريقة</th><th className="text-right p-3">المرجع</th><th className="text-right p-3">القيمة</th><th className="text-right p-3">الحالة</th></tr></thead>
              <tbody className="divide-y">
                {[...settlements, ...legacy].sort((a,b) => String(b.payment_date || "").localeCompare(String(a.payment_date || ""))).map((x) => {
                  const classified = isSettlement(x);
                  return <tr key={x.id} className="hover:bg-gray-50"><td className="p-3">{x.payment_date || "—"}</td><td className="p-3">{x.source_branch || x.branch || "غير محدد"}</td><td className="p-3">{x.destination_branch || x.supplier_name || "غير محدد"}</td><td className="p-3">{x.payment_method || "—"}</td><td className="p-3 font-mono text-xs">{x.reference_number || "—"}</td><td className="p-3 font-bold">{Number(x.amount || 0).toLocaleString("ar-EG")} ج</td><td className="p-3">{classified ? <Badge className="bg-emerald-100 text-emerald-800 border-0 gap-1"><CheckCircle2 className="w-3 h-3" />مصنفة</Badge> : <Badge className="bg-amber-100 text-amber-800 border-0">قديمة تحتاج مراجعة</Badge>}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader><DialogTitle>تسجيل تسوية بين فرعين</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>الفرع المرسل *</Label><Select value={form.source_branch} onValueChange={(v) => setForm(f => ({...f, source_branch:v}))}><SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger><SelectContent>{BRANCHES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><Label>الفرع المستلم *</Label><Select value={form.destination_branch} onValueChange={(v) => setForm(f => ({...f, destination_branch:v}))}><SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger><SelectContent>{BRANCHES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="grid grid-cols-2 gap-3"><div className="space-y-1"><Label>القيمة *</Label><Input type="number" min="0.01" step="0.01" value={form.amount} onChange={e => setForm(f => ({...f, amount:e.target.value}))} /></div><div className="space-y-1"><Label>التاريخ *</Label><Input type="date" value={form.payment_date} onChange={e => setForm(f => ({...f, payment_date:e.target.value}))} /></div></div>
            <div className="grid grid-cols-2 gap-3"><div className="space-y-1"><Label>طريقة التحويل</Label><Select value={form.payment_method} onValueChange={(v) => setForm(f => ({...f, payment_method:v}))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label>رقم المرجع</Label><Input value={form.reference_number} onChange={e => setForm(f => ({...f, reference_number:e.target.value}))} /></div></div>
            <div className="space-y-1"><Label>ملاحظات</Label><Textarea rows={3} value={form.notes} onChange={e => setForm(f => ({...f, notes:e.target.value}))} /></div>
          </div>
          <DialogFooter className="gap-2"><Button onClick={save} disabled={createMutation.isPending} className="bg-indigo-600 hover:bg-indigo-700"><ArrowLeftRight className="w-4 h-4 ml-1" />حفظ التسوية</Button><Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
