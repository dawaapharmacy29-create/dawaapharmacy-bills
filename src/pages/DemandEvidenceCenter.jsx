import { useState } from "react";
import { Upload, ShieldCheck, BrainCircuit, AlertTriangle } from "lucide-react";
import { smartPurchaseApi } from "@/api/smartPurchaseApi";

const FORBIDDEN_KEYS = new Set(["customer_id","customer_code","customer_name","customer_phone","invoice_number","invoice_no","invoice_id"]);
const allowedBranches = new Set(["دواء شكري","دواء الشامي"]);

function validatePayload(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.rows;
  if (!Array.isArray(rows) || !rows.length) throw new Error("الملف لا يحتوي على rows صالحة.");
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("يوجد صف غير صالح داخل الملف.");
    for (const key of Object.keys(row)) if (FORBIDDEN_KEYS.has(key.toLowerCase())) throw new Error("تم رفض الملف: صفوف Evidence يجب أن تكون Aggregate فقط بدون هوية عميل أو رقم فاتورة.");
    if (!allowedBranches.has(String(row.branch || "").trim())) throw new Error("يوجد فرع غير معتمد داخل الملف.");
    if (!String(row.product_code || "").trim()) throw new Error("يوجد صف بدون product_code.");
  }
  return rows;
}

function Card({ title, value }) {
  return <div className="rounded-xl border bg-white p-4"><p className="text-xs text-gray-500">{title}</p><p className="mt-1 text-xl font-bold text-gray-900">{value ?? "—"}</p></div>;
}

export default function DemandEvidenceCenter() {
  const [fileName,setFileName]=useState("");
  const [rows,setRows]=useState([]);
  const [meta,setMeta]=useState(null);
  const [result,setResult]=useState(null);
  const [shadow,setShadow]=useState(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);

  const readFile=async(file)=>{
    setError(""); setResult(null); setShadow(null); setRows([]); setMeta(null);
    if(!file) return;
    try{
      const payload=JSON.parse(await file.text());
      const validRows=validatePayload(payload);
      setRows(validRows); setMeta(Array.isArray(payload)?null:payload); setFileName(file.name);
    }catch(e){setFileName("");setError(e?.message||"تعذر قراءة الملف.");}
  };

  const importFile=async()=>{
    if(!rows.length) return;
    setBusy(true);setError("");
    try{
      const imported=await smartPurchaseApi.importDemandEvidence(rows);
      setResult(imported);
      const summary=await smartPurchaseApi.demandEvidenceShadowSummary(null);
      setShadow(summary);
    }catch(e){setError(e?.message||"فشل استيراد Demand Evidence.");}
    finally{setBusy(false);}
  };

  const completeness=meta?.completeness_status || meta?.metadata?.completeness_status || "غير محدد";
  return <div dir="rtl" className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
    <div><h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><BrainCircuit className="h-6 w-6 text-teal-600"/>دليل الطلب (Demand Evidence)</h1><p className="mt-1 text-sm text-gray-500">استيراد دليل الطلب المجمع وتشغيل مقارنة Shadow فقط. لا يتم تعديل V10 أو إنشاء طلبية من هذه الصفحة.</p></div>
    <div className="rounded-xl border border-teal-100 bg-teal-50 p-4 text-sm text-teal-900"><div className="flex gap-2"><ShieldCheck className="h-5 w-5 shrink-0"/><p>المسار يقبل بيانات Aggregate فقط، ويمنع حقول هوية العميل وأرقام الفواتير. الاستيراد Idempotent والـShadow للقراءة فقط.</p></div></div>
    <div className="rounded-xl border bg-white p-5">
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-sm font-semibold text-gray-600 hover:border-teal-400 hover:text-teal-700"><Upload className="h-5 w-5"/>اختيار ملف JSON<input type="file" accept=".json,application/json" className="hidden" onChange={e=>readFile(e.target.files?.[0])}/></label>
      {fileName&&<div className="mt-4 grid gap-3 md:grid-cols-3"><Card title="الملف" value={fileName}/><Card title="صفوف Evidence" value={rows.length.toLocaleString("ar-EG")}/><Card title="حالة اكتمال المصدر" value={completeness}/></div>}
      {rows.length>0&&<button disabled={busy} onClick={importFile} className="mt-4 rounded-xl bg-teal-600 px-5 py-3 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50">{busy?"جاري الاستيراد وتشغيل Shadow...":"استيراد وتشغيل Shadow"}</button>}
    </div>
    {error&&<div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertTriangle className="h-5 w-5 shrink-0"/>{error}</div>}
    {result&&<div className="space-y-3"><h2 className="font-bold">نتيجة الاستيراد</h2><div className="grid gap-3 md:grid-cols-4"><Card title="تم استيراده" value={result.imported}/><Card title="بدون تغيير / أقدم" value={result.unchanged_or_older}/><Card title="غير مطابق للمخزون" value={result.unmatched}/><Card title="غير صالح" value={result.invalid}/></div></div>}
    {shadow&&<div className="space-y-3"><h2 className="font-bold">Shadow Summary — قراءة فقط</h2><div className="grid gap-3 md:grid-cols-4"><Card title="إجمالي Profiles" value={shadow.total_profiles}/><Card title="قابل للمقارنة" value={shadow.comparable}/><Card title="Evidence غير كافٍ" value={shadow.insufficient_evidence}/><Card title="بدون Evidence" value={shadow.missing_evidence}/><Card title="Unproven coverage" value={shadow.unproven_coverage}/><Card title="نفس القرار" value={shadow.same}/><Card title="High → Review" value={shadow.high_to_review}/><Card title="Medium → Review" value={shadow.medium_to_review}/></div></div>}
  </div>;
}
