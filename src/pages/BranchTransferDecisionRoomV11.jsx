import { useEffect, useMemo, useState } from 'react';
import {
  BrainCircuit, CheckCircle2, ChevronLeft, ChevronRight, Eye, FileSpreadsheet, List, Search,
  ShieldAlert, SkipForward, Sparkles, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import OperationalEvidenceStrip from '@/components/branch-transfer/OperationalEvidenceStrip';
import { inspectTransferFile, buildSourcesFromInspections } from '@/lib/branchTransferAutoImport';
import { reconcileBranchTransfers, explainTransferCase } from '@/lib/branchTransferControl';
import { applyLearnedUnitRules, learnUnitRule, suggestUnitRule, humanUnitRuleLabel } from '@/lib/branchTransferUnitRules';
import { learnPackagingRule, packagingRuleSuggestion } from '@/lib/branchTransferPackagingIntelligence';
import { buildTransferIncidents } from '@/lib/branchTransferIncidentIntelligence';
import { completeResidualBalancedJourneys } from '@/lib/branchTransferResidualJourneyCompletion';
import { settleAggregateProductJourneys } from '@/lib/branchTransferAggregateJourneySettlement';
import { gateTransferReviewCases } from '@/lib/branchTransferReviewGate';
import { buildDecisionTriage } from '@/lib/branchTransferDecisionTriage';
import { buildDecisionPlan } from '@/lib/branchTransferDecisionPlan';
import { buildRootCauseIntelligence, rootCauseClusterForIncident } from '@/lib/branchTransferRootCauseIntelligence';
import { calendarPeriodLabel, incidentMatchesCalendarPeriod } from '@/lib/branchTransferDateRange';
import { buildOperationTimeline } from '@/lib/branchTransferOperationTimeline';
import { buildNextBestActionQueue } from '@/lib/branchTransferNextBestAction';
import {
  incidentMatchesBranch, incidentMatchesIssue, countByBranch, countByIssue,
} from '@/lib/branchTransferReviewFilters';

const STORAGE_KEY = 'dawaa.branch-transfer-control.shadow.v1';
const sourceConfig = {
  shokrySale: { label: 'بيع شكري → الشامي', side: 'sale', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
  shamyPurchase: { label: 'شراء الشامي من شكري', side: 'purchase', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shamySale: { label: 'بيع الشامي → شكري', side: 'sale', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shokryPurchase: { label: 'شراء شكري من الشامي', side: 'purchase', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
};
const periodModes = [['today', 'اليوم'], ['yesterday', 'أمس'], ['last7', '7 أيام'], ['last14', '14 يوم'], ['all', 'كل الفترة'], ['custom', 'من / إلى']];
const branchModes = [['all', 'الكل'], ['shokry_to_shamy', 'شكري → الشامي'], ['shamy_to_shokry', 'الشامي → شكري']];
const issueModes = [
  ['all', 'كل المشاكل'],
  ['missing_side', 'طرف ناقص'],
  ['quantity', 'فرق كمية'],
  ['code', 'اختلاف كود'],
  ['unit_packaging', 'وحدة / عبوة'],
  ['evidence', 'دليل ناقص'],
];

function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function unique(values = []) { return [...new Set(values.map(clean).filter(Boolean))]; }
function nowIso() { return new Date().toISOString(); }
function loadLedger() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { decisions: value.decisions || {}, events: Array.isArray(value.events) ? value.events : [], unitRules: value.unitRules || {}, packagingRules: value.packagingRules || {} };
  } catch {
    return { decisions: {}, events: [], unitRules: {}, packagingRules: {} };
  }
}
function searchText(incident) {
  return [incident?.invoice, ...(incident?.product_names || []), ...(incident?.product_codes || []), ...(incident?.cases || []).flatMap((item) => [item?.product_name, ...(item?.sale_codes || []), ...(item?.purchase_codes || []), ...(item?.sale_invoices || []), ...(item?.purchase_invoices || [])])].join(' ').toLowerCase();
}
function qty(value, display) { return display?.primary || clean(value) || 'لا توجد حركة'; }
function modeClasses(mode) {
  if (mode === 'act') return 'border-teal-200 bg-teal-50 text-teal-950';
  if (mode === 'learn') return 'border-violet-200 bg-violet-50 text-violet-950';
  if (mode === 'wait') return 'border-slate-200 bg-slate-50 text-slate-800';
  return 'border-amber-200 bg-amber-50 text-amber-950';
}

export default function BranchTransferDecisionRoomV11() {
  const [sources, setSources] = useState({});
  const [ledger, setLedger] = useState(loadLedger);
  const [period, setPeriod] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [issueFilter, setIssueFilter] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [whyOpen, setWhyOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [isInspecting, setIsInspecting] = useState(false);
  const [autoReport, setAutoReport] = useState({ ambiguous: [], duplicates: [], errors: [] });
  const [message, setMessage] = useState('');

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger)); }, [ledger]);

  const sales = useMemo(() => Object.entries(sources).flatMap(([key, source]) => sourceConfig[key]?.side === 'sale' ? (source.items || []) : []), [sources]);
  const purchases = useMemo(() => Object.entries(sources).flatMap(([key, source]) => sourceConfig[key]?.side === 'purchase' ? (source.items || []) : []), [sources]);
  const sourcePresence = useMemo(() => Object.fromEntries(Object.keys(sourceConfig).map((key) => [key, Boolean(sources[key]?.items?.length)])), [sources]);
  const rawCases = useMemo(() => reconcileBranchTransfers(sales, purchases, { packagingRules: ledger.packagingRules || {} }), [sales, purchases, ledger.packagingRules]);
  const unitAware = useMemo(() => applyLearnedUnitRules(rawCases, ledger.unitRules || {}), [rawCases, ledger.unitRules]);
  const residual = useMemo(() => completeResidualBalancedJourneys(unitAware), [unitAware]);
  const settled = useMemo(() => settleAggregateProductJourneys(residual), [residual]);
  const decorated = useMemo(() => settled.map((item) => ({ ...item, decision_intelligence: explainTransferCase(item), decision: ledger.decisions[item.id] })), [settled, ledger.decisions]);
  const gate = useMemo(() => gateTransferReviewCases(decorated, sourcePresence), [decorated, sourcePresence]);
  const incidents = useMemo(() => buildTransferIncidents(gate.actionable), [gate.actionable]);
  const triage = useMemo(() => buildDecisionTriage(incidents, ledger), [incidents, ledger]);
  const plan = useMemo(() => buildDecisionPlan(triage.incidents), [triage.incidents]);
  const periodOptions = useMemo(() => ({ from: customFrom, to: customTo }), [customFrom, customTo]);
  const periodIncidents = useMemo(() => plan.incidents.filter((entry) => incidentMatchesCalendarPeriod(entry, period, periodOptions)), [plan.incidents, period, periodOptions]);
  const branchCounts = useMemo(() => countByBranch(periodIncidents), [periodIncidents]);
  const branchIncidents = useMemo(() => periodIncidents.filter((entry) => incidentMatchesBranch(entry, branchFilter)), [periodIncidents, branchFilter]);
  const issueCounts = useMemo(() => countByIssue(branchIncidents), [branchIncidents]);
  const visibleIncidents = useMemo(() => branchIncidents.filter((entry) => incidentMatchesIssue(entry, issueFilter)), [branchIncidents, issueFilter]);
  const actionQueue = useMemo(() => buildNextBestActionQueue(visibleIncidents), [visibleIncidents]);
  const filteredQueue = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? actionQueue.items.filter((entry) => searchText(entry.incident).includes(q)) : actionQueue.items;
  }, [actionQueue, query]);
  const currentIndex = useMemo(() => Math.max(0, filteredQueue.findIndex((entry) => entry.incident?.case_ids?.includes(selectedId))), [filteredQueue, selectedId]);
  const currentAction = filteredQueue[currentIndex] || filteredQueue[0] || null;
  const selectedIncident = currentAction?.incident || null;
  const decision = currentAction?.decision || null;
  const selected = useMemo(() => selectedIncident?.cases?.find((entry) => entry.id === selectedId) || selectedIncident?.cases?.[0] || null, [selectedIncident, selectedId]);
  const rootCause = useMemo(() => buildRootCauseIntelligence(visibleIncidents), [visibleIncidents]);
  const selectedRootCause = useMemo(() => rootCauseClusterForIncident(rootCause, selectedIncident), [rootCause, selectedIncident]);
  const timeline = useMemo(() => selectedIncident ? buildOperationTimeline(selectedIncident) : null, [selectedIncident]);
  const code = selected ? unique([...(selected.sale_codes || []), ...(selected.purchase_codes || [])])[0] || '' : '';
  const packagingSuggestion = selected?.packaging_profile_candidate ? packagingRuleSuggestion(selected) : null;
  const unitSuggestion = selected?.type === 'unit_conversion_review' && !packagingSuggestion ? suggestUnitRule(selected) : null;

  useEffect(() => { setWhyOpen(false); }, [selectedIncident?.id]);
  useEffect(() => { setSelectedId(''); }, [period, customFrom, customTo, branchFilter, issueFilter]);

  const move = (delta) => {
    if (!filteredQueue.length) return;
    const index = filteredQueue.findIndex((entry) => entry.incident?.id === selectedIncident?.id);
    const safeIndex = index >= 0 ? index : 0;
    const next = (safeIndex + delta + filteredQueue.length) % filteredQueue.length;
    setSelectedId(filteredQueue[next]?.incident?.cases?.[0]?.id || '');
  };

  const recordDecision = (status, action) => {
    if (!selectedIncident) return;
    const at = nowIso();
    setLedger((old) => {
      const decisions = { ...old.decisions };
      const events = [];
      selectedIncident.cases.forEach((item) => {
        const productCode = unique([...(item.sale_codes || []), ...(item.purchase_codes || [])])[0] || '';
        decisions[item.id] = { status, action, updated_at: at, incident_id: selectedIncident.id };
        events.push({ case_id: item.id, incident_id: selectedIncident.id, action, status, at, product_name: item.product_name, product_code: productCode });
      });
      return { ...old, decisions, events: [...events, ...old.events].slice(0, 1000) };
    });
    setSelectedId('');
  };

  const approvePackaging = () => {
    if (!selected || !packagingSuggestion) return;
    const at = nowIso();
    setLedger((old) => ({
      ...old,
      packagingRules: learnPackagingRule(selected, old.packagingRules || {}),
      decisions: { ...old.decisions, [selected.id]: { status: 'verified', action: `اعتماد ملف العبوة: ${packagingSuggestion.label}`, updated_at: at } },
      events: [{ case_id: selected.id, action: 'packaging_rule_learned', status: 'verified', at, product_name: selected.product_name, product_code: code }, ...old.events].slice(0, 1000),
    }));
    setSelectedId('');
  };

  const approveUnit = () => {
    if (!selected || !unitSuggestion) return;
    const at = nowIso();
    setLedger((old) => ({
      ...old,
      unitRules: learnUnitRule(selected, old.unitRules || {}),
      decisions: { ...old.decisions, [selected.id]: { status: 'verified', action: `اعتماد تحويل العبوة: ${humanUnitRuleLabel(unitSuggestion)}`, updated_at: at } },
      events: [{ case_id: selected.id, action: 'unit_rule_learned', status: 'verified', at, product_name: selected.product_name, product_code: code }, ...old.events].slice(0, 1000),
    }));
    setSelectedId('');
  };

  const primaryAction = () => {
    if (!decision || !selectedIncident) return;
    if (decision.mode === 'wait') return move(1);
    if (packagingSuggestion) return approvePackaging();
    if (unitSuggestion) return approveUnit();
    if (!decision.can_resolve) return setWhyOpen(true);
    return recordDecision('verified', decision.title);
  };

  const handleFiles = async (files) => {
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
      if (grouped.duplicates.length) notes.push(`تم تجاهل ${grouped.duplicates.length} ملف مكرر.`);
      if (grouped.ambiguous.length) notes.push(`${grouped.ambiguous.length} ملف يحتاج تحديد اتجاه.`);
      if (grouped.errors.length) notes.push(`${grouped.errors.length} ملف تعذر قراءته.`);
      setMessage(notes.join(' '));
      setSelectedId('');
      setUploadOpen(Boolean(grouped.ambiguous.length || grouped.errors.length));
    } finally { setIsInspecting(false); }
  };

  const assignAmbiguous = (entry, sourceKey) => {
    const config = sourceConfig[sourceKey];
    const items = (entry.parsed?.items || []).map((item) => ({ ...item, branch: config.branch, counterparty: config.counterparty }));
    setSources((old) => {
      const bucket = old[sourceKey] || { valid: true, items: [], fileNames: [] };
      return { ...old, [sourceKey]: { ...bucket, valid: true, items: [...bucket.items, ...items], fileNames: [...(bucket.fileNames || []), entry.fileName] } };
    });
    setAutoReport((old) => ({ ...old, ambiguous: old.ambiguous.filter((item) => item !== entry) }));
  };

  return <div dir="rtl" className="min-h-full bg-slate-50">
    <div className="mx-auto max-w-[1400px] px-2 py-2 sm:px-4">
      <Card className="sticky top-2 z-40 border-slate-200 bg-white/95 p-2.5 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="ml-auto flex items-center gap-2"><div className="rounded-xl bg-slate-950 p-2 text-teal-300"><BrainCircuit className="h-4 w-4" /></div><div><div className="text-sm font-black">القرار التالي</div><div className="text-[9px] font-bold text-slate-400">فلتر الفرع والمشكلة فوق — القرار يفضل بسيط</div></div></div>
          <Button size="sm" variant="outline" onClick={() => setQueueOpen((v) => !v)} className="h-8 font-black"><List className="ml-1 h-3.5 w-3.5" />{queueOpen ? 'إخفاء القائمة' : `القائمة ${filteredQueue.length}`}</Button>
          <Button size="sm" variant="outline" onClick={() => setUploadOpen((v) => !v)} className="h-8 font-black"><FileSpreadsheet className="ml-1 h-3.5 w-3.5" />الملفات</Button>
        </div>

        <div className="mt-2 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
          {branchModes.map(([key, label]) => <button key={key} onClick={() => { setBranchFilter(key); setIssueFilter('all'); }} className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-[11px] font-black transition ${branchFilter === key ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{label}<span className="mr-1.5 rounded-full bg-slate-200/80 px-1.5 py-0.5 text-[9px]">{branchCounts[key] || 0}</span></button>)}
        </div>

        <div className="mt-2 flex items-center gap-1 overflow-x-auto">
          {issueModes.filter(([key]) => key === 'all' || (issueCounts[key] || 0) > 0).map(([key, label]) => <button key={key} onClick={() => setIssueFilter(key)} className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[10px] font-black ${issueFilter === key ? 'border-teal-700 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white text-slate-600'}`}>{label}<span className="mr-1 text-[9px] opacity-60">{issueCounts[key] || 0}</span></button>)}
          {issueCounts.other > 0 && <button onClick={() => setIssueFilter('other')} className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[10px] font-black ${issueFilter === 'other' ? 'border-teal-700 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white text-slate-600'}`}>أخرى <span className="mr-1 text-[9px] opacity-60">{issueCounts.other}</span></button>}
        </div>

        <div className="mt-2 flex items-center gap-1 overflow-x-auto border-t pt-2">{periodModes.map(([key, label]) => <button key={key} onClick={() => setPeriod(key)} className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[9px] font-black ${period === key ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-500'}`}>{label}</button>)}</div>
        {period === 'custom' && <div className="mt-2 flex flex-wrap gap-2"><input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-lg border px-2 py-1.5 text-xs font-bold" /><span className="self-center text-[10px] font-black text-slate-400">إلى</span><input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded-lg border px-2 py-1.5 text-xs font-bold" /></div>}
      </Card>

      {uploadOpen && <Card className="mt-2 p-2.5"><label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-teal-300 bg-teal-50/60 p-3"><div><div className="text-xs font-black">ارفع ملفات البيع والشراء</div><div className="mt-0.5 text-[9px] font-bold text-slate-500">بعد التحليل هتشوف القرار ومفاتيح التحقق اللازمة فقط.</div></div><span className="rounded-full bg-teal-700 px-3 py-1 text-[10px] font-black text-white">{isInspecting ? 'جاري التحليل...' : 'اختيار'}</span><input className="hidden" type="file" multiple accept=".xlsx,.xls,.csv" disabled={isInspecting} onChange={(e) => handleFiles(Array.from(e.target.files || []))} /></label>{message && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-900">{message}</div>}{autoReport.ambiguous.map((entry) => <div key={entry.fileName} className="mt-2 rounded-xl border p-2"><b className="text-[10px]">{entry.fileName}</b><div className="mt-1 flex flex-wrap gap-1">{Object.entries(sourceConfig).map(([key, config]) => <Button key={key} size="sm" variant="outline" onClick={() => assignAmbiguous(entry, key)} className="h-7 text-[9px]">{config.label}</Button>)}</div></div>)}</Card>}

      <div className={`mt-2 grid gap-2 ${queueOpen ? 'lg:grid-cols-[320px_minmax(0,1fr)]' : 'grid-cols-1'}`}>
        {queueOpen && <Card className="h-[calc(100vh-245px)] min-h-[520px] overflow-hidden"><div className="flex h-full flex-col"><div className="border-b p-2.5"><div className="relative"><Search className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث عن صنف أو كود" className="w-full rounded-xl border py-2 pr-8 pl-3 text-xs font-bold" /></div></div><div className="flex-1 space-y-1 overflow-y-auto p-1.5">{filteredQueue.map((entry, index) => { const active = selectedIncident?.id === entry.incident?.id; return <button key={entry.incident?.id || index} onClick={() => setSelectedId(entry.incident?.cases?.[0]?.id || '')} className={`w-full rounded-xl border p-2.5 text-right ${active ? 'border-teal-300 bg-teal-50 ring-1 ring-teal-200' : 'border-slate-200 bg-white'}`}><div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-black">{entry.product_name}</span><span className="shrink-0 text-[8px] font-black text-slate-400">{index + 1}</span></div><div className="mt-1 truncate text-[10px] font-black text-slate-600">{entry.decision?.title}</div></button>; })}</div></div></Card>}

        <Card className="relative min-h-[calc(100vh-245px)] overflow-hidden bg-white">
          {!currentAction || !selectedIncident || !selected || !decision ? <div className="flex min-h-[520px] items-center justify-center p-8 text-center"><div><BrainCircuit className="mx-auto h-10 w-10 text-slate-300" /><div className="mt-3 text-base font-black text-slate-700">{periodIncidents.length ? 'لا توجد حالات بهذا الفلتر' : 'ارفع الملفات'}</div><div className="mt-1 text-xs font-bold text-slate-400">{periodIncidents.length ? 'غيّر الفرع أو نوع المشكلة.' : 'والنظام هيختار لك أول قرار.'}</div></div></div> : <div className="flex min-h-[calc(100vh-245px)] flex-col">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-3"><div className="text-[10px] font-black text-slate-400">{calendarPeriodLabel(period, periodOptions)} · {currentIndex + 1} من {filteredQueue.length}</div><div className="flex items-center gap-1"><button onClick={() => move(-1)} className="rounded-lg border p-1.5"><ChevronRight className="h-4 w-4" /></button><button onClick={() => move(1)} className="rounded-lg border p-1.5"><ChevronLeft className="h-4 w-4" /></button></div></div>

            <div className="flex flex-1 items-start justify-center overflow-y-auto p-4 sm:p-6">
              <div className="w-full max-w-4xl text-center">
                <div className="text-sm font-black text-slate-400">{currentAction.product_name}</div>
                <div className={`mx-auto mt-3 max-w-3xl rounded-[28px] border px-5 py-5 sm:px-8 sm:py-6 ${modeClasses(decision.mode)}`}>
                  <div className="text-[10px] font-black opacity-55">{decision.eyebrow}</div>
                  <h1 className="mt-2 text-2xl font-black leading-tight sm:text-3xl">{decision.title}</h1>
                  <p className="mx-auto mt-3 max-w-2xl text-sm font-bold leading-6 opacity-75">{decision.reason}</p>
                </div>

                <OperationalEvidenceStrip selected={selected} timeline={timeline} productName={currentAction.product_name} />

                <div className="mx-auto mt-4 flex max-w-2xl flex-wrap items-center justify-center gap-2">
                  <Button onClick={primaryAction} disabled={decision.mode === 'wait' && filteredQueue.length <= 1} className="min-w-[220px] bg-teal-700 px-8 py-6 text-base font-black hover:bg-teal-800">{decision.mode === 'wait' ? <SkipForward className="ml-2 h-5 w-5" /> : decision.mode === 'learn' ? <Sparkles className="ml-2 h-5 w-5" /> : decision.can_resolve ? <CheckCircle2 className="ml-2 h-5 w-5" /> : <Eye className="ml-2 h-5 w-5" />}{decision.primary_label}</Button>
                  <Button variant="outline" onClick={() => setWhyOpen((v) => !v)} className="px-6 py-6 font-black"><Eye className="ml-2 h-4 w-4" />ليه؟</Button>
                  <Button variant="ghost" onClick={() => move(1)} className="px-5 py-6 font-black text-slate-500"><SkipForward className="ml-2 h-4 w-4" />تخطي</Button>
                </div>
              </div>
            </div>

            {whyOpen && <div className="absolute inset-x-2 bottom-2 z-20 max-h-[72%] overflow-y-auto rounded-3xl border bg-white p-4 shadow-2xl sm:inset-x-4"><div className="flex items-center justify-between gap-3"><div><div className="text-[10px] font-black text-slate-400">ليه القرار ده؟</div><div className="mt-1 text-base font-black">{selectedRootCause?.title || decision.title}</div></div><button onClick={() => setWhyOpen(false)} className="rounded-full border p-2"><X className="h-4 w-4" /></button></div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3"><div className="rounded-xl bg-sky-50 p-3"><div className="text-[9px] font-black text-sky-600">بيع</div><div className="mt-1 text-sm font-black">{qty(selected.sale_qty_label || selected.sale_qty, selected.sale_qty_display)}</div></div><div className="rounded-xl bg-emerald-50 p-3"><div className="text-[9px] font-black text-emerald-600">شراء</div><div className="mt-1 text-sm font-black">{qty(selected.purchase_qty_label || selected.purchase_qty, selected.purchase_qty_display)}</div></div><div className="rounded-xl bg-amber-50 p-3"><div className="text-[9px] font-black text-amber-600">المتبقي</div><div className="mt-1 text-sm font-black">{qty(selected.remaining_qty_display?.primary, selected.remaining_qty_display)}</div></div></div>
              <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs font-bold leading-6 text-slate-700">{selectedRootCause?.explanation || selectedIncident?.action_plan?.why_now || decision.reason}</div>
              {(selected.mixed_units_detected || selected.packaging_conflict || selectedIncident.kind === 'code_mismatch') && <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-950"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />الحالة دي ممنوع تتحسم تلقائيًا قبل مراجعة الدليل.</div>}
              <div className="mt-3 grid gap-2 lg:grid-cols-2"><div className="rounded-xl border p-3"><div className="text-[9px] font-black text-slate-400">دليل البيع</div>{timeline?.sale?.invoiceEvidence?.slice(0, 2).map((entry) => <div key={`s-${entry.invoice}`} className="mt-1 text-[10px] font-bold">فاتورة {entry.invoice} · {entry.qtyLabel}</div>) || <div className="mt-1 text-[10px] text-slate-400">لا يوجد</div>}</div><div className="rounded-xl border p-3"><div className="text-[9px] font-black text-slate-400">دليل الشراء</div>{timeline?.purchase?.invoiceEvidence?.slice(0, 2).map((entry) => <div key={`p-${entry.invoice}`} className="mt-1 text-[10px] font-bold">فاتورة {entry.invoice} · {entry.qtyLabel}</div>) || <div className="mt-1 text-[10px] text-slate-400">لا يوجد</div>}</div></div>
            </div>}
          </div>}
        </Card>
      </div>
    </div>
  </div>;
}
