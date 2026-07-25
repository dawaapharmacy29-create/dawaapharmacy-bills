import React, { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X } from "lucide-react";
import * as XLSX from "xlsx";

const BRANCHES = ["دواء شكري", "دواء الشامي"];

const NAME_KEYS = ["اسم الصنف", "اسم", "product_name", "name", "الاسم", "الصنف"];
const QTY_KEYS  = ["الرصيد", "رصيد", "الكمية", "كمية", "stock_quantity", "quantity", "qty", "الكميه"];
const CODE_KEYS = ["كود", "كود الصنف", "product_code", "code", "الكود", "رقم الصنف"];

const findCol = (headers, keys) => headers.find(h => keys.includes(h?.trim()));

export default function ProductUploader({ onClose }) {
  const qc = useQueryClient();
  const fileRef = useRef();
  const [branch, setBranch] = useState("");
  const [preview, setPreview] = useState(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setError("");
    setPreview(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

        if (rows.length === 0) { setError("الملف فارغ أو لا يحتوي على بيانات"); return; }

        const headers = Object.keys(rows[0]);
        const nameCol = findCol(headers, NAME_KEYS);
        const qtyCol  = findCol(headers, QTY_KEYS);
        const codeCol = findCol(headers, CODE_KEYS);

        if (!nameCol) { setError("لم يتم العثور على عمود اسم الصنف. تأكد من وجود عمود باسم 'اسم الصنف' أو 'الاسم'"); return; }

        const mapped = rows
          .map(row => ({
            product_name: String(row[nameCol] || "").trim(),
            stock_quantity: qtyCol ? (Number(row[qtyCol]) || 0) : 0,
            product_code: codeCol ? String(row[codeCol] || "").trim() : "",
          }))
          .filter(i => i.product_name);

        if (mapped.length === 0) { setError("لا توجد أصناف بأسماء صالحة في الملف"); return; }
        setPreview(mapped);
      } catch (err) {
        setError("تعذّر قراءة الملف: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleImport = async () => {
    if (!branch || !preview) return;
    setImporting(true);
    setProgress(0);

    // Step 1: Delete all existing products for this branch one by one with delay
    const existing = await base44.entities.InventoryProduct.filter({ branch }, null, 500);
    for (let i = 0; i < existing.length; i++) {
      await base44.entities.InventoryProduct.delete(existing[i].id);
      if (i % 5 === 4) await new Promise(r => setTimeout(r, 800));
    }

    // Step 2: Import new products in batches of 20 with small delay
    const BATCH = 20;
    const chunks = [];
    for (let i = 0; i < preview.length; i += BATCH) chunks.push(preview.slice(i, i + BATCH));

    for (let ci = 0; ci < chunks.length; ci++) {
      await base44.entities.InventoryProduct.bulkCreate(
        chunks[ci].map(item => ({
          product_name: item.product_name,
          stock_quantity: item.stock_quantity,
          product_code: item.product_code || "",
          branch,
          is_active: true,
          priority_score: 0,
          discrepancy_count: 0,
        }))
      );
      setProgress(Math.round(((ci + 1) / chunks.length) * 100));
      if (ci < chunks.length - 1) await new Promise(r => setTimeout(r, 400));
    }

    qc.invalidateQueries(["inventory-products"]);
    qc.invalidateQueries(["inventory-products-all"]);
    setImporting(false);
    setDone(true);
  };

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <CheckCircle2 className="w-12 h-12 text-green-500" />
        <p className="text-lg font-bold text-gray-700">تم استيراد {preview?.length} صنف بنجاح!</p>
        <Button onClick={onClose}>إغلاق</Button>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-800 text-base">استيراد الأصناف من ملف Excel</h3>
        <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
      </div>

      <Select value={branch} onValueChange={setBranch}>
        <SelectTrigger><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
        <SelectContent>{BRANCHES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
      </Select>

      <div
        className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-teal-400 hover:bg-teal-50 transition-colors"
        onClick={() => fileRef.current?.click()}
      >
        <FileSpreadsheet className="w-10 h-10 text-gray-400 mx-auto mb-2" />
        <p className="text-sm text-gray-600">{fileName || "اضغط لرفع ملف Excel"}</p>
        <p className="text-xs text-gray-400 mt-1">صيغة xlsx — أعمدة مطلوبة: اسم الصنف، الرصيد، الكود</p>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded p-2">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {preview && (
        <div className="space-y-2">
          <p className="text-sm text-green-700 font-medium">✓ تم التعرف على {preview.length} صنف</p>
          <div className="overflow-x-auto max-h-48 border rounded-lg text-xs">
            <table className="w-full">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-right text-gray-600">الكود</th>
                  <th className="px-2 py-1 text-right text-gray-600">اسم الصنف</th>
                  <th className="px-2 py-1 text-right text-gray-600">الرصيد</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 10).map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1 text-gray-500">{r.product_code}</td>
                    <td className="px-2 py-1 font-medium">{r.product_name}</td>
                    <td className="px-2 py-1">{r.stock_quantity}</td>
                  </tr>
                ))}
                {preview.length > 10 && (
                  <tr><td colSpan={3} className="px-2 py-1 text-gray-400 text-center">... و {preview.length - 10} صنف آخر</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {importing && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>{progress === 0 ? "جاري حذف الأصناف القديمة..." : "جاري الاستيراد..."}</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-teal-500 h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <Button
        className="w-full gap-2 bg-teal-600 hover:bg-teal-700"
        disabled={!branch || !preview || importing}
        onClick={handleImport}
      >
        <Upload className="w-4 h-4" />
        {importing ? `${progress}% — جاري الاستيراد` : `استيراد ${preview?.length || 0} صنف`}
      </Button>
    </div>
  );
}