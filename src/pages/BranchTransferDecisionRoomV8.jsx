import { useEffect, useMemo, useState } from 'react';
import {
  BrainCircuit, CheckCircle2, ChevronLeft, ChevronRight, Eye, EyeOff, FileSpreadsheet,
  List, Search, ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { inspectTransferFile, buildSourcesFromInspections } from '@/lib/branchTransferAutoImport';
import { reconcileBranchTransfers, explainTransferCase, transferBranchLabel } from '@/lib/branchTransferControl';
import { applyLearnedUnitRules, learnUnitRule, suggestUnitRule, humanUnitRuleLabel } from '@/lib/branchTransferUnitRules';
import { learnPackagingRule, packagingRuleSuggestion } from '@/lib/branchTransferPackagingIntelligence';
import { buildTransferIncidents } from '@/lib/branchTransferIncidentIntelligence';
import { completeResidualBalancedJourneys } from '@/lib/branchTransferResidualJourneyCompletion';
import { settleAggregateProductJourneys } from '@/lib/branchTransferAggregateJourneySettlement';
import { gateTransferReviewCases } from '@/lib/branchTransferReviewGate';
import { buildDecisionTriage, compareDecisionTriage } from '@/lib/branchTransferDecisionTriage';
import { buildDecisionPlan } from '@/lib/branchTransferDecisionPlan';
import { buildRootCauseIntelligence, rootCauseClusterForIncident } from '@/lib/branchTransferRootCauseIntelligence';
import { buildOneSecondDecision, oneSecondDecisionTone } from '@/lib/branchTransferOneSecondDecision';
import { calendarPeriodLabel, calendarPeriodRange, incidentMatchesCalendarPeriod } from '@/lib/branchTransferDateRange';
import { buildOperationTimeline } from '@/lib/branchTransferOperationTimeline';
import { summarizeTransferReturnEvidence, formatTransferReturnEvidence } from '@/lib/branchTransferReturnIntelligence';

const STORAGE_KEY = 'dawaa.branch-transfer-control.shadow.v1';
const sourceConfig = {
  shokrySale: { label: 'بيع شكري → الشامي', side: 'sale', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
  shamyPurchase: { label: 'شراء الشامي من شكري', side: 'purchase', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shamySale: { label: 'بيع الشامي → شكري', side: 'sale', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shokryPurchase: { label: 'شراء شكري من الشامي', side: 'purchase', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
};
const periodModes = [['today', 'اليوم'], ['yesterday', 'أمس'], ['last7', '7 أيام'], ['last14', '14 يوم'], ['all', 'كل الفترة'], ['custom', 'من / إلى']];

function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function unique(values = []) { return [...new Set(values.map(clean).filter(Boolean))]; }
function nowIso() { return new Date().toISOString(); }
function loadLedger() { try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); return { decisions: value.decisions || {}, events: Array.isArray(value.events) ? value.events : [], unitRules: value.unitRules || {}, packagingRules: value.packagingRules || {} }; } catch { return { decisions: {}, events: [], unitRules: {}, packagingRules: {} }; } }
function branchName(value) { const label = transferBranchLabel(value); if (/شكري|العزم/i.test(label)) return 'شكري'; if (/شامي/i.test(label)) return 'الشامي'; return label || value || 'الفرع'; }
function searchText(incident) { return [incident?.invoice, ...(incident?.product_names || []), ...(incident?.product_codes || []), ...(incident?.cases || []).flatMap((item) => [item?.product_name, ...(item?.sale_codes || []), ...(item?.purchase_codes || []), ...(item?.sale_invoices || []), ...(item?.purchase_invoices || [])])].join(' ').toLowerCase(); }
function qtyText(value, display) { if (display?.primary) return display.primary; const text = clean(value); return text || 'لا توجد حركة'; }
function toneClasses(mode) {
  const tone = oneSecondDecisionTone(mode);
  if (tone === 'teal') return 'border-teal-200 bg-teal-50 text-teal-950';
  if (tone === 'violet') return 'border-violet-200 bg-violet-50 text-violet-950';
  if (tone === 'slate') return 'border-slate-200 bg-slate-50 text-slate-800';
  return 'border-amber-200 bg-amber-50 text-amber-950';
}

export default function BranchTransferDecisionRoomV8() {
  const [sources, setSources] = useState({});
  const [ledger, setLedger] = useState(loadLedger);
  const [period, setPeriod] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [whyOpen, setWhyOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(true);
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
  const periodRange = useMemo(() => calendarPeriodRange(period, periodOptions), [period, periodOptions]);
  const periodIncidents = useMemo(() => plan.incidents.filter((entry) => incidentMatchesCalendarPeriod(entry, period, periodOptions)), [plan.incidents, period, periodOptions]);
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => [...periodIncidents].filter((entry) => !q || searchText(entry).includes(q)).sort((a, b) => compareDecisionTriage(a, b)), [periodIncidents, q]);
  const selectedIncident = useMemo(() => visible.find((entry) => entry.case_ids?.includes(selectedId)) || visible[0] || null, [visible, selectedId]);
  const selected = useMemo(() => selectedIncident?.cases?.find((entry) => entry.id === selectedId) || selectedIncident?.cases?.[0] || null, [selectedIncident, selectedId]);
  const selectedIndex = selectedIncident ? visible.findIndex((entry) => entry.id === selectedIncident.id) : -1;
  const rootCause = useMemo(() => buildRootCauseIntelligence(periodIncidents), [periodIncidents]);
  const selectedRootCause = useMemo(() => rootCauseClusterForIncident(rootCause, selectedIncident), [rootCause, selectedIncident]);
  const decision = useMemo(() => selectedIncident ? buildOneSecondDecision(selectedIncident) : null, [selectedIncident]);
  const timeline = useMemo(() => selectedIncident ? buildOperationTimeline(selectedIncident) : null, [selectedIncident]);
  const saleQty = Number(selected?.sale_qty || 0);
  const purchaseQty = Number(selected?.purchase_qty || 0);
  const saleReturn = selected ? summarizeTransferReturnEvidence(selected.sale_lines || [], saleQty) : null;
  const purchaseReturn = selected ? summarizeTransferReturnEvidence(selected.purchase_lines || [], purchaseQty) : null;
  const code = selected ? unique([...(selected.sale_codes || []), ...(selected.purchase_codes || [])])[0] || '' : '';
  const packagingSuggestion = selected?.packaging_profile_candidate ? packagingRuleSuggestion(selected) : null;
  const unitSuggestion = selected?.type === 'unit_conversion_review' && !packagingSuggestion ? suggestUnitRule(selected) : null;
  const periodCounts = useMemo(() => Object.fromEntries(periodModes.map(([key]) => [key, key === 'custom' ? undefined : plan.incidents.filter((entry) => incidentMatchesCalendarPeriod(entry, key, {})).length])), [plan.incidents]);

  useEffect(() => { setWhyOpen(false); }, [selectedIncident?.id]);

  const move = (delta) => {
    if (!visible.length || selectedIndex < 0) return;
    const next = (selectedIndex + delta + visible.length) % visible.length;
    setSelectedId(visible[next]?.cases?.[0]?.id || '');
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
    <div className="mx-auto max-w-[1500px] space-y-2 px-2 py-2 sm:px-4">
      <Card className="sticky top-2 z-40 border-slate-200 bg-white/95 p-2.5 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="ml-auto flex items-center gap-2"><div className="rounded-xl bg-slate-950 p-2 text-teal-300"><BrainCircuit className="h-4 w-4" /></div><div><div className="text-sm font-black">قرارات التحويلات</div><div className="text-[9px] font-bold text-slate-400">قرار واحد في كل مرة</div></div></div>
          <Button size="sm" variant="outline" onClick={() => setQueueOpen((v) => !v)} className="h-8 font-black"><List className="ml-1 h-3.5 w-3.5" />{visible.length} متبقي</Button>
          <Button size="sm" variant="outline" onClick={() => setUploadOpen((v) => !v)} className="h-8 font-black"><FileSpreadsheet className="ml-1 h-3.5 w-3.5" />الملفات</Button>
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto">{periodModes.map(([key, label]) => <button key={key} onClick={() => { setPeriod(key); setSelectedId(''); }} className={`rounded-full border px-3 py-1.5 text-[10px] font-black ${period === key ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{label}{Number.isFinite(periodCounts[key]) ? ` · ${periodCounts[key]}` : ''}</button>)}</div>
        {period === 'custom' && <div className="mt-2 flex flex-wrap items-end gap-2"><label className="text-[9px] font-black">من<input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="mt-1 block rounded-lg border px-2 py-1 text-xs" /></label><label className="text-[9px] font-black">إلى<input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="mt-1 block rounded-lg border px-2 py-1 text-xs" /></label><span className={`pb-1 text-[9px] font-black ${periodRange.valid ? 'text-teal-700' : 'text-rose-600'}`}>{periodRange.valid ? calendarPeriodLabel('custom', periodOptions) : 'الفترة غير صحيحة'}</span></div>}
      </Card>

      {uploadOpen && <Card className="p-2.5"><label className="flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-teal-300 bg-teal-50/60 p-3"><div><div className="text-xs font-black">ارفع ملفات البيع والشراء</div><div className="mt-0.5 text-[9px] font-bold text-slate-500">التحليل الكامل هيشتغل في الخلفية.</div></div><span className="rounded-full bg-teal-700 px-3 py-1 text-[10px] font-black text-white">{isInspecting ? 'جاري التحليل...' : 'اختيار'}</span><input className="hidden" type="file" multiple accept=".xlsx,.xls,.csv" disabled={isInspecting} onChange={(e) => handleFiles(Array.from(e.target.files || []))} /></label>{message && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-900">{message}</div>}{autoReport.ambiguous.map((entry) => <div key={entry.fileName} className="mt-2 rounded-xl border p-2"><b className="text-[10px]">{entry.fileName}</b><div className="mt-1 flex flex-wrap gap-1">{Object.entries(sourceConfig).map(([key, config]) => <Button key={key} size="sm" variant="outline" onClick={() => assignAmbiguous(entry, key)} className="h-7 text-[9px]">{config.label}</Button>)}</div></div>)}</Card>}

      {queueOpen && <Card className="p-2.5"><div className="relative mb-2"><Search className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="صنف أو كود أو فاتورة" className="w-full rounded-xl border py-2 pr-8 pl-3 text-xs font-bold" /></div><div className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{visible.map((incident, index) => <button key={incident.id} onClick={() => { setSelectedId(incident.cases?.[0]?.id || ''); setQueueOpen(false); }} className={`rounded-xl border px-3 py-2 text-right ${selectedIncident?.id === incident.id ? 'border-teal-400 bg-teal-50' : 'bg-white'}`}><div className="text-[8px] font-black text-slate-400">#{index + 1}</div><div className="truncate text-xs font-black">{incident.cases?.[0]?.product_name || 'صنف'}</div><div className="mt-1 truncate text-[9px] font-bold text-slate-500">{buildOneSecondDecision(incident).title}</div></button>)}</div></Card>}

      {!selectedIncident || !selected || !decision ? <Card className="flex min-h-[520px] items-center justify-center text-sm font-black text-slate-400">ارفع الملفات لبدء المراجعة.</Card> : <Card className="min-h-[560px] overflow-hidden">
        <div className="flex min-h-[560px] flex-col">
          <div className="flex items-center justify-between border-b px-4 py-3"><div className="min-w-0"><div className="text-[9px] font-black text-slate-400">{selectedIndex + 1} من {visible.length}</div><div className="truncate text-lg font-black">{selected.product_name || selectedIncident.product_names?.[0]}</div></div><div className="flex gap-1"><button onClick={() => move(-1)} className="rounded-xl border p-2"><ChevronRight className="h-4 w-4" /></button><button onClick={() => move(1)} className="rounded-xl border p-2"><ChevronLeft className="h-4 w-4" /></button></div></div>

          <div className="flex flex-1 items-center justify-center p-4 sm:p-8">
            <div className="w-full max-w-3xl text-center">
              <div className={`rounded-3xl border p-6 sm:p-10 ${toneClasses(decision.mode)}`}>
                <div className="text-[10px] font-black opacity-60">{decision.eyebrow}</div>
                <div className="mt-2 text-3xl font-black leading-tight sm:text-4xl">{decision.title}</div>
                <div className="mx-auto mt-3 max-w-xl text-sm font-bold leading-7 opacity-75">{decision.reason}</div>
                <div className="mt-4 text-[10px] font-black opacity-55">{branchName(selectedIncident.from)} · {qtyText(selected.sale_qty_label, selected.sale_qty_display)} &nbsp; ↔ &nbsp; {branchName(selectedIncident.to)} · {qtyText(selected.purchase_qty_label, selected.purchase_qty_display)}</div>
              </div>

              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button onClick={primaryAction} size="lg" className="min-w-[220px] bg-teal-700 text-base font-black hover:bg-teal-800">{decision.can_resolve && decision.mode !== 'wait' ? <CheckCircle2 className="ml-2 h-5 w-5" /> : null}{decision.primary_label}</Button>
                <Button variant="outline" size="lg" onClick={() => setWhyOpen((v) => !v)} className="font-black">{whyOpen ? <EyeOff className="ml-1 h-4 w-4" /> : <Eye className="ml-1 h-4 w-4" />}ليه؟</Button>
                <Button variant="ghost" size="lg" onClick={() => move(1)} className="font-black text-slate-500">التالي</Button>
              </div>

              {whyOpen && <div className="mt-4 rounded-2xl border bg-white p-4 text-right shadow-sm">
                <div className="flex items-start gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><div><div className="text-xs font-black">ليه النظام اقترح القرار ده؟</div><div className="mt-1 text-[10px] font-bold leading-5 text-slate-600">{selectedRootCause?.explanation || selectedIncident.action_plan?.why_now || decision.reason}</div></div></div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-xl bg-slate-50 p-3"><div className="text-[8px] font-black text-slate-400">الإجراء الآمن</div><div className="mt-1 text-[10px] font-black">{selectedRootCause?.recommended_action || selectedIncident.action_plan?.next_step}</div></div><div className="rounded-xl bg-amber-50 p-3"><div className="text-[8px] font-black text-amber-600">متى أتوقف؟</div><div className="mt-1 text-[10px] font-black text-amber-950">{selectedRootCause?.stop_condition || selectedIncident.action_plan?.stop_condition}</div></div></div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-xl border border-sky-100 bg-sky-50 p-3"><div className="text-[9px] font-black text-sky-700">دليل البيع</div>{timeline?.sale?.invoiceEvidence?.slice(0, 2).map((entry) => <div key={`s-${entry.invoice}`} className="mt-1 text-[9px] font-bold">فاتورة {entry.invoice} · {entry.qtyLabel}</div>)}</div><div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3"><div className="text-[9px] font-black text-emerald-700">دليل الشراء</div>{timeline?.purchase?.invoiceEvidence?.slice(0, 2).map((entry) => <div key={`p-${entry.invoice}`} className="mt-1 text-[9px] font-bold">فاتورة {entry.invoice} · {entry.qtyLabel}</div>)}</div></div>
                {(saleReturn?.has_return || purchaseReturn?.has_return) && <div className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-[9px] font-bold text-emerald-900">{saleReturn?.has_return ? formatTransferReturnEvidence(saleReturn, { movement: 'البيع' }) : ''}{saleReturn?.has_return && purchaseReturn?.has_return ? ' · ' : ''}{purchaseReturn?.has_return ? formatTransferReturnEvidence(purchaseReturn, { movement: 'الشراء' }) : ''}</div>}
                <div className="mt-3 flex flex-wrap gap-2 border-t pt-3"><Button size="sm" variant="outline" onClick={() => recordDecision('in_progress', decision.title)} className="font-black">متابعة</Button>{decision.can_dismiss && <Button size="sm" variant="ghost" onClick={() => recordDecision('dismissed', 'ليست مشكلة بعد المراجعة')} className="font-black text-slate-500">ليست مشكلة</Button>}</div>
              </div>}
            </div>
          </div>
        </div>
      </Card>}
    </div>
  </div>;
}
