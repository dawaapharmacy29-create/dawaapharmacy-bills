import { useEffect, useMemo, useState } from 'react';
import { treasuryApi } from '@/api/treasuryApi';
import { useUserRole } from '@/lib/useUserRole';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  HandCoins,
  Landmark,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Smartphone,
  WalletCards,
} from 'lucide-react';

const money = (value) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(value || 0));
const today = () => new Date().toISOString().slice(0, 10);
const cycleStart = () => {
  const date = new Date();
  const year = date.getDate() >= 26 ? date.getFullYear() : new Date(date.getFullYear(), date.getMonth() - 1, 1).getFullYear();
  const month = date.getDate() >= 26 ? date.getMonth() : date.getMonth() - 1;
  return new Date(year, month, 26).toISOString().slice(0, 10);
};

const ACCOUNT_LABELS = {
  cash: 'خزنة النقدي',
  instapay: 'خزنة إنستا باي',
  vodafone_cash: 'خزنة فودافون كاش',
  accounts_custody: 'عهدة مدير الحسابات',
};
const ACCOUNT_ICONS = { cash: Landmark, instapay: Smartphone, vodafone_cash: Smartphone, accounts_custody: HandCoins };
const CATEGORY_LABELS = {
  shift_cash: 'صافي نقدي الشيفت',
  shift_cash_net: 'صافي نقدي الشيفت',
  shift_instapay: 'إنستا باي من الشيفت',
  shift_vodafone_cash: 'فودافون كاش من الشيفت',
  transfer_handover: 'تسليم للحسابات',
  transfer_post: 'تسجيل من العهدة',
  salary: 'مرتبات',
  rent: 'إيجار',
  supplier_payment: 'دفعة مورد',
  manual_income: 'إضافة يدوية',
  other_expense: 'مصروف آخر',
  opening_reconciliation: 'تسوية افتتاحية',
};

export default function TreasuryCenter() {
  const { isAdmin } = useUserRole();
  const [data, setData] = useState({ treasuries: [], transactions: [], transfers: [], pending_shifts: [], reconciliations: [], role: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [returnReasons, setReturnReasons] = useState({});
  const [movement, setMovement] = useState({ branch: 'دواء الشامي', account_type: 'cash', transaction_date: today(), direction: 'credit', category: 'manual_income', amount: '', reason: '', counterparty: '', reference_number: '' });
  const [transfer, setTransfer] = useState({ branch: 'دواء الشامي', transaction_date: today(), transfer_type: 'instapay', source_account_type: 'instapay', amount: '', notes: '' });
  const [reconciliation, setReconciliation] = useState({ treasury_id: '', cycle_start: cycleStart(), actual_balance: '', reason: '', reference_number: '', counted_by_name: '' });

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const [main, controls] = await Promise.all([treasuryApi.dashboard(), treasuryApi.controlsDashboard()]);
      setData({ ...(main || {}), ...(controls || {}) });
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function run(action, success) {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
      await refresh();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setLoading(false);
    }
  }

  const cycleLabel = useMemo(() => {
    const start = new Date(`${cycleStart()}T12:00:00`);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 25);
    return `${start.toLocaleDateString('ar-EG')} — ${end.toLocaleDateString('ar-EG')}`;
  }, []);

  const grouped = useMemo(
    () => ['دواء الشامي', 'دواء شكري'].map((branch) => ({ branch, accounts: (data.treasuries || []).filter((treasury) => treasury.branch === branch) })),
    [data.treasuries],
  );

  const selectedTreasury = (data.treasuries || []).find((treasury) => treasury.id === reconciliation.treasury_id);
  const latestReconciliation = (treasuryId) => (data.reconciliations || []).find((item) => item.treasury_id === treasuryId && item.cycle_start === reconciliation.cycle_start);

  const saveManual = () => run(async () => {
    await treasuryApi.manualTransaction({ ...movement, amount: Number(movement.amount), description: movement.reason });
    setMovement((current) => ({ ...current, amount: '', reason: '', counterparty: '', reference_number: '' }));
  }, 'تم تسجيل الحركة اليدوية باسم المدير العام ووقت تنفيذها.');

  const saveReconciliation = () => run(async () => {
    await treasuryApi.reconcileOpening({ ...reconciliation, actual_balance: Number(reconciliation.actual_balance) });
    setReconciliation((current) => ({ ...current, actual_balance: '', reason: '', reference_number: '', counted_by_name: '' }));
  }, 'تم اعتماد تسوية الرصيد وتسجيل فرق الجرد في الخزنة.');

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الخزنة الذكية والعهد والتحويلات</h1>
          <p className="text-sm text-slate-500 mt-1">دورة المبيعات: {cycleLabel} — الشيفت لا يؤثر على الرصيد إلا بعد المراجعة والاعتماد.</p>
        </div>
        <button onClick={refresh} disabled={loading} className="rounded-lg border bg-white px-4 py-2 flex gap-2"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />تحديث</button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex gap-2"><AlertTriangle className="w-5 h-5 shrink-0" />{error}</div>}
      {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">{message}</div>}

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-2 font-bold text-amber-900"><ShieldCheck className="w-5 h-5" />شيفتات بانتظار مراجعة الخزنة ({(data.pending_shifts || []).length})</div>
        <p className="text-xs text-amber-700 mt-1">اعتماد الشيفت يرحّل النقدي وإنستا باي وفودافون كاش تلقائيًا. الإرجاع لا يضيف أي مبلغ للخزنة.</p>
        <div className="mt-3 grid xl:grid-cols-2 gap-3">
          {(data.pending_shifts || []).map((shift) => (
            <div key={shift.id} className="rounded-xl border bg-white p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <div className="font-bold">{shift.branch} — شيفت {shift.shift_type}</div>
                  <div className="text-xs text-slate-500 mt-1">{shift.shift_date} • المسؤول: {shift.submitted_by || '—'}</div>
                </div>
                <span className={`h-fit rounded-full px-2.5 py-1 text-xs font-bold ${shift.treasury_status === 'returned' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>{shift.treasury_status === 'returned' ? 'مرتجع للتصحيح' : 'انتظار اعتماد'}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-center text-sm">
                <div className="rounded-lg bg-slate-50 p-2"><div className="text-xs text-slate-500">المبيعات</div><div className="font-bold">{money(shift.total_sales)} ج</div></div>
                <div className="rounded-lg bg-slate-50 p-2"><div className="text-xs text-slate-500">البنود</div><div className="font-bold">{money(shift.total_expenses)} ج</div></div>
                <div className="rounded-lg bg-teal-50 p-2"><div className="text-xs text-teal-700">صافي النقدي</div><div className="font-bold text-teal-800">{money(shift.net_amount)} ج</div></div>
              </div>
              {shift.treasury_review_note && <div className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">سبب الإرجاع: {shift.treasury_review_note}</div>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button disabled={loading} onClick={() => run(() => treasuryApi.approveShift(shift.id), 'تم اعتماد الشيفت وترحيله إلى الخزائن الفرعية.')} className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm font-bold flex gap-1"><CheckCircle2 className="w-4 h-4" />اعتماد وترحيل</button>
                <input value={returnReasons[shift.id] || ''} onChange={(event) => setReturnReasons({ ...returnReasons, [shift.id]: event.target.value })} placeholder="سبب الإرجاع للتصحيح" className="min-w-[220px] flex-1 rounded-lg border px-3 py-2 text-sm" />
                <button disabled={loading || !(returnReasons[shift.id] || '').trim()} onClick={() => run(() => treasuryApi.returnShift(shift.id, returnReasons[shift.id]), 'تم إرجاع الشيفت للتصحيح ولم يُرحل للخزنة.')} className="rounded-lg border border-red-300 text-red-700 px-3 py-2 text-sm font-bold flex gap-1 disabled:opacity-40"><RotateCcw className="w-4 h-4" />إرجاع</button>
              </div>
            </div>
          ))}
          {!(data.pending_shifts || []).length && <div className="xl:col-span-2 rounded-xl bg-white/70 p-6 text-center text-sm text-slate-500">لا توجد شيفتات معلقة حاليًا.</div>}
        </div>
      </section>

      {grouped.map((group) => (
        <section key={group.branch} className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="font-bold mb-3">{group.branch}</h2>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {group.accounts.map((treasury) => {
              const Icon = ACCOUNT_ICONS[treasury.account_type] || WalletCards;
              const reconciliationRecord = latestReconciliation(treasury.id);
              return (
                <button key={treasury.id} type="button" onClick={() => isAdmin && setReconciliation((current) => ({ ...current, treasury_id: treasury.id, actual_balance: String(treasury.balance || 0) }))} className={`rounded-xl border p-4 text-right bg-slate-50 ${isAdmin ? 'hover:border-teal-400' : ''}`}>
                  <div className="flex items-center justify-between"><div><div className="text-xs text-slate-500">{treasury.account_name || ACCOUNT_LABELS[treasury.account_type]}</div><div className="text-2xl font-bold mt-2">{money(treasury.balance)} ج</div></div><Icon className="w-8 h-8 text-teal-600" /></div>
                  <div className="text-[11px] text-slate-400 mt-2">{reconciliationRecord ? `تمت تسوية الدورة • الفرق ${money(reconciliationRecord.difference)} ج` : isAdmin ? 'اضغط لإجراء جرد وتسوية' : 'لم تعتمد تسوية الدورة'}</div>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {isAdmin && (
        <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
          <h2 className="font-bold flex gap-2"><ShieldCheck className="w-5 h-5 text-blue-700" />تسوية واعتماد الرصيد الفعلي</h2>
          <p className="text-xs text-blue-700 mt-1">اختَر خزنة من البطاقات، ثم اكتب الرصيد الفعلي وسبب فرق الجرد. النظام يسجل حركة تسوية ولا يحذف أي أثر قديم.</p>
          <div className="mt-3 grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
            <label className="text-sm">الخزنة<select value={reconciliation.treasury_id} onChange={(event) => setReconciliation({ ...reconciliation, treasury_id: event.target.value })} className="mt-1 w-full rounded-lg border p-2"><option value="">اختر الخزنة</option>{(data.treasuries || []).map((treasury) => <option key={treasury.id} value={treasury.id}>{treasury.branch} — {treasury.account_name || ACCOUNT_LABELS[treasury.account_type]}</option>)}</select></label>
            <label className="text-sm">بداية الدورة<input type="date" value={reconciliation.cycle_start} onChange={(event) => setReconciliation({ ...reconciliation, cycle_start: event.target.value })} className="mt-1 w-full rounded-lg border p-2" /></label>
            <label className="text-sm">الرصيد المحسوب<input readOnly value={selectedTreasury ? money(selectedTreasury.balance) : ''} className="mt-1 w-full rounded-lg border bg-slate-100 p-2" /></label>
            <label className="text-sm">الرصيد الفعلي<input type="number" value={reconciliation.actual_balance} onChange={(event) => setReconciliation({ ...reconciliation, actual_balance: event.target.value })} className="mt-1 w-full rounded-lg border p-2" /></label>
            <label className="text-sm">من قام بالجرد<input value={reconciliation.counted_by_name} onChange={(event) => setReconciliation({ ...reconciliation, counted_by_name: event.target.value })} className="mt-1 w-full rounded-lg border p-2" /></label>
            <label className="text-sm">رقم المرجع<input value={reconciliation.reference_number} onChange={(event) => setReconciliation({ ...reconciliation, reference_number: event.target.value })} className="mt-1 w-full rounded-lg border p-2" placeholder="محضر جرد أو إيصال" /></label>
          </div>
          <textarea value={reconciliation.reason} onChange={(event) => setReconciliation({ ...reconciliation, reason: event.target.value })} className="mt-2 w-full rounded-lg border p-2" placeholder="سبب التسوية أو فرق الجرد *" />
          <button disabled={loading || !reconciliation.treasury_id || reconciliation.actual_balance === '' || reconciliation.reason.trim().length < 3} onClick={saveReconciliation} className="mt-3 rounded-lg bg-blue-700 text-white px-4 py-2 font-bold disabled:opacity-40">اعتماد التسوية</button>
        </section>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="font-bold mb-1 flex gap-2"><PlusCircle className="w-5 h-5 text-teal-600" />حركة يدوية للمدير العام</h2>
          <p className="text-xs text-slate-500 mb-3">كل إضافة أو خصم يحتاج سببًا، ويُسجل باسم المستخدم والوقت والمرجع.</p>
          <div className="grid sm:grid-cols-2 gap-2">
            <label className="text-sm">الفرع<select value={movement.branch} onChange={(event) => setMovement({ ...movement, branch: event.target.value })} className="mt-1 w-full border rounded-lg p-2"><option>دواء الشامي</option><option>دواء شكري</option></select></label>
            <label className="text-sm">الخزنة<select value={movement.account_type} onChange={(event) => setMovement({ ...movement, account_type: event.target.value })} className="mt-1 w-full border rounded-lg p-2">{Object.entries(ACCOUNT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-sm">التاريخ<input type="date" value={movement.transaction_date} onChange={(event) => setMovement({ ...movement, transaction_date: event.target.value })} className="mt-1 w-full border rounded-lg p-2" /></label>
            <label className="text-sm">الحركة<select value={movement.direction} onChange={(event) => setMovement({ ...movement, direction: event.target.value })} className="mt-1 w-full border rounded-lg p-2"><option value="credit">إضافة للخزنة</option><option value="debit">خصم من الخزنة</option></select></label>
            <label className="text-sm">التصنيف<select value={movement.category} onChange={(event) => setMovement({ ...movement, category: event.target.value })} className="mt-1 w-full border rounded-lg p-2"><option value="manual_income">إضافة يدوية</option><option value="salary">مرتبات</option><option value="rent">إيجار</option><option value="supplier_payment">دفعة مورد</option><option value="other_expense">مصروف آخر</option></select></label>
            <label className="text-sm">القيمة<input type="number" min="0" value={movement.amount} onChange={(event) => setMovement({ ...movement, amount: event.target.value })} className="mt-1 w-full border rounded-lg p-2" /></label>
            <label className="text-sm">الطرف المرتبط<input value={movement.counterparty} onChange={(event) => setMovement({ ...movement, counterparty: event.target.value })} className="mt-1 w-full border rounded-lg p-2" /></label>
            <label className="text-sm">رقم المرجع<input value={movement.reference_number} onChange={(event) => setMovement({ ...movement, reference_number: event.target.value })} className="mt-1 w-full border rounded-lg p-2" /></label>
          </div>
          <textarea value={movement.reason} onChange={(event) => setMovement({ ...movement, reason: event.target.value })} className="mt-2 w-full border rounded-lg p-2" placeholder="سبب الحركة بالتفصيل *" />
          <button disabled={loading || !isAdmin || !movement.amount || movement.reason.trim().length < 3} onClick={saveManual} className="mt-3 rounded-lg bg-slate-900 text-white px-4 py-2 font-semibold disabled:opacity-40">تسجيل الحركة</button>
          {!isAdmin && <p className="text-xs text-amber-700 mt-2">الحركات اليدوية متاحة للمدير العام فقط.</p>}
        </section>

        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="font-bold mb-3">تحويل أو عهدة جديدة</h2>
          <div className="grid sm:grid-cols-2 gap-2">
            <label className="text-sm">الفرع<select value={transfer.branch} onChange={(event) => setTransfer({ ...transfer, branch: event.target.value })} className="mt-1 w-full border rounded-lg p-2"><option>دواء الشامي</option><option>دواء شكري</option></select></label>
            <label className="text-sm">النوع<select value={transfer.transfer_type} onChange={(event) => { const value = event.target.value; setTransfer({ ...transfer, transfer_type: value, source_account_type: value === 'instapay' ? 'instapay' : value === 'vodafone_cash' ? 'vodafone_cash' : 'cash' }); }} className="mt-1 w-full border rounded-lg p-2"><option value="instapay">إنستا باي</option><option value="vodafone_cash">فودافون كاش</option><option value="zakaria_internal">تحويل داخلي لفرع زكريا</option><option value="other">أخرى</option></select></label>
            <label className="text-sm">التاريخ<input type="date" value={transfer.transaction_date} onChange={(event) => setTransfer({ ...transfer, transaction_date: event.target.value })} className="mt-1 w-full border rounded-lg p-2" /></label>
            <label className="text-sm">القيمة<input type="number" min="0" value={transfer.amount} onChange={(event) => setTransfer({ ...transfer, amount: event.target.value })} className="mt-1 w-full border rounded-lg p-2" /></label>
          </div>
          <textarea value={transfer.notes} onChange={(event) => setTransfer({ ...transfer, notes: event.target.value })} placeholder="سبب التحويل أو رقم المرجع" className="mt-2 w-full border rounded-lg p-2" />
          <button disabled={loading || !transfer.amount} onClick={() => run(() => treasuryApi.createTransfer({ ...transfer, amount: Number(transfer.amount) }), 'تم تسجيل التحويل كعهدة معلقة.')} className="mt-3 rounded-lg bg-violet-600 text-white px-4 py-2 font-semibold">تسجيل تحويل جديد</button>
        </section>
      </div>

      <section className="rounded-2xl border bg-white shadow-sm overflow-auto">
        <div className="p-4 font-bold">التحويلات والعهد</div>
        <table className="min-w-[1100px] w-full text-sm"><thead className="bg-slate-50"><tr>{['التاريخ', 'الفرع', 'النوع', 'من خزنة', 'القيمة', 'الحالة', 'المنشئ', 'التسليم', 'التسجيل'].map((header) => <th key={header} className="p-3 text-right">{header}</th>)}</tr></thead><tbody>
          {(data.transfers || []).map((item) => <tr key={item.id} className="border-t"><td className="p-3">{item.transaction_date}</td><td className="p-3">{item.branch}</td><td className="p-3">{ACCOUNT_LABELS[item.transfer_type] || item.transfer_type}</td><td className="p-3">{ACCOUNT_LABELS[item.source_account_type] || item.source_account_type || '—'}</td><td className="p-3 font-bold">{money(item.amount)} ج</td><td className="p-3">{item.status === 'pending' ? 'في عهدة الدكتور' : item.status === 'transferred_to_accounts' ? 'بعهدة مدير الحسابات' : item.status === 'posted_to_treasury' ? 'تم التسجيل بالخزنة' : item.status}</td><td className="p-3">{item.created_by_name || '—'}</td><td className="p-3">{item.handed_at ? new Date(item.handed_at).toLocaleString('ar-EG') : '—'}</td><td className="p-3">{item.status === 'pending' && <button onClick={() => run(() => treasuryApi.handoverTransfer(item.id), 'تم نقل المبلغ إلى عهدة مدير الحسابات.')} className="rounded bg-violet-600 text-white px-3 py-1.5 flex gap-1"><Send className="w-4 h-4" />تسليم للحسابات</button>}{item.status === 'transferred_to_accounts' && <button onClick={() => run(() => treasuryApi.postTransfer(item.id, 'cash'), 'تم تسجيل المبلغ في خزنة النقدي.')} className="rounded bg-emerald-600 text-white px-3 py-1.5 flex gap-1"><CheckCircle2 className="w-4 h-4" />تسجيل بالنقدي</button>}{item.status === 'posted_to_treasury' && (item.posted_at ? new Date(item.posted_at).toLocaleString('ar-EG') : 'تم')}</td></tr>)}
        </tbody></table>
      </section>

      <section className="rounded-2xl border bg-white shadow-sm overflow-auto">
        <div className="p-4 font-bold">سجل الحركات المالية</div>
        <table className="min-w-[1150px] w-full text-sm"><thead className="bg-slate-50"><tr>{['التاريخ', 'الفرع', 'الخزنة', 'الحركة', 'التصنيف', 'القيمة', 'السبب', 'المستخدم', 'وقت التسجيل'].map((header) => <th key={header} className="p-3 text-right">{header}</th>)}</tr></thead><tbody>
          {(data.transactions || []).map((item) => <tr key={item.id} className="border-t"><td className="p-3">{item.transaction_date}</td><td className="p-3">{item.branch}</td><td className="p-3">{item.account_name || ACCOUNT_LABELS[item.account_type] || '—'}</td><td className="p-3">{item.direction === 'credit' ? <span className="text-emerald-700 flex gap-1"><ArrowDownCircle className="w-4 h-4" />إضافة</span> : <span className="text-red-700 flex gap-1"><ArrowUpCircle className="w-4 h-4" />خصم</span>}</td><td className="p-3">{CATEGORY_LABELS[item.category] || item.category}</td><td className="p-3 font-bold">{money(item.amount)} ج</td><td className="p-3">{item.description || '—'}</td><td className="p-3">{item.created_by_name || 'النظام'}</td><td className="p-3">{item.created_at ? new Date(item.created_at).toLocaleString('ar-EG') : '—'}</td></tr>)}
        </tbody></table>
      </section>
    </div>
  );
}
