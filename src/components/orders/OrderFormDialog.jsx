import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { Loader2, Upload, X } from "lucide-react";
import { useUserRole } from "@/lib/useUserRole";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const SOURCES = ["واتساب", "مكالمة هاتفية", "داخل الصيدلية"];
const PRIORITIES = ["عاجل", "متوسط", "عادي"];

let orderCounter = Date.now();
function genOrderNumber() {
  orderCounter++;
  return `ORD-${new Date().getFullYear()}-${String(orderCounter).slice(-4)}`;
}

export default function OrderFormDialog({ open, onOpenChange, teamMembers = [], onSaved, editOrder = null }) {
  const { user } = useUserRole();
  const [form, setForm] = useState(editOrder || {
    customer_name: "",
    phone: "",
    customer_code: "",
    branch: "",
    request_source: "",
    product_name: "",
    product_image: "",
    notes: "",
    priority: "عادي",
    assigned_employee: "",
    request_date: new Date().toISOString().split("T")[0],
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    set("product_image", file_url);
    setUploading(false);
  };

  const handleSave = async () => {
    if (!form.customer_name || !form.phone || !form.product_name) return;
    setSaving(true);
    const userName = user?.full_name || user?.email || "مجهول";
    const now = new Date().toISOString();
    const data = {
      ...form,
      status: editOrder ? form.status : "طلب جديد",
      order_number: editOrder ? form.order_number : genOrderNumber(),
      timeline: editOrder ? form.timeline : [{ status: "طلب جديد", by: userName, at: now, note: "تم إنشاء الطلب" }],
      ...(!editOrder && { added_at: new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) }),
    };
    if (editOrder) {
      await base44.entities.CustomerOrder.update(editOrder.id, data);
    } else {
      await base44.entities.CustomerOrder.create(data);
    }
    setSaving(false);
    onSaved?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto px-4 py-5 sm:p-6" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-teal-700">{editOrder ? "تعديل الطلب" : "طلب عميل جديد"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">اسم العميل *</label>
              <Input value={form.customer_name} onChange={(e) => set("customer_name", e.target.value)} placeholder="اسم العميل" className="h-9 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">رقم الهاتف *</label>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="01XXXXXXXXX" className="h-9 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">كود العميل</label>
              <Input value={form.customer_code} onChange={(e) => set("customer_code", e.target.value)} placeholder="كود اختياري" className="h-9 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">الفرع</label>
              <Select value={form.branch} onValueChange={(v) => set("branch", v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
                <SelectContent>{BRANCHES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">مصدر الطلب</label>
              <Select value={form.request_source} onValueChange={(v) => set("request_source", v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="المصدر" /></SelectTrigger>
                <SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">الأولوية</label>
              <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">اسم الصنف *</label>
            <Input value={form.product_name} onChange={(e) => set("product_name", e.target.value)} placeholder="اسم الدواء أو المنتج" className="h-9 text-sm" />
          </div>

          {/* Image Upload */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">صورة الصنف</label>
            {form.product_image ? (
              <div className="relative inline-block">
                <img src={form.product_image} alt="product" className="h-24 w-24 object-cover rounded-lg border" />
                <button onClick={() => set("product_image", "")} className="absolute -top-1 -left-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <label className="flex items-center gap-2 border-2 border-dashed border-gray-200 rounded-lg p-4 cursor-pointer hover:border-teal-300 transition-colors">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin text-teal-500" /> : <Upload className="w-4 h-4 text-gray-400" />}
                <span className="text-sm text-gray-400">{uploading ? "جاري الرفع..." : "رفع صورة الصنف"}</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
              </label>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">الموظف المسؤول</label>
              <Select value={form.assigned_employee} onValueChange={(v) => set("assigned_employee", v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="اختر موظف" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>— بدون تعيين —</SelectItem>
                  {teamMembers.map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">تاريخ الطلب</label>
              <Input type="date" value={form.request_date} onChange={(e) => set("request_date", e.target.value)} className="h-9 text-sm" />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">ملاحظات</label>
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="أي ملاحظات إضافية..."
              rows={3}
              className="w-full border border-input rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving || !form.customer_name || !form.phone || !form.product_name} className="flex-1 bg-teal-600 hover:bg-teal-700">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (editOrder ? "حفظ التعديلات" : "حفظ الطلب")}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}