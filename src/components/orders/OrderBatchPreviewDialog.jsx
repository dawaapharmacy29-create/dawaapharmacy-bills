import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Copy, MessageCircle, ShieldCheck, PackageCheck } from "lucide-react";

// UI-only prototype: no calls to Base44, no production writes or outbound WhatsApp actions.
const UNITS = ["علبة", "شريط", "زجاجة", "أمبول", "فيال", "كيس", "قطعة"];
const SOURCES = ["واتساب", "داخل الصيدلية", "مكالمة هاتفية"];
const nextLine = () => ({ id: crypto.randomUUID(), product_name: "", product_code: "", quantity: 1, unit: "علبة", product_not_in_catalog: false, notes: "", alternativeAccepted: false, alternative_product_name: "", alternative_product_code: "" });
const inputStyle = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100";
const selectStyle = inputStyle;

export function validateOrderBatchPreview(form, lines) {
  if (!form.customer_code.trim() && !/^01[0125]\d{8}$/.test(form.phone.trim())) return "اكتب كود العميل أو رقم موبايل مصري صحيح (11 رقمًا).";
  if (form.phone.trim() && !/^01[0125]\d{8}$/.test(form.phone.trim())) return "رقم الموبايل لازم يكون 11 رقمًا ويبدأ بـ 010 أو 011 أو 012 أو 015.";
  if (!form.branch) return "اختر الفرع.";
  if (!SOURCES.includes(form.request_source)) return "اختر مصدر الطلب.";
  if (!lines.length) return "أضف صنفًا واحدًا على الأقل.";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.product_name.trim()) return `اكتب اسم الصنف رقم ${i + 1}.`;
    if (!line.product_not_in_catalog && !line.product_code.trim()) return `اختر الصنف رقم ${i + 1} من الكتالوج، أو فعّل خيار «غير موجود».`;
    if (!Number.isInteger(Number(line.quantity)) || Number(line.quantity) <= 0) return `كمية الصنف رقم ${i + 1} يجب أن تكون عددًا صحيحًا أكبر من صفر.`;
    if (!UNITS.includes(line.unit)) return `اختر وحدة الصنف رقم ${i + 1}.`;
    if (line.alternativeAccepted && (!line.alternative_product_name.trim() || !line.alternative_product_code.trim())) return `أكمل بيانات البديل المقبول للصنف رقم ${i + 1}.`;
  }
  return "";
}

export function buildOrderConfirmationPreview(form, lines, orderNumber = "(بعد الحفظ)") {
  const date = form.expected_availability_date || form.promised_at;
  const formatted = date ? `${date.slice(8, 10)}/${date.slice(5, 7)}` : "(يحدد قبل الحفظ)";
  return ["✅ تم تسجيل طلبك", ...lines.map((l, i) => `${i + 1}) ${l.product_name.trim()} — ${l.quantity} ${l.unit}`), `التنفيذ: ${form.fulfillment_mode === "together" ? "كله مع بعض" : "اللي يتوفر يتبعت"}`, `هنبلغك خلال: ${formatted}`, `رقم الطلب: ${orderNumber}`].join("\n");
}

export default function OrderBatchPreviewDialog({ open, onOpenChange }) {
  const [form, setForm] = useState({ customer_code: "", phone: "", customer_name: "", branch: "", request_source: "واتساب", fulfillment_mode: "partial", expected_availability_date: "", promised_at: "" });
  const [lines, setLines] = useState([nextLine()]);
  const [error, setError] = useState("");
  const [showReview, setShowReview] = useState(false);
  const [copied, setCopied] = useState(false);
  const updateForm = (key, value) => { setForm(p => ({ ...p, [key]: value })); setError(""); setShowReview(false); };
  const updateLine = (id, patch) => { setLines(p => p.map(l => l.id === id ? { ...l, ...patch } : l)); setError(""); setShowReview(false); };
  const confirmation = useMemo(() => buildOrderConfirmationPreview(form, lines), [form, lines]);
  const preview = () => { const message = validateOrderBatchPreview(form, lines); setError(message); setShowReview(!message); setCopied(false); };
  const copyMessage = async () => { try { await navigator.clipboard.writeText(confirmation); setCopied(true); } catch { setError("تعذر النسخ؛ تأكد من صلاحية الحافظة في المتصفح."); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent dir="rtl" className="max-w-5xl max-h-[94dvh] flex flex-col gap-0 overflow-hidden p-0">
    <div className="shrink-0 border-b bg-white px-4 py-3 sm:px-6"><DialogHeader><DialogTitle className="flex items-center gap-2 text-lg sm:text-xl font-black text-teal-800"><PackageCheck className="h-5 w-5"/> تجربة واجهة «طلبية جديدة»</DialogTitle></DialogHeader><p className="mt-1 text-xs text-slate-500">بيانات عميل واحدة، وعدة أصناف في طلبية واحدة</p></div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs sm:text-sm text-amber-900 flex gap-2 items-start"><ShieldCheck className="w-4 h-4 shrink-0"/><span><b>معاينة فقط:</b> لا تُنشئ سجلات CustomerOrder ولا ترسل واتساب. البحث بالكتالوج وربط العميل بالهاتف سيُفعّلان بعد توصيل مصادر البيانات والتحقق منها.</span></div>
    <section className="rounded-2xl border bg-slate-50/70 p-4 space-y-3"><h3 className="font-bold text-slate-800">بيانات العميل والطلبية</h3><div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <label className="text-xs font-semibold text-slate-600">كود العميل<input className={`${inputStyle} mt-1`} value={form.customer_code} onChange={e=>updateForm("customer_code", e.target.value)} placeholder="اختياري مع وجود هاتف"/></label>
      <label className="text-xs font-semibold text-slate-600">رقم الموبايل<input className={`${inputStyle} mt-1`} dir="ltr" value={form.phone} onChange={e=>updateForm("phone", e.target.value)} placeholder="01xxxxxxxxx" maxLength={11}/></label>
      <label className="text-xs font-semibold text-slate-600">اسم العميل<input className={`${inputStyle} mt-1`} value={form.customer_name} onChange={e=>updateForm("customer_name", e.target.value)} placeholder="اختياري في المعاينة"/></label>
      <label className="text-xs font-semibold text-slate-600">الفرع<select className={`${selectStyle} mt-1`} value={form.branch} onChange={e=>updateForm("branch",e.target.value)}><option value="">اختر الفرع</option><option>دواء شكري</option><option>دواء الشامي</option></select></label>
      <label className="text-xs font-semibold text-slate-600">مصدر الطلب<select className={`${selectStyle} mt-1`} value={form.request_source} onChange={e=>updateForm("request_source",e.target.value)}>{SOURCES.map(x=><option key={x}>{x}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-600">طريقة التنفيذ<select className={`${selectStyle} mt-1`} value={form.fulfillment_mode} onChange={e=>updateForm("fulfillment_mode",e.target.value)}><option value="partial">اللي يتوفر يتبعت</option><option value="together">كله مع بعض</option></select></label>
      <label className="text-xs font-semibold text-slate-600">التوفر المتوقع<input type="date" className={`${inputStyle} mt-1`} value={form.expected_availability_date} onChange={e=>updateForm("expected_availability_date",e.target.value)}/></label>
    </div></section>
    <section className="space-y-3"><div className="flex justify-between items-center gap-2"><h3 className="font-bold text-slate-800">أصناف الطلبية <span className="text-sm font-normal text-slate-500">({lines.length})</span></h3><Button type="button" variant="outline" onClick={()=>{setLines(p=>[...p,nextLine()]);setShowReview(false);setError("");}} className="gap-2"><Plus className="w-4 h-4"/> إضافة صنف</Button></div>
      {lines.map((line,index)=><div key={line.id} className="rounded-2xl border border-teal-100 bg-white shadow-sm p-3 sm:p-4 space-y-3"><div className="flex justify-between items-center"><span className="rounded-lg bg-teal-50 text-teal-800 font-bold px-3 py-1 text-sm">صنف {index+1}</span><button type="button" aria-label={`حذف الصنف ${index+1}`} disabled={lines.length===1} onClick={()=>setLines(p=>p.filter(l=>l.id!==line.id))} className="disabled:opacity-30 text-red-600 hover:bg-red-50 rounded p-2"><Trash2 className="w-4 h-4"/></button></div>
      <div className="grid grid-cols-2 md:grid-cols-12 gap-3">
        <label className="text-xs font-semibold text-slate-600 col-span-2 md:col-span-5">اسم الصنف<input className={`${inputStyle} mt-1`} value={line.product_name} onChange={e=>updateLine(line.id,{product_name:e.target.value})} placeholder="اسم الصنف فقط، بدون ملاحظات"/></label>
        <label className="text-xs font-semibold text-slate-600 col-span-2 md:col-span-3">كود الكتالوج<input className={`${inputStyle} mt-1`} value={line.product_code} disabled={line.product_not_in_catalog} onChange={e=>updateLine(line.id,{product_code:e.target.value})} placeholder="كود POS"/></label>
        <label className="text-xs font-semibold text-slate-600 md:col-span-2">الكمية<input className={`${inputStyle} mt-1`} type="number" min="1" step="1" value={line.quantity} onChange={e=>updateLine(line.id,{quantity:e.target.value})}/></label>
        <label className="text-xs font-semibold text-slate-600 md:col-span-2">الوحدة<select className={`${selectStyle} mt-1`} value={line.unit} onChange={e=>updateLine(line.id,{unit:e.target.value})}>{UNITS.map(x=><option key={x}>{x}</option>)}</select></label>
      </div><label className="flex gap-2 items-center text-sm text-slate-700"><input type="checkbox" checked={line.product_not_in_catalog} onChange={e=>updateLine(line.id,{product_not_in_catalog:e.target.checked,product_code:e.target.checked?"":line.product_code})}/> صنف غير موجود في الكتالوج</label>
      <label className="block text-xs font-semibold text-slate-600">ملاحظات الصنف<textarea className={`${inputStyle} mt-1 min-h-16 py-2`} value={line.notes} onChange={e=>updateLine(line.id,{notes:e.target.value})} placeholder="تفاصيل أو أسعار أو موردين، بعيدًا عن اسم الصنف"/></label>
      <label className="flex gap-2 items-center text-sm text-slate-700"><input type="checkbox" checked={line.alternativeAccepted} onChange={e=>updateLine(line.id,{alternativeAccepted:e.target.checked})}/> العميل قبل بديل — لا يظهر في قائمة التوفير</label>
      {line.alternativeAccepted&&<div className="grid sm:grid-cols-2 gap-3 bg-emerald-50 rounded-xl p-3"><label className="text-xs font-semibold">اسم البديل<input className={`${inputStyle} mt-1`} value={line.alternative_product_name} onChange={e=>updateLine(line.id,{alternative_product_name:e.target.value})}/></label><label className="text-xs font-semibold">كود البديل<input className={`${inputStyle} mt-1`} value={line.alternative_product_code} onChange={e=>updateLine(line.id,{alternative_product_code:e.target.value})}/></label></div>}
      </div>)}
    </section>
    {error&&<p role="alert" className="rounded-lg bg-red-50 text-red-700 text-sm p-3">{error}</p>}
    {showReview&&<section className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4"><h3 className="font-bold text-emerald-800">معاينة سجلات الطلبية ({lines.length}) — غير محفوظة</h3><div className="overflow-x-auto"><table className="w-full text-sm min-w-[600px]"><thead><tr className="text-slate-600 border-b"><th className="p-2 text-right">السطر</th><th className="p-2 text-right">الصنف</th><th className="p-2 text-right">الكود</th><th className="p-2 text-right">الكمية</th><th className="p-2 text-right">الحالة</th></tr></thead><tbody>{lines.map((l,i)=><tr key={l.id} className="border-b border-emerald-100"><td className="p-2">{i+1}/{lines.length}</td><td className="p-2">{l.product_name}</td><td className="p-2">{l.product_code||"خارج الكتالوج"}</td><td className="p-2">{l.quantity} {l.unit}</td><td className="p-2">{l.alternativeAccepted?"replaced_by_alternative":"طلب جديد"}</td></tr>)}</tbody></table></div><p className="text-xs text-emerald-900">وقت الحفظ الفعلي ستُولَّد قيمة UUID واحدة للمجموعة، مع group_size وline_no وorder_number منفصل لكل سجل.</p><pre dir="rtl" className="whitespace-pre-wrap rounded-xl bg-white border p-3 text-sm leading-7">{confirmation}</pre><div className="flex flex-wrap gap-2"><Button type="button" onClick={copyMessage} className="bg-teal-600 gap-2"><Copy className="w-4 h-4"/>{copied?"تم نسخ النص التجريبي":"نسخ رسالة المعاينة"}</Button><Button type="button" disabled variant="outline" className="gap-2"><MessageCircle className="w-4 h-4"/> إرسال واتساب (بعد تفعيل الحفظ)</Button></div></section>}
    </div>
    <div className="shrink-0 flex items-center justify-between gap-2 border-t bg-white px-4 py-3 sm:px-6"><div className="text-xs sm:text-sm text-slate-600"><b className="text-teal-800">{lines.length}</b> {lines.length===1?"صنف":"أصناف"}<span className="hidden sm:inline"> · {form.fulfillment_mode==="together"?"كله مع بعض":"حسب التوفر"}</span></div><div className="flex gap-2"><Button variant="outline" onClick={()=>onOpenChange(false)}>إغلاق</Button><Button onClick={preview} className="bg-teal-600 hover:bg-teal-700 text-xs sm:text-sm">مراجعة الطلبية</Button></div></div>
  </DialogContent></Dialog>;
}
