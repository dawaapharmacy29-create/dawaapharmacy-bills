import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeftRight, BrainCircuit, CheckCircle2, ChevronDown, ChevronUp,
  Clock3, FileSpreadsheet, RefreshCw, ShieldAlert, Sparkles, UserRound, WandSparkles,
  XCircle, Zap, UploadCloud, ShieldCheck, ScanSearch, Files, CircleHelp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { parseTransferWorkbook } from '@/lib/branchTransferShadowParser';
import { buildSourcesFromInspections, inspectTransferFile } from '@/lib/branchTransferAutoImport';
import { employeeTransferStats, reconcileBranchTransfers, summarizeTransferCases, transferBranchLabel, transferErrorRate } from '@/lib/branchTransferControl';
import { applyLearnedUnitRules, learnUnitRule, removeUnitRule, suggestUnitRule, unitRuleLabel } from '@/lib/branchTransferUnitRules';

const STORAGE_KEY = 'dawaa.branch-transfer-control.shadow.v1';

const sourceConfig = {
  shokrySale: { label: 'بيع شكري → الشامي', short: 'بيع شكري', side: 'sale', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
  shamyPurchase: { label: 'شراء الشامي من شكري', short: 'شراء الشامي', side: 'purchase', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shamySale: { label: 'بيع الشامي → شكري', short: 'بيع الشامي', side: 'sale', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shokryPurchase: { label: 'شراء شكري من الشامي', short: 'شراء شكري', side: 'purchase', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
};

const typeMeta = {
  sale_without_purchase: { label: 'بيع بدون شراء', tone: 'border-rose-200 bg-rose-50 text-rose-800', accent: 'bg-rose-500' },
  purchase_without_sale: { label: 'شراء بدون بيع', tone: 'border-rose-200 bg-rose-50 text-rose-800', accent: 'bg-rose-500' },
  quantity_mismatch: { label: 'فرق كمية', tone: 'border-amber-200 bg-amber-50 text-amber-800', accent: 'bg-amber-500' },
  unit_conversion_review: { label: 'تحويل وحدة', tone: 'border-sky-200 bg-sky-50 text-sky-800', accent: 'bg-sky-500' },
  code_mismatch: { label: 'اختلاف كود', tone: 'border-violet-200 bg-violet-50 text-violet-800', accent: 'bg-violet-500' },
  matched: { label: 'مطابق', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800', accent: 'bg-emerald-500' },
};

function loadLedger() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { decisions: value.decisions || {}, events: Array.isArray(value.events) ? value.events : [], unitRules: value.unitRules || {} };
  } catch {
    return { decisions: {}, events: [], unitRules: {} };
  }
}

function nowIso() { return new Date().toISOString(); }

function CaseBadge({ item }) {
  const meta = typeMeta[item.type] || typeMeta.quantity_mismatch;
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${meta.tone}`}>{meta.label}</span>;
}

function StatCard({ label, value, hint, tone = 'slate' }) {
  const tones = {
    rose: 'border-rose-100 bg-gradient-to-br from-white to-rose-50 text-rose-700',
    amber: 'border-amber-100 bg-gradient-to-br from-white to-amber-50 text-amber-700',
    sky: 'border-sky-100 bg-gradient-to-br from-white to-sky-50 text-sky-700',
    emerald: 'border-emerald-100 bg-gradient-to-br from-white to-emerald-50 text-emerald-700',
    slate: 'border-slate-100 bg-white text-slate-800',
  };
  return <Card className={`border p-3.5 shadow-sm ${tones[tone]}`}><div className="text-[11px] font-black text-slate-500">{label}</div><div className="mt-1 text-2xl font-black">{value}</div>{hint && <div className="mt-0.5 text-[10px] font-bold text-slate-400">{hint}</div>}</Card>;
}

function SourceUpload({ sourceKey, source, onFiles }) {
  const config = sourceConfig[sourceKey];
  const loaded = source?.items?.length > 0;
  const fileLabel = source?.fileNames?.length ? source.fileNames.join(' + ') : 'اختر ملفًا أو أكثر';
  return <label className={`group relative flex min-h-20 cursor-pointer items-center justify-between gap-3 overflow-hidden rounded-2xl border px-4 py-3 transition ${loaded ? 'border-emerald-200 bg-emerald-50/60' : 'border-dashed border-slate-300 bg-white hover:border-teal-400 hover:bg-teal-50/40'}`}>
    <div className="min-w-0"><div className="text-sm font-black text-slate-900">{config.label}</div><div className="mt-1 truncate text-xs font-bold text-slate-400">{fileLabel}</div>{loaded && <div className="mt-1 text-[10px] font-black text-emerald-700">{source.fileNames.length} ملف · {source.items.length} سطر</div>}</div>
    {loaded ? <FileSpreadsheet className="h-5 w-5 text-emerald-600" /> : <UploadCloud className="h-5 w-5 text-slate-400" />}
    <input className="hidden" type="file" multiple accept=".xlsx,.xls,.csv" onChange={(event) => onFiles(sourceKey, Array.from(event.target.files || []))} />
  </label>;
}

function IdentityDiagnosis({ item }) {
  const diagnosis = item?.identity_diagnosis;
  if (!diagnosis) return null;
  const high = diagnosis.risk === 'high';
  return <div className={`rounded-2xl border p-3.5 ${high ? 'border-rose-200 bg-rose-50' : 'border-violet-200 bg-violet-50'}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-sm font-black text-slate-950"><ScanSearch className={`h-4 w-4 ${high ? 'text-rose-600' : 'text-violet-600'}`} /> فحص هوية الصنف</div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${high ? 'bg-rose-100 text-rose-800' : 'bg-violet-100 text-violet-800'}`}>{diagnosis.label}</span></div>
    <div className="mt-2 text-sm font-black leading-6 text-slate-900">{diagnosis.diagnosis}</div><div className="mt-1 text-xs font-bold leading-5 text-slate-600">{diagnosis.action}</div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-xl bg-white/80 p-2.5"><div className="text-[10px] font-black text-slate-400">اسم البيع</div><div className="mt-1 text-xs font-black text-slate-800">{item.sale_product_name || '—'}</div></div><div className="rounded-xl bg-white/80 p-2.5"><div className="text-[10px] font-black text-slate-400">اسم الشراء</div><div className="mt-1 text-xs font-black text-slate-800">{item.purchase_product_name || '—'}</div></div></div>
  </div>;
}

export default function BranchTransferControl() {
  const [sources, setSources] = useState({});
  const [sourcePanel, setSourcePanel] = useState(true);
  const [manualPanel, setManualPanel] = useState(false);
  const [activeView, setActiveView] = useState('now');
  const [selectedId, setSelectedId] = useState('');
  const [ledger, setLedger] = useState(loadLedger);
  const [message, setMessage] = useState('');
  const [autoReport, setAutoReport] = useState({ inspections: [], ambiguous: [], duplicates: [], errors: [] });
  const [isInspecting, setIsInspecting] = useState(false);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger)); }, [ledger]);

  const sales = useMemo(() => Object.entries(sources).flatMap(([key, source]) => sourceConfig[key]?.side === 'sale' ? (source.items || []) : []), [sources]);
  const purchases = useMemo(() => Object.entries(sources).flatMap(([key, source]) => sourceConfig[key]?.side === 'purchase' ? (source.items || []) : []), [sources]);
  const rawCases = useMemo(() => reconcileBranchTransfers(sales, purchases), [sales, purchases]);
  const cases = useMemo(() => applyLearnedUnitRules(rawCases, ledger.unitRules), [rawCases, ledger.unitRules]);
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
  const learnedRules = useMemo(() => Object.values(ledger.unitRules || {}).filter((rule) => rule?.active), [ledger.unitRules]);
  const loadedSourceCount = Object.values(sources).filter((source) => source?.items?.length).length;
  const loadedFileCount = Object.values(sources).reduce((sum, source) => sum + (source?.fileNames?.length || 0), 0);

  const handleAutoFiles = async (files) => {
    if (!files?.length) return;
    setIsInspecting(true);
    setMessage('');
    try {
      const inspections = [];
      for (const file of files) {
        try { inspections.push(await inspectTransferFile(file)); }
        catch (error) { inspections.push({ fileName: file.name, parsed: { valid: false, warnings: [error?.message || 'خطأ غير معروف'] } }); }
      }
      const grouped = buildSourcesFromInspections(inspections);
      setSources(grouped.sources);
      setAutoReport({ inspections, ambiguous: grouped.ambiguous, duplicates: grouped.duplicates, errors: grouped.errors });
      const notes = [];
      if (grouped.duplicates.length) notes.push(`تم تجاهل ${grouped.duplicates.length} ملف مكرر.`);
      if (grouped.ambiguous.length) notes.push(`${grouped.ambiguous.length} ملف يحتاج تحديد اتجاه يدوي.`);
      if (grouped.errors.length) notes.push(`${grouped.errors.length} ملف تعذر قراءته.`);
      setMessage(notes.join(' '));
      setSelectedId('');
    } finally { setIsInspecting(false); }
  };

  const handleFiles = async (sourceKey, files) => {
    if (!files?.length) return;
    const config = sourceConfig[sourceKey];
    const results = [];
    const errors = [];
    for (const file of files) {
      try {
        const result = parseTransferWorkbook(await file.arrayBuffer(), { branch: config.branch, counterparty: config.counterparty });
        if (result.valid) results.push({ ...result, fileName: file.name }); else errors.push(`${file.name}: ${result.warnings.join(' ')}`);
      } catch (error) { errors.push(`${file.name}: ${error?.message || 'خطأ غير معروف'}`); }
    }
    const items = results.flatMap((result) => result.items || []);
    setSources((old) => ({ ...old, [sourceKey]: { valid: Boolean(items.length), items, fileNames: results.map((result) => result.fileName), warnings: results.flatMap((result) => result.warnings || []), meta: { files: results.map((result) => ({ fileName: result.fileName, ...result.meta })) } } }));
    setMessage(errors.join(' '));
  };

  const assignAmbiguous = (entry, sourceKey) => {
    const config = sourceConfig[sourceKey];
    const items = (entry.parsed?.items || []).map((item) => ({ ...item, branch: config.branch, counterparty: config.counterparty }));
    setSources((old) => {
      const bucket = old[sourceKey] || { valid: true, items: [], fileNames: [], warnings: [], meta: { files: [] } };
      return { ...old, [sourceKey]: { ...bucket, valid: true, items: [...bucket.items, ...items], fileNames: [...bucket.fileNames, entry.fileName], meta: { files: [...(bucket.meta?.files || []), { fileName: entry.fileName, ...entry.parsed?.meta }] } } };
    });
    setAutoReport((old) => ({ ...old, ambiguous: old.ambiguous.filter((item) => item !== entry) }));
  };

  const recordDecision = (item, status, action) => {
    if (!item) return;
    const event = { case_id: item.id, action, status, at: nowIso(), type: item.type, from: item.from, to: item.to, product_name: item.product_name };
    setLedger((old) => ({ ...old, decisions: { ...old.decisions, [item.id]: { status, action, updated_at: event.at } }, events: [event, ...old.events].slice(0, 1000) }));
    const index = actionable.findIndex((candidate) => candidate.id === item.id);
    const next = actionable[index + 1] || actionable[index - 1];
    setSelectedId(next?.id || '');
  };

  const approveUnitRule = (item) => {
    const suggestion = suggestUnitRule(item); if (!suggestion) return;
    const at = nowIso(); const label = unitRuleLabel(suggestion);
    setLedger((old) => ({ ...old, unitRules: learnUnitRule(item, old.unitRules || {}), decisions: { ...old.decisions, [item.id]: { status: 'verified', action: `اعتماد تحويل الوحدة: ${label}`, updated_at: at } }, events: [{ case_id: item.id, action: 'unit_rule_learned', status: 'verified', at, type: item.type, from: item.from, to: item.to, product_name: item.product_name, rule: suggestion }, ...old.events].slice(0, 1000) }));
    setSelectedId('');
  };

  const revokeUnitRule = (rule) => { const at = nowIso(); setLedger((old) => ({ ...old, unitRules: removeUnitRule(old.unitRules || {}, rule.key), events: [{ action: 'unit_rule_revoked', at, product_name: rule.product_name, from: rule.from, to: rule.to, rule_key: rule.key }, ...old.events].slice(0, 1000) })); };
  const resetShadow = () => { setSources({}); setSelectedId(''); setMessage(''); setAutoReport({ inspections: [], ambiguous: [], duplicates: [], errors: [] }); };

  const branchHealth = { shokry: transferErrorRate(decoratedCases, 'shokry'), shamy: transferErrorRate(decoratedCases, 'shamy') };
  const nextType = actionable[0]?.type;
  const mostRepeatedEmployee = employees[0];
  const unitSuggestion = selected?.type === 'unit_conversion_review' ? suggestUnitRule(selected) : null;
  const selectedMeta = selected ? (typeMeta[selected.type] || typeMeta.quantity_mismatch) : null;

  return <div dir="rtl" className="min-h-full bg-gradient-to-b from-slate-50 via-white to-slate-50/70"><div className="mx-auto w-full max-w-7xl space-y-4 px-3 py-4 sm:px-5 lg:px-6">
    <div className="overflow-hidden rounded-3xl border border-teal-100 bg-gradient-to-l from-teal-700 via-teal-600 to-cyan-600 text-white shadow-lg shadow-teal-900/10"><div className="relative p-5 sm:p-6"><div className="absolute -left-14 -top-16 h-44 w-44 rounded-full bg-white/10 blur-2xl" /><div className="relative flex flex-wrap items-center justify-between gap-4"><div><div className="flex items-center gap-2 text-xs font-black text-teal-100"><Sparkles className="h-4 w-4" /> مركز مطابقة تحويلات الفروع</div><h1 className="mt-1.5 text-2xl font-black sm:text-3xl">تحويلات شكري ↔ الشامي</h1><p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-teal-50/90">اختار كل ملفات التحويلات مرة واحدة؛ النظام يصنفها ويجمع ملفات نفس الاتجاه تلقائيًا.</p></div><div className="flex flex-wrap items-center gap-2"><div className="rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-center backdrop-blur"><div className="text-[10px] font-black text-teal-100">ملفات محملة</div><div className="text-xl font-black">{loadedFileCount}</div><div className="text-[9px] font-bold text-teal-100">في {loadedSourceCount} اتجاه</div></div><Button variant="secondary" size="sm" onClick={() => setSourcePanel((value) => !value)} className="gap-2 border-0 bg-white font-black text-teal-800 hover:bg-teal-50">الملفات {sourcePanel ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button><Button variant="outline" size="sm" onClick={resetShadow} className="gap-2 border-white/30 bg-transparent font-black text-white hover:bg-white/10 hover:text-white"><RefreshCw className="h-4 w-4" /> مسح الرفع</Button></div></div></div></div>

    {sourcePanel && <Card className="border-slate-200/80 p-4 shadow-sm">
      <label className="group flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-teal-300 bg-gradient-to-b from-teal-50/70 to-white p-6 text-center transition hover:border-teal-500 hover:bg-teal-50">
        <div className="rounded-2xl bg-teal-100 p-3 text-teal-700"><Files className="h-7 w-7" /></div><div className="mt-3 text-lg font-black text-slate-950">ارفع كل ملفات اليوم مرة واحدة</div><div className="mt-1 max-w-2xl text-sm font-bold leading-6 text-slate-500">اختار 4 أو 5 أو 10 ملفات — حتى لو فيه أكثر من ملف لنفس الفرع. النظام يقرأ المحتوى ويحدد الاتجاه تلقائيًا.</div><div className="mt-3 rounded-full bg-teal-700 px-4 py-2 text-xs font-black text-white">{isInspecting ? 'جاري قراءة وتصنيف الملفات...' : 'اختيار ملفات اليوم'}</div>
        <input className="hidden" type="file" multiple accept=".xlsx,.xls,.csv" disabled={isInspecting} onChange={(event) => handleAutoFiles(Array.from(event.target.files || []))} />
      </label>

      {loadedFileCount > 0 && <div className="mt-4"><div className="mb-2 flex items-center justify-between gap-2"><div className="text-sm font-black text-slate-950">نتيجة التصنيف التلقائي</div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">{loadedFileCount} ملف جاهز</span></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(sourceConfig).map(([key, config]) => { const source = sources[key]; return <div key={key} className={`rounded-2xl border p-3 ${source?.fileNames?.length ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50'}`}><div className="text-xs font-black text-slate-900">{config.label}</div><div className={`mt-1 text-xl font-black ${source?.fileNames?.length ? 'text-emerald-700' : 'text-slate-300'}`}>{source?.fileNames?.length || 0} ملف</div><div className="mt-1 truncate text-[10px] font-bold text-slate-400">{source?.fileNames?.join(' + ') || 'لم يتم العثور على ملف لهذا الاتجاه'}</div></div>; })}</div></div>}

      {autoReport.ambiguous.length > 0 && <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3"><div className="flex items-center gap-2 text-sm font-black text-amber-900"><CircleHelp className="h-4 w-4" /> ملفات محتاجة منك تحديد الاتجاه فقط</div>{autoReport.ambiguous.map((entry) => <div key={`${entry.fileName}-${entry.fileSize}`} className="mt-2 rounded-xl bg-white p-3"><div className="text-sm font-black text-slate-900">{entry.fileName}</div><div className="mt-1 text-xs font-bold text-slate-500">{entry.reason}</div><div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(sourceConfig).map(([key, config]) => <Button key={key} size="sm" variant="outline" onClick={() => assignAmbiguous(entry, key)} className="text-[11px] font-black">{config.label}</Button>)}</div></div>)}</div>}
      {message && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800">{message}</div>}

      <button type="button" onClick={() => setManualPanel((value) => !value)} className="mt-4 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-600"><span>تحديد يدوي متقدم — استخدمه فقط لو التصنيف التلقائي لم يعرف ملفًا</span>{manualPanel ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
      {manualPanel && <div className="mt-3 grid gap-2 md:grid-cols-2">{Object.keys(sourceConfig).map((key) => <SourceUpload key={key} sourceKey={key} source={sources[key]} onFiles={handleFiles} />)}</div>}
    </Card>}

    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><StatCard label="حرج" value={summary.critical} hint="أعلى أولوية" tone="rose" /><StatCard label="قرار الآن" value={actionable.length} hint="محتاج تدخل" tone="amber" /><StatCard label="تحويل وحدة" value={summary.unit_review} hint="لا يُحسب خطأ" tone="sky" /><StatCard label="مطابق" value={summary.matched} hint="اتخفى تلقائيًا" tone="emerald" /></div>
    <div className="grid grid-cols-3 gap-1 rounded-2xl border border-slate-200 bg-slate-100/80 p-1 shadow-inner">{[['now', 'القرار الآن'], ['followup', 'المتابعة'], ['intel', 'الذكاء']].map(([key, label]) => <button key={key} onClick={() => setActiveView(key)} className={`rounded-xl px-3 py-2.5 text-sm font-black transition ${activeView === key ? 'bg-white text-teal-800 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'}`}>{label}</button>)}</div>

    {activeView === 'now' && <div className="space-y-3">{!sales.length && !purchases.length ? <Card className="flex min-h-64 flex-col items-center justify-center border-dashed border-teal-200 bg-gradient-to-b from-white to-teal-50/40 p-6 text-center shadow-sm"><div className="rounded-2xl bg-teal-100 p-3 text-teal-700"><BrainCircuit className="h-8 w-8" /></div><div className="mt-4 text-lg font-black text-slate-950">ارفع ملفات اليوم كلها مرة واحدة</div><div className="mt-1 max-w-xl text-sm font-bold leading-6 text-slate-500">المطابق لن يملأ الصفحة. النظام يسكت لما الدنيا صح، ويتكلم فقط لما محتاج قرار.</div></Card> : !selected ? <Card className="flex min-h-56 flex-col items-center justify-center border-emerald-200 bg-emerald-50/50 p-6 text-center shadow-sm"><div className="rounded-full bg-emerald-100 p-3"><CheckCircle2 className="h-8 w-8 text-emerald-600" /></div><div className="mt-3 text-lg font-black text-slate-950">ممتاز — لا توجد حالة تحتاج قرارًا الآن</div><div className="mt-1 text-sm font-bold text-slate-500">الحركات الحالية مطابقة أو تم اتخاذ قرار بشأنها.</div></Card> : <Card className="overflow-hidden border-slate-200 shadow-md shadow-slate-900/5"><div className={`h-1.5 ${selectedMeta?.accent || 'bg-slate-400'}`} /><div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-l from-slate-50 to-white p-4 sm:p-5"><div><div className="flex flex-wrap items-center gap-2"><CaseBadge item={selected} /><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">خطورة {selected.severity}/100</span></div><div className="mt-2 text-xl font-black text-slate-950 sm:text-2xl">{selected.product_name}</div><div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-black text-slate-500"><ArrowLeftRight className="h-3.5 w-3.5 text-teal-600" /> {transferBranchLabel(selected.from)} → {transferBranchLabel(selected.to)} <span className="text-slate-300">•</span> {selected.day_key}</div></div><div className="rounded-xl bg-slate-100 px-3 py-2 text-center"><div className="text-[10px] font-black text-slate-400">الحالة</div><div className="text-sm font-black text-slate-800">{actionable.findIndex((item) => item.id === selected.id) + 1} / {actionable.length}</div></div></div><div className="space-y-3 p-4 sm:p-5"><div className="grid gap-3 md:grid-cols-[1fr_1fr_1.25fr]"><div className="rounded-2xl border border-slate-100 bg-slate-50 p-3.5"><div className="text-[11px] font-black text-slate-400">بيع المرسل</div><div className="mt-1 text-2xl font-black text-slate-950">{selected.sale_qty}</div><div className="mt-1 text-xs font-bold leading-5 text-slate-500">{selected.sale_units.join('، ') || 'الوحدة غير مسجلة'}<br />كود: {selected.sale_codes.join('، ') || 'بدون كود'}</div></div><div className="rounded-2xl border border-slate-100 bg-slate-50 p-3.5"><div className="text-[11px] font-black text-slate-400">شراء المستلم</div><div className="mt-1 text-2xl font-black text-slate-950">{selected.purchase_qty}</div><div className="mt-1 text-xs font-bold leading-5 text-slate-500">{selected.purchase_units.join('، ') || 'الوحدة غير مسجلة'}<br />كود: {selected.purchase_codes.join('، ') || 'بدون كود'}</div></div><div className="rounded-2xl border border-teal-200 bg-teal-50 p-3.5"><div className="flex items-center gap-1.5 text-[11px] font-black text-teal-700"><Zap className="h-3.5 w-3.5" /> القرار المقترح</div><div className="mt-1.5 text-sm font-black leading-6 text-slate-950">{selected.next_action}</div></div></div><IdentityDiagnosis item={selected} /><div className="flex flex-wrap gap-2 rounded-2xl border border-slate-100 bg-slate-50/70 p-3">{unitSuggestion ? <Button onClick={() => approveUnitRule(selected)} className="gap-2 bg-sky-600 font-black hover:bg-sky-700"><WandSparkles className="h-4 w-4" /> اعتماد: {unitRuleLabel(unitSuggestion)}</Button> : <Button onClick={() => recordDecision(selected, 'waiting_verification', 'تم التنفيذ - ينتظر التحقق')} className="gap-2 bg-teal-700 font-black hover:bg-teal-800"><ShieldCheck className="h-4 w-4" /> تم التنفيذ</Button>}<Button variant="outline" onClick={() => recordDecision(selected, 'in_progress', 'بدأت المراجعة')} className="font-black">جاري المراجعة</Button><Button variant="outline" onClick={() => recordDecision(selected, 'dismissed', 'ليست مشكلة بعد المراجعة')} className="font-black">ليست مشكلة</Button><Button variant="ghost" onClick={() => { const index = actionable.findIndex((item) => item.id === selected.id); const next = actionable[index + 1] || actionable[0]; setSelectedId(next?.id || ''); }} className="font-black text-slate-500">تخطي</Button></div></div></Card>}</div>}

    {activeView === 'followup' && <Card className="border-slate-200 p-4 shadow-sm"><div className="mb-3 flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-sm font-black text-slate-950"><Clock3 className="h-4 w-4 text-sky-600" /> حالات تحتاج تحقق بعد القرار</div><span className="rounded-full bg-sky-50 px-2 py-1 text-[10px] font-black text-sky-700">{followup.length} معلقة</span></div>{!followup.length ? <div className="rounded-2xl bg-slate-50 p-6 text-center text-sm font-bold text-slate-500">لا توجد متابعة معلقة.</div> : <div className="divide-y divide-slate-100">{followup.slice(0, 12).map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><div className="font-black text-slate-900">{item.product_name}</div><div className="mt-1 text-xs font-bold text-slate-400">{typeMeta[item.type]?.label} · {item.decision?.action}</div></div><Button size="sm" variant="outline" onClick={() => { setActiveView('now'); setSelectedId(item.id); }} className="font-black">فتح الحالة</Button></div>)}</div>}</Card>}

    {activeView === 'intel' && <div className="grid gap-3 lg:grid-cols-2"><Card className="border-slate-200 p-4 shadow-sm"><div className="flex items-center gap-2 text-sm font-black text-slate-950"><ShieldAlert className="h-4 w-4 text-rose-600" /> صحة الفروع</div><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-2xl border border-slate-100 bg-slate-50 p-3"><div className="text-xs font-black text-slate-500">شكري</div><div className="mt-1 text-2xl font-black text-slate-950">{branchHealth.shokry}%</div><div className="text-[11px] font-bold text-slate-400">حالات غير مطابقة</div></div><div className="rounded-2xl border border-slate-100 bg-slate-50 p-3"><div className="text-xs font-black text-slate-500">الشامي</div><div className="mt-1 text-2xl font-black text-slate-950">{branchHealth.shamy}%</div><div className="text-[11px] font-bold text-slate-400">حالات غير مطابقة</div></div></div><div className="mt-3 rounded-2xl border border-slate-100 bg-white p-3 text-sm font-bold leading-6 text-slate-600">أكثر مشكلة الآن: <span className="font-black text-slate-950">{nextType ? typeMeta[nextType]?.label : 'لا يوجد'}</span> · قواعد وحدة متعلمة <span className="font-black text-sky-700">{learnedRules.length}</span> · تم إغلاق/استبعاد <span className="font-black text-slate-950">{resolvedCount}</span> حالة.</div>{learnedRules.length > 0 && <div className="mt-3 space-y-2"><div className="flex items-center gap-2 text-xs font-black text-slate-500"><WandSparkles className="h-4 w-4 text-sky-600" /> قواعد تحويل الوحدة المعتمدة</div>{learnedRules.slice(0, 6).map((rule) => <div key={rule.key} className="flex items-center justify-between gap-3 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2"><div className="min-w-0"><div className="truncate text-sm font-black text-slate-900">{rule.product_name}</div><div className="text-[11px] font-bold text-slate-500">{transferBranchLabel(rule.from)} → {transferBranchLabel(rule.to)} · {unitRuleLabel(rule)}</div></div><Button size="sm" variant="ghost" onClick={() => revokeUnitRule(rule)} className="shrink-0 gap-1 font-black text-rose-600"><XCircle className="h-4 w-4" /> إلغاء</Button></div>)}</div>}</Card><Card className="border-slate-200 p-4 shadow-sm"><div className="flex items-center gap-2 text-sm font-black text-slate-950"><UserRound className="h-4 w-4 text-violet-600" /> تكرار الحالات حسب الموظف</div>{!mostRepeatedEmployee ? <div className="mt-4 rounded-2xl bg-slate-50 p-6 text-center text-sm font-bold text-slate-500">لا توجد أخطاء مؤكدة مرتبطة بموظفين في الملفات الحالية.</div> : <><div className="mt-4 rounded-2xl border border-violet-100 bg-violet-50 p-3"><div className="text-xs font-black text-violet-700">الأكثر تكرارًا في الحالات الحالية</div><div className="mt-1 text-lg font-black text-slate-950">{mostRepeatedEmployee.name}</div><div className="mt-1 text-xs font-bold text-slate-500">{mostRepeatedEmployee.cases} حالة · بيع {mostRepeatedEmployee.sale_cases} · شراء {mostRepeatedEmployee.purchase_cases}</div></div><div className="mt-2 space-y-1">{employees.slice(1, 5).map((employee) => <div key={employee.name} className="flex items-center justify-between rounded-xl px-2 py-2 text-sm hover:bg-slate-50"><span className="font-bold text-slate-700">{employee.name}</span><span className="rounded-full bg-slate-100 px-2 py-1 font-black text-slate-950">{employee.cases}</span></div>)}</div></>}</Card></div>}

    <div className="flex items-start gap-2 rounded-2xl border border-amber-100 bg-amber-50/60 px-3 py-2.5 text-[11px] font-bold leading-5 text-amber-900"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> نسخة الاختبار تقرأ الملفات وتحتفظ بقواعد التعلم وسجل القرارات محليًا داخل المتصفح فقط. لا توجد أي كتابة على بيانات الإنتاج.</div>
  </div></div>;
}
