import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Banknote, CheckCircle2, CreditCard, Landmark, ReceiptText, Wallet } from "lucide-react";

const fmt = (value) => Number(value || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });
const SHIFT_BADGE = { صباحي: "bg-amber-100 text-amber-700", مسائي: "bg-blue-100 text-blue-700", ليلي: "bg-indigo-100 text-indigo-700" };
const STATUS_LABELS = { pending_review: "بانتظار مراجعة الخزنة", pending: "بانتظار المراجعة", reviewed: "تمت المراجعة", approved: "معتمد ومقفل" };

function amountByCategory(items, category) {
  return Number(items.find((entry) => entry.category === category)?.amount || 0);
}

function SummaryCard({ label, value, className = "", icon: Icon }) {
  return <div className={`rounded-xl border p-3 ${className}`}><div className="mb-1 flex items-center justify-center gap-1 text-xs text-gray-500">{Icon && <Icon className="h-3.5 w-3.5" />}{label}</div><p className="text-center text-base font-bold">{fmt(value)} ج.م</p></div>;
}

export default function ShiftDeliveryDetail({ item, onClose }) {
  if (!item) return null;
  const entries = Array.isArray(item.expenses) ? item.expenses : [];
  const hasStructuredDetails = entries.some((entry) => entry.entry_type);
  const collections = entries.filter((entry) => entry.entry_type === "collection");
  const cashControls = entries.filter((entry) => entry.entry_type === "cash_control");
  const expenses = hasStructuredDetails ? entries.filter((entry) => entry.entry_type === "expense") : entries;
  const cash = amountByCategory(collections, "نقدي");
  const card = amountByCategory(collections, "فيزا");
  const transfer = amountByCategory(collections, "تحويل");
  const opening = amountByCategory(cashControls, "رصيد افتتاحي");
  const expected = amountByCategory(cashControls, "نقدية متوقعة");
  const actual = amountByCategory(cashControls, "نقدية فعلية");
  const difference = amountByCategory(cashControls, "فرق الخزنة");
  const treasuryStatus = item.treasury_status || item.status || "pending";
  const isApproved = ["approved", "reviewed"].includes(treasuryStatus);

  return <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto" dir="rtl">
      <DialogHeader><DialogTitle className="flex flex-wrap items-center gap-2"><Badge className={SHIFT_BADGE[item.shift_type] || "bg-gray-100 text-gray-700"}>{item.shift_type || "شيفت"}</Badge><span>{item.branch || "—"}</span><span className="text-sm font-normal text-gray-400">{item.shift_date || "—"}</span></DialogTitle></DialogHeader>

      <div className="space-y-5">
        <div className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${isApproved ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{isApproved ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}<div><p className="font-bold">{STATUS_LABELS[treasuryStatus] || item.status || treasuryStatus}</p><p className="text-xs opacity-80">المسؤول عن التسليم: {item.submitted_by || item.employee_name || "—"}</p></div></div>

        <section><h3 className="mb-2 text-sm font-bold text-gray-800">ملخص الشيفت</h3><div className="grid grid-cols-2 gap-3 md:grid-cols-4"><SummaryCard label="إجمالي المبيعات" value={item.total_sales} icon={ReceiptText} className="bg-blue-50 text-blue-800" /><SummaryCard label="المصروفات" value={item.total_expenses} icon={Wallet} className="bg-red-50 text-red-700" /><SummaryCard label="صافي الشيفت" value={item.net_amount} icon={Banknote} className="bg-emerald-50 text-emerald-800" /><SummaryCard label="فرق الخزنة" value={difference} icon={AlertTriangle} className={difference === 0 ? "bg-gray-50 text-gray-700" : difference > 0 ? "bg-blue-50 text-blue-800" : "bg-red-50 text-red-700"} /></div></section>

        {hasStructuredDetails && <section><h3 className="mb-2 text-sm font-bold text-gray-800">تفاصيل التحصيل</h3><div className="grid gap-3 sm:grid-cols-3"><SummaryCard label="نقدي" value={cash} icon={Banknote} /><SummaryCard label="فيزا" value={card} icon={CreditCard} /><SummaryCard label="تحويلات ومحافظ" value={transfer} icon={Landmark} /></div></section>}

        {hasStructuredDetails && <section><h3 className="mb-2 text-sm font-bold text-gray-800">مطابقة النقدية</h3><div className="grid gap-3 sm:grid-cols-3"><SummaryCard label="رصيد افتتاحي" value={opening} /><SummaryCard label="النقدية المتوقعة" value={expected} /><SummaryCard label="النقدية الفعلية" value={actual} /></div><p className={`mt-2 rounded-lg p-2 text-center text-sm font-bold ${difference === 0 ? "bg-emerald-50 text-emerald-700" : difference > 0 ? "bg-blue-50 text-blue-700" : "bg-red-50 text-red-700"}`}>{difference === 0 ? "الخزنة مطابقة" : difference > 0 ? `زيادة خزنة: ${fmt(difference)} ج.م` : `عجز خزنة: ${fmt(Math.abs(difference))} ج.م`}</p></section>}

        <section><h3 className="mb-2 text-sm font-bold text-gray-800">بنود المصروفات</h3>{expenses.length ? <div className="overflow-hidden rounded-xl border"><Table><TableHeader><TableRow><TableHead>البند</TableHead><TableHead>البيان</TableHead><TableHead className="text-left">القيمة</TableHead></TableRow></TableHeader><TableBody>{expenses.map((expense, index) => <TableRow key={`${expense.category || "expense"}-${index}`}><TableCell className="font-medium">{expense.category || "أخرى"}</TableCell><TableCell className="text-sm text-gray-600">{expense.description || "—"}</TableCell><TableCell className="text-left font-bold text-red-600">{fmt(expense.amount)} ج.م</TableCell></TableRow>)}</TableBody></Table></div> : <div className="rounded-xl border border-dashed p-5 text-center text-sm text-gray-400">لا توجد مصروفات مسجلة</div>}</section>

        {item.notes && <section><h3 className="mb-2 text-sm font-bold text-gray-800">ملاحظات الشيفت</h3><p className="whitespace-pre-wrap rounded-xl bg-gray-50 p-3 text-sm leading-6 text-gray-700">{item.notes}</p></section>}
        {!hasStructuredDetails && <p className="rounded-xl bg-blue-50 p-3 text-xs text-blue-700">هذا تسليم قديم تم تسجيله قبل إضافة تفاصيل طرق التحصيل ومطابقة النقدية؛ لذلك تظهر البيانات المتاحة فقط.</p>}
      </div>
    </DialogContent>
  </Dialog>;
}
