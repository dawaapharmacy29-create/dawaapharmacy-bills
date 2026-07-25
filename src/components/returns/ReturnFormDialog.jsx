import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { Plus, Trash2, Upload, X, Image, Loader2, Camera } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const REASONS = ["صنف جاء بالخطأ", "كمية زائدة", "عدم الحاجة", "قرب انتهاء الصلاحية", "انتهاء الصلاحية", "تغيير السعر", "تلف", "اختلاف باتش", "لم يصل", "تم احتسابه ولم يصل", "سبب آخر"];

const emptyItem = () => ({
  product_name: "", quantity: 1, item_reason: ""
});

const generateReturnNumber = () => {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `RTN-${y}${m}${d}-${rand}`;
};

export default function ReturnFormDialog({ open, onOpenChange, onSuccess }) {
  const [form, setForm] = useState({
    invoice_number: "", supplier_name: "", branch_name: "", employee_name: "",
    notes: "", items: [emptyItem()], invoice_images: []
  });
  const [imageFiles, setImageFiles] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef();
  const cameraInputRef = useRef();

  const { data: teamMembers = [] } = useQuery({
    queryKey: ["team-members"],
    queryFn: () => base44.entities.TeamMember.list(),
    staleTime: 60000,
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => base44.entities.Supplier.list(),
    staleTime: 60000,
  });

  const filteredMembers = form.branch_name
    ? teamMembers.filter(m => !m.branches || m.branches.includes(form.branch_name))
    : teamMembers;

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const handleImageAdd = (files) => {
    const arr = Array.from(files);
    const valid = arr.filter(f => {
      if (f.size > 5 * 1024 * 1024) { setError(`الملف ${f.name} يتجاوز الحد الأقصى 5MB`); return false; }
      return true;
    });
    setImageFiles(prev => [...prev, ...valid]);
    valid.forEach(f => {
      const reader = new FileReader();
      reader.onload = (e) => setImagePreviews(prev => [...prev, { url: e.target.result, name: f.name, type: f.type }]);
      reader.readAsDataURL(f);
    });
  };

  const removeImage = (idx) => {
    setImageFiles(prev => prev.filter((_, i) => i !== idx));
    setImagePreviews(prev => prev.filter((_, i) => i !== idx));
  };

  const updateItem = (idx, field, val) => {
    setForm(f => {
      const items = [...f.items];
      items[idx] = { ...items[idx], [field]: val };
      return { ...f, items };
    });
  };

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, emptyItem()] }));
  const removeItem = (idx) => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const handleSubmit = async () => {
    setError("");
    if (!form.invoice_number || !form.supplier_name || !form.branch_name || !form.employee_name) {
      setError("يرجى ملء جميع الحقول المطلوبة");
      return;
    }
    const validItems = form.items.filter(it => it.product_name.trim());
    if (validItems.length === 0) {
      setError("يجب إضافة صنف واحد على الأقل");
      return;
    }
    if (validItems.some((item) => !item.item_reason)) {
      setError("يجب تحديد سبب المرتجع لكل صنف");
      return;
    }

    setSaving(true);
    setUploading(true);
    try {
      const uploadedUrls = [];
      for (const file of imageFiles) {
        const res = await base44.integrations.Core.UploadFile({ file });
        uploadedUrls.push(res.file_url);
      }
      setUploading(false);

      const user = await base44.auth.me();
      const statusHistory = [{
        status: "Pending",
        changed_by: user?.full_name || user?.email || "مجهول",
        changed_at: new Date().toISOString(),
        note: "تم إنشاء المرتجع"
      }];

      await base44.entities.Return.create({
        ...form,
        items: validItems,
        invoice_images: [...form.invoice_images, ...uploadedUrls],
        return_number: generateReturnNumber(),
        status: "Pending",
        status_history: statusHistory,
      });

      onSuccess?.();
      onOpenChange(false);
      setForm({ invoice_number: "", supplier_name: "", branch_name: "", employee_name: "", notes: "", items: [emptyItem()], invoice_images: [] });
      setImageFiles([]);
      setImagePreviews([]);
    } finally {
      setSaving(false);
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-teal-700">إنشاء مرتجع جديد</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">المورد أو المخزن *</label>
              <Select value={form.supplier_name} onValueChange={v => { set("supplier_name", v); set("invoice_number", ""); }}>
                <SelectTrigger><SelectValue placeholder="اختر المورد" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {form.supplier_name && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">رقم الفاتورة *</label>
                <Input value={form.invoice_number} onChange={e => set("invoice_number", e.target.value)} placeholder={`أدخل رقم فاتورة ${form.supplier_name}`} />
              </div>
            )}
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">الفرع *</label>
              <Select value={form.branch_name} onValueChange={v => { set("branch_name", v); set("employee_name", ""); }}>
                <SelectTrigger><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
                <SelectContent>
                  {BRANCHES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">اسم الموظف *</label>
              <Select value={form.employee_name} onValueChange={v => set("employee_name", v)}>
                <SelectTrigger><SelectValue placeholder="اختر الموظف" /></SelectTrigger>
                <SelectContent>
                  {filteredMembers.map(m => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">ملاحظات</label>
              <Input value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="ملاحظات اختيارية..." />
            </div>
          </div>

          {/* Image Upload */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-700">صور الفاتورة * (مطلوبة)</label>
            <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 bg-gray-50">
              <div className="flex gap-2 justify-center mb-3">
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
                  <Upload className="w-4 h-4" /> رفع ملف
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => cameraInputRef.current?.click()} className="gap-1.5">
                  <Camera className="w-4 h-4" /> التقاط صورة
                </Button>
              </div>
              <p className="text-xs text-center text-gray-400">JPG, PNG, PDF — حد أقصى 5MB لكل ملف</p>
              <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf" className="hidden" onChange={e => handleImageAdd(e.target.files)} />
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handleImageAdd(e.target.files)} />
            </div>
            {imagePreviews.length > 0 && (
              <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                {imagePreviews.map((img, idx) => (
                  <div key={idx} className="relative group">
                    {img.type === "application/pdf" ? (
                      <div className="h-20 bg-red-50 border rounded-lg flex items-center justify-center text-red-500 text-xs font-medium">PDF</div>
                    ) : (
                      <img src={img.url} alt={img.name} className="h-20 w-full object-cover rounded-lg border cursor-pointer" onClick={() => window.open(img.url, "_blank")} />
                    )}
                    <button onClick={() => removeImage(idx)} className="absolute top-1 left-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Items Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-700">الأصناف المرتجعة *</label>
              <Button type="button" size="sm" variant="outline" onClick={addItem} className="gap-1 text-teal-600 border-teal-300">
                <Plus className="w-3.5 h-3.5" /> إضافة صنف
              </Button>
            </div>
            <div className="space-y-2">
              {form.items.map((item, idx) => (
                <div key={idx} className="border rounded-xl p-3 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-600">الصنف {idx + 1}</span>
                    {form.items.length > 1 && (
                      <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    <div className="md:col-span-2">
                      <Input placeholder="اسم الصنف *" value={item.product_name} onChange={e => updateItem(idx, "product_name", e.target.value)} className="text-sm" />
                    </div>
                    <Input placeholder="العدد" type="number" min="1" value={item.quantity} onChange={e => updateItem(idx, "quantity", +e.target.value)} className="text-sm" />
                    <div className="md:col-span-3">
                      <Select value={item.item_reason} onValueChange={v => updateItem(idx, "item_reason", v)}>
                        <SelectTrigger className="text-sm h-9"><SelectValue placeholder="سبب المرتجع" /></SelectTrigger>
                        <SelectContent>
                          {REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex justify-end gap-3 pt-2 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button onClick={handleSubmit} disabled={saving} className="bg-teal-600 hover:bg-teal-700 text-white gap-2 min-w-28">
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" />{uploading ? "جاري رفع الصور..." : "جاري الحفظ..."}</> : "حفظ المرتجع"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}