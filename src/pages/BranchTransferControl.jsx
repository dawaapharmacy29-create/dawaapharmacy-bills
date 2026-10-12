import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, BrainCircuit, CheckCircle2, ChevronDown, ChevronUp, Clock3, FileSpreadsheet, RefreshCw, ShieldAlert, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { parseTransferWorkbook } from '@/lib/branchTransferShadowParser';
import { employeeTransferStats, reconcileBranchTransfers, summarizeTransferCases, transferBranchLabel, transferErrorRate } from '@/lib/branchTransferControl';

const STORAGE_KEY = 'dawaa.branch-transfer-control.shadow.v1';

const sourceConfig = {
  shokrySale: { label: 'بيع شكري → الشامي', side: 'sale', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
  shamyPurchase: { label: 'شراء الشامي من شكري', side: 'purchase', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shamySale: { label: 'بيع الشامي → شكري', side: 'sale', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shokryPurchase: { label: 'شراء شكري من الشامي', side: 'purchase', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
};

const typeMeta = {
  sale_without_purchase: { label: 'بيع بدون شراء', tone: 'border-rose-200 bg-rose-50 text-rose-800' },
  purchase_without_sale: { label: 'شراء بدون بيع', tone: 'border-rose-200 bg-rose-50 text-rose-800' },
  quantity_mismatch: { label: 'فرق كمية', tone: 'border-amber-200 bg-amber-50 text-amber-800' },
  code_mismatch: { label: 'اختلاف كود', tone: 'border-violet-200 bg-violet-50 text-violet-800' },
  matched: { label: 'مطابق', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
};

function loadLedger() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { decisions: value.decisions || {}, events: Array.isArray(value.events) ? value.events : [] };
  } catch {
    return { decisions: {}, events: [] };
  }
}

function nowIso() {
  return new Date().toISOString();
}

function todayKey() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function CaseBadge({ item }) {
  const meta = typeMeta[item.type] || typeMeta.quantity_mismatch;
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${meta.tone}`}>{meta.label}</span>;
}

function SourceUpload({ sourceKey, source, onFile }) {
  const config = sourceConfig[sourceKey];
  return <label className="group flex min-h-20 cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 transition hover:border-teal-400 hover:bg-teal-50/40">
    <div className="min-w-0">
      <div className="text-sm font-black text-slate-800">{config.label}</div>
      <div className="mt-1 truncate text-xs font-bold text-slate-400">{source?.fileName || 'اختر ملف تفاصيل الأصناف'}</div>
      {source?.items?.length > 0 && <div className="mt-1 text-[11px] font-black text-emerald-700">{source.items.length} سطر جاهز</div>}
    </div>
    <FileSpreadsheet className="h-5 w-5 shrink-0 text-slate-400 group-hover:text-teal-600" />
    <input className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => onFile(sourceKey, event.target.files?.[0])} />
  </label>;
}

export default function BranchTransferControl() {
  const [sources, setSources] = useState({});
  const [sourcePanel, setSourcePanel] = useState(true);
  const [activeView, setActiveView] = useState('now');
  const [selectedId, setSelectedId] = useState('');
  const [ledger, setLedger] = useState(loadLedger);
  const [message, setMessage] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
  }, [ledger]);

  const sales = useMemo(() => Object.entries(sources).flatMap(([key, source]) => sourceConfig[key]?.side === 'sale' ? (source.items || []) : []), [sources]);
  const purchases = useMemo(() => Object.entries(sources).flatMap(([key, source]) => sourceConfig[key]?.side === 'purchase' ? (source.items || []) : []), [sources]);
  const cases = useMemo(() => reconcileBranchTransfers(sales, purchases), [sales, purchases]);
  const summary = useMemo(() => summarizeTransferCases(cases), [cases]);

  const decoratedCases = useMemo(() => cases.map((item) => {
    const decision = ledger.decisions[item.id];
    const autoVerified = item.type === 'matched' && decision?.status === 'waiting_verification';
    return { ...item, decision: autoVerified ? { ...decision, status: 'verified' } : decision };
  }), [cases, ledger.decisions]);

  const actionable = useMemo(() => decoratedCases.filter((item) => item.type !== 'matched' && !['dismissed', 'verified'].includes(item.decision?.status)), [decoratedCases]);
  const followup = useMemo(() => decoratedCases.filter((item) => ['in_progress', 'waiting_verification'].includes(item.decision?.status)), [decoratedCases]);
  const selected = useMemo(() => actionable.find((item) => item.id === selectedId) || actionable[0] || null, [actionable, selectedId]);
  const employees = useMemo(() => employeeTransferStats(decoratedCases), [decoratedCases]);
  const resolvedCount = Object.values(ledger.decisions).filter((decision) => ['verified', 'dismissed'].includes(decision.status)).length;

  const handleFile = async (sourceKey, file) => {
    if (!file) return;
    const config = sourceConfig[sourceKey];
    try {
      const result = parseTransferWorkbook(await file.arrayBuffer(), {
        branch: config.branch,
        counterparty: config.counterparty,
        date: todayKey(),
      });
      setSources((old) => ({ ...old, [sourceKey]: { ...result, fileName: file.name } }));
      setMessage(result.valid ? '' : result.warnings.join(' '));
    } catch (error) {
      setMessage(`تعذر قراءة ${file.name}: ${error?.message || 'خطأ غير معروف'}`);
    }
  };

  const recordDecision = (item, status, action) => {
    if (!item) return;
    const event = { case_id: item.id, action, status, at: nowIso(), type: item.type, from: item.from, to: item.to, product_name: item.product_name };
    setLedger((old) => ({
      decisions: { ...old.decisions, [item.id]: { status, action, updated_at: event.at } },
      events: [event, ...old.events].slice(0, 1000),
    }));
    const index = actionable.findIndex((candidate) => candidate.id === item.id);
    const next = actionable[index + 1] || actionable[index - 1];
    setSelectedId(next?.id || '');
  };

  const resetShadow = () => {
    setSources({});
    setSelectedId('');
    setMessage('');
  };

  const branchHealth = {
    shokry: transferErrorRate(decoratedCases, 'shokry'),
    shamy: transferErrorRate(decoratedCases, 'shamy'),
  };

  const nextType = actionable[0]?.type;
  const mostRepeatedEmployee = employees[0];

  return <div dir="rtl" className="mx-auto w-full max-w-6xl space-y-4 px-3 py-4 sm:px-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 text-xs font-black text-teal-700"><ArrowLeftRight className="h-4 w-4" /> Shadow Control</div>
        <h1 className="mt-1 text-xl font-black text-slate-950 sm:text-2xl">تحويلات الفروع</h1>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setSourcePanel((value) => !value)} className="gap-2 font-black">
          البيانات {sourcePanel ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
        <Button variant="outline" size="sm" onClick={resetShadow} className="gap-2 font-black"><RefreshCw className="h-4 w-4" /> إعادة</Button>
      </div>
    </div>

    {sourcePanel && <Card className="border-slate-200 p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-black text-slate-900">مصادر المطابقة</div>
          <div className="text-xs font-bold text-slate-400">نسخة تجريبية: قراءة فقط، ولا تعدّل B-Connect أو الأرصدة.</div>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600">4 ملفات كحد أقصى</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {Object.keys(sourceConfig).map((key) => <SourceUpload key={key} sourceKey={key} source={sources[key]} onFile={handleFile} />)}
      </div>
      {message && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{message}</div>}
    </Card>}

    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Card className="p-3 shadow-sm"><div className="text-[11px] font-black text-slate-400">حرج</div><div className="mt-1 text-2xl font-black text-rose-700">{summary.critical}</div></Card>
      <Card className="p-3 shadow-sm"><div className="text-[11px] font-black text-slate-400">قرار الآن</div><div className="mt-1 text-2xl font-black text-amber-700">{actionable.length}</div></Card>
      <Card className="p-3 shadow-sm"><div className="text-[11px] font-black text-slate-400">متابعة</div><div className="mt-1 text-2xl font-black text-sky-700">{followup.length}</div></Card>
      <Card className="p-3 shadow-sm"><div className="text-[11px] font-black text-slate-400">مطابق</div><div className="mt-1 text-2xl font-black text-emerald-700">{summary.matched}</div></Card>
    </div>

    <div className="flex gap-1 rounded-2xl bg-slate-100 p-1">
      {[['now', 'الآن'], ['followup', 'المتابعة'], ['intel', 'الذكاء']].map(([key, label]) => <button key={key} onClick={() => setActiveView(key)} className={`flex-1 rounded-xl px-3 py-2 text-sm font-black transition ${activeView === key ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}>{label}</button>)}
    </div>

    {activeView === 'now' && <div className="space-y-3">
      {!sales.length && !purchases.length ? <Card className="flex min-h-56 flex-col items-center justify-center p-6 text-center shadow-sm">
        <BrainCircuit className="h-9 w-9 text-teal-600" />
        <div className="mt-3 text-lg font-black text-slate-900">ارفع تفاصيل التحويلات وابدأ بالاستثناءات فقط</div>
        <div className="mt-1 max-w-xl text-sm font-bold text-slate-500">لن نعرض كل الحركات. المحرك يخفي المطابق ويعطيك أهم قرار تالٍ حسب الخطورة.</div>
      </Card> : !selected ? <Card className="flex min-h-48 flex-col items-center justify-center p-6 text-center shadow-sm">
        <CheckCircle2 className="h-9 w-9 text-emerald-600" />
        <div className="mt-3 text-lg font-black text-slate-900">لا توجد حالة تحتاج قرارًا الآن</div>
        <div className="mt-1 text-sm font-bold text-slate-500">الحركات الحالية إما مطابقة أو تم اتخاذ قرار بشأنها.</div>
      </Card> : <Card className="overflow-hidden border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/70 p-4">
          <div>
            <div className="flex flex-wrap items-center gap-2"><CaseBadge item={selected} /><span className="text-xs font-black text-slate-400">خطورة {selected.severity}/100</span></div>
            <div className="mt-2 text-xl font-black text-slate-950">{selected.product_name}</div>
            <div className="mt-1 text-sm font-bold text-slate-500">{transferBranchLabel(selected.from)} ← {transferBranchLabel(selected.to)} · {selected.day_key}</div>
          </div>
          <div className="text-left text-xs font-black text-slate-400">{actionable.findIndex((item) => item.id === selected.id) + 1} / {actionable.length}</div>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_1.3fr]">
          <div className="rounded-2xl bg-slate-50 p-3"><div className="text-[11px] font-black text-slate-400">بيع المرسل</div><div className="mt-1 text-2xl font-black text-slate-950">{selected.sale_qty}</div><div className="mt-1 text-xs font-bold text-slate-500">{selected.sale_codes.join('، ') || 'بدون كود'}</div></div>
          <div className="rounded-2xl bg-slate-50 p-3"><div className="text-[11px] font-black text-slate-400">شراء المستلم</div><div className="mt-1 text-2xl font-black text-slate-950">{selected.purchase_qty}</div><div className="mt-1 text-xs font-bold text-slate-500">{selected.purchase_codes.join('، ') || 'بدون كود'}</div></div>
          <div className="rounded-2xl border border-teal-100 bg-teal-50 p-3"><div className="text-[11px] font-black text-teal-700">الخطوة التالية</div><div className="mt-1 text-sm font-black leading-6 text-slate-900">{selected.next_action}</div></div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-slate-100 p-4">
          <Button onClick={() => recordDecision(selected, 'waiting_verification', 'تم التنفيذ - ينتظر التحقق')} className="font-black">تم التنفيذ</Button>
          <Button variant="outline" onClick={() => recordDecision(selected, 'in_progress', 'بدأت المراجعة')} className="font-black">جاري المراجعة</Button>
          <Button variant="outline" onClick={() => recordDecision(selected, 'dismissed', 'ليست مشكلة بعد المراجعة')} className="font-black">ليست مشكلة</Button>
          <Button variant="ghost" onClick={() => { const index = actionable.findIndex((item) => item.id === selected.id); const next = actionable[index + 1] || actionable[0]; setSelectedId(next?.id || ''); }} className="font-black text-slate-500">تخطي</Button>
        </div>
      </Card>}
    </div>}

    {activeView === 'followup' && <Card className="p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-sm font-black text-slate-900"><Clock3 className="h-4 w-4 text-sky-600" /> حالات اتخذنا فيها قرار ولسه تحتاج تحقق</div>
      {!followup.length ? <div className="rounded-xl bg-slate-50 p-5 text-center text-sm font-bold text-slate-500">لا توجد متابعة معلقة.</div> : <div className="divide-y divide-slate-100">
        {followup.slice(0, 12).map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div><div className="font-black text-slate-900">{item.product_name}</div><div className="text-xs font-bold text-slate-400">{typeMeta[item.type]?.label} · {item.decision?.action}</div></div>
          <Button size="sm" variant="outline" onClick={() => { setActiveView('now'); setSelectedId(item.id); }} className="font-black">فتح</Button>
        </div>)}
      </div>}
    </Card>}

    {activeView === 'intel' && <div className="grid gap-3 lg:grid-cols-2">
      <Card className="p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-black text-slate-900"><ShieldAlert className="h-4 w-4 text-rose-600" /> صحة الفروع</div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-slate-50 p-3"><div className="text-xs font-black text-slate-500">شكري</div><div className="mt-1 text-2xl font-black text-slate-950">{branchHealth.shokry}%</div><div className="text-[11px] font-bold text-slate-400">معدل حالات غير مطابقة</div></div>
          <div className="rounded-2xl bg-slate-50 p-3"><div className="text-xs font-black text-slate-500">الشامي</div><div className="mt-1 text-2xl font-black text-slate-950">{branchHealth.shamy}%</div><div className="text-[11px] font-bold text-slate-400">معدل حالات غير مطابقة</div></div>
        </div>
        <div className="mt-3 rounded-2xl border border-slate-100 p-3 text-sm font-bold text-slate-600">
          أكثر مشكلة الآن: <span className="font-black text-slate-950">{nextType ? typeMeta[nextType]?.label : 'لا يوجد'}</span> · تم إغلاق/استبعاد <span className="font-black text-slate-950">{resolvedCount}</span> حالة في سجل التجربة.
        </div>
      </Card>
      <Card className="p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-black text-slate-900"><UserRound className="h-4 w-4 text-violet-600" /> تكرار الموظفين</div>
        {!mostRepeatedEmployee ? <div className="mt-4 rounded-xl bg-slate-50 p-5 text-center text-sm font-bold text-slate-500">لا توجد أخطاء مرتبطة بموظفين في الملفات الحالية.</div> : <>
          <div className="mt-4 rounded-2xl bg-violet-50 p-3"><div className="text-xs font-black text-violet-700">الأكثر تكرارًا في الحالات الحالية</div><div className="mt-1 text-lg font-black text-slate-950">{mostRepeatedEmployee.name}</div><div className="mt-1 text-xs font-bold text-slate-500">{mostRepeatedEmployee.cases} حالة · بيع {mostRepeatedEmployee.sale_cases} · شراء {mostRepeatedEmployee.purchase_cases}</div></div>
          <div className="mt-2 space-y-1">{employees.slice(1, 5).map((employee) => <div key={employee.name} className="flex items-center justify-between rounded-xl px-2 py-2 text-sm"><span className="font-bold text-slate-700">{employee.name}</span><span className="font-black text-slate-950">{employee.cases}</span></div>)}</div>
        </>}
      </Card>
    </div>}

    <div className="flex items-center gap-2 px-1 text-[11px] font-bold text-slate-400"><AlertTriangle className="h-3.5 w-3.5" /> سجل القرارات في هذه النسخة محفوظ محليًا داخل المتصفح للاختبار فقط؛ لا توجد كتابة على بيانات الإنتاج.</div>
  </div>;
}
