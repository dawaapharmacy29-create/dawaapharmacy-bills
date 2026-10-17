import { Copy, ReceiptText, UserRound } from 'lucide-react';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function unique(values = []) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function arabicBranchLabel(value = '') {
  const text = clean(value).toLowerCase();
  if (!text) return '';
  if (text.includes('شامي') || text.includes('shamy') || text.includes('shami')) return 'الشامي';
  if (text.includes('شكري') || text.includes('العزم') || text.includes('shokry') || text.includes('shoukry') || text.includes('shukry') || text.includes('abu al azm') || text.includes('abo el azm')) return 'شكري';
  return clean(value);
}

function branchFromSide(selected, side) {
  const lines = side === 'sale' ? (selected?.sale_lines || []) : (selected?.purchase_lines || []);
  const branch = lines.map((line) => line?.branch).find(Boolean);
  if (branch) return arabicBranchLabel(branch);

  if (side === 'sale') {
    return arabicBranchLabel(selected?.from || selected?.branch || '');
  }
  return arabicBranchLabel(selected?.to || selected?.counterparty || '');
}

async function copy(value) {
  const text = clean(value);
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch { /* clipboard may be blocked by browser policy */ }
}

function CopyChip({ label, value }) {
  if (!clean(value)) return null;
  return <button type="button" onClick={() => copy(value)} title={`نسخ ${label}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-700 hover:border-teal-300 hover:bg-teal-50">
    <span>{label}: {value}</span><Copy className="h-3 w-3 text-slate-400" />
  </button>;
}

function EvidenceCard({ title, branchName, tone, side, fallbackQty }) {
  const evidence = side?.invoiceEvidence || [];
  const shown = evidence.slice(0, 2);
  const extra = Math.max(0, evidence.length - shown.length);
  const toneClass = tone === 'sale' ? 'border-sky-200 bg-sky-50/70' : 'border-emerald-200 bg-emerald-50/70';

  return <div className={`rounded-2xl border p-3 text-right ${toneClass}`}>
    <div className="flex items-center justify-between gap-2">
      <div>
        <div className="text-[10px] font-black text-slate-500">{title}</div>
        {branchName && <div className="mt-0.5 text-[11px] font-black text-slate-800">فرع {branchName}</div>}
      </div>
      <div className="text-sm font-black text-slate-950">{shown[0]?.qtyLabel || fallbackQty || 'لا توجد حركة'}</div>
    </div>
    {!shown.length ? <div className="mt-2 text-[10px] font-bold text-slate-400">لا توجد فاتورة في هذا الطرف</div> : <div className="mt-2 space-y-2">
      {shown.map((entry, index) => <div key={`${entry.invoice}-${index}`} className="rounded-xl border border-white/80 bg-white/85 p-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <CopyChip label="فاتورة" value={entry.invoice} />
          <span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-700">{entry.qtyLabel}</span>
        </div>
        <div className="mt-1.5 flex items-start gap-1.5 text-[10px] font-bold text-slate-600"><UserRound className="mt-0.5 h-3 w-3 shrink-0" /><span>{entry.actor || 'مدخل الفاتورة غير متاح'}</span></div>
        <div className="mt-1 flex items-start gap-1.5 text-[10px] font-bold leading-5 text-slate-600"><ReceiptText className="mt-0.5 h-3 w-3 shrink-0" /><span>{entry.dateLabel || 'التاريخ غير متاح'}</span></div>
      </div>)}
      {extra > 0 && <div className="text-[9px] font-black text-slate-500">+ {extra} فاتورة أخرى داخل نفس الحركة</div>}
    </div>}
  </div>;
}

export default function OperationalEvidenceStrip({ selected, timeline }) {
  const saleCodes = unique(selected?.sale_codes || []);
  const purchaseCodes = unique(selected?.purchase_codes || []);
  const allCodes = unique([...saleCodes, ...purchaseCodes]);
  const sameCode = allCodes.length === 1;
  const saleQty = selected?.sale_qty_display?.primary || selected?.sale_qty_label || selected?.sale_qty || 'لا توجد حركة';
  const purchaseQty = selected?.purchase_qty_display?.primary || selected?.purchase_qty_label || selected?.purchase_qty || 'لا توجد حركة';
  const saleBranch = branchFromSide(selected, 'sale');
  const purchaseBranch = branchFromSide(selected, 'purchase');

  return <div className="mx-auto mt-4 w-full max-w-4xl rounded-2xl border border-slate-200 bg-slate-50/80 p-2.5 text-right">
    <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-2">
      <span className="ml-auto text-[10px] font-black text-slate-500">مفاتيح التحقق السريع</span>
      {sameCode ? <CopyChip label="كود الصنف" value={allCodes[0]} /> : <>
        {saleCodes.slice(0, 2).map((value) => <CopyChip key={`s-${value}`} label="كود البيع" value={value} />)}
        {purchaseCodes.slice(0, 2).map((value) => <CopyChip key={`p-${value}`} label="كود الشراء" value={value} />)}
      </>}
    </div>
    <div className="mt-2 grid gap-2 md:grid-cols-2">
      <EvidenceCard title="البيع" branchName={saleBranch} tone="sale" side={timeline?.sale} fallbackQty={saleQty} />
      <EvidenceCard title="الشراء" branchName={purchaseBranch} tone="purchase" side={timeline?.purchase} fallbackQty={purchaseQty} />
    </div>
  </div>;
}
