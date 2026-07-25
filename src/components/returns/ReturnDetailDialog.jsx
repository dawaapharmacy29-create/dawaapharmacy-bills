import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { useUserRole } from "@/lib/useUserRole";
import { CheckCircle, XCircle, Clock, Send, RotateCcw, Loader2, ZoomIn, MessageSquare, Edit2, PauseCircle, Save, Printer, ReceiptText } from "lucide-react";
import { logActivity } from "@/lib/activityLogger";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const STATUS_CONFIG = {
  Pending: { label: "في الانتظار", color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  "Under Review": { label: "جاري المراجعة", color: "bg-blue-100 text-blue-800 border-blue-200" },
  Approved: { label: "معتمد", color: "bg-green-100 text-green-800 border-green-200" },
  Returned: { label: "تم التنفيذ", color: "bg-teal-100 text-teal-800 border-teal-200" },
  Rejected: { label: "مرفوض", color: "bg-red-100 text-red-800 border-red-200" },
};

const REASONS = ["عدم الحاجة", "انتهاء الصلاحية", "تغيير السعر", "تلف", "لم يصل"];

const STATUS_TIMELINE = ["Pending", "Under Review", "Approved", "Returned"];

export default function ReturnDetailDialog({ open, onOpenChange, returnData, onUpdated, onDeleted }) {
  const [note, setNote] = useState("");
  const [updatingStatus, setUpdatingStatus] = useState(null);
  const [lightboxImg, setLightboxImg] = useState(null);
  const [internalNote, setInternalNote] = useState(returnData?.internal_notes || "");
  const [savingNote, setSavingNote] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editItems, setEditItems] = useState(returnData?.items || []);
  const [savingEdit, setSavingEdit] = useState(false);
  const [creditNote, setCreditNote] = useState({
    number: returnData?.credit_note_number || "",
    amount: returnData?.credit_note_amount || "",
    date: returnData?.credit_note_date || new Date().toISOString().slice(0, 10),
    notes: returnData?.credit_note_notes || "",
  });
  const [savingCreditNote, setSavingCreditNote] = useState(false);
  const [creditError, setCreditError] = useState("");
  const { isManager, user } = useUserRole();

  if (!returnData) return null;
  const cfg = STATUS_CONFIG[returnData.status] || STATUS_CONFIG.Pending;

  const saveEdit = async () => {
    setSavingEdit(true);
    await base44.entities.Return.update(returnData.id, { items: editItems });
    setSavingEdit(false);
    setEditMode(false);
    onUpdated?.({ ...returnData, items: editItems });
  };

  const updateEditItem = (idx, field, val) => {
    setEditItems(prev => {
      const arr = [...prev];
      arr[idx] = { ...arr[idx], [field]: val };
      return arr;
    });
  };

  const changeStatus = async (newStatus) => {
    setUpdatingStatus(newStatus);
    const userName = user?.full_name || user?.email || "مجهول";
    const history = [...(returnData.status_history || []), {
      status: newStatus,
      changed_by: userName,
      changed_at: new Date().toISOString(),
      note: note || "",
    }];
    const updates = {
      status: newStatus,
      status_history: history,
    };
    if (newStatus === "Returned") {
      updates.returned_at = new Date().toISOString();
      updates.approved_by = userName;
    }
    if (newStatus === "Under Review") updates.reviewed_by = userName;
    if (newStatus === "Approved") updates.approved_by = userName;

    await base44.entities.Return.update(returnData.id, updates);
    setNote("");
    setUpdatingStatus(null);
    onUpdated?.({ ...returnData, ...updates });
  };


  const saveCreditNote = async () => {
    setCreditError("");
    if (!creditNote.number.trim()) return setCreditError("أدخل رقم إشعار الخصم.");
    const amount = Number(creditNote.amount || 0);
    if (amount <= 0) return setCreditError("قيمة إشعار الخصم يجب أن تكون أكبر من صفر.");
    if (!creditNote.date) return setCreditError("حدد تاريخ إشعار الخصم.");
    setSavingCreditNote(true);
    try {
      const updates = {
        credit_note_number: creditNote.number.trim(),
        credit_note_amount: amount,
        credit_note_date: creditNote.date,
        credit_note_notes: creditNote.notes.trim(),
        credit_note_status: "received",
        credit_note_recorded_by: user?.full_name || user?.email || "مجهول",
        credit_note_recorded_at: new Date().toISOString(),
      };
      await base44.entities.Return.update(returnData.id, updates);
      await logActivity({
        action_type: "update",
        entity_type: "return",
        entity_id: returnData.id,
        entity_label: `إشعار خصم: ${returnData.return_number || returnData.invoice_number}`,
        details: `تم تسجيل إشعار خصم رقم ${updates.credit_note_number} بقيمة ${amount}`,
      });
      onUpdated?.({ ...returnData, ...updates });
    } finally {
      setSavingCreditNote(false);
    }
  };

  const saveInternalNote = async () => {
    setSavingNote(true);
    await base44.entities.Return.update(returnData.id, { internal_notes: internalNote });
    setSavingNote(false);
    onUpdated?.({ ...returnData, internal_notes: internalNote });
  };

  const canChangeStatus = isManager;
  const isRejected = returnData.status === "Rejected";
  const isReturned = returnData.status === "Returned";
  const isDone = isRejected || isReturned;

  const handlePrint = () => {
    const STATUS_LABELS = { Pending: "في الانتظار", "Under Review": "جاري المراجعة", Approved: "معتمد", Returned: "تم التنفيذ", Rejected: "مرفوض" };
    const itemsHtml = (returnData.items || []).map(it => `<tr><td>${esc(it.product_name)}</td><td>${it.quantity || ""}</td><td>${esc(it.item_reason) || "—"}</td></tr>`).join("");
    const historyHtml = (returnData.status_history || []).map(h => `<tr><td>${STATUS_LABELS[h.status] || esc(h.status)}</td><td>${esc(h.changed_by)}</td><td>${h.changed_at ? new Date(h.changed_at).toLocaleDateString("ar-EG") : ""}</td><td>${esc(h.note)}</td></tr>`).join("");
    const w = window.open("", "_blank");
    w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>تقرير مرتجع ${returnData.return_number}</title>
    <style>body{font-family:Arial,sans-serif;padding:24px;color:#111}h1{color:#0d9488;font-size:18px}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border:1px solid #ddd;padding:8px;text-align:right;font-size:13px}th{background:#f0fdfa;color:#0d9488}
    .badge{display:inline-block;padding:2px 10px;border-radius:9999px;font-size:12px;font-weight:bold}
    .info-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:12px 0}
    .info-cell{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px}
    .info-label{font-size:11px;color:#6b7280}.info-value{font-size:13px;font-weight:600;margin-top:4px}
    @media print{button{display:none}}</style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #0d9488;padding-bottom:12px;margin-bottom:16px">
      <div><h1>تقرير مرتجع — ${returnData.return_number || "—"}</h1><p style="color:#6b7280;font-size:12px;margin:0">تاريخ الطباعة: ${new Date().toLocaleDateString("ar-EG")}</p></div>
      <span class="badge" style="background:#f0fdfa;color:#0d9488;border:1px solid #99f6e4">${STATUS_LABELS[returnData.status] || returnData.status}</span>
    </div>
    <div class="info-grid">
      <div class="info-cell"><div class="info-label">رقم الفاتورة</div><div class="info-value">${returnData.invoice_number || "—"}</div></div>
      <div class="info-cell"><div class="info-label">المورد</div><div class="info-value">${returnData.supplier_name || "—"}</div></div>
      <div class="info-cell"><div class="info-label">الفرع</div><div class="info-value">${returnData.branch_name || "—"}</div></div>
      <div class="info-cell"><div class="info-label">الموظف</div><div class="info-value">${returnData.employee_name || "—"}</div></div>
      <div class="info-cell"><div class="info-label">التاريخ</div><div class="info-value">${returnData.created_date ? new Date(returnData.created_date).toLocaleDateString("ar-EG") : "—"}</div></div>
      ${returnData.approved_by ? `<div class="info-cell"><div class="info-label">معتمد بواسطة</div><div class="info-value">${returnData.approved_by}</div></div>` : ""}
      ${returnData.credit_note_number ? `<div class="info-cell"><div class="info-label">إشعار الخصم</div><div class="info-value">${returnData.credit_note_number} — ${Number(returnData.credit_note_amount || 0).toLocaleString("ar-EG")} ج</div></div>` : ""}
    </div>
    ${returnData.notes ? `<p style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px;font-size:13px"><strong>ملاحظات:</strong> ${returnData.notes}</p>` : ""}
    <h3 style="color:#0d9488;font-size:14px;margin-top:16px">الأصناف المرتجعة</h3>
    <table><thead><tr><th>اسم الصنف</th><th>الكمية</th><th>السبب</th></tr></thead><tbody>${itemsHtml}</tbody></table>
    ${historyHtml ? `<h3 style="color:#0d9488;font-size:14px;margin-top:16px">سجل التغييرات</h3><table><thead><tr><th>الحالة</th><th>بواسطة</th><th>التاريخ</th><th>ملاحظة</th></tr></thead><tbody>${historyHtml}</tbody></table>` : ""}
    <script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="text-lg font-bold text-teal-700">
                تفاصيل المرتجع — {returnData.return_number}
              </DialogTitle>
              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${cfg.color}`}>{cfg.label}</span>
                <Button size="sm" variant="outline" onClick={handlePrint} className="gap-1 h-7 text-xs text-gray-600 border-gray-300">
                  <Printer className="w-3.5 h-3.5" /> طباعة
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-5">
            {/* Basic Info */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 bg-gray-50 rounded-xl p-4">
              <InfoRow label="رقم الفاتورة" value={returnData.invoice_number} />
              <InfoRow label="المورد" value={returnData.supplier_name} />
              <InfoRow label="الفرع" value={returnData.branch_name} />
              <InfoRow label="الموظف" value={returnData.employee_name} />
              <InfoRow label="التاريخ" value={returnData.created_date ? new Date(returnData.created_date).toLocaleDateString("ar-EG") : "—"} />
              {returnData.approved_by && <InfoRow label="معتمد بواسطة" value={returnData.approved_by} />}
              {returnData.reviewed_by && <InfoRow label="مراجع بواسطة" value={returnData.reviewed_by} />}
              {returnData.returned_at && <InfoRow label="تاريخ التنفيذ" value={new Date(returnData.returned_at).toLocaleDateString("ar-EG")} />}
            </div>
            {returnData.notes && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
                <strong>ملاحظات:</strong> {returnData.notes}
              </div>
            )}

            {/* Status Timeline */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">مسار الحالة</h3>
              <div className="relative">
                <div className="flex items-center justify-between relative">
                  {STATUS_TIMELINE.map((s, i) => {
                    const scfg = STATUS_CONFIG[s];
                    const currentIdx = STATUS_TIMELINE.indexOf(returnData.status);
                    const done = i <= currentIdx && !isRejected;
                    return (
                      <div key={s} className="flex flex-col items-center flex-1">
                        <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold z-10 ${done ? "bg-teal-500 border-teal-500 text-white" : "bg-white border-gray-300 text-gray-400"}`}>
                          {done ? "✓" : i + 1}
                        </div>
                        <span className="text-xs text-center mt-1 text-gray-600 hidden md:block">{scfg.label}</span>
                        {i < STATUS_TIMELINE.length - 1 && (
                          <div className={`absolute top-3.5 h-0.5 ${done && i < currentIdx ? "bg-teal-500" : "bg-gray-200"}`} style={{ left: `${(i + 1) * (100 / STATUS_TIMELINE.length)}%`, right: `${(STATUS_TIMELINE.length - i - 2) * (100 / STATUS_TIMELINE.length)}%` }} />
                        )}
                      </div>
                    );
                  })}
                  {isRejected && (
                    <div className="flex flex-col items-center flex-1">
                      <div className="w-7 h-7 rounded-full border-2 bg-red-500 border-red-500 text-white flex items-center justify-center text-xs z-10">✕</div>
                      <span className="text-xs text-center mt-1 text-red-600 hidden md:block">مرفوض</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Status History */}
            {returnData.status_history?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">سجل التغييرات</h3>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {[...(returnData.status_history || [])].reverse().map((h, i) => (
                    <div key={i} className="flex items-start gap-3 text-xs bg-gray-50 rounded-lg p-2.5">
                      <div className={`mt-0.5 px-2 py-0.5 rounded-full border text-xs whitespace-nowrap ${STATUS_CONFIG[h.status]?.color || "bg-gray-100"}`}>
                        {STATUS_CONFIG[h.status]?.label || h.status}
                      </div>
                      <div className="flex-1">
                        <span className="font-medium text-gray-700">{h.changed_by}</span>
                        {h.note && <span className="text-gray-500"> — {h.note}</span>}
                      </div>
                      <span className="text-gray-400 whitespace-nowrap">{h.changed_at ? new Date(h.changed_at).toLocaleDateString("ar-EG") : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Items */}
            {returnData.items?.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-700">الأصناف المرتجعة ({returnData.items.length})</h3>
                  {isManager && !editMode && (
                    <Button size="sm" variant="outline" onClick={() => { setEditItems(returnData.items); setEditMode(true); }} className="gap-1 text-blue-600 border-blue-300 h-7 text-xs">
                      <Edit2 className="w-3 h-3" /> تعديل
                    </Button>
                  )}
                </div>
                {editMode ? (
                  <div className="space-y-2">
                    {editItems.map((item, i) => (
                      <div key={i} className="bg-gray-50 rounded-lg p-3 border space-y-2">
                        <Input value={item.product_name} onChange={e => updateEditItem(i, "product_name", e.target.value)} placeholder="اسم الصنف" className="text-sm h-8" />
                        <div className="grid grid-cols-2 gap-2">
                          <Input type="number" min="1" value={item.quantity} onChange={e => updateEditItem(i, "quantity", +e.target.value)} placeholder="العدد" className="text-sm h-8" />
                          <Select value={item.item_reason} onValueChange={v => updateEditItem(i, "item_reason", v)}>
                            <SelectTrigger className="text-sm h-8"><SelectValue placeholder="السبب" /></SelectTrigger>
                            <SelectContent>
                              {REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ))}
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" onClick={saveEdit} disabled={savingEdit} className="gap-1 bg-teal-600 hover:bg-teal-700 text-white">
                        {savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} حفظ
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditMode(false)}>إلغاء</Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {returnData.items.map((item, i) => (
                      <div key={i} className="bg-gray-50 rounded-lg p-3 text-sm border">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-gray-800">{item.product_name}</span>
                          <span className="bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full text-xs font-bold">كمية: {item.quantity}</span>
                        </div>
                        {item.item_reason && <p className="text-xs text-gray-500">سبب: {item.item_reason}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Images */}
            {returnData.invoice_images?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">صور الفاتورة</h3>
                <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                  {returnData.invoice_images.map((url, i) => (
                    <div key={i} className="relative group cursor-pointer" onClick={() => setLightboxImg(url)}>
                      {url.toLowerCase().endsWith(".pdf") ? (
                        <div className="h-20 bg-red-50 border rounded-lg flex flex-col items-center justify-center text-red-400 text-xs">
                          <span className="text-2xl">📄</span> PDF
                        </div>
                      ) : (
                        <img src={url} alt={`صورة ${i + 1}`} className="h-20 w-full object-cover rounded-lg border hover:opacity-80 transition-opacity" />
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors rounded-lg flex items-center justify-center">
                        <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}


            {/* Credit Note */}
            {(returnData.status === "Returned" || returnData.credit_note_number) && (
              <div className={`rounded-xl border p-4 space-y-3 ${returnData.credit_note_number ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-300"}`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className={`font-bold text-sm flex items-center gap-2 ${returnData.credit_note_number ? "text-emerald-800" : "text-amber-800"}`}><ReceiptText className="w-4 h-4" />إشعار الخصم من المورد</h3>
                  <span className={`text-xs px-2 py-1 rounded-full ${returnData.credit_note_number ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{returnData.credit_note_number ? "تم التوثيق" : "مطلوب للإغلاق المالي"}</span>
                </div>
                {creditError && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{creditError}</div>}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div className="space-y-1"><label className="text-xs text-gray-600">رقم الإشعار *</label><Input value={creditNote.number} onChange={e => setCreditNote(v => ({...v, number:e.target.value}))} disabled={!isManager} /></div>
                  <div className="space-y-1"><label className="text-xs text-gray-600">القيمة *</label><Input type="number" min="0.01" step="0.01" value={creditNote.amount} onChange={e => setCreditNote(v => ({...v, amount:e.target.value}))} disabled={!isManager} /></div>
                  <div className="space-y-1"><label className="text-xs text-gray-600">التاريخ *</label><Input type="date" value={creditNote.date} onChange={e => setCreditNote(v => ({...v, date:e.target.value}))} disabled={!isManager} /></div>
                </div>
                <div className="space-y-1"><label className="text-xs text-gray-600">ملاحظات الإشعار</label><Input value={creditNote.notes} onChange={e => setCreditNote(v => ({...v, notes:e.target.value}))} disabled={!isManager} placeholder="مثال: تمت مطابقته مع كشف حساب المورد" /></div>
                {isManager && <Button size="sm" onClick={saveCreditNote} disabled={savingCreditNote} className="bg-emerald-600 hover:bg-emerald-700 gap-1">{savingCreditNote ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}حفظ إشعار الخصم</Button>}
              </div>
            )}

            {/* Internal Notes - Managers only */}
            {isManager && (
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 space-y-2">
                <label className="text-sm font-semibold text-purple-700 flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4" /> ملاحظات داخلية (للإدارة فقط)
                </label>
                <Input
                  value={internalNote}
                  onChange={e => setInternalNote(e.target.value)}
                  placeholder="أضف ملاحظة داخلية..."
                  className="text-sm"
                />
                <Button size="sm" variant="outline" onClick={saveInternalNote} disabled={savingNote} className="border-purple-300 text-purple-700">
                  {savingNote ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "حفظ الملاحظة"}
                </Button>
              </div>
            )}

            {/* Action Buttons */}
            {canChangeStatus && !isDone && (
              <div className="border-t pt-4 space-y-3">
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">ملاحظة على الإجراء (اختياري)</label>
                  <Input value={note} onChange={e => setNote(e.target.value)} placeholder="أضف ملاحظة..." className="text-sm h-8" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {returnData.status === "Pending" && (
                    <Button size="sm" onClick={() => changeStatus("Under Review")} disabled={!!updatingStatus} className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
                      {updatingStatus === "Under Review" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
                      جاري المراجعة
                    </Button>
                  )}
                  {(returnData.status === "Pending" || returnData.status === "Under Review") && (
                    <Button size="sm" onClick={() => changeStatus("Approved")} disabled={!!updatingStatus} className="gap-1.5 bg-green-600 hover:bg-green-700 text-white">
                      {updatingStatus === "Approved" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                      اعتماد المرتجع
                    </Button>
                  )}
                  {returnData.status === "Approved" && (
                    <Button size="sm" onClick={() => changeStatus("Returned")} disabled={!!updatingStatus} className="gap-1.5 bg-teal-600 hover:bg-teal-700 text-white">
                      {updatingStatus === "Returned" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      تم تنفيذ المرتجع
                    </Button>
                  )}
                  <Button size="sm" onClick={() => changeStatus("Rejected")} disabled={!!updatingStatus} variant="outline" className="gap-1.5 border-red-300 text-red-600 hover:bg-red-50">
                    {updatingStatus === "Rejected" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                    رفض المرتجع
                  </Button>
                </div>
              </div>
            )}

            {/* Manager actions for done returns */}
            {isManager && isDone && (
              <div className="border-t pt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => changeStatus("Pending")} disabled={!!updatingStatus} variant="outline" className="gap-1.5 border-yellow-400 text-yellow-700 hover:bg-yellow-50">
                  {updatingStatus === "Pending" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PauseCircle className="w-3.5 h-3.5" />}
                  إعادة تعليق
                </Button>
                <div className="text-xs text-gray-500 bg-gray-50 border rounded-lg px-3 py-2">تم إيقاف الحذف المباشر لحماية أثر المرتجع. استخدم إعادة التعليق أو الرفض مع تسجيل السبب.</div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>



      {/* Lightbox */}
      {lightboxImg && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4" onClick={() => setLightboxImg(null)}>
          <img src={lightboxImg} alt="صورة كاملة" className="max-w-full max-h-full object-contain rounded-lg" />
          <button className="absolute top-4 left-4 text-white text-2xl font-bold" onClick={() => setLightboxImg(null)}>✕</button>
        </div>
      )}
    </>
  );
}

function InfoRow({ label, value }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-medium text-gray-800 mt-0.5">{value || "—"}</div>
    </div>
  );
}