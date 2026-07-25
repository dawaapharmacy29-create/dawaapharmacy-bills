import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Phone, MapPin, Clock, CreditCard, Building2, Ban, Search, X } from "lucide-react";
import { logActivity } from "@/lib/activityLogger";
import { useUserRole } from "@/lib/useUserRole";
import { fuzzyMatch } from "@/lib/fuzzySearch";
import { SUPPLIER_TYPE_LABELS, BRANCHES, SUPPLIER_CATEGORY_MODE_LABELS, SUPPLIER_CATEGORY_MODE_COLORS, SUPPLIER_DEFAULT_CATEGORY_OPTIONS } from "@/lib/purchaseCalculations";
import SupplierCategorySettings from "@/components/supplier/SupplierCategorySettings";
import { useTableSorting } from "@/hooks/useTableSorting";
import { SortControls } from "@/components/table/SortControls";
import { SUPPLIER_TYPE_ORDER, PAYMENT_STATUS_ORDER, SUPPLIER_CATEGORY_MODE_ORDER } from "@/lib/sortUtils";

const SUPPLIER_SORT_COLUMNS = [
  { field: "name", label: "اسم المورد", type: "text" },
  { field: "supplier_type", label: "نوع المورد", type: "status", statusMap: SUPPLIER_TYPE_ORDER },
  { field: "default_purchase_category", label: "تصنيف المورد", type: "status", statusMap: SUPPLIER_CATEGORY_MODE_ORDER },
  { field: "payment_type", label: "طريقة الدفع", type: "status", statusMap: PAYMENT_STATUS_ORDER },
  { field: "created_date", label: "تاريخ الإضافة", type: "date" },
];

const emptyForm = { name: "", phone: "", address: "", payment_type: "", payment_terms_days: 30, notes: "", supplier_type: "external_supplier", linked_branch: "", exclude_from_net_purchases: false, default_purchase_category: "none" };

const paymentTypeColor = {
  "كاش": "bg-emerald-100 text-emerald-800",
  "آجل": "bg-orange-100 text-orange-800",
  "انستا": "bg-pink-100 text-pink-800",
  "فودافون": "bg-red-100 text-red-800",
};

const PAYMENT_TYPES = ["كاش", "آجل", "انستا", "فودافون"];

export default function Suppliers() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [filterType, setFilterType] = useState("الكل");
  const [filterSupplierType, setFilterSupplierType] = useState("الكل");
  const [searchQuery, setSearchQuery] = useState("");
  const queryClient = useQueryClient();

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => base44.entities.Supplier.list("-created_date"),
  });

  const { isManager } = useUserRole();

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Supplier.create(data),
    onSuccess: (_, data) => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setDialogOpen(false);
      logActivity({ action_type: "create", entity_type: "supplier", entity_label: data.name, details: `إضافة مورد: ${data.name}` });
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Supplier.update(id, data),
    onSuccess: (_, { data }) => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setDialogOpen(false);
      setEditing(null);
      logActivity({ action_type: "update", entity_type: "supplier", entity_label: data.name, details: `تعديل مورد: ${data.name}` });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Supplier.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      logActivity({ action_type: "delete", entity_type: "supplier", entity_id: id, details: `حذف مورد` });
    },
  });

  const openNew = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (s) => {
    setEditing(s);
    setForm({
      name: s.name, phone: s.phone || "", address: s.address || "",
      payment_type: s.payment_type || "", payment_terms_days: s.payment_terms_days || 30, notes: s.notes || "",
      supplier_type: s.supplier_type || "external_supplier",
      linked_branch: s.linked_branch || "",
      exclude_from_net_purchases: s.exclude_from_net_purchases || false,
      default_purchase_category: s.default_purchase_category || "none",
    });
    setDialogOpen(true);
  };
  const set = (f, v) => setForm((p) => ({ ...p, [f]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const duplicate = suppliers.find((supplier) => supplier.id !== editing?.id && supplier.name.trim().toLowerCase() === form.name.trim().toLowerCase());
    if (duplicate) {
      window.alert(`يوجد مورد مسجل بنفس الاسم: ${duplicate.name}`);
      return;
    }
    if (form.supplier_type === "external_supplier" && !form.payment_type) {
      window.alert("يجب تحديد نوع التعامل للمورد الخارجي");
      return;
    }
    if (form.supplier_type === "internal_branch" && !form.linked_branch) {
      window.alert("يجب تحديد الفرع المرتبط");
      return;
    }
    const safeForm = form.supplier_type === "internal_branch"
      ? { ...form, payment_type: "", payment_terms_days: 0, exclude_from_net_purchases: true }
      : { ...form, linked_branch: "", payment_terms_days: form.payment_type === "آجل" ? Number(form.payment_terms_days || 0) : 0 };
    if (editing) updateMutation.mutate({ id: editing.id, data: safeForm });
    else createMutation.mutate(safeForm);
  };

  const filtered = suppliers.filter((s) => {
    const payMatch = filterType === "الكل" || s.payment_type === filterType;
    const typeMatch = filterSupplierType === "الكل" || (s.supplier_type || "external_supplier") === filterSupplierType;
    const searchMatch = !searchQuery || fuzzyMatch(searchQuery, s.name);
    return payMatch && typeMatch && searchMatch;
  });
  const { sortField, sortDirection, toggleSort, setSort, resetSort, sortData } = useTableSorting({
    columns: SUPPLIER_SORT_COLUMNS,
    defaultSort: { field: "name", direction: "asc" },
    paramPrefix: "sup",
  });
  const sorted = useMemo(() => sortData(filtered), [filtered, sortData]);

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">الموردين</h1>
          <p className="text-gray-500 text-sm mt-0.5">{suppliers.length} مورد مسجل</p>
        </div>
        {isManager && (
          <Button onClick={openNew} className="bg-teal-600 hover:bg-teal-700 text-white gap-2">
            <Plus className="w-4 h-4" /> إضافة مورد
          </Button>
        )}
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="ابحث باسم المورد (مثال: مخ، مخ*ن*المع)..."
          className="w-full h-10 pr-10 pl-10 rounded-lg border border-gray-200 bg-white text-sm shadow-sm outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Sort controls */}
      <SortControls
        columns={SUPPLIER_SORT_COLUMNS}
        sortField={sortField}
        sortDirection={sortDirection}
        onToggle={toggleSort}
        onSet={setSort}
        onReset={resetSort}
        cardMode
      />

      {/* Filter by payment type */}
      <div className="flex gap-2 flex-wrap">
        {["الكل", ...PAYMENT_TYPES].map((t) => (
          <button key={t} onClick={() => setFilterType(t)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${filterType === t ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-600 border-gray-200 hover:border-teal-300"}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Filter by supplier type */}
      <div className="flex gap-2 flex-wrap">
        {["الكل", "external_supplier", "internal_branch"].map((t) => (
          <button key={t} onClick={() => setFilterSupplierType(t)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filterSupplierType === t ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"}`}>
            {t === "الكل" ? "كل الأنواع" : SUPPLIER_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center text-gray-400">لا يوجد موردين بعد</Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((s) => (
            <Card key={s.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-bold text-gray-800 text-base">{s.name}</h3>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Badge className={`border-0 text-xs ${(s.supplier_type || "external_supplier") === "internal_branch" ? "bg-purple-100 text-purple-800" : "bg-blue-100 text-blue-800"}`}>
                      {s.supplier_type === "internal_branch" ? <><Building2 className="w-2.5 h-2.5 ml-0.5" /> فرع داخلي</> : "مورد خارجي"}
                    </Badge>
                    {s.payment_type && (
                      <Badge className={`${paymentTypeColor[s.payment_type] || "bg-gray-100 text-gray-700"} border-0 text-xs`}>
                        {s.payment_type}
                      </Badge>
                    )}
                    {s.exclude_from_net_purchases && (
                      <Badge className="bg-red-100 text-red-800 border-0 text-xs gap-0.5">
                        <Ban className="w-2.5 h-2.5" /> مستثنى من الصافي
                      </Badge>
                    )}
                  </div>
                </div>
                {isManager && (
                       <div className="flex gap-1">
                         <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-500" onClick={() => openEdit(s)}><Pencil className="w-3.5 h-3.5" /></Button>
                         <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => window.alert("تم إيقاف الحذف المباشر للموردين لحماية الفواتير والدفعات المرتبطة. استخدم التعطيل أو الدمج بعد المراجعة.")}><Trash2 className="w-3.5 h-3.5" /></Button>
                       </div>
                     )}
                   </div>
                   {s.default_purchase_category && s.default_purchase_category !== "none" && (
                     <Badge className={`${SUPPLIER_CATEGORY_MODE_COLORS[s.default_purchase_category]} border-0 text-xs`}>
                       {SUPPLIER_CATEGORY_MODE_LABELS[s.default_purchase_category]}
                     </Badge>
                   )}
                   {isManager && <SupplierCategorySettings supplier={s} />}
              {s.phone && <p className="text-sm text-gray-600 flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{s.phone}</p>}
              {s.address && <p className="text-sm text-gray-600 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{s.address}</p>}
              {s.payment_terms_days && s.payment_type === "آجل" && <p className="text-sm text-gray-600 flex items-center gap-1"><Clock className="w-3.5 h-3.5" />شروط الدفع: {s.payment_terms_days} يوم</p>}
              {s.notes && <p className="text-xs text-gray-400">{s.notes}</p>}
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader><DialogTitle className="text-right">{editing ? "تعديل مورد" : "إضافة مورد"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1"><Label>اسم المورد *</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} required /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>نوع المورد</Label>
                <Select value={form.supplier_type} onValueChange={(v) => set("supplier_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="external_supplier">مورد خارجي</SelectItem>
                    <SelectItem value="internal_branch">فرع داخلي</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>نوع التعامل</Label>
                <Select value={form.payment_type} onValueChange={(v) => set("payment_type", v)}>
                  <SelectTrigger><SelectValue placeholder="اختر نوع التعامل" /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.supplier_type === "internal_branch" && (
              <div className="space-y-1">
                <Label>الفرع المرتبط</Label>
                <Select value={form.linked_branch} onValueChange={(v) => set("linked_branch", v)}>
                  <SelectTrigger><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
                  <SelectContent>
                    {BRANCHES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label>تصنيف المورد</Label>
              <Select value={form.default_purchase_category} onValueChange={(v) => set("default_purchase_category", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SUPPLIER_DEFAULT_CATEGORY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-50">
              <input type="checkbox" id="exclude_net" checked={form.exclude_from_net_purchases} onChange={(e) => set("exclude_from_net_purchases", e.target.checked)} className="w-4 h-4 accent-red-600" />
              <label htmlFor="exclude_net" className="text-sm text-gray-700 cursor-pointer">استثناء فواتير هذا المورد من صافي المشتريات افتراضيًا</label>
            </div>
            <div className="space-y-1"><Label>رقم الهاتف</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
            <div className="space-y-1"><Label>العنوان</Label><Input value={form.address} onChange={(e) => set("address", e.target.value)} /></div>
            {form.payment_type === "آجل" && (
              <div className="space-y-1"><Label>شروط الدفع (أيام)</Label><Input type="number" min="0" value={form.payment_terms_days} onChange={(e) => set("payment_terms_days", parseInt(e.target.value) || 0)} placeholder="30" /></div>
            )}
            <div className="space-y-1"><Label>ملاحظات</Label><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} /></div>
            <DialogFooter className="gap-2 flex-row-reverse">
              <Button type="submit" className="bg-teal-600 hover:bg-teal-700" disabled={createMutation.isPending || updateMutation.isPending}>
                {editing ? "تحديث" : "حفظ"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}