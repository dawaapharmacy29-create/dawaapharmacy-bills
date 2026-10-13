import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeftRight, BrainCircuit, CheckCircle2, ChevronDown, ChevronUp,
  Clock3, FileSpreadsheet, RefreshCw, ShieldAlert, Sparkles, UserRound, WandSparkles,
  XCircle, Zap, UploadCloud, ShieldCheck, ScanSearch, Files, CircleHelp, Gauge,
  SearchCheck, Route, CircleDot, SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { parseTransferWorkbook } from '@/lib/branchTransferShadowParser';
import { buildSourcesFromInspections, inspectTransferFile } from '@/lib/branchTransferAutoImport';
import {
  employeeTransferStats, reconcileBranchTransfers, summarizeTransferCases, summarizeDecisionIntelligence,
  transferBranchLabel, transferErrorRate, explainTransferCase,
} from '@/lib/branchTransferControl';
import { applyLearnedUnitRules, learnUnitRule, removeUnitRule, suggestUnitRule, unitRuleLabel } from '@/lib/branchTransferUnitRules';
import { buildTransferIncidents, summarizeTransferIncidents } from '@/lib/branchTransferIncidentIntelligence';

const STORAGE_KEY = 'dawaa.branch-transfer-control.shadow.v1';

const sourceConfig = {
  shokrySale: { label: 'بيع شكري → الشامي', side: 'sale', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
  shamyPurchase: { label: 'شراء الشامي من شكري', side: 'purchase', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shamySale: { label: 'بيع الشامي → شكري', side: 'sale', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shokryPurchase: { label: 'شراء شكري من الشامي', side: 'purchase', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
};

const typeMeta = {
  sale_without_purchase: { label: 'بيع بدون شراء', tone: 'border-rose-200 bg-rose-50 text-rose-800', accent: 'bg-rose-500' },
  purchase_without_sale: { label: 'شراء بدون بيع', tone: 'border-rose-200 bg-rose-50 text-rose-800', accent: 'bg-rose-500' },
  quantity_mismatch: { label: 'فرق كمية', tone: 'border-amber-200 bg-amber-50 text-amber-800', accent: 'bg-amber-500' },
  unit_conversion_review: { label: 'تحويل وحدة', tone: 'border-sky-200 bg-sky-50 text-sky-800', accent: 'bg-sky-500' },
  code_mismatch: { label: 'اختلاف كود', tone: 'border-violet-200 bg-violet-50 text-violet-800', accent: 'bg-violet-500' },
  matched: { label: 'مطابق', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800', accent: 'bg-emerald-500' },
};

const filters = [
  ['all', 'الكل'],
  ['strong', 'مشكلة قوية'],
  ['missing', 'ناقص بيع/شراء'],
  ['qty', 'فرق كمية'],
  ['code', 'اختلاف كود'],
  ['unit', 'تحويل وحدة'],
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

function CaseBadge({ item }) {
  const meta = typeMeta[item.type] || typeMeta.quantity_mismatch;
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${meta.tone}`}>{meta.label}</span>;
}

function StatCard({ label, value, hint, tone = 'slate' }) {
  const tones = {
    rose: 'border-rose-100 bg-gradient-to-br from-white to-rose-50 text-rose-700',
    amber: 'border-amber-100 bg-gradient-to-br from-white to-amber-50 text-amber-700',
    sky: 'border-sky-100 bg-gradient-to-br from-white to-sky-50 text-sky-700',
    emerald: 'border-emerald-100 bg-gradient-to-br from-white to-emerald-50 text-emerald-700',
    slate: 'border-slate-100 bg-white text-slate-800',
  };
  return <Card className={`border p-3.5 shadow-sm ${tones[tone]}`}>
    <div className="text-[11px] font-black text-slate-500">{label}</div>
    <div className="mt-1 text-2xl font-black">{value}</div>
    {hint && <div className="mt-0.5 text-[10px] font-bold text-slate-400">{hint}</div>}
  </Card>;
}

function ConfidenceMeter({ label, score = 0, reason, kind = 'journey' }) {
  const safe = Math.max(0, Math.min(100, Number(score) || 0));
  const bar = safe >= 75 ? 'bg-emerald-500' : safe >= 55 ? 'bg-amber-500' : 'bg-slate-400';
  const icon = kind === 'issue' ? <ShieldAlert className="h-4 w-4" /> : <Route className="h-4 w-4" />;
  return <div className="rounded-2xl border border-slate-200 bg-white p-3">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 text-xs font-black text-slate-700">{icon}{label}</div>
      <div className="text-lg font-black text-slate-950">{safe}%</div>
    </div>
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${bar}`} style={{ width: `${safe}%` }} /></div>
    <div className="mt-2 text-[11px] font-bold leading-5 text-slate-500">{reason || 'لا توجد تفاصيل إضافية.'}</div>
  </div>;
}

function SourceUpload({ sourceKey, source, onFiles }) {
  const config = sourceConfig[sourceKey];
  const loaded = source?.items?.length > 0;
  return <label className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${loaded ? 'border-emerald-200 bg-emerald-50/60' : 'border-dashed border-slate-300 bg-white'}`}>
    <div className="min-w-0"><div className="text-xs font-black text-slate-900">{config.label}</div><div className="mt-0.5 truncate text-[10px] font-bold text-slate-400">{source?.fileNames?.join(' + ') || 'اختيار يدوي'}</div></div>
    {loaded ? <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> : <UploadCloud className="h-4 w-4 text-slate-400" />}
    <input className="hidden" type="file" multiple accept=".xlsx,.xls,.csv" onChange={(event) => onFiles(sourceKey, Array.from(event.target.files || []))} />
  </label>;
}

function IdentityDiagnosis({ item }) {
  const diagnosis = item?.identity_diagnosis;
  if (!diagnosis) return null;
  const high = diagnosis.risk === 'high';
  return <div className={`rounded-2xl border p-3.5 ${high ? 'border-rose-200 bg-rose-50' : 'border-violet-200 bg-violet-50'}`}>
    <div className="flex items-center gap-2 text-sm font-black text-slate-950"><ScanSearch className={`h-4 w-4 ${high ? 'text-rose-600' : 'text-violet-600'}`} /> فحص هوية الصنف</div>
    <div className="mt-2 text-sm font-black leading-6 text-slate-900">{diagnosis.diagnosis}</div>
    <div className="mt-1 text-xs font-bold leading-5 text-slate-600">{diagnosis.action}</div>
  </div>;
}

function DecisionEvidence({ item }) {
  const intel = item?.decision_intelligence || explainTransferCase(item);
  return <div className="grid gap-3 lg:grid-cols-2">
    <ConfidenceMeter label="ثقة إنهم نفس رحلة التحويل" score={intel.journey_confidence?.score} reason={intel.journey_confidence?.reason} />
    <ConfidenceMeter label="ثقة إن فيه مشكلة فعلًا" score={intel.issue_confidence?.score} reason={intel.issue_confidence?.reason} kind="issue" />
    <div className="rounded-2xl border border-teal-200 bg-teal-50 p-3.5 lg:col-span-2">
      <div className="flex items-center gap-2 text-xs font-black text-teal-700"><SearchCheck className="h-4 w-4" /> أول مراجعة تعملها</div>
      <div className="mt-1.5 text-sm font-black leading-6 text-slate-950">{intel.recommended_check}</div>
    </div>
    {intel.signals?.length > 0 && <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 lg:col-span-2">
      <div className="mb-2 text-xs font-black text-slate-500">أقوى الأدلة</div>
      <div className="flex flex-wrap gap-2">{intel.signals.slice(0, 5).map((signal) => <span key={signal.key} title={signal.detail} className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${signal.kind === 'supports_issue' ? 'border-rose-200 bg-rose-50 text-rose-700' : signal.kind === 'reduces_issue' ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{signal.label} · {signal.strength}%</span>)}</div>
    </div>}
    {intel.uncertainties?.length > 0 && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 lg:col-span-2">
      <div className="text-xs font-black text-amber-800">قبل ما تعتبرها خطأ مؤكد</div>
      <div className="mt-1.5 space-y-1">{intel.uncertainties.slice(0, 3).map((text, index) => <div key={`${text}-${index}`} className="flex items-start gap-1.5 text-[11px] font-bold leading-5 text-amber-900"><CircleDot className="mt-1 h-2.5 w-2.5 shrink-0" />{text}</div>)}</div>
    </div>}
  </div>;
}

export default function BranchTransferControl() {
  const [sources, setSources] = useState({});
  const [sourcePanel, setSourcePanel] = useState(true);
  const [manualPanel, setManualPanel] = useState(false);
  const [activeView, setActiveView] = useState('now');
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [ledger, setLedger] = useState(loadLedger);
  const [message, setMessage] = useState('');
  const [autoReport, setAutoReport] = useState({ inspections: [], ambiguous: [], duplicates: [], errors: [] });
  const [isInspecting, setIsInspecting] = useState(false);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger)); }, [ledger]);

  const sales = useMemo(() => Object.entries(sources).flatMap(([key, source]) => sourceConfig[key]?.side === 'sale' ? (source.items || []) : []), [sources]);
  const purchases = useMemo(() => Object.entries(sources).flatMap(([key, source]) => sourceConfig[key]?.side === 'purchase' ? (source.items || []) : []), [sources]);
  const rawCases = useMemo(() => reconcileBranchTransfers(sales, purchases), [sales, purchases]);
  const cases = useMemo(() => applyLearnedUnitRules(rawCases, ledger.unitRules).map((item) => ({ ...item, decision_intelligence: explainTransferCase(item) })), [rawCases, ledger.unitRules]);
  const summary = useMemo(() => summarizeTransferCases(cases), [cases]);
  const intelligenceSummary = useMemo(() => summarizeDecisionIntelligence(cases), [cases]);
  const decoratedCases = useMemo(() => cases.map((item) => {
    const decision = ledger.decisions[item.id];
    const autoVerified = item.type === 'matched' && decision?.status === 'waiting_verification';
    return { ...item, decision: autoVerified ? { ...decision, status: 'verified' } : decision };
  }), [cases, ledger.decisions]);

  const actionable = useMemo(() => decoratedCases
    .filter((item) => item.type !== 'matched' && !['dismissed', 'verified'].includes(item.decision?.status))
    .sort((a, b) => (b.decision_intelligence?.issue_confidence?.score || 0) - (a.decision_intelligence?.issue_confidence?.score || 0) || b.severity - a.severity), [decoratedCases]);

  const incidentCases = useMemo(() => decoratedCases.filter((item) => item.type === 'matched' || !['dismissed', 'verified'].includes(item.decision?.status)), [decoratedCases]);
  const incidents = useMemo(() => buildTransferIncidents(incidentCases), [incidentCases]);
  const incidentSummary = useMemo(() => summarizeTransferIncidents(incidents), [incidents]);

  const incidentMatchesFilter = (incident, key) => incident.cases.some((item) => {
    if (key === 'strong') return (item.decision_intelligence?.issue_confidence?.score || 0) >= 75 || incident.root_cause_confidence >= 90;
    if (key === 'missing') return ['sale_without_purchase', 'purchase_without_sale'].includes(item.type);
    if (key === 'qty') return item.type === 'quantity_mismatch';
    if (key === 'code') return item.type === 'code_mismatch';
    if (key === 'unit') return item.type === 'unit_conversion_review';
    return true;
  });

  const filteredIncidents = useMemo(() => incidents.filter((incident) => incidentMatchesFilter(incident, activeFilter)), [incidents, activeFilter]);

  const followup = useMemo(() => decoratedCases.filter((item) => ['in_progress', 'waiting_verification'].includes(item.decision?.status)), [decoratedCases]);
  const selectedIncident = useMemo(() => filteredIncidents.find((incident) => incident.case_ids.includes(selectedId)) || filteredIncidents[0] || null, [filteredIncidents, selectedId]);
  const selected = useMemo(() => {
    if (!selectedIncident) return null;
    return selectedIncident.cases.find((item) => item.id === selectedId) || selectedIncident.cases[0] || null;
  }, [selectedIncident, selectedId]);
  const employees = useMemo(() => employeeTransferStats(decoratedCases), [decoratedCases]);
  const resolvedCount = Object.values(ledger.decisions).filter((decision) => ['verified', 'dismissed'].includes(decision.status)).length;
  const learnedRules = useMemo(() => Object.values(ledger.unitRules || {}).filter((rule) => rule?.active), [ledger.unitRules]);
  const loadedSourceCount = Object.values(sources).filter((source) => source?.items?.length).length;
  const loadedFileCount = Object.values(sources).reduce((sum, source) => sum + (source?.fileNames?.length || 0), 0);

  useEffect(() => {
    if (selectedId && !filteredIncidents.some((incident) => incident.case_ids.includes(selectedId))) setSelectedId('');
  }, [activeFilter, filteredIncidents, selectedId]);

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
      if (!grouped.ambiguous.length && !grouped.errors.length) setSourcePanel(false);
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

  const recordIncidentDecision = (incident, status, action) => {
    if (!incident) return;
    const at = nowIso();
    setLedger((old) => {
      const decisions = { ...old.decisions };
      const events = [];
      incident.cases.forEach((item) => {
        decisions[item.id] = { status, action, updated_at: at, incident_id: incident.id };
        events.push({ case_id: item.id, incident_id: incident.id, action, status, at, type: item.type, from: item.from, to: item.to, product_name: item.product_name });
      });
      return { ...old, decisions, events: [...events, ...old.events].slice(0, 1000) };
    });
    const index = filteredIncidents.findIndex((candidate) => candidate.id === incident.id);
    const next = filteredIncidents[index + 1] || filteredIncidents[index - 1];
    setSelectedId(next?.cases?.[0]?.id || '');
  };

  const approveUnitRule = (item) => {
    const suggestion = suggestUnitRule(item); if (!suggestion) return;
    const at = nowIso(); const label = unitRuleLabel(suggestion);
    setLedger((old) => ({ ...old, unitRules: learnUnitRule(item, old.unitRules || {}), decisions: { ...old.decisions, [item.id]: { status: 'verified', action: `اعتماد تحويل الوحدة: ${label}`, updated_at: at } }, events: [{ case_id: item.id, action: 'unit_rule_learned', status: 'verified', at, type: item.type, from: item.from, to: item.to, product_name: item.product_name, rule: suggestion }, ...old.events].slice(0, 1000) }));
    setSelectedId('');
  };

  const revokeUnitRule = (rule) => {
    const at = nowIso();
    setLedger((old) => ({ ...old, unitRules: removeUnitRule(old.unitRules || {}, rule.key), events: [{ action: 'unit_rule_revoked', at, product_name: rule.product_name, from: rule.from, to: rule.to, rule_key: rule.key }, ...old.events].slice(0, 1000) }));
  };

  const resetShadow = () => {
    setSources({}); setSelectedId(''); setMessage(''); setActiveFilter('all');
    setAutoReport({ inspections: [], ambiguous: [], duplicates: [], errors: [] });
  };

  const branchHealth = { shokry: transferErrorRate(decoratedCases, 'shokry'), shamy: transferErrorRate(decoratedCases, 'shamy') };
  const mostRepeatedEmployee = employees[0];
  const unitSuggestion = selected?.type === 'unit_conversion_review' ? suggestUnitRule(selected) : null;
  const selectedMeta = selected ? (typeMeta[selected.type] || typeMeta.quantity_mismatch) : null;
  const selectedIntel = selected?.decision_intelligence;
  const strongestIncident = incidents[0];

  const filterCount = (key) => incidents.filter((incident) => incidentMatchesFilter(incident, key)).length;

  return <div dir="rtl" className="min-h-full bg-gradient-to-b from-slate-50 via-white to-slate-50/70">
    <div className="mx-auto w-full max-w-[1480px] space-y-4 px-3 py-4 sm:px-5 lg:px-6">
      <div className="overflow-hidden rounded-3xl border border-teal-100 bg-gradient-to-l from-teal-800 via-teal-700 to-cyan-700 text-white shadow-lg shadow-teal-900/10">
        <div className="relative p-4 sm:p-5">
          <div className="absolute -left-14 -top-16 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-black text-teal-100"><BrainCircuit className="h-4 w-4" /> مركز قرار تحويلات الفروع</div>
              <h1 className="mt-1 text-2xl font-black sm:text-3xl">اعرف المشكلة والقرار في ثواني</h1>
              <p className="mt-1.5 text-sm font-bold text-teal-50/90">النظام يفصل بين قوة ربط الرحلة وقوة إثبات المشكلة، فلا يحول كل اختلاف إلى خطأ.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-center"><div className="text-[10px] font-black text-teal-100">ملفات</div><div className="text-xl font-black">{loadedFileCount}</div></div>
              <Button variant="secondary" size="sm" onClick={() => setSourcePanel((value) => !value)} className="gap-2 border-0 bg-white font-black text-teal-800 hover:bg-teal-50">الملفات {sourcePanel ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button>
              <Button variant="outline" size="sm" onClick={resetShadow} className="gap-2 border-white/30 bg-transparent font-black text-white hover:bg-white/10 hover:text-white"><RefreshCw className="h-4 w-4" /> مسح</Button>
            </div>
          </div>
        </div>
      </div>

      {sourcePanel && <Card className="border-slate-200/80 p-4 shadow-sm">
        <label className="group flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-teal-300 bg-teal-50/40 p-5 text-center hover:border-teal-500">
          <Files className="h-7 w-7 text-teal-700" />
          <div className="mt-2 text-base font-black text-slate-950">ارفع كل ملفات التحويلات مرة واحدة</div>
          <div className="mt-1 text-xs font-bold text-slate-500">التصنيف من أكواد B-Connect الداخلية، وليس من اسم الملف.</div>
          <div className="mt-3 rounded-full bg-teal-700 px-4 py-2 text-xs font-black text-white">{isInspecting ? 'جاري القراءة والتحليل...' : 'اختيار الملفات'}</div>
          <input className="hidden" type="file" multiple accept=".xlsx,.xls,.csv" disabled={isInspecting} onChange={(event) => handleAutoFiles(Array.from(event.target.files || []))} />
        </label>

        {loadedFileCount > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(sourceConfig).map(([key, config]) => {
          const source = sources[key];
          return <div key={key} className={`rounded-xl border p-2.5 ${source?.fileNames?.length ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50'}`}><div className="text-[11px] font-black text-slate-800">{config.label}</div><div className="mt-1 text-sm font-black text-emerald-700">{source?.fileNames?.length || 0} ملف · {source?.items?.length || 0} سطر</div></div>;
        })}</div>}

        {autoReport.ambiguous.length > 0 && <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center gap-2 text-sm font-black text-amber-900"><CircleHelp className="h-4 w-4" /> ملفات تحتاج تحديد اتجاه يدوي</div>
          {autoReport.ambiguous.map((entry) => <div key={`${entry.fileName}-${entry.fileSize}`} className="mt-2 rounded-xl bg-white p-3">
            <div className="text-sm font-black text-slate-900">{entry.fileName}</div><div className="mt-1 text-xs font-bold text-slate-500">{entry.reason}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(sourceConfig).map(([key, config]) => <Button key={key} size="sm" variant="outline" onClick={() => assignAmbiguous(entry, key)} className="text-[11px] font-black">{config.label}</Button>)}</div>
          </div>)}
        </div>}
        {message && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{message}</div>}
        <button type="button" onClick={() => setManualPanel((value) => !value)} className="mt-3 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-600">
          <span>رفع يدوي متقدم عند الحاجة فقط</span>{manualPanel ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {manualPanel && <div className="mt-2 grid gap-2 md:grid-cols-2">{Object.keys(sourceConfig).map((key) => <SourceUpload key={key} sourceKey={key} source={sources[key]} onFiles={handleFiles} />)}</div>}
      </Card>}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatCard label="مشكلة قوية" value={intelligenceSummary.high_issue_confidence} hint="ثقة مشكلة ≥ 75%" tone="rose" />
        <StatCard label="قرارات فعلية" value={incidentSummary.total} hint={`${incidentSummary.line_issues} فرق خام بعد تجميع السبب`} tone="amber" />
        <StatCard label="تحويل وحدة" value={intelligenceSummary.review_conversion} hint="مراجعة وليست خطأ" tone="sky" />
        <StatCard label="سليم وصامت" value={intelligenceSummary.silent} hint="لا يحتاج تدخل" tone="emerald" />
      </div>

      {strongestIncident && <Card className="border-rose-200 bg-gradient-to-l from-rose-50 to-white p-3.5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-black text-rose-700"><Zap className="h-4 w-4" /> أقوى سبب جذري يستحق نظرك الآن</div>
            <div className="mt-1 truncate text-lg font-black text-slate-950">{strongestIncident.label}{strongestIncident.invoice ? ` · فاتورة ${strongestIncident.invoice}` : ''}</div>
            <div className="mt-1 text-xs font-bold leading-5 text-slate-500">{strongestIncident.summary}</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-white px-3 py-2 text-center ring-1 ring-rose-100"><div className="text-[9px] font-black text-slate-400">ثقة السبب الجذري</div><div className="text-xl font-black text-rose-700">{strongestIncident.root_cause_confidence}%</div></div>
            <Button size="sm" onClick={() => { setActiveView('now'); setActiveFilter('all'); setSelectedId(strongestIncident.cases?.[0]?.id || ''); }} className="bg-rose-600 font-black hover:bg-rose-700">افتح القرار</Button>
          </div>
        </div>
      </Card>}

      <div className="sticky top-2 z-20 grid grid-cols-3 gap-1 rounded-2xl border border-slate-200 bg-slate-100/95 p-1 shadow-sm backdrop-blur">
        {[['now', 'القرار الآن'], ['followup', 'المتابعة'], ['intel', 'الذكاء']].map(([key, label]) => <button key={key} onClick={() => setActiveView(key)} className={`rounded-xl px-3 py-2.5 text-sm font-black ${activeView === key ? 'bg-white text-teal-800 shadow-sm ring-1 ring-slate-200' : 'text-slate-500'}`}>{label}</button>)}
      </div>

      {activeView === 'now' && <>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {filters.map(([key, label]) => <button key={key} onClick={() => { setActiveFilter(key); setSelectedId(''); }} className={`shrink-0 rounded-full border px-3 py-2 text-xs font-black ${activeFilter === key ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}><SlidersHorizontal className="ml-1 inline h-3 w-3" />{label} <span className="opacity-70">({filterCount(key)})</span></button>)}
        </div>

        {!sales.length && !purchases.length ? <Card className="flex min-h-64 flex-col items-center justify-center border-dashed border-teal-200 bg-teal-50/30 p-6 text-center">
          <BrainCircuit className="h-9 w-9 text-teal-700" /><div className="mt-3 text-lg font-black text-slate-950">ارفع الملفات وخلّي النظام يفرز الضوضاء</div><div className="mt-1 text-sm font-bold text-slate-500">المطابق يختفي، والتحويلات المحتملة لا تُحسب كأخطاء، والمشكلة الأقوى تصعد أولًا.</div>
        </Card> : !selectedIncident || !selected ? <Card className="flex min-h-48 flex-col items-center justify-center border-emerald-200 bg-emerald-50/50 p-6 text-center"><CheckCircle2 className="h-8 w-8 text-emerald-600" /><div className="mt-2 font-black text-slate-950">لا توجد قرارات في الفلتر الحالي</div></Card> :
          <div className="grid gap-3 lg:grid-cols-[350px_minmax(0,1fr)]">
            <Card className="h-fit max-h-[72vh] overflow-y-auto border-slate-200 p-2 shadow-sm">
              <div className="px-2 py-2">
                <div className="text-xs font-black text-slate-700">{filteredIncidents.length} قرار فعلي</div>
                <div className="mt-0.5 text-[10px] font-bold text-slate-400">{filteredIncidents.reduce((sum, incident) => sum + incident.line_issue_count, 0)} فرق خام تم تجميعها حسب السبب المحتمل</div>
              </div>
              <div className="space-y-1.5">{filteredIncidents.map((incident) => {
                const active = selectedIncident?.id === incident.id;
                return <button key={incident.id} onClick={() => setSelectedId(incident.cases?.[0]?.id || '')} className={`w-full rounded-xl border p-3 text-right transition ${active ? 'border-teal-300 bg-teal-50 ring-1 ring-teal-200' : 'border-slate-100 bg-white hover:bg-slate-50'}`}>
                  <div className="flex items-center justify-between gap-2"><span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-black text-slate-600">{incident.label}</span><span className={`text-sm font-black ${incident.root_cause_confidence >= 90 ? 'text-rose-700' : 'text-slate-600'}`}>{incident.root_cause_confidence}%</span></div>
                  <div className="mt-2 truncate text-sm font-black text-slate-950">{incident.invoice ? `فاتورة ${incident.invoice}` : incident.product_names?.[0]}</div>
                  <div className="mt-1 text-[10px] font-bold text-slate-400">{incident.line_issue_count > 1 ? `${incident.line_issue_count} أصناف/حركات تحت نفس القرار` : incident.product_names?.[0]}</div>
                  <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-slate-400"><span>{transferBranchLabel(incident.from)} → {transferBranchLabel(incident.to)}</span><span>{incident.employee_error_confirmed ? 'خطأ موظف مؤكد' : 'ليس اتهام موظف'}</span></div>
                </button>;
              })}</div>
            </Card>

            <Card className="overflow-hidden border-slate-200 shadow-md shadow-slate-900/5">
              <div className={`h-1.5 ${selectedMeta?.accent || 'bg-slate-400'}`} />
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-l from-slate-50 to-white p-4 sm:p-5">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><CaseBadge item={selected} /><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">خطورة {selected.severity}/100</span>{selected.cross_midnight && <span className="rounded-full bg-sky-50 px-2 py-1 text-[10px] font-black text-sky-700">عبر منتصف الليل</span>}</div>
                  <div className="mt-2 text-xl font-black text-slate-950 sm:text-2xl">{selected.product_name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-black text-slate-500"><ArrowLeftRight className="h-3.5 w-3.5 text-teal-600" /> {transferBranchLabel(selected.from)} → {transferBranchLabel(selected.to)}{selected.time_gap_minutes != null && <><span className="text-slate-300">•</span><Clock3 className="h-3.5 w-3.5" /> فرق {selected.time_gap_minutes} دقيقة</>}</div>
                </div>
                <div className={`rounded-xl px-3 py-2 text-center ${selectedIntel?.issue_confidence?.score >= 75 ? 'bg-rose-50 ring-1 ring-rose-100' : 'bg-slate-100'}`}><div className="text-[9px] font-black text-slate-400">ثقة المشكلة</div><div className={`text-2xl font-black ${selectedIntel?.issue_confidence?.score >= 75 ? 'text-rose-700' : 'text-slate-800'}`}>{selectedIntel?.issue_confidence?.score || 0}%</div></div>
              </div>

              <div className="space-y-3 p-4 sm:p-5">
                <div className={`rounded-2xl border p-4 ${selectedIncident.root_cause_confidence >= 90 ? 'border-rose-200 bg-rose-50' : 'border-teal-200 bg-teal-50'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-black text-slate-600">السبب الجذري المحتمل</div>
                    <div className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-slate-700">ثقة {selectedIncident.root_cause_confidence}%</div>
                  </div>
                  <div className="mt-1 text-base font-black leading-7 text-slate-950">{selectedIncident.label}{selectedIncident.invoice ? ` · فاتورة ${selectedIncident.invoice}` : ''}</div>
                  <div className="mt-1 text-xs font-bold leading-6 text-slate-600">{selectedIncident.summary}</div>
                  <div className="mt-2 rounded-xl bg-white/80 p-2.5 text-xs font-black leading-5 text-teal-900">{selectedIncident.recommended_check}</div>
                  {selectedIncident.line_issue_count > 1 && <div className="mt-2 flex flex-wrap gap-1.5">{selectedIncident.cases.slice(0, 12).map((item) => <span key={item.id} className="rounded-full border border-white bg-white/80 px-2 py-1 text-[10px] font-bold text-slate-700">{item.product_name} {item.sale_codes?.[0] || item.purchase_codes?.[0] ? `· ${item.sale_codes?.[0] || item.purchase_codes?.[0]}` : ''}</span>)}</div>}
                  <div className="mt-2 text-[10px] font-black text-slate-500">اختلاف الملف مؤكد حسب البيانات المحملة، لكن ده لا يعني تلقائيًا إن موظف ارتكب خطأ.</div>
                </div>

                <div className={`rounded-2xl border p-4 ${selectedIntel?.issue_confidence?.score >= 75 ? 'border-rose-200 bg-rose-50' : selected.type === 'unit_conversion_review' ? 'border-sky-200 bg-sky-50' : 'border-amber-200 bg-amber-50'}`}>
                  <div className="flex items-center gap-2 text-xs font-black text-slate-600"><Gauge className="h-4 w-4" /> خلاصة العقل</div>
                  <div className="mt-1.5 text-base font-black leading-7 text-slate-950">{selectedIntel?.summary}</div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3.5"><div className="text-[11px] font-black text-slate-400">بيع المرسل</div><div className="mt-1 text-2xl font-black text-slate-950">{selected.sale_qty}</div><div className="mt-1 text-xs font-bold leading-5 text-slate-500">{selected.sale_units.join('، ') || 'الوحدة غير مسجلة'}<br />كود: {selected.sale_codes.join('، ') || 'بدون كود'}<br />فاتورة: {selected.sale_invoices.join('، ') || '—'}</div></div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3.5"><div className="text-[11px] font-black text-slate-400">شراء المستلم</div><div className="mt-1 text-2xl font-black text-slate-950">{selected.purchase_qty}</div><div className="mt-1 text-xs font-bold leading-5 text-slate-500">{selected.purchase_units.join('، ') || 'الوحدة غير مسجلة'}<br />كود: {selected.purchase_codes.join('، ') || 'بدون كود'}<br />فاتورة: {selected.purchase_invoices.join('، ') || '—'}</div></div>
                  <div className="rounded-2xl border border-teal-200 bg-teal-50 p-3.5"><div className="flex items-center gap-1.5 text-[11px] font-black text-teal-700"><Zap className="h-3.5 w-3.5" /> القرار المقترح</div><div className="mt-1.5 text-sm font-black leading-6 text-slate-950">{selected.next_action}</div></div>
                </div>

                <DecisionEvidence item={selected} />
                <IdentityDiagnosis item={selected} />

                <div className="sticky bottom-2 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
                  {unitSuggestion ? <Button onClick={() => approveUnitRule(selected)} className="gap-2 bg-sky-600 font-black hover:bg-sky-700"><WandSparkles className="h-4 w-4" /> اعتماد: {unitRuleLabel(unitSuggestion)}</Button> : <Button onClick={() => recordIncidentDecision(selectedIncident, 'waiting_verification', `تم تنفيذ قرار السبب الجذري: ${selectedIncident.label}`)} className="gap-2 bg-teal-700 font-black hover:bg-teal-800"><ShieldCheck className="h-4 w-4" /> تم تنفيذ القرار</Button>}
                  <Button variant="outline" onClick={() => recordIncidentDecision(selectedIncident, 'in_progress', `بدأت مراجعة السبب الجذري: ${selectedIncident.label}`)} className="font-black">جاري المراجعة</Button>
                  <Button variant="outline" onClick={() => recordIncidentDecision(selectedIncident, 'dismissed', `ليست مشكلة بعد مراجعة السبب الجذري: ${selectedIncident.label}`)} className="font-black">ليست مشكلة</Button>
                  <Button variant="ghost" onClick={() => { const index = filteredIncidents.findIndex((incident) => incident.id === selectedIncident.id); const next = filteredIncidents[index + 1] || filteredIncidents[0]; setSelectedId(next?.cases?.[0]?.id || ''); }} className="font-black text-slate-500">تخطي</Button>
                </div>
              </div>
            </Card>
          </div>}
      </>}

      {activeView === 'followup' && <Card className="border-slate-200 p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-black text-slate-950"><Clock3 className="h-4 w-4 text-sky-600" /> حالات تحتاج تحقق بعد القرار</div><span className="rounded-full bg-sky-50 px-2 py-1 text-[10px] font-black text-sky-700">{followup.length} معلقة</span></div>
        {!followup.length ? <div className="rounded-2xl bg-slate-50 p-6 text-center text-sm font-bold text-slate-500">لا توجد متابعة معلقة.</div> : <div className="divide-y divide-slate-100">{followup.slice(0, 20).map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><div className="font-black text-slate-900">{item.product_name}</div><div className="mt-1 text-xs font-bold text-slate-400">{typeMeta[item.type]?.label} · {item.decision?.action}</div></div><Button size="sm" variant="outline" onClick={() => { setActiveView('now'); setActiveFilter('all'); setSelectedId(item.id); }} className="font-black">فتح</Button></div>)}</div>}
      </Card>}

      {activeView === 'intel' && <div className="grid gap-3 lg:grid-cols-2">
        <Card className="border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black text-slate-950"><ShieldAlert className="h-4 w-4 text-rose-600" /> جودة التحليل الحالي</div>
          <div className="mt-3 grid grid-cols-2 gap-2"><StatCard label="ربط رحلة قوي" value={intelligenceSummary.high_journey_confidence} hint="ثقة ≥ 90%" /><StatCard label="مشكلة قوية" value={intelligenceSummary.high_issue_confidence} hint="ثقة ≥ 75%" tone="rose" /></div>
          <div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-2xl bg-slate-50 p-3"><div className="text-xs font-black text-slate-500">شكري</div><div className="mt-1 text-2xl font-black">{branchHealth.shokry}%</div><div className="text-[10px] font-bold text-slate-400">حالات غير مطابقة</div></div><div className="rounded-2xl bg-slate-50 p-3"><div className="text-xs font-black text-slate-500">الشامي</div><div className="mt-1 text-2xl font-black">{branchHealth.shamy}%</div><div className="text-[10px] font-bold text-slate-400">حالات غير مطابقة</div></div></div>
          <div className="mt-3 rounded-xl border border-slate-100 p-3 text-xs font-bold leading-6 text-slate-600">تم إغلاق/استبعاد <b>{resolvedCount}</b> حالة · قواعد وحدات متعلمة <b>{learnedRules.length}</b> · حالات عبر منتصف الليل <b>{summary.cross_midnight}</b>.</div>
          {learnedRules.length > 0 && <div className="mt-3 space-y-2">{learnedRules.slice(0, 8).map((rule) => <div key={rule.key} className="flex items-center justify-between gap-3 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2"><div className="min-w-0"><div className="truncate text-sm font-black text-slate-900">{rule.product_name}</div><div className="text-[11px] font-bold text-slate-500">{transferBranchLabel(rule.from)} → {transferBranchLabel(rule.to)} · {unitRuleLabel(rule)}</div></div><Button size="sm" variant="ghost" onClick={() => revokeUnitRule(rule)} className="text-rose-600"><XCircle className="h-4 w-4" /></Button></div>)}</div>}
        </Card>
        <Card className="border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black text-slate-950"><UserRound className="h-4 w-4 text-violet-600" /> إشارات الموظفين</div>
          {!mostRepeatedEmployee ? <div className="mt-4 rounded-2xl bg-slate-50 p-6 text-center text-sm font-bold text-slate-500">لا توجد أخطاء مؤكدة مرتبطة بموظفين.</div> : <div className="mt-3 space-y-2">{employees.slice(0, 8).map((employee) => <div key={employee.name} className="flex items-center justify-between rounded-xl border border-slate-100 p-3"><div><div className="font-black text-slate-900">{employee.name}</div><div className="text-[10px] font-bold text-slate-400">بيع {employee.sale_cases} · شراء {employee.purchase_cases}</div></div><span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-black text-violet-700">{employee.cases}</span></div>)}</div>}
        </Card>
      </div>}

      <div className="flex items-start gap-2 rounded-2xl border border-amber-100 bg-amber-50/60 px-3 py-2.5 text-[11px] font-bold leading-5 text-amber-900"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> نسخة الاختبار فقط: قواعد التعلم وسجل القرارات محفوظان محليًا في المتصفح، ولا توجد كتابة على بيانات الإنتاج.</div>
    </div>
  </div>;
}
