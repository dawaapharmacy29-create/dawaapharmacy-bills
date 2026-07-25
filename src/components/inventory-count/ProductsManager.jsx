import React, { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Trash2, Package, AlertTriangle, CheckCircle2, Upload, FileSpreadsheet, ChevronDown, ChevronUp, Search, XCircle } from "lucide-react";
import * as XLSX from "xlsx";

const BRANCHES = ["دواء شكري", "دواء الشامي"];
const NAME_KEYS = ["اسم الصنف", "اسم", "product_name", "name", "الاسم", "الصنف"];
const QTY_KEYS  = ["الرصيد", "رصيد", "الكمية", "كمية", "stock_quantity", "quantity", "qty", "الكميه"];
const CODE_KEYS = ["كود", "كود الصنف", "product_code", "code", "الكود", "رقم الصنف"];
const findCol = (headers, keys) => headers.find(h => keys.some(k => k === h?.trim()));

function BranchCard({ branch, allProducts, onRefetch, qc }) {
  const fileInputRef = useRef(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [isError, setIsError] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadPreview, setUploadPreview] = useState(null);
  const [uploadError, setUploadError] = useState("");
  const [viewing, setViewing] = useState(false);
  const [search, setSearch] = useState("");

  const count = allProducts.filter(p => p.branch === branch).length;

  const showMsg = (msg, error = false) => {
    setStatusMsg(msg);
    setIsError(error);
    if (!error) setTimeout(() => setStatusMsg(""), 4000);
  };

  const invalidate = async () => {
    qc.removeQueries({ queryKey: ["inventory-products-all"] });
    qc.removeQueries({ queryKey: ["inventory-products"] });
    await onRefetch();
  };

  // ── DELETE via backend function ──
  const handleDelete = async () => {
    setBusy(true);
    setConfirm(false);
    showMsg("جاري الحذف...");
    try {
      const res = await base44.functions.invoke("deleteInventoryProducts", { branch });
      await invalidate();
      showMsg(`تم حذف ${res.data.deleted} صنف بنجاح ✓`);
    } catch (e) {
      showMsg("فشل الحذف: " + e.message, true);
    }
    setBusy(false);
  };

  // ── FILE PARSE ──
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadError("");
    setUploadPreview(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        if (!rows.length) { setUploadError("الملف فارغ"); return; }
        const headers = Object.keys(rows[0]);
        const nameCol = findCol(headers, NAME_KEYS);
        const qtyCol  = findCol(headers, QTY_KEYS);
        const codeCol = findCol(headers, CODE_KEYS);
        if (!nameCol) { setUploadError(`لم يُعثر على عمود الاسم. الأعمدة: ${headers.join(", ")}`); return; }
        const mapped = rows
          .map(r => ({
            product_name: String(r[nameCol] || "").trim(),
            stock_quantity: qtyCol ? (Number(r[qtyCol]) || 0) : 0,
            product_code: codeCol ? String(r[codeCol] || "").trim() : "",
          }))
          .filter(i => i.product_name);
        if (!mapped.length) { setUploadError("لا أصناف صالحة في الملف"); return; }
        setUploadPreview(mapped);
      } catch (err) {
        setUploadError("تعذّر قراءة الملف: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  // ── UPLOAD via backend function ──
  const handleUpload = async () => {
    if (!uploadPreview) return;
    setBusy(true);
    setUploadOpen(false);
    showMsg(`جاري رفع ${uploadPreview.length} صنف...`);
    try {
      const res = await base44.functions.invoke("uploadInventoryProducts", {
        branch,
        products: uploadPreview,
      });
      await invalidate();
      setUploadPreview(null);
      showMsg(`تم رفع ${res.data.inserted} صنف بنجاح ✓`);
    } catch (e) {
      showMsg("فشل الرفع: " + e.message, true);
    }
    setBusy(false);
  };

  const viewedProducts = allProducts.filter(p =>
    p.branch === branch &&
    (!search || p.product_name?.includes(search) || p.product_code?.includes(search))
  );

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-teal-600" />
            <span className="font-bold text-gray-800">{branch}</span>
          </div>
          {count > 0 && (
            <button
              className="flex items-center gap-1 text-xs text-teal-600 hover:underline"
              onClick={() => { setViewing(v => !v); setSearch(""); }}
            >
              {viewing ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {viewing ? "إخفاء" : "عرض الأصناف"}
            </button>
          )}
        </div>

        {/* Count */}
        <div className="text-center py-2">
          <p className="text-3xl font-bold text-gray-700">{count}</p>
          <p className="text-xs text-gray-400 mt-1">صنف مسجّل</p>
        </div>

        {/* Status message */}
        {statusMsg && (
          <div className={`flex items-center gap-1.5 justify-center text-sm ${isError ? "text-red-600" : "text-green-600"}`}>
            {isError ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            {statusMsg}
          </div>
        )}

        {/* Confirm message */}
        {confirm && (
          <p className="text-xs text-center text-red-600 font-medium">هل أنت متأكد من حذف {count} صنف؟</p>
        )}

        {/* Action buttons */}
        {!busy && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs h-8 gap-1 text-teal-700 border-teal-200 hover:bg-teal-50"
              onClick={() => { setUploadOpen(o => !o); setConfirm(false); setUploadPreview(null); setUploadError(""); }}
            >
              <Upload className="w-3.5 h-3.5" /> رفع ملف
            </Button>

            {count > 0 && (
              confirm ? (
                <>
                  <Button size="sm" className="flex-1 bg-red-600 hover:bg-red-700 text-xs h-8" onClick={handleDelete}>
                    <Trash2 className="w-3.5 h-3.5 ml-1" /> تأكيد
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 text-xs h-8" onClick={() => setConfirm(false)}>
                    إلغاء
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs h-8 text-red-600 border-red-200 hover:bg-red-50 gap-1"
                  onClick={() => { setConfirm(true); setUploadOpen(false); }}
                >
                  <Trash2 className="w-3.5 h-3.5" /> حذف
                </Button>
              )
            )}
          </div>
        )}

        {busy && (
          <div className="text-center text-sm text-gray-400 animate-pulse">
            {statusMsg || "جاري التنفيذ..."}
          </div>
        )}

        {/* Inline Upload Form */}
        {!busy && uploadOpen && (
          <div className="border-t pt-3 space-y-2">
            <div
              className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-teal-400 hover:bg-teal-50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileSpreadsheet className="w-7 h-7 text-gray-400 mx-auto mb-1" />
              <p className="text-xs text-gray-500">
                {uploadPreview ? `✓ ${uploadPreview.length} صنف جاهز للرفع` : "اضغط لاختيار ملف Excel"}
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileChange}
            />
            {uploadError && <p className="text-xs text-red-600 text-center">{uploadError}</p>}
            {uploadPreview && (
              <Button
                size="sm"
                className="w-full bg-teal-600 hover:bg-teal-700 text-xs h-8 gap-1"
                onClick={handleUpload}
              >
                <Upload className="w-3.5 h-3.5" /> استيراد {uploadPreview.length} صنف
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Products list */}
      {viewing && count > 0 && (
        <div className="border-t">
          <div className="px-3 py-2 bg-gray-50">
            <div className="relative">
              <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                className="w-full pr-7 pl-2 py-1.5 text-xs border rounded-md outline-none focus:border-teal-400"
                placeholder="بحث باسم أو كود..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="overflow-y-auto max-h-56 divide-y text-xs">
            {viewedProducts.slice(0, 200).map((p, i) => (
              <div key={p.id || i} className="px-3 py-2 flex justify-between items-center hover:bg-gray-50">
                <span className="text-gray-700 truncate flex-1">{p.product_name}</span>
                <div className="flex items-center gap-2 shrink-0 mr-2">
                  {p.product_code && <span className="text-gray-400">{p.product_code}</span>}
                  <span className="font-medium text-teal-700">{p.stock_quantity ?? 0}</span>
                </div>
              </div>
            ))}
            {viewedProducts.length === 0 && <p className="text-center text-gray-400 py-4">لا نتائج</p>}
            {viewedProducts.length > 200 && <p className="text-center text-gray-400 py-2">يُعرض أول 200 صنف</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProductsManager() {
  const qc = useQueryClient();
  const { data: allProducts = [], isLoading, refetch } = useQuery({
    queryKey: ["inventory-products-all"],
    queryFn: () => base44.entities.InventoryProduct.list(),
    staleTime: 30000,
  });

  if (isLoading) return <div className="text-center text-gray-400 py-8">جاري التحميل...</div>;

  return (
    <div dir="rtl" className="space-y-4">
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 flex items-start gap-2 text-yellow-800 text-sm">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>يمكنك حذف أصناف الفرع أو رفع ملف جديد مباشرة. الحذف نهائي.</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {BRANCHES.map(branch => (
          <BranchCard key={branch} branch={branch} allProducts={allProducts} onRefetch={refetch} qc={qc} />
        ))}
      </div>
    </div>
  );
}