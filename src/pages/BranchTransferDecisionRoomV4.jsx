import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp, BarChart3, BrainCircuit, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  ChevronUp, Copy, Eye, EyeOff, FileSpreadsheet, Files, FilterX, Gauge, History, PanelLeftClose, PanelLeftOpen,
  Repeat2, Search, ShieldAlert, SlidersHorizontal, Sparkles, UserCheck, Zap,
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
import { branchReviewQueueForIncident, incidentMatchesBranchQueue } from '@/lib/branchTransferBranchQueue';
import { compareIncidentsByDay, formatIncidentDayLabel, incidentDayKey } from '@/lib/branchTransferIncidentDay';
import { summarizeTransferReturnEvidence, formatTransferReturnEvidence } from '@/lib/branchTransferReturnIntelligence';
import { buildOperationTimeline } from '@/lib/branchTransferOperationTimeline';
import { buildDecisionTriage, compareDecisionTriage, incidentMatchesTriage } from '@/lib/branchTransferDecisionTriage';
import { calendarPeriodLabel, calendarPeriodRange, incidentMatchesCalendarPeriod } from '@/lib/branchTransferDateRange';

const STORAGE_KEY = 'dawaa.branch-transfer-control.shadow.v1';

const sourceConfig = {
  shokrySale: { label: 'بيع شكري → الشامي', side: 'sale', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
  shamyPurchase: { label: 'شراء الشامي من شكري', side: 'purchase', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shamySale: { label: 'بيع الشامي → شكري', side: 'sale', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shokryPurchase: { label: 'شراء شكري من الشامي', side: 'purchase', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
};

const issueFilters = [
  ['all', 'كل القرارات'], ['missing', 'طرف ناقص'], ['quantity', 'فرق كمية'], ['invoice', 'فاتورة كاملة'], ['code', 'اختلاف كود'], ['unit', 'تحويل عبوة'],
];
const queueFilters = [['all', 'كل الفروع'], ['shamy', 'الشامي'], ['shokry', 'شكري'], ['shared', 'مشترك']];
const sortFilters = [['priority', 'الأذكى أولًا'], ['newest', 'الأحدث'], ['oldest', 'الأقدم']];
const triageModes = [
  ['all', 'الكل', BrainCircuit], ['quick', 'حسم سريع', Zap], ['important', 'مهم', Gauge],
  ['learning', 'تعلم النظام', Repeat2], ['human', 'تحقق بشري', UserCheck],
];
const periodModes = [
  ['today', 'اليوم'], ['yesterday', 'أمس'], ['last7', '7 أيام'], ['last14', '14 يوم'], ['all', 'كل الفترة'], ['custom', 'من / إلى'],
];

function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function unique(values = []) { return [...new Set(values.map(clean).filter(Boolean))]; }
function nowIso() { return new Date().toISOString(); }

function loadLedger() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      decisions: value.decisions || {},
      events: Array.isArray(value.events) ? value.events : [],
      unitRules: value.unitRules || {},
      packagingRules: value.packagingRules || {},
    };
  } catch {
    return { decisions: {}, events: [], unitRules: {}, packagingRules: {} };
  }
}

function branchName(value) {
  const label = transferBranchLabel(value);
  if (/شكري|العزم/i.test(label)) return 'شكري';
  if (/شامي/i.test(label)) return 'الشامي';
  return label || value || 'الفرع';
}

function issueMatches(incident, filter) {
  if (filter === 'quantity') return incident.kind === 'quantity_mismatch';
  if (filter === 'unit') return incident.kind === 'unit_conversion';
  if (filter === 'code') return incident.kind === 'code_mismatch';
  if (filter === 'invoice') return ['whole_sale_invoice_missing', 'whole_purchase_invoice_missing'].includes(incident.kind);
  if (filter === 'missing') return ['whole_sale_invoice_missing', 'partial_sale_invoice_missing', 'whole_purchase_invoice_missing', 'partial_purchase_invoice_missing', 'single_missing'].includes(incident.kind);
  return true;
}

function incidentTitle(incident) {
  if (incident.kind === 'quantity_mismatch') return 'فرق كمية';
  if (incident.kind === 'code_mismatch') return 'اختلاف كود';
  if (incident.kind === 'unit_conversion') return 'تحويل عبوة';
  if (['whole_sale_invoice_missing', 'whole_purchase_invoice_missing'].includes(incident.kind)) return 'فاتورة كاملة ناقصة';
  return 'طرف ناقص';
}

function queueLabel(incident) {
  const queue = branchReviewQueueForIncident(incident);
  if (queue === 'shamy') return 'الشامي';
  if (queue === 'shokry') return 'شكري';
  return 'مشترك';
}

function searchText(incident) {
  return [incident.invoice, ...(incident.product_names || []), ...(incident.product_codes || []), ...(incident.cases || []).flatMap((item) => [
    item.product_name, ...(item.sale_codes || []), ...(item.purchase_codes || []), ...(item.sale_invoices || []), ...(item.purchase_invoices || []),
  ])].join(' ').toLowerCase();
}

function decisionFor(incident, item) {
  const from = branchName(incident.from);
  const to = branchName(incident.to);
  if (item?.mixed_units_detected) return { headline: 'راجع وحدات الحركة', reason: 'فيه أكثر من وحدة فعلية، والنظام رفض يجمعهم في رقم مضلل.', tone: 'amber' };
  if (item?.packaging_profile_candidate && item?.packaging_profile?.label) return { headline: `أكد ${item.packaging_profile.label}`, reason: item.packaging_reason || 'الفرق غالبًا سببه طريقة تسجيل الشريط مقابل العلبة.', tone: 'sky' };
  if (item?.packaging_normalized_mismatch) return { headline: item?.remaining_qty_display?.primary ? `راجع ${item.remaining_qty_display.primary}` : 'راجع فرق العبوة', reason: item.packaging_reason || 'تم توحيد العبوة قبل حساب الفرق.', tone: 'amber' };
  if (item?.residual_progress_status === 'partial') return { headline: item?.remaining_qty_display?.precise ? `راجع ${item.remaining_qty_display.primary}` : 'راجع الاستكمال الجزئي', reason: item.residual_review_reason || 'جزء من الحركة اتسجل لاحقًا ولسه جزء محتاج قرار.', tone: 'amber' };
  if (incident.side === 'sale') return { headline: `شراء ${to} غير موجود`, reason: `بيع ${from} موجود، لكن الحركة المقابلة غير محسومة ضمن التغطية الحالية.`, tone: 'rose' };
  if (incident.side === 'purchase') return { headline: `بيع ${from} غير موجود`, reason: `شراء ${to} موجود، لكن الحركة المقابلة غير محسومة ضمن التغطية الحالية.`, tone: 'rose' };
  if (incident.kind === 'quantity_mismatch') return { headline: item?.remaining_qty_display?.precise ? `راجع ${item.remaining_qty_display.primary}` : 'راجع فرق الكمية', reason: item?.remaining_qty_display?.precise ? 'ده الفرق الصافي بعد التجميع والمرتجعات.' : 'لا يوجد فرق رقمي آمن قبل توحيد الوحدة.', tone: 'amber' };
  if (incident.kind === 'code_mismatch') return { headline: 'احسم هوية الصنف', reason: 'الكود مختلف؛ لا يتم الدمج تلقائيًا حتى لو الاسم قريب.', tone: 'violet' };
  if (incident.kind === 'unit_conversion') {
    const rule = suggestUnitRule(item);
    return { headline: rule ? `أكد ${humanUnitRuleLabel(rule)}` : 'أكد علاقة العبوة', reason: 'بعد الاعتماد يتعلم النظام نفس التحويل تلقائيًا.', tone: 'sky' };
  }
  return { headline: 'راجع الحركة', reason: incident.summary || '', tone: 'slate' };
}

function toneClass(tone) {
  if (tone === 'rose') return 'border-rose-200 bg-rose-50 text-rose-950';
  if (tone === 'violet') return 'border-violet-200 bg-violet-50 text-violet-950';
  if (tone === 'sky') return 'border-sky-200 bg-sky-50 text-sky-950';
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-950';
  return 'border-slate-200 bg-slate-50 text-slate-950';
}

function quantityParts(value, display) {
  if (display?.primary) return { primary: display.primary, detail: display.secondary || '', empty: display.kind === 'none' };
  const normalized = clean(value);
  if (!normalized) return { primary: '—', detail: '', empty: true };
  if (normalized === 'لا توجد حركة') return { primary: normalized, detail: '', empty: true };
  const [primary, ...detail] = normalized.split(' · ');
  return { primary, detail: detail.join(' · '), empty: false };
}

function QtyTile({ label, value, display, branch, tone }) {
  const parts = quantityParts(value, display);
  const styles = tone === 'sale' ? 'border-sky-200 bg-sky-50/70' : tone === 'purchase' ? 'border-emerald-200 bg-emerald-50/70' : 'border-amber-200 bg-amber-50/70';
  return <div className={`rounded-2xl border px-3 py-2.5 ${styles}`}>
    <div className="flex items-center justify-between gap-2"><span className="text-[9px] font-black text-slate-400">{label}</span>{branch && <span className="rounded-full bg-white/90 px-2 py-0.5 text-[8px] font-black text-slate-500">{branch}</span>}</div>
    <div className={`mt-1.5 font-black leading-tight ${parts.empty ? 'text-xs text-slate-400' : 'text-lg text-slate-950'}`}>{parts.primary}</div>
    {parts.detail && <div className="mt-1 text-[9px] font-black text-slate-500">{parts.detail}</div>}
  </div>;
}

function MiniMetric({ label, value, tone = 'slate' }) {
  const styles = tone === 'teal' ? 'bg-teal-50 text-teal-800' : tone === 'violet' ? 'bg-violet-50 text-violet-800' : tone === 'rose' ? 'bg-rose-50 text-rose-800' : 'bg-slate-100 text-slate-700';
  return <div className={`rounded-xl px-2.5 py-1.5 ${styles}`}><div className="text-[8px] font-black opacity-60">{label}</div><div className="text-sm font-black">{value}</div></div>;
}

function PeriodChip({ label, active, count, onClick }) {
  return <button onClick={onClick} className={`rounded-full border px-3 py-1.5 text-[10px] font-black transition ${active ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300'}`}>{label}{Number.isFinite(count) && <span className="mr-1 opacity-70">{count}</span>}</button>;
}

function FilterChip({ label, active, count, onClick }) {
  return <button onClick={onClick} className={`rounded-xl border px-2.5 py-2 text-[10px] font-black transition ${active ? 'border-teal-400 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>{label}<span className="mr-1 text-[9px] opacity-60">{count ?? 0}</span></button>;
}

function EvidenceLine({ title, branch, metadata, tone }) {
  const first = metadata?.invoiceEvidence?.[0];
  const qty = quantityParts(first?.qtyLabel || first?.qty, first?.qtyDisplay);
  const styles = tone === 'sale' ? 'border-sky-100 bg-sky-50/50' : 'border-emerald-100 bg-emerald-50/50';
  return <div className={`rounded-xl border px-3 py-2 ${styles}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-[10px] font-black text-slate-500">{title} · {branch}</div><div className="text-[9px] font-black text-slate-400">{first ? `فاتورة ${first.invoice}` : 'لا توجد فاتورة'}</div></div>
    {first ? <div className="mt-1 flex flex-wrap items-center justify-between gap-2"><b className="text-sm text-slate-950">{qty.primary}</b><span className="text-[9px] font-bold text-slate-500">{first.actor} · {first.dateLabel}</span></div> : <div className="mt-1 text-[10px] font-bold text-slate-400">لا توجد حركة مسجلة في الملفات الحالية.</div>}
    {first?.mixedUnits && <div className="mt-1 text-[9px] font-black text-amber-700">وحدات مختلفة — لم يتم جمعها رقميًا.</div>}
  </div>;
}

function PackagingInsight({ item }) {
  const profile = item?.packaging_profile;
  if (!profile?.strips_per_box) return null;
  const confidence = profile.confidence === 'confirmed' ? 'مؤكدة' : profile.confidence === 'high' ? 'عالية' : profile.confidence === 'medium' ? 'محتملة' : 'مبدئية';
  return <div className="rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2 text-[10px] font-bold text-sky-950"><div className="flex flex-wrap items-center justify-between gap-2"><b className="inline-flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" /> فهم العبوة</b><span className="font-black">{profile.label} · {confidence}</span></div>{item.packaging_reason && <div className="mt-1 leading-5 text-sky-800">{item.packaging_reason}</div>}</div>;
}

function sortIncidents(values, sort) {
  const copy = [...values];
  if (sort === 'newest') return copy.sort((a, b) => compareIncidentsByDay(a, b, () => 0));
  if (sort === 'oldest') return copy.sort((a, b) => compareIncidentsByDay(b, a, () => 0));
  return copy.sort((a, b) => compareDecisionTriage(a, b) || compareIncidentsByDay(a, b, () => 0));
}

export default function BranchTransferDecisionRoomV4() {
  const [sources, setSources] = useState({});
  const [ledger, setLedger] = useState(loadLedger);
  const [uploadOpen, setUploadOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [deepEvidenceOpen, setDeepEvidenceOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [queueOpen, setQueueOpen] = useState(true);
  const [isInspecting, setIsInspecting] = useState(false);
  const [autoReport, setAutoReport] = useState({ ambiguous: [], duplicates: [], errors: [] });
  const [message, setMessage] = useState('');
  const [queue, setQueue] = useState('all');
  const [issue, setIssue] = useState('all');
  const [triageMode, setTriageMode] = useState('all');
  const [period, setPeriod] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [sort, setSort] = useState('priority');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger)); }, [ledger]);

  const sales = useMemo(() => Object.entries(sources).flatMap(([key, source]) => sourceConfig[key]?.side === 'sale' ? (source.items || []) : []), [sources]);
  const purchases = useMemo(() => Object.entries(sources).flatMap(([key, source]) => sourceConfig[key]?.side === 'purchase' ? (source.items || []) : []), [sources]);
  const sourcePresence = useMemo(() => Object.fromEntries(Object.keys(sourceConfig).map((key) => [key, Boolean(sources[key]?.items?.length)])), [sources]);

  const rawCases = useMemo(() => reconcileBranchTransfers(sales, purchases, { packagingRules: ledger.packagingRules || {} }), [sales, purchases, ledger.packagingRules]);
  const unitAwareCases = useMemo(() => applyLearnedUnitRules(rawCases, ledger.unitRules), [rawCases, ledger.unitRules]);
  const residualCases = useMemo(() => completeResidualBalancedJourneys(unitAwareCases), [unitAwareCases]);
  const settledCases = useMemo(() => settleAggregateProductJourneys(residualCases), [residualCases]);
  const decoratedCases = useMemo(() => settledCases.map((item) => ({ ...item, decision_intelligence: explainTransferCase(item), decision: ledger.decisions[item.id] })), [settledCases, ledger.decisions]);
  const gate = useMemo(() => gateTransferReviewCases(decoratedCases, sourcePresence), [decoratedCases, sourcePresence]);
  const incidents = useMemo(() => buildTransferIncidents(gate.actionable), [gate.actionable]);
  const triage = useMemo(() => buildDecisionTriage(incidents, ledger), [incidents, ledger]);
  const smartIncidents = triage.incidents;

  const periodOptions = useMemo(() => ({ from: customFrom, to: customTo }), [customFrom, customTo]);
  const periodRange = useMemo(() => calendarPeriodRange(period, periodOptions), [period, periodOptions]);
  const periodCounts = useMemo(() => Object.fromEntries(periodModes.map(([key]) => [key, key === 'custom' ? undefined : smartIncidents.filter((entry) => incidentMatchesCalendarPeriod(entry, key, {})).length])), [smartIncidents]);
  const periodBase = useMemo(() => smartIncidents.filter((entry) => incidentMatchesCalendarPeriod(entry, period, periodOptions)), [smartIncidents, period, periodOptions]);
  const triageBase = useMemo(() => periodBase.filter((entry) => incidentMatchesTriage(entry, triageMode)), [periodBase, triageMode]);
  const q = query.trim().toLowerCase();
  const searchMatches = (entry) => !q || searchText(entry).includes(q);
  const baseForIssueCounts = useMemo(() => triageBase.filter((entry) => incidentMatchesBranchQueue(entry, queue)).filter(searchMatches), [triageBase, queue, q]);
  const baseForQueueCounts = useMemo(() => triageBase.filter((entry) => issueMatches(entry, issue)).filter(searchMatches), [triageBase, issue, q]);
  const issueCounts = useMemo(() => Object.fromEntries(issueFilters.map(([key]) => [key, baseForIssueCounts.filter((entry) => issueMatches(entry, key)).length])), [baseForIssueCounts]);
  const queueCounts = useMemo(() => Object.fromEntries(queueFilters.map(([key]) => [key, baseForQueueCounts.filter((entry) => key === 'all' || incidentMatchesBranchQueue(entry, key)).length])), [baseForQueueCounts]);
  const visible = useMemo(() => sortIncidents(triageBase.filter((entry) => incidentMatchesBranchQueue(entry, queue)).filter((entry) => issueMatches(entry, issue)).filter(searchMatches), sort), [triageBase, queue, issue, q, sort]);

  const selectedIncident = useMemo(() => visible.find((entry) => entry.case_ids.includes(selectedId)) || visible[0] || null, [visible, selectedId]);
  const selected = useMemo(() => selectedIncident?.cases.find((entry) => entry.id === selectedId) || selectedIncident?.cases?.[0] || null, [selectedIncident, selectedId]);
  const selectedIndex = selectedIncident ? visible.findIndex((entry) => entry.id === selectedIncident.id) : -1;
  const decision = selectedIncident && selected ? decisionFor(selectedIncident, selected) : null;
  const recommendation = selectedIncident?.triage?.recommendation || null;
  const code = selected ? unique([...(selected.sale_codes || []), ...(selected.purchase_codes || [])])[0] || '' : '';
  const saleQty = Number(selected?.sale_qty || 0);
  const purchaseQty = Number(selected?.purchase_qty || 0);
  const packagingSuggestion = selected?.packaging_profile_candidate ? packagingRuleSuggestion(selected) : null;
  const unitSuggestion = selected?.type === 'unit_conversion_review' && !packagingSuggestion ? suggestUnitRule(selected) : null;
  const timeline = useMemo(() => selectedIncident ? buildOperationTimeline(selectedIncident) : null, [selectedIncident]);
  const saleReturn = selected ? summarizeTransferReturnEvidence(selected.sale_lines || [], saleQty) : null;
  const purchaseReturn = selected ? summarizeTransferReturnEvidence(selected.purchase_lines || [], purchaseQty) : null;

  useEffect(() => { setDetailsOpen(false); setDeepEvidenceOpen(false); }, [selectedIncident?.id]);

  const resetFilters = () => { setQueue('all'); setIssue('all'); setTriageMode('all'); setPeriod('all'); setCustomFrom(''); setCustomTo(''); setSort('priority'); setQuery(''); };
  const moveCase = (delta) => {
    if (!visible.length || selectedIndex < 0) return;
    const index = (selectedIndex + delta + visible.length) % visible.length;
    setSelectedId(visible[index]?.cases?.[0]?.id || '');
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
      setMessage(notes.join(' ')); setSelectedId(''); resetFilters(); setUploadOpen(Boolean(grouped.ambiguous.length || grouped.errors.length));
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

  const recordDecision = (status, action) => {
    if (!selectedIncident) return;
    const at = nowIso();
    setLedger((old) => {
      const decisions = { ...old.decisions }; const events = [];
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
    setLedger((old) => ({ ...old, packagingRules: learnPackagingRule(selected, old.packagingRules || {}), decisions: { ...old.decisions, [selected.id]: { status: 'verified', action: `اعتماد ملف العبوة: ${packagingSuggestion.label}`, updated_at: at } }, events: [{ case_id: selected.id, action: 'packaging_rule_learned', status: 'verified', at, product_name: selected.product_name, product_code: code, packaging: packagingSuggestion.label }, ...old.events].slice(0, 1000) }));
    setSelectedId('');
  };

  const approveUnit = () => {
    if (!selected || !unitSuggestion) return;
    const at = nowIso();
    setLedger((old) => ({ ...old, unitRules: learnUnitRule(selected, old.unitRules || {}), decisions: { ...old.decisions, [selected.id]: { status: 'verified', action: `اعتماد تحويل العبوة: ${humanUnitRuleLabel(unitSuggestion)}`, updated_at: at } }, events: [{ case_id: selected.id, action: 'unit_rule_learned', status: 'verified', at, product_name: selected.product_name, product_code: code }, ...old.events].slice(0, 1000) }));
    setSelectedId('');
  };

  const copyCode = async () => { if (!code) return; try { await navigator.clipboard.writeText(code); } catch { /* no-op */ } setCopied(code); window.setTimeout(() => setCopied(''), 1200); };
  const autoSolved = Math.max(0, rawCases.filter((item) => item.type !== 'matched').length - settledCases.filter((item) => item.type !== 'matched').length);
  const activeFilters = [queue !== 'all', issue !== 'all', triageMode !== 'all', period !== 'all', Boolean(query)].filter(Boolean).length;

  return <div dir="rtl" className="min-h-full bg-slate-50">
    <div className="mx-auto max-w-[1660px] space-y-2 px-2 py-2 sm:px-4">
      {copied && <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-white">تم نسخ {copied}</div>}

      <Card className="sticky top-2 z-40 border-slate-200 bg-white/95 p-2.5 shadow-md backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="ml-auto flex min-w-[220px] items-center gap-2">
            <div className="rounded-xl bg-slate-950 p-2 text-teal-300"><BrainCircuit className="h-4 w-4" /></div>
            <div><div className="text-sm font-black text-slate-950">مركز قرار التحويلات</div><div className="text-[9px] font-bold text-slate-400">قرار واحد واضح في كل مرة</div></div>
          </div>
          <div className="hidden items-center gap-1.5 xl:flex"><MiniMetric label="مطلوب" value={triage.summary.total} /><MiniMetric label="حسم سريع" value={triage.summary.quick} tone="teal" /><MiniMetric label="متكرر" value={triage.summary.repeated} tone="violet" /><MiniMetric label="قفل تلقائي" value={autoSolved} /></div>
          <Button size="sm" variant={focusMode ? 'default' : 'outline'} onClick={() => setFocusMode((v) => !v)} className="h-8 font-black">{focusMode ? <EyeOff className="ml-1 h-3.5 w-3.5" /> : <Eye className="ml-1 h-3.5 w-3.5" />} {focusMode ? 'إنهاء التركيز' : 'وضع التركيز'}</Button>
          <Button size="sm" variant="outline" onClick={() => setFiltersOpen((v) => !v)} className="h-8 font-black"><SlidersHorizontal className="ml-1 h-3.5 w-3.5" /> الفلاتر{activeFilters ? ` · ${activeFilters}` : ''}</Button>
          <Button size="sm" variant="outline" onClick={() => setUploadOpen((v) => !v)} className="h-8 font-black"><Files className="ml-1 h-3.5 w-3.5" /> الملفات</Button>
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">{periodModes.map(([key, label]) => <PeriodChip key={key} label={label} count={key === 'custom' ? undefined : periodCounts[key]} active={period === key} onClick={() => { setPeriod(key); setSelectedId(''); }} />)}</div>
        {period === 'custom' && <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-teal-50/60 p-2"><label className="text-[9px] font-black text-slate-500">من<input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="mt-1 block rounded-lg border bg-white px-2 py-1 text-xs font-bold" /></label><label className="text-[9px] font-black text-slate-500">إلى<input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="mt-1 block rounded-lg border bg-white px-2 py-1 text-xs font-bold" /></label><span className={`pb-1 text-[9px] font-black ${periodRange.valid ? 'text-teal-700' : 'text-rose-600'}`}>{periodRange.valid ? calendarPeriodLabel('custom', periodOptions) : 'الفترة غير صحيحة'}</span></div>}
      </Card>

      {uploadOpen && <Card className="p-2.5 shadow-sm"><label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-teal-300 bg-teal-50/60 p-3"><div className="flex items-center gap-2"><div className="rounded-lg bg-white p-2"><FileSpreadsheet className="h-4 w-4 text-teal-700" /></div><div><div className="text-xs font-black">ارفع ملفات البيع والشراء</div><div className="text-[9px] font-bold text-slate-500">العقل يجمع الفواتير والمرتجعات والوحدات في رحلة واحدة.</div></div></div><span className="rounded-full bg-teal-700 px-3 py-1 text-[10px] font-black text-white">{isInspecting ? 'جاري التحليل...' : 'اختيار'}</span><input className="hidden" type="file" multiple accept=".xlsx,.xls,.csv" disabled={isInspecting} onChange={(e) => handleFiles(Array.from(e.target.files || []))} /></label>{message && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-900">{message}</div>}{autoReport.ambiguous.length > 0 && <div className="mt-2 space-y-2">{autoReport.ambiguous.map((entry) => <div key={entry.fileName} className="rounded-xl border p-2"><b className="text-[10px]">{entry.fileName}</b><div className="mt-1.5 flex flex-wrap gap-1">{Object.entries(sourceConfig).map(([key, config]) => <Button key={key} size="sm" variant="outline" onClick={() => assignAmbiguous(entry, key)} className="h-7 text-[9px] font-black">{config.label}</Button>)}</div></div>)}</div>}</Card>}

      {filtersOpen && <Card className="space-y-2 p-2.5 shadow-sm">
        <div className="flex flex-wrap gap-1.5">{triageModes.map(([mode, label, Icon]) => <button key={mode} onClick={() => { setTriageMode(mode); setSelectedId(''); }} className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-2 text-[10px] font-black ${triageMode === mode ? 'border-teal-500 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600'}`}><Icon className="h-3.5 w-3.5" /> {label} <span className="opacity-60">{mode === 'all' ? periodBase.length : periodBase.filter((entry) => incidentMatchesTriage(entry, mode)).length}</span></button>)}</div>
        <div className="grid gap-2 md:grid-cols-[150px_160px_145px_minmax(220px,1fr)_auto]"><select value={queue} onChange={(e) => setQueue(e.target.value)} className="rounded-xl border px-3 py-2 text-xs font-black">{queueFilters.map(([key, label]) => <option key={key} value={key}>{label} · {queueCounts[key] || 0}</option>)}</select><select value={issue} onChange={(e) => setIssue(e.target.value)} className="rounded-xl border px-3 py-2 text-xs font-black">{issueFilters.map(([key, label]) => <option key={key} value={key}>{label} · {issueCounts[key] || 0}</option>)}</select><select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-xl border px-3 py-2 text-xs font-black">{sortFilters.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><div className="relative"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="اسم الصنف أو الكود أو الفاتورة" className="w-full rounded-xl border py-2 pr-9 pl-3 text-xs font-bold outline-none focus:border-teal-400" /></div><Button variant="outline" size="sm" onClick={resetFilters} className="font-black"><FilterX className="ml-1 h-4 w-4" /> مسح</Button></div>
        <div className="flex flex-wrap gap-1">{issueFilters.map(([key, label]) => <FilterChip key={key} label={label} count={issueCounts[key]} active={issue === key} onClick={() => setIssue(key)} />)}</div>
      </Card>}

      {!focusMode && (sales.length || purchases.length) > 0 && <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-7"><MiniMetric label="كل القرارات" value={triage.summary.total} /><MiniMetric label="طرف ناقص" value={smartIncidents.filter((x) => issueMatches(x, 'missing')).length} tone="rose" /><MiniMetric label="فرق كمية" value={smartIncidents.filter((x) => issueMatches(x, 'quantity')).length} /><MiniMetric label="تحويل عبوة" value={smartIncidents.filter((x) => issueMatches(x, 'unit')).length} /><MiniMetric label="ثقة عالية" value={triage.summary.high_confidence} tone="teal" /><MiniMetric label="تحقق بشري" value={triage.summary.human} /><MiniMetric label="نمط متكرر" value={triage.summary.repeated} tone="violet" /></div>}

      <div className={`grid gap-2 ${queueOpen ? 'lg:grid-cols-[330px_minmax(0,1fr)]' : 'lg:grid-cols-[44px_minmax(0,1fr)]'}`}>
        <Card className="relative h-[calc(100vh-205px)] min-h-[560px] overflow-hidden shadow-sm">
          {!queueOpen ? <button onClick={() => setQueueOpen(true)} className="flex h-full w-full items-start justify-center pt-3 text-slate-500 hover:bg-slate-50"><PanelLeftOpen className="h-4 w-4" /></button> : <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b px-2.5 py-2"><div className="ml-auto"><div className="text-xs font-black text-slate-950">طابور القرار</div><div className="text-[9px] font-bold text-slate-400">{visible.length} حالة · {sortFilters.find(([key]) => key === sort)?.[1]}</div></div><button onClick={() => setQueueOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><PanelLeftClose className="h-4 w-4" /></button></div>
            <div className="flex-1 space-y-1 overflow-y-auto p-1.5">{visible.map((incident, index) => { const item = incident.cases?.[0]; const selectedRow = selectedIncident?.id === incident.id; const saleDisplay = quantityParts(item?.sale_qty_label || 'لا توجد حركة', item?.sale_qty_display); const purchaseDisplay = quantityParts(item?.purchase_qty_label || 'لا توجد حركة', item?.purchase_qty_display); return <button key={incident.id} onClick={() => setSelectedId(item?.id || '')} className={`w-full rounded-xl border px-2.5 py-2 text-right transition ${selectedRow ? 'border-teal-400 bg-teal-50 shadow-sm' : 'border-transparent bg-white hover:border-slate-200 hover:bg-slate-50'}`}><div className="flex items-center justify-between gap-2"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[8px] font-black">{index + 1}</span><div className="flex items-center gap-1"><span className="text-[8px] font-black text-teal-700">{incident.triage.confidence}%</span><span className="text-[8px] font-black text-slate-400">{incidentTitle(incident)} · {queueLabel(incident)}</span></div></div><div className="mt-1.5 truncate text-xs font-black text-slate-950">{item?.product_name || 'صنف'}</div><div className="mt-1 flex items-center gap-1 text-[9px] font-bold text-slate-500"><span className="rounded bg-sky-50 px-1.5 py-0.5">{saleDisplay.primary}</span><span>↔</span><span className="rounded bg-emerald-50 px-1.5 py-0.5">{purchaseDisplay.primary}</span></div><div className="mt-1.5 flex items-center justify-between gap-2"><span className="truncate text-[9px] font-black text-teal-800">{incident.triage.recommendation.label}</span>{incident.triage.repeat_count > 1 && <span className="inline-flex shrink-0 items-center gap-0.5 text-[8px] font-black text-violet-600"><Repeat2 className="h-3 w-3" />{incident.triage.repeat_count}</span>}</div></button>; })}{!visible.length && <div className="p-8 text-center text-xs font-black text-emerald-700">مفيش قرار مطلوب في الفلتر الحالي.</div>}</div>
          </div>}
        </Card>

        <Card className="relative h-[calc(100vh-205px)] min-h-[560px] overflow-hidden shadow-sm">{!selectedIncident || !selected ? <div className="flex h-full items-center justify-center text-sm font-bold text-slate-400">ارفع الملفات أو اختر حالة.</div> : <div className="flex h-full flex-col">
          <div className="flex shrink-0 flex-wrap items-start gap-2 border-b px-3 py-2.5"><div className="ml-auto min-w-0"><div className="text-[9px] font-black text-slate-400">{incidentTitle(selectedIncident)} · {queueLabel(selectedIncident)} · {formatIncidentDayLabel(incidentDayKey(selectedIncident))}</div><h2 className="mt-0.5 truncate text-lg font-black text-slate-950">{selected.product_name || selectedIncident.product_names?.[0]}</h2><div className="mt-1 flex flex-wrap gap-1"><button onClick={copyCode} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[9px] font-black"><Copy className="h-3 w-3 text-teal-600" /> {code || 'بدون كود'}</button>{selectedIncident.invoice && <span className="rounded-lg bg-slate-100 px-2 py-1 text-[9px] font-black">فاتورة {selectedIncident.invoice}</span>}</div></div><div className="flex items-center gap-1"><button onClick={() => moveCase(-1)} className="rounded-lg border p-1.5 text-slate-500 hover:bg-slate-50"><ChevronRight className="h-4 w-4" /></button><span className="min-w-[58px] text-center text-[9px] font-black text-slate-500">{selectedIndex + 1} / {visible.length}</span><button onClick={() => moveCase(1)} className="rounded-lg border p-1.5 text-slate-500 hover:bg-slate-50"><ChevronLeft className="h-4 w-4" /></button></div></div>

          <div className="flex-1 overflow-y-auto p-3">
            <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_240px]">
              <div className="rounded-2xl border border-teal-200 bg-gradient-to-l from-teal-50 to-white p-3"><div className="text-[9px] font-black text-teal-700">توصية العقل الآن</div><div className="mt-0.5 text-xl font-black text-slate-950">{recommendation?.label || decision.headline}</div><div className="mt-1 text-[10px] font-bold leading-5 text-slate-600">{recommendation?.reason || decision.reason}</div>{selectedIncident.triage.history?.consistent && <div className="mt-1.5 inline-flex rounded-full bg-violet-50 px-2 py-1 text-[8px] font-black text-violet-700">نفس القرار اتكرر تاريخيًا بشكل متسق</div>}</div>
              <div className="grid grid-cols-3 gap-1.5"><MiniMetric label="الثقة" value={`${selectedIncident.triage.confidence}%`} tone="teal" /><MiniMetric label="الأولوية" value={selectedIncident.triage.priority} /><MiniMetric label="النمط" value={selectedIncident.triage.repeat_count} tone="violet" /></div>
            </div>

            <div className="mt-2 grid gap-1.5 sm:grid-cols-3"><QtyTile label="بيع" value={selected.sale_qty_label || saleQty} display={selected.sale_qty_display} branch={branchName(selectedIncident.from)} tone="sale" /><QtyTile label="شراء" value={selected.purchase_qty_label || purchaseQty} display={selected.purchase_qty_display} branch={branchName(selectedIncident.to)} tone="purchase" /><QtyTile label="المتبقي" value={selected.remaining_qty_display?.primary || 'غير قابل للحساب بدقة'} display={selected.remaining_qty_display} branch={selected.remaining_qty_display?.precise ? 'صافي' : 'غير موحد'} tone="remaining" /></div>

            <div className={`mt-2 flex items-start gap-2 rounded-xl border px-3 py-2 ${toneClass(decision.tone)}`}><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" /><div className="min-w-0"><div className="text-[9px] font-black opacity-60">ليه ظهرت الحالة؟</div><div className="text-xs font-black">{decision.headline}</div><div className="truncate text-[9px] font-bold opacity-70">{decision.reason}</div></div></div>

            <button onClick={() => setDetailsOpen((v) => !v)} className="mt-2 flex w-full items-center justify-between rounded-xl border bg-white px-3 py-2 text-[10px] font-black text-slate-600 hover:bg-slate-50"><span className="inline-flex items-center gap-1.5">{detailsOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {detailsOpen ? 'إخفاء التفاصيل' : 'إظهار التفاصيل الذكية'}</span>{detailsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</button>

            {detailsOpen && <div className="mt-2 space-y-2 rounded-2xl border bg-slate-50/60 p-2.5">
              {selected.mixed_units_detected && <div className="rounded-xl bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-900"><b>حماية الوحدات:</b> لن يتم جمع أو طرح وحدات مختلفة قبل وجود تحويل موثوق.</div>}
              <PackagingInsight item={selected} />
              <div className="grid gap-2 lg:grid-cols-2"><EvidenceLine title="البيع" branch={branchName(selectedIncident.from)} metadata={timeline?.sale} tone="sale" /><EvidenceLine title="الشراء" branch={branchName(selectedIncident.to)} metadata={timeline?.purchase} tone="purchase" /></div>
              {selected?.residual_progress_status === 'partial' && <div className="rounded-xl bg-sky-50 px-3 py-2 text-[10px] font-bold text-sky-900"><History className="ml-1 inline h-3.5 w-3.5" /> {selected.residual_review_reason}</div>}
              <button onClick={() => setDeepEvidenceOpen((v) => !v)} className="flex w-full items-center justify-between rounded-xl bg-white px-3 py-2 text-[10px] font-black text-slate-500"><span className="inline-flex items-center gap-1"><BarChart3 className="h-3.5 w-3.5" /> الدليل الكامل والتحليل</span>{deepEvidenceOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</button>
              {deepEvidenceOpen && <div className="space-y-1.5 rounded-xl bg-white p-2.5"><div className="grid grid-cols-3 gap-1.5"><MiniMetric label="ثقة الرحلة" value={`${selected.decision_intelligence?.journey_confidence?.score || 0}%`} /><MiniMetric label="ثقة المشكلة" value={`${selected.decision_intelligence?.issue_confidence?.score || 0}%`} /><MiniMetric label="قرارات سابقة" value={selectedIncident.triage.previous_decision_count || 0} /></div>{timeline?.sale?.invoiceEvidence?.map((entry) => <div key={`sale-${entry.invoice}`} className="rounded-lg bg-sky-50 px-2.5 py-2 text-[9px] font-bold"><b>بيع {entry.invoice}:</b> {entry.actor} · {entry.dateLabel} · {entry.qtyLabel}</div>)}{timeline?.purchase?.invoiceEvidence?.map((entry) => <div key={`purchase-${entry.invoice}`} className="rounded-lg bg-emerald-50 px-2.5 py-2 text-[9px] font-bold"><b>شراء {entry.invoice}:</b> {entry.actor} · {entry.dateLabel} · {entry.qtyLabel}</div>)}{saleReturn?.has_return && <div className="rounded-lg bg-emerald-50 px-2.5 py-2 text-[9px] font-bold text-emerald-900">{formatTransferReturnEvidence(saleReturn, { movement: 'البيع' })}</div>}{purchaseReturn?.has_return && <div className="rounded-lg bg-emerald-50 px-2.5 py-2 text-[9px] font-bold text-emerald-900">{formatTransferReturnEvidence(purchaseReturn, { movement: 'الشراء' })}</div>}</div>}
            </div>}
          </div>

          <div className="shrink-0 border-t bg-white/95 p-2.5 backdrop-blur"><div className="flex flex-wrap items-center gap-2">{packagingSuggestion ? <Button onClick={approvePackaging} className="bg-teal-700 font-black hover:bg-teal-800">اعتماد {packagingSuggestion.label}</Button> : unitSuggestion ? <Button onClick={approveUnit} className="bg-teal-700 font-black hover:bg-teal-800">اعتماد تحويل العبوة</Button> : <Button onClick={() => recordDecision('verified', `تم الحل: ${decision.headline}`)} className="bg-teal-700 font-black hover:bg-teal-800"><CheckCircle2 className="ml-1 h-4 w-4" /> تم الحل</Button>}<Button variant="outline" onClick={() => recordDecision('in_progress', decision.headline)} className="font-black">متابعة</Button><Button variant="ghost" onClick={() => recordDecision('dismissed', 'ليست مشكلة بعد المراجعة')} className="font-black text-slate-500">ليست مشكلة</Button><div className="mr-auto flex items-center gap-1"><button onClick={() => moveCase(-1)} className="rounded-lg border p-2 text-slate-500"><ChevronRight className="h-4 w-4" /></button><button onClick={() => moveCase(1)} className="rounded-lg border p-2 text-slate-500"><ChevronLeft className="h-4 w-4" /></button></div></div></div>
        </div>}</Card>
      </div>
    </div>
  </div>;
}
