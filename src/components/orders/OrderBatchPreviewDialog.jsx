import { useEffect, useMemo, useState } from "react";
import { lookupManagementReference } from "@/api/orderManagementReferenceApi";
import { customerOrderBatchApi } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Copy, MessageCircle, ShieldCheck, PackageCheck } from "lucide-react";

// UI-only prototype: no calls to Base44, no production writes or outbound WhatsApp actions.
const UNITS = ["علبة", "شريط", "زجاجة", "أمبول", "فيال", "كيس", "قطعة"];
const SOURCES = ["واتساب", "داخل الصيدلية", "مكالمة هاتفية"];
const cairoDay = (offset = 0) => {
  const parts = new Intl.DateTimeFormat("en-GB", {timeZone:"Africa/Cairo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(Date.now()+offset*86400000);
  const v = Object.fromEntries(parts.filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  return v.year+"-"+v.month+"-"+v.day;
};
const nextLine = () => ({ id: crypto.randomUUID(), product_name: "", product_code: "", quantity: 1, unit: "علبة", product_not_in_catalog: false, notes: "", alternativeAccepted: false, alternative_product_name: "", alternative_product_code: "" });
const inputStyle = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100";
const selectStyle = inputStyle;

export function validateOrderBatchPreview(form, lines) {
  if (!form.customer_code.trim() && !/^01[0125]\d{8}$/.test(form.phone.trim())) return "اكتب كود العميل أو رقم موبايل مصري صحيح (11 رقمًا).";
  if (form.phone.trim() && !/^01[0125]\d{8}$/.test(form.phone.trim())) return "رقم الموبايل لازم يكون 11 رقمًا ويبدأ بـ 010 أو 011 أو 012 أو 015.";
  if (!form.branch) return "اختر الفرع.";
  if (!SOURCES.includes(form.request_source)) return "اختر مصدر الطلب.";
  if (!form.recorded_by_id?.trim()) return "اختر اسم الدكتور من قائمة الفرع.";
  if (!form.expected_availability_date) return "حدد موعد احتياج العميل."; 
  if (!lines.length) return "أضف صنفًا واحدًا على الأقل.";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.product_name.trim()) return `اكتب اسم الصنف رقم ${i + 1}.`;
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

function ProductNameAutocomplete({ line, updateLine }) {
  const [choices, setChoices] = useState([]);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const term = line.product_name.trim();
    if (term.length < 2 || line.product_code) { setChoices([]); setNotice(""); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      lookupManagementReference("product", term, controller.signal)
        .then(setChoices)
        .catch(e => { if (!controller.signal.aborted) { setChoices([]); setNotice(e.message); } });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [line.product_name, line.product_code]);
  return <div className="col-span-2 md:col-span-5 relative">
    <label className="text-xs font-semibold text-slate-600">اسم الصنف
      <input id={`product-${line.id}`} className={`${inputStyle} mt-1`} value={line.product_name}
        onChange={e => updateLine(line.id, { product_name: e.target.value, product_code: "", product_not_in_catalog: false })}
        placeholder="اكتب أي صنف؛ الاقتراحات اختيارية" />
    </label>
    {choices.length > 0 && <div role="listbox" className="absolute z-20 mt-1 w-full max-h-44 overflow-y-auto bg-white border shadow-lg rounded-lg">
      {choices.map((p, i) => <button key={p.product_code || i} type="button"
        className="w-full text-right px-3 py-2 text-sm hover:bg-teal-50 border-b"
        onClick={() => { updateLine(line.id, { product_name: p.product_name, product_code: p.product_code || "", product_not_in_catalog: false }); setChoices([]); }}>
        {p.product_name} <span className="text-xs text-slate-500">{p.product_code || ""}</span>
      </button>)}
    </div>}
    {notice && <p className="mt-1 text-[11px] text-amber-700">{notice} — يمكنك تسجيل الاسم يدويًا.</p>}
  </div>;
}

function CustomerSearch({ onSelect }) {
  const [term, setTerm] = useState("");
  const [choices, setChoices] = useState([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (term.replace(/\*/g, "").trim().length < 2) { setChoices([]); setNotice(""); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      lookupManagementReference("customer", term, controller.signal)
        .then(data => { if (!controller.signal.aborted) { setChoices(data || []); setNotice(data?.length ? "" : "لا توجد نتائج مطابقة"); } })
        .catch(e => { if (!controller.signal.aborted) { setChoices([]); setNotice(e.message); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [term]);
  return <div className="md:col-span-3 relative">
    <label className="text-xs font-semibold text-slate-600">بحث العميل (اسم / كود / تليفون)
      <input className={`${inputStyle} mt-1`} value={term} onChange={e => setTerm(e.target.value)} placeholder="مثال: محم* أو 010* أو م*حم*" />
    </label>
    {loading && <p className="text-xs text-slate-500 mt-1">جاري البحث...</p>}
    {choices.length > 0 && <div role="listbox" className="absolute z-30 mt-1 w-full max-h-52 overflow-y-auto bg-white border shadow-lg rounded-lg">
      {choices.map((c, i) => <button key={`${c.customer_code}-${i}`} type="button" className="block w-full text-right px-3 py-2 text-sm hover:bg-teal-50 border-b"
        onClick={() => { onSelect(c); setTerm(c.customer_name || c.customer_code); setChoices([]); }}>
        <b>{c.customer_name || "بدون اسم"}</b><span className="block text-xs text-slate-500" dir="ltr">{c.customer_code} · {c.phone}</span>
      </button>)}
    </div>}
    {notice && <p className="text-xs text-amber-700 mt-1">{notice}</p>}
  </div>;
}

export default function OrderBatchPreviewDialog({ open, onOpenChange, teamMembers = [], onSaved }) {
  const [form, setForm] = useState({ customer_code: "", phone: "", customer_name: "", branch: "", request_source: "واتساب", fulfillment_mode: "partial", expected_availability_date: "", needed_time: "", urgent: false, important_customer: false, recorded_by_id: "", recorded_by: "", general_notes: "", promised_at: "" });
  const [lines, setLines] = useState([nextLine()]);
  const doctorsForBranch = useMemo(() => {
    if (!form.branch) return [];
    const normalize = value => String(value || "").replace(/^دواء\s*/, "").replace(/\s+/g, "").trim();
    return teamMembers.filter(person => {
      const branches = Array.isArray(person.branches) ? person.branches : [];
      const belongsToBranch = [person.primary_branch, person.branch, ...branches].some(value => normalize(value) === normalize(form.branch));
      if (!belongsToBranch) return false;
      if (person.is_active === false || person.active === false || person.status === "غير نشط" || person.employment_status === "منتهي") return false;
      const job = String(person.role || person.job_title || person.position || "").trim();
      return /^(صيدلي|طبيب|دكتور|دكتورة|pharmacist)$/i.test(job);
    }).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"ar"));
  }, [teamMembers, form.branch]);
  const [error, setError] = useState("");
  const [showReview, setShowReview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [customerResolved, setCustomerResolved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const updateForm = (key, value) => { setForm(p => ({ ...p, [key]: value, ...(key === "branch" ? { recorded_by: "", recorded_by_id: "" } : {}) })); if (key === "customer_code") setCustomerResolved(false); setError(""); setShowReview(false); };
  const selectCustomer = c => { setForm(p => ({ ...p, customer_code: c.customer_code || "", customer_name: c.customer_name || "", phone: c.phone || "" })); setCustomerResolved(true); setError(""); };
  const updateLine = (id, patch) => { setLines(p => p.map(l => l.id === id ? { ...l, ...patch } : l)); setError(""); setShowReview(false); };
  const addLine = afterId => {
    const item = nextLine();
    setLines(prev => {
      const i = prev.findIndex(x=>x.id===afterId);
      const at = i<0?prev.length:i+1;
      return [...prev.slice(0,at),item,...prev.slice(at)];
    });
    setError(""); setShowReview(false);
    requestAnimationFrame(()=>document.getElementById("product-"+item.id)?.focus());
  };
  const confirmation = useMemo(() => buildOrderConfirmationPreview(form, lines, saved?.order_number), [form, lines, saved]);
  const preview = () => { const message = validateOrderBatchPreview(form, lines) || (!customerResolved ? "لازم تختار العميل من نتائج البحث قبل الحفظ." : "") || (!form.customer_code || !form.customer_name || !form.phone ? "بيانات العميل غير مكتملة." : ""); setError(message); setShowReview(!message); setCopied(false); };
  const saveBatch = async () => {
    if (saving || saved) return;
    const message = validateOrderBatchPreview(form, lines) || (!customerResolved ? "اختر العميل من البحث." : "");
    if (message) { setError(message); return; }
    setSaving(true); setError("");
    try {
      const result = await customerOrderBatchApi.create({
        requestId,
        order: { customer_code: form.customer_code, customer_name: form.customer_name, phone: form.phone, branch: form.branch,
          request_source: form.request_source, needed_by_date: form.expected_availability_date, needed_time: form.needed_time,
          urgent: form.urgent, important_customer: form.important_customer, recorded_by_id: form.recorded_by_id, general_notes: form.general_notes },
        lines: lines.map(l => ({ product_name: l.product_name, product_code: l.product_code, quantity: Number(l.quantity), unit: l.unit,
          notes: l.notes, alternative_accepted: l.alternativeAccepted })),
      });
      if (!result?.order_number || result.group_size !== lines.length) throw new Error("تعذر تأكيد حفظ كل الأصناف؛ راجع الطلب قبل إعادة تسجيله.");
      setSaved(result); onSaved?.();
    } catch (e) { setError(e?.message || "تعذر الحفظ؛ لا تعِد إنشاء الطلب قبل التأكد من حالته."); }
    finally { setSaving(false); }
  };
  const copyMessage = async () => { try { await navigator.clipboard.writeText(confirmation); setCopied(true); } catch { setError("تعذر النسخ؛ تأكد من صلاحية الحافظة في المتصفح."); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent dir="rtl" className="max-w-5xl max-h-[94dvh] flex flex-col gap-0 overflow-hidden p-0">
    <div className="shrink-0 border-b bg-white px-4 py-3 sm:px-6"><DialogHeader><DialogTitle className="flex items-center gap-2 text-lg sm:text-xl font-black text-teal-800"><PackageCheck className="h-5 w-5"/> تجربة واجهة «طلبية جديدة»</DialogTitle></DialogHeader><p className="mt-1 text-xs text-slate-500">بيانات عميل واحدة، وعدة أصناف برقم طلبية واحد بسيط بعد الحفظ</p></div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs sm:text-sm text-amber-900 flex gap-2 items-start"><ShieldCheck className="w-4 h-4 shrink-0"/><span>راجع بيانات العميل والفرع والأصناف قبل الحفظ. المسلسل يصدر من الخادم بعد الحفظ فقط، ولا يتم إرسال واتساب تلقائيًا.</span></div>
    <section className="rounded-2xl border bg-slate-50/70 p-4 space-y-3"><h3 className="font-bold text-slate-800">بيانات العميل والطلبية</h3><div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <CustomerSearch onSelect={selectCustomer} />
      <label className="text-xs font-semibold text-slate-600">كود العميل<input className={`${inputStyle} mt-1`} value={form.customer_code} onChange={e=>updateForm("customer_code", e.target.value)} placeholder="اختياري مع وجود هاتف"/></label>
      <label className="text-xs font-semibold text-slate-600">رقم الموبايل<input className={`${inputStyle} mt-1`} dir="ltr" value={form.phone} onChange={e=>updateForm("phone", e.target.value)} placeholder="01xxxxxxxxx" maxLength={11}/></label>
      <label className="text-xs font-semibold text-slate-600">اسم العميل<input className={`${inputStyle} mt-1`} value={form.customer_name} onChange={e=>updateForm("customer_name", e.target.value)} placeholder="اختياري في المعاينة"/></label>
      <label className="text-xs font-semibold text-slate-600">الفرع<select className={`${selectStyle} mt-1`} value={form.branch} onChange={e=>updateForm("branch",e.target.value)}><option value="">اختر الفرع</option><option>دواء شكري</option><option>دواء الشامي</option></select></label>
      <label className="text-xs font-semibold text-slate-600">مصدر الطلب<select className={`${selectStyle} mt-1`} value={form.request_source} onChange={e=>updateForm("request_source",e.target.value)}>{SOURCES.map(x=><option key={x}>{x}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-600">طريقة التنفيذ<select className={`${selectStyle} mt-1`} value={form.fulfillment_mode} onChange={e=>updateForm("fulfillment_mode",e.target.value)}><option value="partial">اللي يتوفر يتبعت</option><option value="together">كله مع بعض</option></select></label>
      <label className="text-xs font-semibold text-slate-600">الدكتور اللي سجل الطلب *
        <select className={`${selectStyle} mt-1`} value={form.recorded_by_id} disabled={!form.branch || !!saved} onChange={e=>{const doctor=doctorsForBranch.find(x=>String(x.id)===e.target.value);setForm(p=>({...p, recorded_by_id: String(doctor?.id||""), recorded_by: doctor?.name||""}));setShowReview(false);}}>
          <option value="">{form.branch ? "اختر الدكتور من الفرع" : "اختر الفرع الأول"}</option>
          {doctorsForBranch.map(p=><option key={p.id} value={String(p.id)}>{p.name}</option>)}
        </select>
        {form.branch && doctorsForBranch.length === 0 && <span className="block mt-1 text-[11px] text-amber-700">لا توجد أسماء دكاترة مطابقة للفرع في قائمة الموظفين؛ يلزم مراجعة مسميات الأدوار قبل تفعيل الحفظ.</span>}
      </label>
      <div className="md:col-span-3 rounded-xl border bg-white p-3 space-y-2">
        <p className="text-xs font-bold">العميل محتاج الصنف إمتى؟ *</p>
        <div className="flex flex-wrap gap-2">{[["النهارده",0,""],["بكرا",1,""],["بكرا الصبح",1,"صباحًا"]].map(([label,day,time])=><button key={label} type="button" onClick={()=>{setForm(p=>({...p,expected_availability_date:cairoDay(day),needed_time:time}));setShowReview(false);}} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${form.expected_availability_date===cairoDay(day)&&form.needed_time===time?"bg-teal-50 border-teal-500":"border-slate-200"}`}>{label}</button>)}</div>
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-xs">اختار يوم محدد<input type="date" className={`${inputStyle} mt-1`} value={form.expected_availability_date} onChange={e=>updateForm("expected_availability_date",e.target.value)}/></label>
          <label className="text-xs">الوقت<select className={`${selectStyle} mt-1`} value={form.needed_time} onChange={e=>updateForm("needed_time",e.target.value)}><option value="">أي وقت</option><option value="صباحًا">الصبح</option><option value="مساءً">المساء</option></select></label>
        </div>
        <div className="flex flex-wrap gap-4 text-sm"><label className="flex gap-2"><input type="checkbox" checked={form.urgent} onChange={e=>updateForm("urgent",e.target.checked)}/>عاجل</label><label className="flex gap-2"><input type="checkbox" checked={form.important_customer} onChange={e=>updateForm("important_customer",e.target.checked)}/>عميل مهم</label></div>
      </div>
      <label className="text-xs font-semibold text-slate-600 md:col-span-3">ملاحظة عامة للطلبية<textarea className={`${inputStyle} mt-1 min-h-16 py-2`} value={form.general_notes} onChange={e=>updateForm("general_notes",e.target.value)} placeholder="ملاحظات الدكتور أو تعليمات المخزن"/></label>
    </div></section>
    <section className="space-y-3"><div className="flex justify-between items-center gap-2"><h3 className="font-bold text-slate-800">أصناف الطلبية <span className="text-sm font-normal text-slate-500">({lines.length})</span></h3><Button type="button" variant="outline" onClick={()=>addLine()} className="gap-2"><Plus className="w-4 h-4"/> إضافة صنف</Button></div>
      {lines.map((line,index)=><div key={line.id} className="rounded-2xl border border-teal-100 bg-white shadow-sm p-3 sm:p-4 space-y-3"><div className="flex justify-between items-center"><span className="rounded-lg bg-teal-50 text-teal-800 font-bold px-3 py-1 text-sm">صنف {index+1}</span><button type="button" aria-label={`حذف الصنف ${index+1}`} disabled={lines.length===1} onClick={()=>setLines(p=>p.filter(l=>l.id!==line.id))} className="disabled:opacity-30 text-red-600 hover:bg-red-50 rounded p-2"><Trash2 className="w-4 h-4"/></button></div>
      <div className="grid grid-cols-2 md:grid-cols-12 gap-3">
        <ProductNameAutocomplete line={line} updateLine={updateLine} />
        <label className="text-xs font-semibold text-slate-600 col-span-2 md:col-span-3">كود الصنف (اختياري)<input className={`${inputStyle} mt-1`} value={line.product_code} disabled={line.product_not_in_catalog} onChange={e=>updateLine(line.id,{product_code:e.target.value})} placeholder="المشتريات تقدر تضيفه لاحقًا"/></label>
        <label className="text-xs font-semibold text-slate-600 md:col-span-2">الكمية<input className={`${inputStyle} mt-1`} type="number" min="1" step="1" value={line.quantity} onChange={e=>updateLine(line.id,{quantity:e.target.value})}/></label>
        <label className="text-xs font-semibold text-slate-600 md:col-span-2">الوحدة<select className={`${selectStyle} mt-1`} value={line.unit} onChange={e=>updateLine(line.id,{unit:e.target.value})}>{UNITS.map(x=><option key={x}>{x}</option>)}</select></label>
      </div><label className="flex gap-2 items-center text-sm text-slate-700"><input type="checkbox" checked={line.product_not_in_catalog} onChange={e=>updateLine(line.id,{product_not_in_catalog:e.target.checked,product_code:e.target.checked?"":line.product_code})}/> لم أجد الصنف في الكتالوج (اختياري)</label>
      <label className="block text-xs font-semibold text-slate-600">ملاحظات الصنف<textarea className={`${inputStyle} mt-1 min-h-16 py-2`} value={line.notes} onChange={e=>updateLine(line.id,{notes:e.target.value})} placeholder="تفاصيل أو أسعار أو موردين، بعيدًا عن اسم الصنف"/></label>
      <label className="flex gap-2 items-center text-sm text-slate-700"><input type="checkbox" checked={line.alternativeAccepted} onChange={e=>updateLine(line.id,{alternativeAccepted:e.target.checked})}/> العميل قبل بديل — لا يظهر في قائمة التوفير</label>
      {line.alternativeAccepted&&<div className="grid sm:grid-cols-2 gap-3 bg-emerald-50 rounded-xl p-3"><label className="text-xs font-semibold">اسم البديل<input className={`${inputStyle} mt-1`} value={line.alternative_product_name} onChange={e=>updateLine(line.id,{alternative_product_name:e.target.value})}/></label><label className="text-xs font-semibold">كود البديل<input className={`${inputStyle} mt-1`} value={line.alternative_product_code} onChange={e=>updateLine(line.id,{alternative_product_code:e.target.value})}/></label></div>}
      <div className="flex justify-end border-t pt-3"><Button type="button" variant="outline" onClick={()=>addLine(line.id)} className="gap-2 border-teal-300 text-teal-800"><Plus className="w-4 h-4"/> إضافة صنف تاني هنا</Button></div>
      </div>)}
    </section>
    {error&&<p role="alert" className="rounded-lg bg-red-50 text-red-700 text-sm p-3">{error}</p>}
    {showReview&&<section className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4"><h3 className="font-bold text-emerald-800">{saved?`تم حفظ الطلبية رقم ${saved.order_number}`:`معاينة سجلات الطلبية (${lines.length}) — غير محفوظة`}</h3><p className="text-xs">مسجل الطلب: {form.recorded_by} · الموعد: {form.expected_availability_date} {form.needed_time} {form.urgent?"· عاجل":""} {form.important_customer?"· عميل مهم":""}</p>{form.general_notes&&<p className="text-xs">ملاحظة عامة: {form.general_notes}</p>}<div className="overflow-x-auto"><table className="w-full text-sm min-w-[600px]"><thead><tr className="text-slate-600 border-b"><th className="p-2 text-right">السطر</th><th className="p-2 text-right">الصنف</th><th className="p-2 text-right">الكود</th><th className="p-2 text-right">الكمية</th><th className="p-2 text-right">الحالة</th></tr></thead><tbody>{lines.map((l,i)=><tr key={l.id} className="border-b border-emerald-100"><td className="p-2">{i+1}/{lines.length}</td><td className="p-2">{l.product_name}</td><td className="p-2">{l.product_code||"بانتظار ربط المشتريات"}</td><td className="p-2">{l.quantity} {l.unit}</td><td className="p-2">{l.alternativeAccepted?"replaced_by_alternative":"طلب جديد"}</td></tr>)}</tbody></table></div><p className="text-xs text-emerald-900">{saved?"تم حفظ كل الأصناف وربطها بنفس رقم الطلبية.":"لن يصدر المسلسل إلا بعد الحفظ على الخادم؛ لا ترسل تأكيد الطلب للعميل قبل نجاح الحفظ."}</p><div dir="rtl" className="whitespace-pre-line rounded-xl bg-white border p-4 font-sans text-right text-sm leading-8 text-slate-800">{confirmation}</div><div className="flex flex-wrap gap-2"><Button type="button" disabled={!saved} onClick={copyMessage} className="bg-teal-600 gap-2"><Copy className="w-4 h-4"/>{copied?"تم نسخ رسالة التأكيد":"نسخ رسالة تأكيد الحفظ"}</Button><Button type="button" disabled variant="outline" className="gap-2"><MessageCircle className="w-4 h-4"/> إرسال واتساب (بعد تفعيل الحفظ)</Button></div></section>}
    </div>
    <div className="shrink-0 flex items-center justify-between gap-2 border-t bg-white px-4 py-3 sm:px-6"><div className="text-xs sm:text-sm text-slate-600">{saved?<b className="text-emerald-700">تم الحفظ · {saved.order_number}</b>:<><b className="text-teal-800">{lines.length}</b> {lines.length===1?"صنف":"أصناف"}</>}</div><div className="flex gap-2 flex-wrap"><Button variant="outline" onClick={()=>onOpenChange(false)}>إغلاق</Button>{!saved&&<Button onClick={preview} disabled={saving} variant="outline">مراجعة الطلبية</Button>}{showReview&&!saved&&<Button onClick={saveBatch} disabled={saving || lines.some(l=>l.alternativeAccepted)} className="bg-teal-600 hover:bg-teal-700 text-xs sm:text-sm">{saving?"جاري حفظ الأصناف...":"تأكيد وحفظ الطلبية"}</Button>}</div></div>
  </DialogContent></Dialog>;
}
