import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { lookupOrderCustomerByCode } from "@/api/orderCustomerLookupApi";
import { Loader2, Upload, X, Search, CheckCircle2 } from "lucide-react";
import { useUserRole } from "@/lib/useUserRole";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const SOURCES = ["واتساب", "مكالمة هاتفية", "داخل الصيدلية"];
const PRIORITIES = ["عاجل", "متوسط", "عادي"];
let orderCounter = Date.now();
function genOrderNumber(){orderCounter++;return `PHR-${new Date().getFullYear()}-${String(orderCounter).slice(-4)}`;}

export default function PharmacyOrderFormDialog({ open, onOpenChange, teamMembers = [], onSaved, editOrder = null }) {
  const { user } = useUserRole();
  const [form,setForm]=useState(editOrder||{customer_name:"",phone:"",customer_code:"",branch:"",request_source:"",product_name:"",product_image:"",notes:"",priority:"عادي",assigned_employee:"",request_date:new Date().toISOString().split("T")[0]});
  const [saving,setSaving]=useState(false);const [uploading,setUploading]=useState(false);const [searching,setSearching]=useState(false);const [error,setError]=useState("");
  const [customerResolved,setCustomerResolved]=useState(Boolean(editOrder?.customer_code));
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const changeCode=(value)=>{setForm(p=>({...p,customer_code:value,customer_name:"",phone:""}));setCustomerResolved(false);setError("");};
  async function lookupCustomer(){setSearching(true);setError("");try{const customer=await lookupOrderCustomerByCode(form.customer_code);setForm(p=>({...p,customer_code:customer.customer_code,customer_name:customer.customer_name||"",phone:customer.phone||"",branch:customer.branch||p.branch}));setCustomerResolved(true);}catch(e){setCustomerResolved(false);setError(e.message);}finally{setSearching(false);}}
  const handleImageUpload=async(e)=>{const file=e.target.files?.[0];if(!file)return;setUploading(true);const {file_url}=await base44.integrations.Core.UploadFile({file});set("product_image",file_url);setUploading(false);};
  const handleSave=async()=>{
    setError("");
    if(!form.customer_code||!customerResolved){setError("ابحث بكود الصيدلية الصحيح أولًا.");return;}
    if(!form.customer_name||!form.phone||!form.product_name||!form.branch||!form.assigned_employee){setError("يرجى استكمال بيانات الصنف والفرع والموظف المسؤول.");return;}
    setSaving(true);
    try{
      const userName=user?.full_name||user?.email||"مجهول";const now=new Date().toISOString();
      const data={...form,status:editOrder?form.status:"طلب جديد",order_number:editOrder?form.order_number:genOrderNumber(),timeline:editOrder?form.timeline:[{status:"طلب جديد",by:userName,at:now,note:"تم إنشاء الطلب"}],...(!editOrder&&{added_at:new Date().toLocaleString("ar-EG",{timeZone:"Africa/Cairo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})})};
      if(editOrder)await base44.entities.PharmacyOrder.update(editOrder.id,data);else await base44.entities.PharmacyOrder.create(data);
      onSaved?.();onOpenChange(false);
    }catch(e){setError(e.message||"تعذر حفظ الطلب.");}finally{setSaving(false);}
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" dir="rtl"><DialogHeader><DialogTitle className="text-violet-700">{editOrder?"تعديل الطلب":"طلب صيدلية جديد"}</DialogTitle></DialogHeader><div className="space-y-4">
    <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-3 space-y-3"><div><label className="text-xs font-bold text-gray-700">كود الصيدلية *</label><div className="mt-1 flex gap-2"><Input value={form.customer_code} onChange={e=>changeCode(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();lookupCustomer();}}} placeholder="اكتب كود الصيدلية فقط" className="h-10 font-semibold" autoFocus/><Button type="button" onClick={lookupCustomer} disabled={searching||!form.customer_code.trim()} className="bg-violet-600 hover:bg-violet-700 gap-2">{searching?<Loader2 className="w-4 h-4 animate-spin"/>:<Search className="w-4 h-4"/>}بحث بالكود</Button></div><p className="mt-1 text-[11px] text-gray-500">لا يمكن البحث باسم الصيدلية أو رقم الهاتف؛ يجب إدخال الكود كاملًا.</p></div>
    {customerResolved&&<div className="rounded-lg border border-emerald-200 bg-white p-3"><div className="flex items-center gap-2 text-emerald-700 text-sm font-bold mb-2"><CheckCircle2 className="w-4 h-4"/>تم العثور على الصيدلية</div><div className="grid sm:grid-cols-2 gap-2 text-sm"><div><span className="text-gray-500">الاسم: </span><b>{form.customer_name}</b></div><div><span className="text-gray-500">الهاتف: </span><b dir="ltr">{form.phone}</b></div></div></div>}
    </section>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div className="space-y-1"><label className="text-xs font-medium text-gray-600">اسم الصيدلية</label><Input value={form.customer_name} readOnly placeholder="يظهر بعد البحث بالكود" className="h-9 bg-gray-50"/></div><div className="space-y-1"><label className="text-xs font-medium text-gray-600">رقم الهاتف</label><Input value={form.phone} readOnly placeholder="يظهر بعد البحث بالكود" className="h-9 bg-gray-50" dir="ltr"/></div><div className="space-y-1"><label className="text-xs font-medium text-gray-600">الفرع</label><Select value={form.branch} onValueChange={v=>set("branch",v)}><SelectTrigger className="h-9"><SelectValue placeholder="اختر الفرع"/></SelectTrigger><SelectContent>{BRANCHES.map(b=><SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><label className="text-xs font-medium text-gray-600">مصدر الطلب</label><Select value={form.request_source} onValueChange={v=>set("request_source",v)}><SelectTrigger className="h-9"><SelectValue placeholder="المصدر"/></SelectTrigger><SelectContent>{SOURCES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div></div>
    <div className="grid sm:grid-cols-2 gap-3"><div className="space-y-1"><label className="text-xs font-medium text-gray-600">الأولوية</label><Select value={form.priority} onValueChange={v=>set("priority",v)}><SelectTrigger className="h-9"><SelectValue/></SelectTrigger><SelectContent>{PRIORITIES.map(p=><SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><label className="text-xs font-medium text-gray-600">الموظف المسؤول</label><Select value={form.assigned_employee} onValueChange={v=>set("assigned_employee",v)}><SelectTrigger className="h-9"><SelectValue placeholder="اختر موظف"/></SelectTrigger><SelectContent><SelectItem value={null}>— بدون تعيين —</SelectItem>{teamMembers.map(m=><SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent></Select></div></div>
    <div className="space-y-1"><label className="text-xs font-medium text-gray-600">اسم الصنف *</label><Input value={form.product_name} onChange={e=>set("product_name",e.target.value)} placeholder="اسم الدواء أو المنتج"/></div>
    <div className="space-y-1"><label className="text-xs font-medium text-gray-600">صورة الصنف</label>{form.product_image?<div className="relative inline-block"><img src={form.product_image} alt="product" className="h-24 w-24 object-cover rounded-lg border"/><button onClick={()=>set("product_image","")} className="absolute -top-1 -left-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center"><X className="w-3 h-3"/></button></div>:<label className="flex items-center gap-2 border-2 border-dashed rounded-lg p-4 cursor-pointer">{uploading?<Loader2 className="w-4 h-4 animate-spin"/>:<Upload className="w-4 h-4"/>}<span className="text-sm text-gray-400">{uploading?"جاري الرفع...":"رفع صورة الصنف"}</span><input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading}/></label>}</div>
    <div className="space-y-1"><label className="text-xs font-medium text-gray-600">تاريخ الطلب</label><Input type="date" value={form.request_date} onChange={e=>set("request_date",e.target.value)}/></div>
    <div className="space-y-1"><label className="text-xs font-medium text-gray-600">ملاحظات</label><textarea value={form.notes} onChange={e=>set("notes",e.target.value)} rows={3} className="w-full border rounded-md px-3 py-2 text-sm"/></div>
    {error&&<p className="text-sm text-red-600 text-center">{error}</p>}<div className="flex gap-2"><Button onClick={handleSave} disabled={saving||!customerResolved||!form.product_name||!form.branch||!form.assigned_employee} className="flex-1 bg-violet-600 hover:bg-violet-700">{saving?<Loader2 className="w-4 h-4 animate-spin"/>:(editOrder?"حفظ التعديلات":"حفظ الطلب")}</Button><Button variant="outline" onClick={()=>onOpenChange(false)}>إلغاء</Button></div>
  </div></DialogContent></Dialog>;
}