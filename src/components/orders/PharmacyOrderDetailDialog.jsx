import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import {
  Loader2, Edit2, Ban, RotateCcw, AlertTriangle, User, Phone,
  MapPin, Calendar, CheckCircle2, Package, Truck, Search, ShoppingCart, ArrowLeftRight
} from "lucide-react";
import PharmacyOrderFormDialog from "./PharmacyOrderFormDialog";

const STATUS_STYLE = {
  "طلب جديد":              "bg-blue-100 text-blue-700 border-blue-200",
  "جاري البحث":            "bg-yellow-100 text-yellow-700 border-yellow-200",
  "تم الطلب":              "bg-indigo-100 text-indigo-700 border-indigo-200",
  "النواقص":               "bg-purple-100 text-purple-700 border-purple-200",
  "تم توفير الصنف":        "bg-teal-100 text-teal-700 border-teal-200",
  "تم التوصيل":            "bg-green-100 text-green-700 border-green-200",
  "تم توفير بديل":         "bg-cyan-100 text-cyan-700 border-cyan-200",
  "الصنف غير متوفر حاليا": "bg-orange-100 text-orange-700 border-orange-200",
  "تم الإلغاء":            "bg-red-100 text-red-700 border-red-200",
};

const CANCEL_REASONS = ["السعر غير مناسب", "تأخر الرد", "الصيدلية كانت تسأل فقط", "وجدته في مكان آخر", "أخرى"];

const PROGRESS_STAGES = [
  { key: "طلب جديد",       label: "طلب جديد",   icon: "📋" },
  { key: "جاري البحث",     label: "جاري البحث", icon: "🔍" },
  { key: "تم الطلب",       label: "تم الطلب",   icon: "🛒" },
  { key: "تم توفير الصنف", label: "تم التوفير", icon: "📦" },
  { key: "تم التوصيل",     label: "تم التوصيل", icon: "✅" },
];

function getProgressIndex(status) {
  const idx = PROGRESS_STAGES.findIndex(s => s.key === status);
  if (idx !== -1) return idx;
  if (status === "النواقص") return 2;
  return 0;
}

export default function PharmacyOrderDetailDialog({ open, onOpenChange, order, teamMembers = [], isManager, onUpdated }) {
  const [saving, setSaving] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [lightbox, setLightbox] = useState(null);

  const [supplierSearch, setSupplierSearch] = useState(order.supplier_found || "");
  const [purchasePrice, setPurchasePrice] = useState(order.purchase_price || "");
  const [searchNotes, setSearchNotes] = useState(order.search_notes || "");

  const [orderedSupplier, setOrderedSupplier] = useState(order.ordered_supplier || "");
  const [arrivalNotes, setArrivalNotes] = useState(order.arrival_notes || "");

  const [customerContacted, setCustomerContacted] = useState(order.customer_contacted || false);
  const [contactNote, setContactNote] = useState(order.followup_notes || "");

  const [showCancelPanel, setShowCancelPanel] = useState(false);
  const [cancelReason, setCancelReason] = useState(order.cancellation_reason || "");

  const isCancelled = order.status === "تم الإلغاء";
  const isDelivered  = order.status === "تم التوصيل";
  const progressIdx  = getProgressIndex(order.status);

  const updateOrder = async (updates, newStatus, timelineNote) => {
    setSaving(true);
    const user = await base44.auth.me();
    const userName = user?.full_name || user?.email || "مجهول";
    const timeline = [...(order.timeline || []), {
      status: newStatus || order.status,
      by: userName,
      at: new Date().toISOString(),
      note: timelineNote || "",
    }];
    const updated = { ...updates, timeline };
    if (newStatus) updated.status = newStatus;
    await base44.entities.PharmacyOrder.update(order.id, updated);
    setSaving(false);
    onUpdated?.({ ...order, ...updated });
  };

  const handleStartSearch = () =>
    updateOrder({ supplier_found: supplierSearch, purchase_price: purchasePrice ? Number(purchasePrice) : undefined, search_notes: searchNotes }, "جاري البحث", "بدء البحث");

  const handleSaveSearch = () =>
    updateOrder({ supplier_found: supplierSearch, purchase_price: purchasePrice ? Number(purchasePrice) : undefined, search_notes: searchNotes }, null, "تحديث بيانات البحث");

  const handleMoveToOrdered = () =>
    updateOrder({ ordered_supplier: orderedSupplier, arrival_notes: arrivalNotes }, "تم الطلب", `تم الطلب من: ${orderedSupplier}`);

  const handleSaveOrdered = () =>
    updateOrder({ ordered_supplier: orderedSupplier, arrival_notes: arrivalNotes }, null, "تحديث بيانات الطلب");

  const handleMoveToShortage = () =>
    updateOrder({ supplier_found: supplierSearch, search_notes: searchNotes }, "النواقص", "نقل للنواقص");

  const handleMoveToAvailable = () =>
    updateOrder({ customer_contacted: customerContacted, followup_notes: contactNote, product_available: true }, "تم توفير الصنف", "تم توفير الصنف");

  const handleSaveAvailable = () =>
    updateOrder({ customer_contacted: customerContacted, followup_notes: contactNote }, null, "تحديث متابعة الصيدلية");

  const handleDeliver = () =>
    updateOrder({}, "تم التوصيل", "تم التسليم للصيدلية");

  const handleCancel = () =>
    updateOrder({ cancellation_reason: cancelReason }, "تم الإلغاء", `إلغاء: ${cancelReason}`);

  const handleRestore = (newStatus) =>
    updateOrder({ cancellation_reason: "" }, newStatus, `استعادة إلى: ${newStatus}`);

  const handleMoveToCustomer = async () => {
    setSaving(true);
    const { id, created_date, updated_date, created_by_id, ...data } = order;
    await base44.entities.CustomerOrder.create({ ...data, timeline: [...(order.timeline || []), { status: order.status, by: "النظام", at: new Date().toISOString(), note: "تم النقل من طلبات الصيدليات" }] });
    await base44.entities.PharmacyOrder.delete(order.id);
    setSaving(false);
    onUpdated?.(null);
    onOpenChange(false);
  };

  const cfg = STATUS_STYLE[order.status] || "";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <DialogTitle className="text-gray-800 text-base">
                طلب #{order.order_number || order.id?.slice(-6)}
              </DialogTitle>
              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${cfg}`}>{order.status}</span>
                {isManager && !isCancelled && !isDelivered && (
                  <Button size="sm" variant="outline" onClick={() => setShowEdit(true)} className="gap-1 h-7 text-xs">
                    <Edit2 className="w-3 h-3" /> تعديل
                  </Button>
                )}
                {isManager && (
                  <Button size="sm" variant="outline" onClick={handleMoveToCustomer} disabled={saving}
                    className="gap-1 h-7 text-xs border-teal-300 text-teal-700 hover:bg-teal-50">
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowLeftRight className="w-3 h-3" />}
                    نقل لعملاء
                  </Button>
                )}
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4">

            {/* Progress Bar */}
            {!isCancelled && (
              <div className="bg-gray-50 rounded-xl p-3 border">
                <div className="flex items-center justify-between relative">
                  <div className="absolute top-4 right-4 left-4 h-0.5 bg-gray-200 z-0" />
                  <div className="absolute top-4 right-4 h-0.5 bg-violet-500 z-0 transition-all duration-500"
                    style={{ width: `${(progressIdx / (PROGRESS_STAGES.length - 1)) * 100}%` }} />
                  {PROGRESS_STAGES.map((s, i) => {
                    const done = i < progressIdx || isDelivered;
                    const active = i === progressIdx && !isDelivered;
                    return (
                      <div key={s.key} className="flex flex-col items-center gap-1 z-10 flex-1">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all
                          ${done ? "bg-violet-500 border-violet-500 text-white" :
                            active ? "bg-white border-violet-500 text-violet-600 shadow-md" :
                            "bg-white border-gray-200 text-gray-400"}`}>
                          {done ? <CheckCircle2 className="w-4 h-4" /> : <span>{s.icon}</span>}
                        </div>
                        <span className={`text-xs text-center leading-tight ${active ? "text-violet-700 font-bold" : done ? "text-violet-600" : "text-gray-400"}`}>
                          {s.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Cancel button */}
            {isManager && !isCancelled && !isDelivered && (
              <div className="flex justify-end">
                <Button size="sm" variant="outline"
                  className="gap-1.5 border-red-300 text-red-600 hover:bg-red-50 text-xs h-8"
                  onClick={() => setShowCancelPanel(p => !p)}>
                  <Ban className="w-3.5 h-3.5" /> إلغاء الطلب
                </Button>
              </div>
            )}

            {showCancelPanel && isManager && (
              <div className="border border-red-200 bg-red-50 rounded-xl p-3 space-y-2">
                <p className="text-sm font-semibold text-red-700 flex items-center gap-1"><Ban className="w-4 h-4" /> إلغاء الطلب</p>
                <Select value={cancelReason} onValueChange={setCancelReason}>
                  <SelectTrigger className="h-8 text-sm border-red-200 text-red-700 bg-white">
                    <SelectValue placeholder="اختر سبب الإلغاء" />
                  </SelectTrigger>
                  <SelectContent>
                    {CANCEL_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white text-xs h-8"
                    disabled={!cancelReason || saving} onClick={handleCancel}>
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "تأكيد الإلغاء"}
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setShowCancelPanel(false)}>إغلاق</Button>
                </div>
              </div>
            )}

            {/* STAGE 1: بيانات الطلب */}
            <StageCard number={1} title="بيانات الطلب" icon={<span>📋</span>}
              active done={progressIdx > 0 || isDelivered} color="blue">
              <div className="grid grid-cols-2 gap-2">
                <InfoItem icon={<User className="w-3.5 h-3.5" />} label="الصيدلية" value={order.customer_name} bold />
                <InfoItem icon={<Phone className="w-3.5 h-3.5" />} label="الهاتف" value={order.phone} />
                <InfoItem icon={<Package className="w-3.5 h-3.5" />} label="الصنف" value={order.product_name} bold />
                <InfoItem icon={<MapPin className="w-3.5 h-3.5" />} label="الفرع" value={order.branch} />
                {order.request_source && <InfoItem label="مصدر الطلب" value={order.request_source} />}
                {order.priority && <InfoItem label="الأولوية" value={order.priority} />}
                {order.customer_code && <InfoItem label="كود الصيدلية" value={order.customer_code} />}
                {order.assigned_employee && <InfoItem label="الموظف" value={order.assigned_employee} />}
                {order.request_date && <InfoItem icon={<Calendar className="w-3.5 h-3.5" />} label="التاريخ" value={order.request_date} />}
              </div>
              {order.notes && (
                <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800">
                  <strong>ملاحظات:</strong> {order.notes}
                </div>
              )}
              {order.product_image && (
                <div className="mt-2 cursor-pointer inline-block" onClick={() => setLightbox(order.product_image)}>
                  <img src={order.product_image} alt="صنف" className="h-20 w-20 object-cover rounded-lg border hover:opacity-80" />
                </div>
              )}
            </StageCard>

            {/* STAGE 2: جاري البحث */}
            <StageCard number={2} title="مرحلة البحث" icon={<Search className="w-3.5 h-3.5" />}
              active={!isCancelled && !isDelivered}
              done={progressIdx > 1 || isDelivered}
              color="yellow">
              {isManager && !isCancelled && !isDelivered ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-gray-500">المورد المتوقع</label>
                      <Input value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} placeholder="اسم المورد..." className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-gray-500">سعر الشراء</label>
                      <Input type="number" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} placeholder="السعر" className="h-8 text-sm" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">ملاحظات البحث</label>
                    <Input value={searchNotes} onChange={e => setSearchNotes(e.target.value)} placeholder="ملاحظات..." className="h-8 text-sm" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {order.status === "طلب جديد" && (
                      <Button size="sm" className="bg-yellow-500 hover:bg-yellow-600 text-white gap-1.5 text-xs h-8"
                        onClick={handleStartSearch} disabled={saving}>
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                        بدء البحث
                      </Button>
                    )}
                    {order.status === "جاري البحث" && (
                      <Button size="sm" variant="outline" className="border-yellow-300 text-yellow-700 hover:bg-yellow-50 gap-1.5 text-xs h-8"
                        onClick={handleSaveSearch} disabled={saving}>
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "💾"} حفظ التعديلات
                      </Button>
                    )}
                    {(order.status === "جاري البحث" || order.status === "طلب جديد") && (
                      <Button size="sm" variant="outline" className="border-purple-300 text-purple-700 hover:bg-purple-50 gap-1.5 text-xs h-8"
                        onClick={handleMoveToShortage} disabled={saving}>
                        <AlertTriangle className="w-3.5 h-3.5" /> نقل للنواقص
                      </Button>
                    )}
                  </div>
                  {order.status === "النواقص" && (
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-2 text-xs text-purple-700 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      الصنف في قائمة النواقص — في انتظار التوفير
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm space-y-1 text-gray-600">
                  {order.supplier_found && <p>المورد: <strong>{order.supplier_found}</strong></p>}
                  {order.purchase_price && <p>سعر الشراء: <strong>{order.purchase_price}</strong></p>}
                  {order.search_notes && <p>ملاحظات: {order.search_notes}</p>}
                  {!order.supplier_found && <p className="text-gray-400 text-xs">لم تبدأ مرحلة البحث بعد</p>}
                </div>
              )}
            </StageCard>

            {/* STAGE 3: تم الطلب */}
            <StageCard number={3} title="تم الطلب من المورد" icon={<ShoppingCart className="w-3.5 h-3.5" />}
              active={!isCancelled && !isDelivered && progressIdx >= 1}
              done={progressIdx >= 3 || isDelivered}
              color="indigo">
              {isManager && !isCancelled && !isDelivered ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">اسم المورد الذي تم الطلب منه *</label>
                    <Input value={orderedSupplier} onChange={e => setOrderedSupplier(e.target.value)} placeholder="اسم المورد..." className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">ملاحظات موعد الوصول</label>
                    <Input value={arrivalNotes} onChange={e => setArrivalNotes(e.target.value)} placeholder="مثال: يصل الخميس القادم..." className="h-8 text-sm" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(order.status === "جاري البحث" || order.status === "النواقص" || order.status === "طلب جديد") && (
                      <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 text-xs h-8"
                        onClick={handleMoveToOrdered} disabled={saving || !orderedSupplier}>
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShoppingCart className="w-3.5 h-3.5" />}
                        تأكيد: تم الطلب
                      </Button>
                    )}
                    {order.status === "تم الطلب" && (
                      <Button size="sm" variant="outline" className="border-indigo-300 text-indigo-700 hover:bg-indigo-50 gap-1.5 text-xs h-8"
                        onClick={handleSaveOrdered} disabled={saving}>
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "💾"} حفظ التعديلات
                      </Button>
                    )}
                  </div>
                  {order.ordered_supplier && (
                    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-2 text-xs text-indigo-800 space-y-0.5">
                      <p>المورد: <strong>{order.ordered_supplier}</strong></p>
                      {order.arrival_notes && <p>موعد الوصول: {order.arrival_notes}</p>}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm space-y-1 text-gray-600">
                  {order.ordered_supplier ? (
                    <>
                      <p className="flex items-center gap-1 text-indigo-700 font-medium"><CheckCircle2 className="w-3.5 h-3.5" /> تم الطلب</p>
                      <p>المورد: <strong>{order.ordered_supplier}</strong></p>
                      {order.arrival_notes && <p className="text-xs text-gray-500">موعد الوصول: {order.arrival_notes}</p>}
                    </>
                  ) : (
                    <p className="text-gray-400 text-xs">لم يتم الطلب من المورد بعد</p>
                  )}
                </div>
              )}
            </StageCard>

            {/* STAGE 4: توفير الصنف */}
            <StageCard number={4} title="توفير الصنف" icon={<Package className="w-3.5 h-3.5" />}
              active={!isCancelled && !isDelivered && progressIdx >= 2}
              done={progressIdx >= 4 || isDelivered}
              color="teal">
              {isManager && !isCancelled && !isDelivered ? (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                    <input type="checkbox" checked={customerContacted}
                      onChange={e => setCustomerContacted(e.target.checked)}
                      className="w-4 h-4 accent-teal-600" />
                    تم التواصل مع الصيدلية
                  </label>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">ملاحظة المتابعة</label>
                    <Input value={contactNote} onChange={e => setContactNote(e.target.value)} placeholder="ملاحظة..." className="h-8 text-sm" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(order.status === "تم الطلب" || order.status === "النواقص" || order.status === "جاري البحث") && (
                      <>
                        <Button size="sm" className="bg-teal-600 hover:bg-teal-700 text-white gap-1.5 text-xs h-8"
                          onClick={handleMoveToAvailable} disabled={saving}>
                          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
                          تم توفير الصنف
                        </Button>
                        <Button size="sm" className="bg-cyan-600 hover:bg-cyan-700 text-white gap-1.5 text-xs h-8"
                          onClick={() => updateOrder({ customer_contacted: customerContacted, followup_notes: contactNote, product_available: true }, "تم توفير بديل", "تم توفير بديل للصنف")} disabled={saving}>
                          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "🔄"}
                          تم توفير بديل
                        </Button>
                      </>
                    )}
                    {order.status === "تم توفير الصنف" && (
                      <Button size="sm" variant="outline" className="border-teal-300 text-teal-700 hover:bg-teal-50 gap-1.5 text-xs h-8"
                        onClick={handleSaveAvailable} disabled={saving}>
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "💾"} حفظ التعديلات
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-600">
                  {progressIdx >= 4 || isDelivered ? (
                    <div className="space-y-1">
                      <p className="flex items-center gap-1 text-teal-700 font-medium"><CheckCircle2 className="w-3.5 h-3.5" /> تم توفير الصنف</p>
                      {order.customer_contacted && <p className="text-xs text-gray-500">✓ تم التواصل مع الصيدلية</p>}
                      {order.followup_notes && <p className="text-xs text-gray-500">{order.followup_notes}</p>}
                    </div>
                  ) : (
                    <p className="text-gray-400 text-xs">في انتظار توفير الصنف</p>
                  )}
                </div>
              )}
            </StageCard>

            {/* STAGE 5: تم التوصيل */}
            <StageCard number={5} title="تم التوصيل" icon={<Truck className="w-3.5 h-3.5" />}
              active={!isCancelled && (progressIdx >= 4 || order.status === "تم توفير الصنف" || order.status === "تم توفير بديل")}
              done={isDelivered}
              color={order.status === "تم توفير بديل" && !isDelivered ? "amber" : isDelivered && order.timeline?.slice().reverse().find(t => t.status === "تم توفير بديل") ? "amber" : "green"}>
              {isManager && !isCancelled && !isDelivered ? (
                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white gap-1.5 text-xs h-8"
                  onClick={handleDeliver} disabled={saving || (order.status !== "تم توفير الصنف" && order.status !== "تم توفير بديل")}>
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />}
                  {(order.status !== "تم توفير الصنف" && order.status !== "تم توفير بديل") ? "يتطلب توفير الصنف أولاً" : "تأكيد التوصيل"}
                </Button>
              ) : isDelivered ? (
                <p className="text-green-700 font-semibold text-sm flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> تم تسليم الطلب للصيدلية
                </p>
              ) : (
                <p className="text-gray-400 text-xs">في انتظار التوصيل</p>
              )}
            </StageCard>

            {/* Cancelled */}
            {isCancelled && (
              <div className="border border-red-200 bg-red-50 rounded-xl p-3 space-y-2">
                <p className="text-sm font-semibold text-red-700 flex items-center gap-1.5"><Ban className="w-4 h-4" /> تم إلغاء الطلب</p>
                {order.cancellation_reason && <p className="text-xs text-red-600">السبب: {order.cancellation_reason}</p>}
                {isManager && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <p className="text-xs text-gray-500 w-full flex items-center gap-1"><RotateCcw className="w-3 h-3" /> استعادة إلى:</p>
                    <Button size="sm" variant="outline" className="text-xs h-7 border-blue-300 text-blue-600" onClick={() => handleRestore("طلب جديد")} disabled={saving}>طلب جديد</Button>
                    <Button size="sm" variant="outline" className="text-xs h-7 border-yellow-300 text-yellow-700" onClick={() => handleRestore("جاري البحث")} disabled={saving}>جاري البحث</Button>
                  </div>
                )}
              </div>
            )}

            {/* Timeline */}
            {order.timeline?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">سجل الطلب</p>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {[...(order.timeline || [])].reverse().map((t, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs bg-gray-50 rounded-lg p-2">
                      <span className={`px-2 py-0.5 rounded-full whitespace-nowrap font-medium ${STATUS_STYLE[t.status] || "bg-gray-100 text-gray-600"}`}>{t.status}</span>
                      <div className="flex-1">
                        <span className="font-medium text-gray-700">{t.by}</span>
                        {t.note && <span className="text-gray-500"> — {t.note}</span>}
                      </div>
                      <span className="text-gray-400 whitespace-nowrap">{t.at ? new Date(t.at).toLocaleDateString("ar-EG") : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </DialogContent>
      </Dialog>

      {showEdit && (
        <PharmacyOrderFormDialog
          open={showEdit}
          onOpenChange={setShowEdit}
          editOrder={order}
          teamMembers={teamMembers}
          onSaved={() => { setShowEdit(false); onUpdated?.({ ...order }); }}
        />
      )}

      {lightbox && (
        <div className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="صنف" className="max-w-full max-h-full object-contain rounded-lg" />
          <button className="absolute top-4 left-4 text-white text-2xl font-bold" onClick={() => setLightbox(null)}>✕</button>
        </div>
      )}
    </>
  );
}

const STAGE_COLORS = {
  blue:   { border: "border-blue-200",   bg: "bg-blue-50",   num: "bg-blue-600",   title: "text-blue-800"  },
  yellow: { border: "border-yellow-200", bg: "bg-yellow-50", num: "bg-yellow-500", title: "text-yellow-800" },
  indigo: { border: "border-indigo-200", bg: "bg-indigo-50", num: "bg-indigo-600", title: "text-indigo-800" },
  teal:   { border: "border-teal-200",   bg: "bg-teal-50",   num: "bg-teal-600",   title: "text-teal-800"  },
  green:  { border: "border-green-200",  bg: "bg-green-50",  num: "bg-green-600",  title: "text-green-800" },
  amber:  { border: "border-amber-200",  bg: "bg-amber-50",  num: "bg-amber-500",  title: "text-amber-800" },
};

function StageCard({ number, title, icon, active, done, color = "blue", children }) {
  const c = STAGE_COLORS[color];
  return (
    <div className={`rounded-xl border p-3 space-y-3 transition-all ${active ? `${c.border} ${c.bg}` : "border-gray-100 bg-gray-50 opacity-50"}`}>
      <div className="flex items-center gap-2">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${done ? "bg-violet-500" : active ? c.num : "bg-gray-300"}`}>
          {done ? <CheckCircle2 className="w-4 h-4" /> : number}
        </div>
        <span className={`text-sm font-semibold flex items-center gap-1.5 ${active ? c.title : "text-gray-400"}`}>
          {icon} {title}
        </span>
        {done && <span className="text-xs text-violet-600 mr-auto font-medium">✓ مكتمل</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function InfoItem({ icon, label, value, bold }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-gray-400 flex items-center gap-1">{icon}{label}</span>
      <span className={`text-sm ${bold ? "font-bold text-gray-800" : "text-gray-700"}`}>{value}</span>
    </div>
  );
}