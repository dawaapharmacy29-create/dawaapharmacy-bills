import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeftRight, BrainCircuit, CheckCircle2, ChevronDown, ChevronUp,
  CircleHelp, Clock3, FileSpreadsheet, Files, Filter, RefreshCw, ScanSearch,
  ShieldAlert, ShieldCheck, Sparkles, UserRound, WandSparkles, XCircle, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { parseTransferWorkbook } from '@/lib/branchTransferShadowParser';
import { buildSourcesFromInspections, inspectTransferFile } from '@/lib/branchTransferAutoImport';
import {
  employeeTransferStats, reconcileBranchTransfers, summarizeTransferCases,
  transferBranchLabel, transferErrorRate,
} from '@/lib/branchTransferControl';
import {
  applyLearnedUnitRules, learnUnitRule, removeUnitRule, suggestUnitRule, unitRuleLabel,
} from '@/lib/branchTransferUnitRules';

const STORAGE_KEY = 'dawaa.branch-transfer-control.shadow.v1';

const sourceConfig = {
  shokrySale: { label: 'بيع شكري → الشامي', side: 'sale', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
  shamyPurchase: { label: 'شراء الشامي من شكري', side: 'purchase', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shamySale: { label: 'بيع الشامي → شكري', side: 'sale', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shokryPurchase: { label: 'شراء شكري من الشامي', side: 'purchase', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
};

const typeMeta = {
  sale_without_purchase: { label: 'بيع بدون شراء', short: 'بيع ناقص', tone: 'rose', priority: 100 },
  purchase_without_sale: { label: 'شراء بدون بيع', short: 'شراء بلا مقابل', tone: 'rose', priority: 98 },
  code_mismatch: { label: 'اختلاف كود', short: 'كود مختلف', tone: 'violet', priority: 92 },
  quantity_mismatch: { label: 'فرق كمية', short: 'فرق كمية', tone: 'amber', priority: 82 },
  unit_conversion_review: { label: 'تحويل وحدة', short: 'تحويل وحدة', tone: 'sky', priority: 45 },
  matched: { label: 'مطابق', short: 'مطابق', tone: 'emerald', priority: 0 },
};

const filterDefs = [
  ['all', 'كل القرارات'],
  ['critical', 'الحرج فقط'],
  ['missing', 'بيع/شراء ناقص'],
  ['quantity', 'فروق الكمية'],
  ['code', 'اختلاف الأكواد'],
  ['unit', 'تحويل الوحدة'],
];

function loadLedger() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { decisions: value.decisions || {}, events: Array.isArray(value.events) ? value.events : [], unitRules: value.unitRules || {} };
  } catch {
    return { decisions: {}, events: [], unitRules: {} };
  }
}

function nowIso() { return new Date().toISOString(); }

function matchesFilter(item, filter) {
  if (filter === 'critical') return Number(item.severity || 0) >= 75 || ['sale_without_purchase', 'purchase_without_sale', 'code_mismatch'].includes(item.type);
  if (filter === 'missing') return ['sale_without_purchase', 'purchase_without_sale'].includes(item.type);
  if (filter === 'quantity') return item.type === 'quantity_mismatch';
  if (filter === 'code') return item.type === 'code_mismatch';
  if (filter === 'unit') return item.type === 'unit_conversion_review';
  return true;
}

function caseScore(item) {
  return (typeMeta[item.type]?.priority || 0) + Number(item.severity || 0);
}

function toneClasses(tone) {
  return {
    rose: 'border-rose-200 bg-rose-50 text-rose-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    violet: 'border-violet-200 bg-violet-50 text-violet-800',
    sky: 'border-sky-200 bg-sky-50 text-sky-800',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  }[tone] || 'border-slate-200 bg-slate-50 text-slate-700';
}

function SourceUpload({ sourceKey, source, onFiles }) {
  const config = sourceConfig[sourceKey];
  const loaded = source?.items?.length > 0;
  return <label className={`flex min-h-16 cursor-pointer items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 ${loaded ? 'border-emerald-200 bg-emerald-50/60' : 'border-dashed border-slate-300 bg-white'}`}>
    <div className="min-w-0"><div className="text-xs font-black text-slate-900">{config.label}</div><div className="mt-1 truncate text-[10px] font-bold text-slate-400">{loaded ? `${source.fileNames?.length || 0} ملف · ${source.items?.length || 0} سطر` : 'اختر ملفًا أو أكثر'}</div></div>
    <FileSpreadsheet className={`h-4 w-4 ${loaded ? 'text-emerald-600' : 'text-slate-400'}`} />
    <input className="hidden" type="file" multiple accept=".xlsx,.xls,.csv" onChange={(e) => onFiles(sourceKey, Array.from(e.target.files || []))} />
  </label>;
}

export default function BranchTransferDecisionCommand() {
  const [sources, setSources] = useState({});
  const [ledger, setLedger] = useState(loadLedger);
  const [message, setMessage] = useState('');
  const [autoReport, setAutoReport] = useState({ ambiguous: [], duplicates: [], errors: [] });
  const [isInspecting, setIsInspecting] = useState(false);
  const [sourcePanel, setSourcePanel] = useState(true);
  const [manualPanel, setManualPanel] = useState(false);
  const [view, setView] = useState('now');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger)); }, [ledger]);

  const sales = useMemo(() => Object.entries(sources).flatMap(([key, source]) => sourceConfig[key]?.side === 'sale' ? (source.items || []) : []), [sources]);
  const purchases = useMemo(() => Object.entries(sources).flatMap(([key, source]) => sourceConfig[key]?.side === 'purchase' ? (source.items || []) : []), [sources]);
  const rawCases = useMemo(() => reconcileBranchTransfers(sales, purchases), [sales, purchases]);
  const cases = useMemo(() => applyLearnedUnitRules(rawCases, ledger.unitRules), [rawCases, ledger.unitRules]);
  const summary = useMemo(() => summarizeTransferCases(cases), [cases]);
  const decorated = useMemo(() => cases.map((item) => ({ ...item, decision: ledger.decisions[item.id] })), [cases, ledger.decisions]);
  const actionable = useMemo(() => decorated
    .filter((item) => item.type !== 'matched' && !['dismissed', 'verified'].includes(item.decision?.status))
    .sort((a, b) => caseScore(b) - caseScore(a)), [decorated]);
  const filtered = useMemo(() => actionable.filter((item) => matchesFilter(item, filter)), [actionable, filter]);
  const selected = useMemo(() => filtered.find((item) => item.id === selectedId) || filtered[0] || null, [filtered, selectedId]);
  const followup = useMemo(() => decorated.filter((item) => ['in_progress', 'waiting_verification'].includes(item.decision?.status)), [decorated]);
  const employees = useMemo(() => employeeTransferStats(decorated), [decorated]);
  const loadedFileCount = Object.values(sources).reduce((sum, source) => sum + (source?.fileNames?.length || 0), 0);
  const loadedSourceCount = Object.values(sources).filter((source) => source?.items?.length).length;
  const criticalCount = actionable.filter((item) => matchesFilter(item, 'critical')).length;
  const missingCount = actionable.filter((item) => matchesFilter(item, 'missing')).length;
  const qtyCount = actionable.filter((item) => matchesFilter(item, 'quantity')).length;
  const codeCount = actionable.filter((item) => matchesFilter(item, 'code')).length;
  const unitCount = actionable.filter((item) => matchesFilter(item, 'unit')).length;
  const branchHealth = { shokry: transferErrorRate(decorated, 'shokry'), shamy: transferErrorRate(decorated, 'shamy') };
  const unitSuggestion = selected?.type === 'unit_conversion_review' ? suggestUnitRule(selected) : null;
  const learnedRules = Object.values(ledger.unitRules || {}).filter((rule) => rule?.active);

  const handleAutoFiles = async (files) => {
    if (!files?.length) return;
    setIsInspecting(true); setMessage('');
    try {
      const inspections = [];
      for (const file of files) {
        try { inspections.push(await inspectTransferFile(file)); }
        catch (error) { inspections.push({ fileName: file.name, parsed: { valid: false, warnings: [error?.message || 'تعذر القراءة'] } }); }
      }
      const grouped = buildSourcesFromInspections(inspections);
      setSources(grouped.sources);
      setAutoReport({ ambiguous: grouped.ambiguous, duplicates: grouped.duplicates, errors: grouped.errors });
      const notes = [];
      if (grouped.duplicates.length) notes.push(`تجاهلنا ${grouped.duplicates.length} ملف مكرر.`);
      if (grouped.ambiguous.length) notes.push(`${grouped.ambiguous.length} ملف محتاج تحديد اتجاه.`);
      if (grouped.errors.length) notes.push(`${grouped.errors.length} ملف تعذر قراءته.`);
      setMessage(notes.join(' ')); setSelectedId(''); setFilter('all'); setSourcePanel(false);
    } finally { setIsInspecting(false); }
  };

  const handleFiles = async (sourceKey, files) => {
    if (!files?.length) return;
    const config = sourceConfig[sourceKey]; const results = []; const errors = [];
    for (const file of files) {
      try {
        const result = parseTransferWorkbook(await file.arrayBuffer(), { branch: config.branch, counterparty: config.counterparty });
        if (result.valid) results.push({ ...result, fileName: file.name }); else errors.push(`${file.name}: ${result.warnings.join(' ')}`);
      } catch (error) { errors.push(`${file.name}: ${error?.message || 'تعذر القراءة'}`); }
    }
    const items = results.flatMap((result) => result.items || []);
    setSources((old) => ({ ...old, [sourceKey]: { valid: Boolean(items.length), items, fileNames: results.map((r) => r.fileName), warnings: results.flatMap((r) => r.warnings || []), meta: { files: results.map((r) => ({ fileName: r.fileName, ...r.meta })) } } }));
    setMessage(errors.join(' '));
  };

  const assignAmbiguous = (entry, sourceKey) => {
    const config = sourceConfig[sourceKey];
    const items = (entry.parsed?.items || []).map((item) => ({ ...item, branch: config.branch, counterparty: config.counterparty }));
    setSources((old) => {
      const bucket = old[sourceKey] || { valid: true, items: [], fileNames: [], warnings: [], meta: { files: [] } };
      return { ...old, [sourceKey]: { ...bucket, items: [...bucket.items, ...items], fileNames: [...bucket.fileNames, entry.fileName] } };
    });
    setAutoReport((old) => ({ ...old, ambiguous: old.ambiguous.filter((item) => item !== entry) }));
  };

  const recordDecision = (item, status, action) => {
    if (!item) return;
    const event = { case_id: item.id, action, status, at: nowIso(), type: item.type, from: item.from, to: item.to, product_name: item.product_name };
    setLedger((old) => ({ ...old, decisions: { ...old.decisions, [item.id]: { status, action, updated_at: event.at } }, events: [event, ...old.events].slice(0, 1000) }));
    const index = filtered.findIndex((candidate) => candidate.id === item.id);
    setSelectedId((filtered[index + 1] || filtered[index - 1])?.id || '');
  };

  const approveUnitRule = (item) => {
    const suggestion = suggestUnitRule(item); if (!suggestion) return;
    const at = nowIso();
    setLedger((old) => ({ ...old, unitRules: learnUnitRule(item, old.unitRules || {}), decisions: { ...old.decisions, [item.id]: { status: 'verified', action: `اعتماد تحويل الوحدة: ${unitRuleLabel(suggestion)}`, updated_at: at } } }));
    setSelectedId('');
  };

  const reset = () => { setSources({}); setMessage(''); setSelectedId(''); setFilter('all'); setSourcePanel(true); setAutoReport({ ambiguous: [], duplicates: [], errors: [] }); };

  const decisionHeadline = !loadedFileCount ? 'ارفع الملفات أولًا' : !actionable.length ? 'لا يوجد قرار مطلوب الآن' : criticalCount ? `${criticalCount} حالة حرجة تبدأ بها الآن` : `${actionable.length} حالة تحتاج قرار`;
  const nextAction = !selected ? 'لا يوجد إجراء مطلوب' : selected.next_action || typeMeta[selected.type]?.label;

  return <div dir="rtl" className="min-h-full bg-slate-50/80"><div className="mx-auto w-full max-w-[1480px] space-y-3 px-3 py-3 sm:px-5">
    <Card className="overflow-hidden border-0 bg-gradient-to-l from-slate-950 via-slate-900 to-teal-950 text-white shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
        <div><div className="flex items-center gap-2 text-[11px] font-black text-teal-300"><Sparkles className="h-4 w-4" /> مركز القرار السريع</div><h1 className="mt-1 text-xl font-black sm:text-2xl">تحويلات شكري ↔ الشامي</h1><div className="mt-1 text-xs font-bold text-slate-300">النظام يخفي السليم ويطلع لك المشكلة والقرار مباشرة.</div></div>
        <div className="flex items-center gap-2"><div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-center"><div className="text-[9px] font-bold text-slate-400">الملفات</div><div className="text-lg font-black">{loadedFileCount}</div></div><Button size="sm" variant="secondary" onClick={() => setSourcePanel((v) => !v)} className="font-black">{sourcePanel ? 'إخفاء الملفات' : 'الملفات'}</Button><Button size="sm" variant="outline" onClick={reset} className="border-white/20 bg-transparent font-black text-white hover:bg-white/10 hover:text-white"><RefreshCw className="ml-1 h-4 w-4" /> مسح</Button></div>
      </div>
    </Card>

    {sourcePanel && <Card className="border-slate-200 p-3 shadow-sm">
      <label className="flex min-h-24 cursor-pointer items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-teal-300 bg-teal-50/50 px-4 py-4 text-center hover:border-teal-500">
        <Files className="h-7 w-7 text-teal-700" /><div><div className="font-black text-slate-950">ارفع كل ملفات اليوم مرة واحدة</div><div className="mt-1 text-xs font-bold text-slate-500">أي عدد ملفات، والنظام يصنف ويجمع ملفات نفس الاتجاه تلقائيًا.</div></div><span className="rounded-full bg-teal-700 px-3 py-1.5 text-xs font-black text-white">{isInspecting ? 'جاري التحليل...' : 'اختيار الملفات'}</span>
        <input className="hidden" type="file" multiple accept=".xlsx,.xls,.csv" disabled={isInspecting} onChange={(e) => handleAutoFiles(Array.from(e.target.files || []))} />
      </label>
      {loadedFileCount > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(sourceConfig).map(([key, config]) => <div key={key} className={`rounded-xl border px-3 py-2 ${sources[key]?.fileNames?.length ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}><div className="text-[11px] font-black text-slate-800">{config.label}</div><div className="mt-1 text-sm font-black text-emerald-700">{sources[key]?.fileNames?.length || 0} ملف</div></div>)}</div>}
      {autoReport.ambiguous.length > 0 && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="flex items-center gap-2 text-xs font-black text-amber-900"><CircleHelp className="h-4 w-4" /> ملفات لم نحسم اتجاهها</div>{autoReport.ambiguous.map((entry) => <div key={entry.fileName} className="mt-2 rounded-xl bg-white p-2"><div className="text-xs font-black">{entry.fileName}</div><div className="mt-2 flex flex-wrap gap-1">{Object.entries(sourceConfig).map(([key, config]) => <Button key={key} size="sm" variant="outline" onClick={() => assignAmbiguous(entry, key)} className="h-7 text-[10px] font-black">{config.label}</Button>)}</div></div>)}</div>}
      {message && <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{message}</div>}
      <button onClick={() => setManualPanel((v) => !v)} className="mt-3 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-black text-slate-500"><span>تحديد يدوي متقدم</span>{manualPanel ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
      {manualPanel && <div className="mt-2 grid gap-2 md:grid-cols-2">{Object.keys(sourceConfig).map((key) => <SourceUpload key={key} sourceKey={key} source={sources[key]} onFiles={handleFiles} />)}</div>}
    </Card>}

    {loadedFileCount > 0 && <Card className={`border-2 p-3.5 shadow-sm ${criticalCount ? 'border-rose-300 bg-rose-50/70' : actionable.length ? 'border-amber-300 bg-amber-50/70' : 'border-emerald-300 bg-emerald-50/70'}`}>
      <div className="grid gap-3 lg:grid-cols-[1.35fr_.65fr] lg:items-center"><div><div className="text-[10px] font-black text-slate-500">الخلاصة في ثواني</div><div className="mt-1 text-xl font-black text-slate-950">{decisionHeadline}</div><div className="mt-1 text-xs font-bold text-slate-600">{actionable.length ? `أول قرار مقترح: ${nextAction}` : `${summary.matched || 0} حركة مطابقة — لا تحتاج تدخل.`}</div></div><div className="grid grid-cols-4 gap-1.5 text-center"><div className="rounded-xl bg-white px-2 py-2"><div className="text-[9px] font-bold text-slate-400">حرج</div><div className="text-xl font-black text-rose-700">{criticalCount}</div></div><div className="rounded-xl bg-white px-2 py-2"><div className="text-[9px] font-bold text-slate-400">ناقص</div><div className="text-xl font-black text-rose-700">{missingCount}</div></div><div className="rounded-xl bg-white px-2 py-2"><div className="text-[9px] font-bold text-slate-400">كمية</div><div className="text-xl font-black text-amber-700">{qtyCount}</div></div><div className="rounded-xl bg-white px-2 py-2"><div className="text-[9px] font-bold text-slate-400">كود</div><div className="text-xl font-black text-violet-700">{codeCount}</div></div></div></div>
    </Card>}

    <div className="sticky top-2 z-30 space-y-2 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">{[['now', `قرار الآن ${actionable.length ? `(${actionable.length})` : ''}`], ['followup', `متابعة ${followup.length ? `(${followup.length})` : ''}`], ['intel', 'الذكاء']].map(([key, label]) => <button key={key} onClick={() => setView(key)} className={`rounded-lg px-3 py-2 text-xs font-black ${view === key ? 'bg-white text-teal-800 shadow-sm' : 'text-slate-500'}`}>{label}</button>)}</div>
      {view === 'now' && actionable.length > 0 && <div className="flex gap-1.5 overflow-x-auto pb-0.5"><Filter className="mt-1.5 h-4 w-4 shrink-0 text-slate-400" />{filterDefs.map(([key, label]) => { const count = key === 'all' ? actionable.length : actionable.filter((i) => matchesFilter(i, key)).length; return <button key={key} onClick={() => { setFilter(key); setSelectedId(''); }} className={`shrink-0 rounded-full border px-2.5 py-1.5 text-[10px] font-black ${filter === key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{label} · {count}</button>; })}</div>}
    </div>

    {view === 'now' && <div className="grid gap-3 lg:grid-cols-[330px_1fr]">
      {actionable.length > 0 && <Card className="order-2 max-h-[660px] overflow-auto border-slate-200 p-2 shadow-sm lg:order-1"><div className="px-2 py-1 text-[10px] font-black text-slate-400">مرتبة تلقائيًا حسب الأهمية</div><div className="space-y-1.5">{filtered.map((item, index) => { const meta = typeMeta[item.type] || typeMeta.quantity_mismatch; const active = selected?.id === item.id; return <button key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full rounded-xl border p-2.5 text-right transition ${active ? 'border-slate-900 bg-slate-900 text-white shadow-md' : 'border-slate-200 bg-white hover:border-slate-300'}`}><div className="flex items-center justify-between gap-2"><span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${active ? 'border-white/20 bg-white/10 text-white' : toneClasses(meta.tone)}`}>{meta.short}</span><span className={`text-[9px] font-black ${active ? 'text-slate-300' : 'text-slate-400'}`}>#{index + 1} · خطورة {item.severity || 0}</span></div><div className="mt-1.5 truncate text-xs font-black">{item.product_name}</div><div className={`mt-1 text-[9px] font-bold ${active ? 'text-slate-300' : 'text-slate-400'}`}>{transferBranchLabel(item.from)} → {transferBranchLabel(item.to)}</div></button>; })}</div></Card>}

      <div className="order-1 lg:order-2">{!loadedFileCount ? <Card className="flex min-h-64 flex-col items-center justify-center border-dashed border-teal-200 p-6 text-center"><BrainCircuit className="h-9 w-9 text-teal-600" /><div className="mt-3 font-black">ارفع الملفات، والباقي علينا</div><div className="mt-1 text-xs font-bold text-slate-500">المطابق سيختفي، والمشاكل ستظهر مرتبة بالخطورة.</div></Card> : !selected ? <Card className="flex min-h-56 flex-col items-center justify-center border-emerald-200 bg-emerald-50 p-6 text-center"><CheckCircle2 className="h-9 w-9 text-emerald-600" /><div className="mt-3 text-lg font-black">الدنيا سليمة</div><div className="mt-1 text-xs font-bold text-slate-500">لا توجد حالة ضمن الفلتر الحالي تحتاج قرارًا.</div></Card> : <Card className="overflow-hidden border-slate-300 shadow-xl shadow-slate-900/5"><div className={`h-1.5 ${selected.type === 'unit_conversion_review' ? 'bg-sky-500' : selected.type === 'quantity_mismatch' ? 'bg-amber-500' : selected.type === 'code_mismatch' ? 'bg-violet-500' : 'bg-rose-500'}`} /><div className="border-b border-slate-100 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className={`rounded-full border px-2 py-1 text-[10px] font-black ${toneClasses(typeMeta[selected.type]?.tone)}`}>{typeMeta[selected.type]?.label}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">خطورة {selected.severity || 0}/100</span></div><h2 className="mt-2 text-xl font-black text-slate-950 sm:text-2xl">{selected.product_name}</h2><div className="mt-1 flex items-center gap-2 text-xs font-black text-slate-500"><ArrowLeftRight className="h-4 w-4 text-teal-600" />{transferBranchLabel(selected.from)} → {transferBranchLabel(selected.to)} · {selected.day_key}</div></div><div className="rounded-xl bg-slate-100 px-3 py-2 text-center"><div className="text-[9px] font-black text-slate-400">ضمن الفلتر</div><div className="text-sm font-black">{filtered.findIndex((i) => i.id === selected.id) + 1} / {filtered.length}</div></div></div></div>
        <div className="space-y-3 p-4"><div className="rounded-2xl border-2 border-teal-300 bg-teal-50 p-4"><div className="flex items-center gap-2 text-[11px] font-black text-teal-800"><Zap className="h-4 w-4" /> القرار المقترح الآن</div><div className="mt-1 text-lg font-black leading-7 text-slate-950">{nextAction}</div></div><div className="grid gap-2 sm:grid-cols-2"><div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="text-[10px] font-black text-slate-400">بيع المرسل</div><div className="mt-1 text-2xl font-black">{selected.sale_qty}</div><div className="mt-1 text-[10px] font-bold text-slate-500">{selected.sale_units?.join('، ') || 'بدون وحدة'} · كود {selected.sale_codes?.join('، ') || '—'}</div></div><div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="text-[10px] font-black text-slate-400">شراء المستلم</div><div className="mt-1 text-2xl font-black">{selected.purchase_qty}</div><div className="mt-1 text-[10px] font-bold text-slate-500">{selected.purchase_units?.join('، ') || 'بدون وحدة'} · كود {selected.purchase_codes?.join('، ') || '—'}</div></div></div>{selected.identity_diagnosis && <div className={`rounded-xl border p-3 ${selected.identity_diagnosis.risk === 'high' ? 'border-rose-200 bg-rose-50' : 'border-violet-200 bg-violet-50'}`}><div className="flex items-center gap-2 text-xs font-black"><ScanSearch className="h-4 w-4" /> {selected.identity_diagnosis.label}</div><div className="mt-1 text-xs font-bold leading-5 text-slate-700">{selected.identity_diagnosis.diagnosis}</div></div>}
        <div className="sticky bottom-2 z-20 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white/95 p-2.5 shadow-xl backdrop-blur">{unitSuggestion ? <Button onClick={() => approveUnitRule(selected)} className="flex-1 gap-2 bg-sky-600 font-black hover:bg-sky-700"><WandSparkles className="h-4 w-4" /> اعتماد التحويل</Button> : <Button onClick={() => recordDecision(selected, 'waiting_verification', 'تم التنفيذ - ينتظر التحقق')} className="flex-1 gap-2 bg-teal-700 font-black hover:bg-teal-800"><ShieldCheck className="h-4 w-4" /> تم التنفيذ</Button>}<Button variant="outline" onClick={() => recordDecision(selected, 'in_progress', 'بدأت المراجعة')} className="font-black">مراجعة</Button><Button variant="outline" onClick={() => recordDecision(selected, 'dismissed', 'ليست مشكلة بعد المراجعة')} className="font-black">ليست مشكلة</Button></div></div></Card>}</div>
    </div>}

    {view === 'followup' && <Card className="border-slate-200 p-4"><div className="flex items-center gap-2 text-sm font-black"><Clock3 className="h-4 w-4 text-sky-600" /> المتابعة بعد القرار</div><div className="mt-3 space-y-2">{followup.length ? followup.slice(0, 20).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3"><div><div className="text-sm font-black">{item.product_name}</div><div className="text-[10px] font-bold text-slate-400">{typeMeta[item.type]?.label} · {item.decision?.action}</div></div><Button size="sm" variant="outline" onClick={() => { setView('now'); setFilter('all'); setSelectedId(item.id); }} className="font-black">فتح</Button></div>) : <div className="rounded-xl bg-slate-50 p-6 text-center text-sm font-bold text-slate-500">لا توجد متابعة معلقة.</div>}</div></Card>}

    {view === 'intel' && <div className="grid gap-3 lg:grid-cols-3"><Card className="p-4"><div className="flex items-center gap-2 text-sm font-black"><ShieldAlert className="h-4 w-4 text-rose-600" /> صحة الفروع</div><div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] font-black text-slate-400">شكري</div><div className="text-2xl font-black">{branchHealth.shokry}%</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] font-black text-slate-400">الشامي</div><div className="text-2xl font-black">{branchHealth.shamy}%</div></div></div></Card><Card className="p-4"><div className="flex items-center gap-2 text-sm font-black"><UserRound className="h-4 w-4 text-violet-600" /> تكرار حسب الموظف</div><div className="mt-3 space-y-1">{employees.slice(0, 6).map((employee) => <div key={employee.name} className="flex justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs"><span className="font-bold">{employee.name}</span><span className="font-black">{employee.cases}</span></div>)}</div></Card><Card className="p-4"><div className="flex items-center gap-2 text-sm font-black"><WandSparkles className="h-4 w-4 text-sky-600" /> قواعد الوحدة</div><div className="mt-3 space-y-1">{learnedRules.slice(0, 6).map((rule) => <div key={rule.key} className="flex items-center justify-between gap-2 rounded-xl bg-sky-50 px-3 py-2"><div className="min-w-0"><div className="truncate text-xs font-black">{rule.product_name}</div><div className="text-[9px] font-bold text-slate-500">{unitRuleLabel(rule)}</div></div><Button size="sm" variant="ghost" onClick={() => setLedger((old) => ({ ...old, unitRules: removeUnitRule(old.unitRules || {}, rule.key) }))} className="h-7 text-rose-600"><XCircle className="h-4 w-4" /></Button></div>)}</div></Card></div>}

    <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-900"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> القرارات وقواعد التعلم ما زالت محلية داخل المتصفح في نسخة الاختبار، ولا توجد كتابة على بيانات الإنتاج.</div>
  </div></div>;
}
