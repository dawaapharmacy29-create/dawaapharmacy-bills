import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileSearch, Upload, XCircle } from 'lucide-react';
import { performanceApi } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { parseBConnectWorkbook } from '@/lib/bconnectPurchaseInvoiceParser';
import { reconcilePurchaseInvoice } from '@/lib/purchaseInvoiceReconciliation';

const labels = { clean: 'سليم', review: 'راجعها', problem: 'مشكلة' };
const icons = { clean: CheckCircle2, review: AlertTriangle, problem: XCircle };
const money = (v) => Number(v || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

export default function BConnectInvoiceReview() {
  const [state, setState] = useState({ loading: false, error: '', fileName: '', rows: [], meta: null });
  const [problemsOnly, setProblemsOnly] = useState(true);

  const visible = useMemo(() => problemsOnly ? state.rows.filter((r) => r.status !== 'clean') : state.rows, [state.rows, problemsOnly]);
  const counts = useMemo(() => state.rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), { clean: 0, review: 0, problem: 0 }), [state.rows]);

  const reviewFile = async (file) => {
    if (!file) return;
    setState({ loading: true, error: '', fileName: file.name, rows: [], meta: null });
    try {
      const parsed = parseBConnectWorkbook(await file.arrayBuffer());
      if (!parsed.valid) throw new Error(parsed.warnings?.join(' ') || 'ملف B-Connect غير صالح.');
      const numbers = [...new Set(parsed.invoices.map((r) => String(r.serial || '').trim()).filter(Boolean))];
      // Global lookup is the only authority for uniqueness and matching.
      // Never fall back to a date-limited scan: failure must fail closed.
      const checked = await performanceApi.bconnectInvoiceNumbers(numbers);
      if (!Array.isArray(checked)) throw new Error('تعذر التحقق العالمي من أرقام الفواتير؛ لم يتم إصدار أحكام.');
      const globalGate = new Map(checked.map((x) => [String(x.number), x]));
      const fileCounts = new Map();
      parsed.invoices.forEach((r) => {
        const key = String(r.serial || '').trim();
        if (key) fileCounts.set(key, (fileCounts.get(key) || 0) + 1);
      });
      const rows = parsed.invoices.map((b) => {
        const number = String(b.serial || '').trim();
        const gate = globalGate.get(number);
        const recordCount = Number(gate?.record_count);
        const authorizedRows = Array.isArray(gate?.rows) ? gate.rows : [];
        const problem = (identity, reason) => ({
          number, bconnect: b, app: null, status: 'problem', identity,
          reasons: [reason], financial: { difference: null },
        });
        if (!gate || !Number.isSafeInteger(recordCount) || recordCount < 0)
          return problem('unverified', 'التحقق العالمي غير مكتمل لهذا الرقم؛ ممنوع اعتماد الفاتورة.');
        if ((fileCounts.get(number) || 0) > 1)
          return problem('duplicate_bconnect', 'رقم الفاتورة مكرر داخل ملف B-Connect.');
        if (recordCount > 1)
          return problem('duplicate_app', 'رقم الفاتورة مكرر عالميًا في التطبيق؛ ممنوع الاعتماد.');
        if (recordCount === 0)
          return problem('missing', 'الفاتورة غير موجودة في التطبيق.');
        if (authorizedRows.length !== 1)
          return problem('unauthorized_or_incomplete', 'الفاتورة موجودة لكن تفاصيلها غير متاحة أو غير مكتملة ضمن صلاحياتك.');
        const app = authorizedRows[0];
        const result = reconcilePurchaseInvoice(app, b);
        return { number, bconnect: b, app, ...result };
      });
      setState({ loading: false, error: '', fileName: file.name, rows, meta: { ...parsed.meta, global_gate: true } });
    } catch (error) {
      setState({ loading: false, error: error?.message || 'تعذر مراجعة الملف.', fileName: file.name, rows: [], meta: null });
    }
  };

  return <div dir="rtl" className="space-y-4 p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">مراجعة B-Connect</h1><p className="mt-1 text-sm text-gray-500">مقارنة قراءة فقط — لا يتم تعديل أو إنشاء أو حذف أي فاتورة.</p></div>
      <Button asChild variant="outline"><Link to="/invoices">العودة للفواتير</Link></Button>
    </div>
    <Card className="p-5">
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center hover:bg-gray-50">
        <Upload className="h-7 w-7 text-teal-600" /><strong>{state.loading ? 'جاري التحليل والمقارنة...' : 'اختر ملف B-Connect Excel'}</strong>
        <span className="text-xs text-gray-500">قراءة فقط. الأخضر يتطلب تحققًا عالميًا من تفرد رقم الفاتورة + الفرع + القيمة.</span>
        <input type="file" accept=".xlsx,.xls" className="hidden" disabled={state.loading} onChange={(e) => reviewFile(e.target.files?.[0])} />
      </label>
      {state.error && <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</div>}
    </Card>
    {!!state.rows.length && <>
      <div className="grid gap-3 md:grid-cols-4">
        <Card className="p-4"><div className="text-xs text-gray-500">فواتير B-Connect</div><div className="text-2xl font-bold">{state.rows.length}</div></Card>
        <Card className="p-4"><div className="text-xs text-gray-500">🟢 سليم</div><div className="text-2xl font-bold">{counts.clean}</div></Card>
        <Card className="p-4"><div className="text-xs text-gray-500">🟡 راجعها</div><div className="text-2xl font-bold">{counts.review}</div></Card>
        <Card className="p-4"><div className="text-xs text-gray-500">🔴 مشكلة</div><div className="text-2xl font-bold">{counts.problem}</div></Card>
      </div>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b p-4">
          <div className="flex items-center gap-2"><FileSearch className="h-4 w-4"/><strong>{state.fileName}</strong></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)}/> المشاكل فقط</label>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="p-3 text-right">الحالة</th><th className="p-3 text-right">رقم البرنامج</th><th className="p-3 text-right">المورد B-Connect</th><th className="p-3 text-right">قيمة B-Connect</th><th className="p-3 text-right">قيمة التطبيق</th><th className="p-3 text-right">الفرق</th><th className="p-3 text-right">الدليل</th></tr></thead>
          <tbody>{visible.map((r, i) => { const Icon = icons[r.status]; return <tr key={r.number + '-' + i} className="border-b align-top">
            <td className="p-3"><span className="inline-flex items-center gap-1 font-semibold"><Icon className="h-4 w-4"/>{labels[r.status]}</span></td>
            <td className="p-3 font-mono font-bold">{r.number}</td><td className="p-3">{r.bconnect?.supplier || '—'}</td>
            <td className="p-3">{money(r.bconnect?.invoice_value)} ج</td><td className="p-3">{r.app ? money(r.app.total_value) + ' ج' : '—'}</td>
            <td className="p-3">{r.financial?.difference == null ? '—' : money(r.financial.difference) + ' ج'}</td>
            <td className="max-w-[420px] p-3 text-xs leading-6 text-gray-600">{(r.reasons || []).join(' ')}</td>
          </tr>; })}{!visible.length && <tr><td colSpan={7} className="p-10 text-center text-gray-400">لا توجد نتائج ضمن الفلتر الحالي.</td></tr>}</tbody>
        </table></div>
      </Card>
    </>}
  </div>;
}
