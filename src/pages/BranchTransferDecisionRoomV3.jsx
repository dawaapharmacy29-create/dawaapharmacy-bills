import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp, BarChart3, BrainCircuit, CalendarDays, CheckCircle2, ChevronDown, ChevronUp, Copy,
  FileSpreadsheet, Files, FilterX, Gauge, History, Repeat2, Search, ShieldAlert, Sparkles, UserCheck, Zap,
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
import { compareIncidentsByDay, formatIncidentDayLabel, incidentDayKey, incidentDayOptions, incidentMatchesDay } from '@/lib/branchTransferIncidentDay';
import { summarizeTransferReturnEvidence, formatTransferReturnEvidence } from '@/lib/branchTransferReturnIntelligence';
import { buildOperationTimeline } from '@/lib/branchTransferOperationTimeline';
import { buildDecisionTriage, compareDecisionTriage, incidentMatchesTriage } from '@/lib/branchTransferDecisionTriage';

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
  ['all', 'كل الحالات', BrainCircuit],
  ['quick', 'حسم سريع', Zap],
  ['important', 'مهم', Gauge],
  ['learning', 'تعلم النظام', Repeat2],
  ['human', 'تحقق بشري', UserCheck],
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
  if (item?.mixed_units_detected) return {
    headline: 'راجع وحدات الحركة',
    reason: 'الوحدات مختلفة؛ النظام فصلها ولم يجمعها في رقم مضلل.', tone: 'amber',
  };
  if (item?.packaging_profile_candidate && item?.packaging_profile?.label) return {
    headline: `أكد ${item.packaging_profile.label}`,
    reason: item.packaging_reason || 'الفرق غالبًا سببه طريقة تسجيل الشريط مقابل العلبة.', tone: 'sky',
  };
  if (item?.packaging_normalized_mismatch) return {
    headline: item?.remaining_qty_display?.primary ? `راجع ${item.remaining_qty_display.primary}` : 'راجع فرق العبوة',
    reason: item.packaging_reason || 'تم توحيد العبوة قبل حساب الفرق.', tone: 'amber',
  };
  if (item?.residual_progress_status === 'partial') return {
    headline: item?.remaining_qty_display?.precise ? `راجع ${item.remaining_qty_display.primary}` : 'راجع الاستكمال الجزئي',
    reason: item.residual_review_reason || 'جزء من الحركة اتسجل لاحقًا وما زال جزء يحتاج قرار.', tone: 'amber',
  };
  if (incident.side === 'sale') return { headline: `شراء ${to} غير موجود`, reason: `بيع ${from} موجود ومصدر الشراء المقابل مغطى، لكن الحركة المقابلة غير محسومة.`, tone: 'rose' };
  if (incident.side === 'purchase') return { headline: `بيع ${from} غير موجود`, reason: `شراء ${to} موجود ومصدر البيع المقابل مغطى، لكن الحركة المقابلة غير محسومة.`, tone: 'rose' };
  if (incident.kind === 'quantity_mismatch') return {
    headline: item?.remaining_qty_display?.precise ? `راجع ${item.remaining_qty_display.primary}` : 'راجع فرق الكمية',
    reason: item?.remaining_qty_display?.precise ? 'ده الفرق الصافي بعد التجميع والمرتجعات.' : 'لا يوجد فرق رقمي آمن قبل توحيد الوحدة.', tone: 'amber',
  };
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

function Qty({ label, value, display, hint, tone = 'neutral' }) {
  const parts = quantityParts(value, display);
  const styles = tone === 'sale' ? 'border-sky-200 bg-sky-50/70' : tone === 'purchase' ? 'border-emerald-200 bg-emerald-50/70' : 'border-amber-200 bg-amber-50/70';
  return <div className={`min-h-[102px] rounded-2xl border p-3.5 ${styles}`}>
    <div className="flex items-center justify-between gap-2"><div className="text-[10px] font-black text-slate-400">{label}</div>{hint && <span className="rounded-full bg-white/90 px-2 py-1 text-[9px] font-black text-slate-500">{hint}</span>}</div>
    <div className={`mt-3 font-black leading-tight ${parts.empty ? 'text-sm text-slate-400' : 'text-xl text-slate-950 sm:text-2xl'}`}>{parts.primary}</div>
    {parts.detail && <div className="mt-1 text-[10px] font-black text-slate-500">{parts.detail}</div>}
  </div>;
}

function PackagingInsight({ item }) {
  const profile = item?.packaging_profile;
  if (!profile?.strips_per_box) return null;
  const confidence = profile.confidence === 'confirmed' ? 'مؤكدة' : profile.confidence === 'high' ? 'عالية' : profile.confidence === 'medium' ? 'محتملة' : 'مبدئية';
  return <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-3 text-xs font-bold text-sky-950">
    <div className="flex flex-wrap items-center justify-between gap-2"><b className="inline-flex items-center gap-1"><Sparkles className="h-4 w-4" /> فهم العبوة</b><div className="flex gap-1.5"><span className="rounded-full bg-white px-2 py-1 text-[10px] font-black">{profile.label}</span><span className="rounded-full bg-white px-2 py-1 text-[10px] font-black">الثقة: {confidence}</span></div></div>
    {item.packaging_reason && <div className="mt-2 text-[11px] leading-5 text-sky-800">{item.packaging_reason}</div>}
  </div>;
}

function InvoiceEvidenceCard({ title, branch, side, metadata }) {
  const invoices = metadata?.invoiceEvidence || [];
  const first = invoices[0] || null;
  const quantity = quantityParts(first?.qtyLabel || first?.qty, first?.qtyDisplay);
  const styles = side === 'sale' ? 'border-sky-200 bg-sky-50/60' : 'border-emerald-200 bg-emerald-50/60';
  return <div className={`rounded-2xl border p-3.5 ${styles}`}>
    <div className="flex items-center justify-between gap-2"><b>{title} — {branch}</b><span className="rounded-full bg-white px-2 py-1 text-[9px] font-black">{invoices.length ? `${invoices.length} فاتورة` : 'لا توجد فاتورة'}</span></div>
    {!metadata?.available || !first ? <div className="mt-3 text-xs font-bold text-slate-500">لا توجد حركة مسجلة.</div> : <>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-xl bg-white/80 p-3"><div><div className="text-[9px] font-black text-slate-400">الكمية</div><div className="mt-1 text-lg font-black">{quantity.primary}</div>{quantity.detail && <div className="text-[10px] font-bold text-slate-500">{quantity.detail}</div>}</div><span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-black">فاتورة {first.invoice}</span></div>
      <div className="mt-2 text-[11px] font-bold leading-5 text-slate-600">{first.actor} · {first.dateLabel}</div>
      {first.mixedUnits && <div className="mt-2 rounded-lg bg-amber-100 px-2 py-1.5 text-[10px] font-black text-amber-900">وحدات مختلفة — لم يتم جمعها رقميًا.</div>}
    </>}
  </div>;
}

function DashboardCard({ label, value, active, onClick, tone = 'slate' }) {
  const styles = { slate: 'border-slate-200 bg-white', rose: 'border-rose-200 bg-rose-50/60', amber: 'border-amber-200 bg-amber-50/60', violet: 'border-violet-200 bg-violet-50/60', sky: 'border-sky-200 bg-sky-50/60' };
  return <button onClick={onClick} className={`rounded-2xl border p-3 text-right transition hover:shadow-sm ${styles[tone]} ${active ? 'ring-2 ring-teal-400' : ''}`}><div className="text-[10px] font-black text-slate-500">{label}</div><div className="mt-1 text-2xl font-black">{value}</div></button>;
}

function TriageButton({ mode, label, Icon, count, active, onClick }) {
  return <button onClick={onClick} className={`flex min-w-[132px] items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 text-right transition ${active ? 'border-teal-500 bg-teal-700 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-teal-300'}`}>
    <span className="flex items-center gap-2 text-[11px] font-black"><Icon className="h-4 w-4" /> {label}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${active ? 'bg-white/20' : 'bg-slate-100'}`}>{count}</span>
  </button>;
}

function sortIncidents(values, sort) {
  const copy = [...values];
  if (sort === 'newest') return copy.sort((a, b) => compareIncidentsByDay(a, b, () => 0));
  if (sort === 'oldest') return copy.sort((a, b) => compareIncidentsByDay(b, a, () => 0));
  return copy.sort((a, b) => compareDecisionTriage(a, b) || compareIncidentsByDay(a, b, () => 0));
}

export default function BranchTransferDecisionRoomV3() {
  const [sources, setSources] = useState({});
  const [ledger, setLedger] = useState(loadLedger);
  const [uploadOpen, setUploadOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [autoReport, setAutoReport] = useState({ ambiguous: [], duplicates: [], errors: [] });
  const [message, setMessage] = useState('');
  const [queue, setQueue] = useState('all');
  const [issue, setIssue] = useState('all');
  const [triageMode, setTriageMode] = useState('all');
  const [day, setDay] = useState('all');
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

  const q = query.trim().toLowerCase();
  const searchMatches = (entry) => !q || searchText(entry).includes(q);
  const triageBase = useMemo(() => smartIncidents.filter((entry) => incidentMatchesTriage(entry, triageMode)), [smartIncidents, triageMode]);
  const baseForIssueCounts = useMemo(() => triageBase.filter((entry) => incidentMatchesBranchQueue(entry, queue)).filter((entry) => incidentMatchesDay(entry, day)).filter(searchMatches), [triageBase, queue, day, q]);
  const baseForQueueCounts = useMemo(() => triageBase.filter((entry) => issueMatches(entry, issue)).filter((entry) => incidentMatchesDay(entry, day)).filter(searchMatches), [triageBase, issue, day, q]);
  const issueCounts = useMemo(() => Object.fromEntries(issueFilters.map(([key]) => [key, baseForIssueCounts.filter((entry) => issueMatches(entry, key)).length])), [baseForIssueCounts]);
  const queueCounts = useMemo(() => Object.fromEntries(queueFilters.map(([key]) => [key, baseForQueueCounts.filter((entry) => key === 'all' || incidentMatchesBranchQueue(entry, key)).length])), [baseForQueueCounts]);
  const dayOptions = useMemo(() => incidentDayOptions(triageBase.filter((entry) => incidentMatchesBranchQueue(entry, queue) && issueMatches(entry, issue) && searchMatches(entry))), [triageBase, queue, issue, q]);
  const quickDays = useMemo(() => {
    const preset = (name) => dayOptions.find((entry) => entry.preset === name);
    return [{ key: 'all', label: 'كل الفترة', count: triageBase.filter((entry) => incidentMatchesBranchQueue(entry, queue) && issueMatches(entry, issue) && searchMatches(entry)).length }, preset('latest'), preset('last3'), preset('last7')].filter(Boolean);
  }, [dayOptions, triageBase, queue, issue, q]);

  const visible = useMemo(() => sortIncidents(
    triageBase.filter((entry) => incidentMatchesBranchQueue(entry, queue)).filter((entry) => issueMatches(entry, issue)).filter((entry) => incidentMatchesDay(entry, day)).filter(searchMatches), sort,
  ), [triageBase, queue, issue, day, q, sort]);

  const visibleGroups = useMemo(() => {
    const groups = []; const byDay = new Map();
    visible.forEach((entry) => { const key = incidentDayKey(entry); if (!byDay.has(key)) { const group = { key, label: formatIncidentDayLabel(key), items: [] }; byDay.set(key, group); groups.push(group); } byDay.get(key).items.push(entry); });
    return groups;
  }, [visible]);

  const selectedIncident = useMemo(() => visible.find((entry) => entry.case_ids.includes(selectedId)) || visible[0] || null, [visible, selectedId]);
  const selected = useMemo(() => selectedIncident?.cases.find((entry) => entry.id === selectedId) || selectedIncident?.cases?.[0] || null, [selectedIncident, selectedId]);
  const decision = selectedIncident && selected ? decisionFor(selectedIncident, selected) : null;
  const recommendation = selectedIncident?.triage?.recommendation || null;
  const code = selected ? unique([...(selected.sale_codes || []), ...(selected.purchase_codes || [])])[0] || '' : '';
  const saleQty = Number(selected?.sale_qty || 0); const purchaseQty = Number(selected?.purchase_qty || 0);
  const packagingSuggestion = selected?.packaging_profile_candidate ? packagingRuleSuggestion(selected) : null;
  const unitSuggestion = selected?.type === 'unit_conversion_review' && !packagingSuggestion ? suggestUnitRule(selected) : null;
  const timeline = useMemo(() => selectedIncident ? buildOperationTimeline(selectedIncident) : null, [selectedIncident]);
  const saleReturn = selected ? summarizeTransferReturnEvidence(selected.sale_lines || [], saleQty) : null;
  const purchaseReturn = selected ? summarizeTransferReturnEvidence(selected.purchase_lines || [], purchaseQty) : null;

  useEffect(() => { setDetailsOpen(false); }, [selectedIncident?.id]);
  useEffect(() => { if (day !== 'all' && !dayOptions.some((entry) => entry.key === day)) setDay('all'); }, [day, dayOptions]);

  const resetFilters = () => { setQueue('all'); setIssue('all'); setTriageMode('all'); setDay('all'); setSort('priority'); setQuery(''); };
  const nextCase = () => { if (!selectedIncident || visible.length < 2) return; const index = visible.findIndex((entry) => entry.id === selectedIncident.id); const next = visible[(index + 1) % visible.length]; setSelectedId(next?.cases?.[0]?.id || ''); };

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
      setSources(grouped.sources); setAutoReport({ ambiguous: grouped.ambiguous, duplicates: grouped.duplicates, errors: grouped.errors });
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
    setSources((old) => { const bucket = old[sourceKey] || { valid: true, items: [], fileNames: [] }; return { ...old, [sourceKey]: { ...bucket, valid: true, items: [...bucket.items, ...items], fileNames: [...(bucket.fileNames || []), entry.fileName] } }; });
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
  const horizonStyles = gate.summary.incomplete_source > 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : gate.summary.awaiting_later_evidence > 0 ? 'border-sky-200 bg-sky-50 text-sky-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900';

  return <div dir="rtl" className="min-h-full bg-slate-50"><div className="mx-auto max-w-[1580px] space-y-3 px-3 py-3 sm:px-5">
    {copied && <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-white">تم نسخ {copied}</div>}

    <Card className="border-0 bg-slate-950 p-4 text-white shadow-lg sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2 text-[11px] font-black text-teal-300"><BrainCircuit className="h-4 w-4" /> مركز القرار الذكي</div><h1 className="mt-1 text-xl font-black sm:text-2xl">تحويلات الفروع</h1><div className="mt-1 text-xs font-bold text-slate-400">ابدأ بالأسرع والأعلى تأثيرًا، وافتح الدليل الكامل فقط لو احتجته.</div></div><Button size="sm" variant="secondary" onClick={() => setUploadOpen((v) => !v)} className="font-black"><Files className="ml-1 h-4 w-4" /> الملفات {uploadOpen ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}</Button></div></Card>

    {uploadOpen && <Card className="p-3 shadow-sm"><label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-teal-300 bg-teal-50/60 p-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-white p-2"><FileSpreadsheet className="h-5 w-5 text-teal-700" /></div><div><div className="font-black">ارفع ملفات البيع والشراء للفترة</div><div className="text-[11px] font-bold text-slate-500">الفواتير والمرتجعات والوحدات والتسجيلات المتأخرة تدخل في قرار واحد.</div></div></div><span className="rounded-full bg-teal-700 px-3 py-1.5 text-xs font-black text-white">{isInspecting ? 'جاري التحليل...' : 'اختيار'}</span><input className="hidden" type="file" multiple accept=".xlsx,.xls,.csv" disabled={isInspecting} onChange={(e) => handleFiles(Array.from(e.target.files || []))} /></label>{message && <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">{message}</div>}{autoReport.ambiguous.length > 0 && <div className="mt-2 space-y-2">{autoReport.ambiguous.map((entry) => <div key={entry.fileName} className="rounded-xl border p-3"><b className="text-xs">{entry.fileName}</b><div className="mt-2 flex flex-wrap gap-1">{Object.entries(sourceConfig).map(([key, config]) => <Button key={key} size="sm" variant="outline" onClick={() => assignAmbiguous(entry, key)} className="text-[10px] font-black">{config.label}</Button>)}</div></div>)}</div>}</Card>}

    {(sales.length || purchases.length) > 0 && <>
      <Card className="p-3 shadow-sm"><div className="mb-2 flex items-center justify-between gap-2"><div><div className="text-xs font-black text-slate-950">ابدأ من هنا</div><div className="text-[10px] font-bold text-slate-500">العقل قسم الحالات حسب سرعة الحسم والحاجة لتدخل بشري.</div></div><span className="text-[10px] font-black text-teal-700">{triage.summary.high_confidence} حالة ثقتها عالية</span></div><div className="flex gap-2 overflow-x-auto pb-1">{triageModes.map(([mode, label, Icon]) => <TriageButton key={mode} mode={mode} label={label} Icon={Icon} count={mode === 'all' ? triage.summary.total : triage.summary[mode] || 0} active={triageMode === mode} onClick={() => { setTriageMode(mode); setSelectedId(''); }} />)}</div></Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <DashboardCard label="كل القرارات" value={issueCounts.all ?? triageBase.length} active={issue === 'all'} onClick={() => setIssue('all')} />
        <DashboardCard label="طرف ناقص" value={issueCounts.missing || 0} active={issue === 'missing'} onClick={() => setIssue('missing')} tone="rose" />
        <DashboardCard label="فرق كمية" value={issueCounts.quantity || 0} active={issue === 'quantity'} onClick={() => setIssue('quantity')} tone="amber" />
        <DashboardCard label="اختلاف كود" value={issueCounts.code || 0} active={issue === 'code'} onClick={() => setIssue('code')} tone="violet" />
        <DashboardCard label="تحويل عبوة" value={issueCounts.unit || 0} active={issue === 'unit'} onClick={() => setIssue('unit')} tone="sky" />
      </div>

      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs font-bold ${horizonStyles}`}><div className="flex items-center gap-2"><CalendarDays className="h-4 w-4" /><span><b>أحدث يوم بيانات:</b> {formatIncidentDayLabel(gate.latest_evidence_day)}</span></div><div className="flex gap-3 text-[11px]">{gate.summary.awaiting_later_evidence > 0 && <span>{gate.summary.awaiting_later_evidence} بانتظار دليل لاحق</span>}{gate.summary.incomplete_source > 0 && <span>{gate.summary.incomplete_source} تغطيتها ناقصة</span>}{!gate.summary.awaiting_later_evidence && !gate.summary.incomplete_source && <span>أفق الدليل مقفول للمراجعات الظاهرة</span>}</div></div>

      <div className="rounded-2xl border bg-white px-4 py-3 text-xs font-bold text-slate-600"><b className="text-slate-950">{triage.summary.total} قرار فعلي</b><span className="mx-2 text-slate-300">•</span><b className="text-emerald-700">{triage.summary.quick}</b> حسم سريع<span className="mx-2 text-slate-300">•</span><b className="text-violet-700">{triage.summary.repeated}</b> نمط متكرر<span className="mx-2 text-slate-300">•</span>قفل تلقائيًا <b className="text-teal-700">{autoSolved}</b></div>
    </>}

    <Card className="space-y-3 p-3 shadow-sm"><div className="flex flex-wrap gap-1.5">{quickDays.map((entry) => <button key={entry.key} onClick={() => setDay(entry.key)} className={`rounded-full border px-3 py-1.5 text-[10px] font-black ${day === entry.key ? 'border-teal-600 bg-teal-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{entry.label} <span className="opacity-70">{entry.count}</span></button>)}</div><div className="grid gap-2 md:grid-cols-[150px_165px_205px_145px_minmax(220px,1fr)_auto]"><select value={queue} onChange={(e) => setQueue(e.target.value)} className="rounded-xl border px-3 py-2 text-xs font-black">{queueFilters.map(([key, label]) => <option key={key} value={key}>{label} · {queueCounts[key] || 0}</option>)}</select><select value={issue} onChange={(e) => setIssue(e.target.value)} className="rounded-xl border px-3 py-2 text-xs font-black">{issueFilters.map(([key, label]) => <option key={key} value={key}>{label} · {issueCounts[key] || 0}</option>)}</select><select value={day} onChange={(e) => setDay(e.target.value)} className="rounded-xl border px-3 py-2 text-xs font-black"><option value="all">كل الفترة</option>{dayOptions.map((entry) => <option key={entry.key} value={entry.key}>{entry.label} · {entry.count}</option>)}</select><select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-xl border px-3 py-2 text-xs font-black">{sortFilters.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><div className="relative"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="اسم الصنف أو الكود أو الفاتورة" className="w-full rounded-xl border py-2 pr-9 pl-3 text-xs font-bold outline-none focus:border-teal-400" /></div><Button variant="outline" size="sm" onClick={resetFilters} className="font-black"><FilterX className="ml-1 h-4 w-4" /> مسح</Button></div></Card>

    <div className="grid gap-3 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="max-h-[76vh] overflow-y-auto p-2 shadow-sm"><div className="flex items-center justify-between px-2 py-2 text-xs font-black text-slate-500"><span>{visible.length} قرار</span><span className="inline-flex items-center gap-1 text-[10px]"><ArrowDownUp className="h-3.5 w-3.5" /> {sortFilters.find(([key]) => key === sort)?.[1]}</span></div><div className="space-y-3">{visibleGroups.map((group) => <div key={group.key}><div className="sticky top-0 z-10 mb-1.5 flex items-center justify-between rounded-xl bg-slate-100/95 px-2.5 py-1.5"><span className="text-[10px] font-black">{group.label}</span><span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-black">{group.items.length}</span></div><div className="space-y-1.5">{group.items.map((incident) => { const item = incident.cases?.[0]; const selectedRow = selectedIncident?.id === incident.id; const saleDisplay = quantityParts(item?.sale_qty_label || 'لا توجد حركة', item?.sale_qty_display); const purchaseDisplay = quantityParts(item?.purchase_qty_label || 'لا توجد حركة', item?.purchase_qty_display); return <button key={incident.id} onClick={() => setSelectedId(item?.id || '')} className={`w-full rounded-2xl border p-3 text-right transition ${selectedRow ? 'border-teal-400 bg-teal-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}><div className="flex items-start justify-between gap-2"><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black">{incidentTitle(incident)}</span><div className="flex items-center gap-1"><span className="rounded-full bg-teal-50 px-2 py-1 text-[9px] font-black text-teal-700">{incident.triage.confidence}%</span><span className="text-[9px] font-black text-slate-400">{queueLabel(incident)}</span></div></div><div className="mt-2 truncate text-sm font-black">{item?.product_name || 'صنف'}</div><div className="mt-2 flex items-center gap-1 text-[10px] font-bold text-slate-500"><span className="rounded-md bg-sky-50 px-1.5 py-1">{saleDisplay.primary}</span><span>↔</span><span className="rounded-md bg-emerald-50 px-1.5 py-1">{purchaseDisplay.primary}</span></div><div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs font-black text-teal-800">{incident.triage.recommendation.label}</span>{incident.triage.repeat_count > 1 && <span className="inline-flex items-center gap-1 text-[9px] font-black text-violet-600"><Repeat2 className="h-3 w-3" /> ×{incident.triage.repeat_count}</span>}</div></button>; })}</div></div>)}{!visible.length && <div className="rounded-2xl bg-emerald-50 p-8 text-center"><CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600" /><div className="mt-2 text-sm font-black text-emerald-900">مفيش قرار مطلوب هنا</div></div>}</div></Card>

      <Card className="relative p-4 shadow-sm sm:p-5">{!selectedIncident || !selected ? <div className="flex min-h-[430px] items-center justify-center text-sm font-bold text-slate-400">اختر قرارًا من القائمة.</div> : <div className="space-y-3 pb-20">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3"><div><div className="text-[10px] font-black text-slate-400">{incidentTitle(selectedIncident)} · {queueLabel(selectedIncident)}</div><h2 className="mt-1 text-xl font-black">{selected.product_name || selectedIncident.product_names?.[0]}</h2><div className="mt-2 flex gap-2"><button onClick={copyCode} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-black"><Copy className="h-3.5 w-3.5 text-teal-600" /> كود {code || 'غير متاح'}</button>{selectedIncident.invoice && <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-black">فاتورة {selectedIncident.invoice}</span>}</div></div><div className="text-[10px] font-black text-slate-400">{formatIncidentDayLabel(incidentDayKey(selectedIncident))}</div></div>

        <div className="rounded-2xl border border-teal-200 bg-gradient-to-l from-teal-50 to-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-[10px] font-black text-teal-700">توصية العقل الآن</div><div className="mt-1 text-xl font-black text-slate-950">{recommendation?.label || decision.headline}</div><div className="mt-1 text-xs font-bold leading-6 text-slate-600">{recommendation?.reason || decision.reason}</div></div><div className="grid grid-cols-3 gap-1.5 text-center"><div className="rounded-xl bg-white px-3 py-2"><div className="text-[9px] font-black text-slate-400">الثقة</div><div className="text-lg font-black text-teal-700">{selectedIncident.triage.confidence}%</div></div><div className="rounded-xl bg-white px-3 py-2"><div className="text-[9px] font-black text-slate-400">الأولوية</div><div className="text-lg font-black">{selectedIncident.triage.priority}</div></div><div className="rounded-xl bg-white px-3 py-2"><div className="text-[9px] font-black text-slate-400">نفس النمط</div><div className="text-lg font-black text-violet-700">{selectedIncident.triage.repeat_count}</div></div></div></div>{selectedIncident.triage.repeat_count > 1 && <div className="mt-3 rounded-xl bg-violet-50 px-3 py-2 text-[10px] font-black text-violet-800">النمط متكرر {selectedIncident.triage.repeat_count} مرة في العرض الحالي؛ حسم السبب هنا قد يقلل مراجعات مشابهة.</div>}</div>

        <div className="grid gap-2 sm:grid-cols-3"><Qty label="بيع" value={selected.sale_qty_label || saleQty} display={selected.sale_qty_display} hint={branchName(selectedIncident.from)} tone="sale" /><Qty label="شراء" value={selected.purchase_qty_label || purchaseQty} display={selected.purchase_qty_display} hint={branchName(selectedIncident.to)} tone="purchase" /><Qty label="المتبقي" value={selected.remaining_qty_display?.primary || 'غير قابل للحساب بدقة'} display={selected.remaining_qty_display} hint={selected.remaining_qty_display?.precise ? 'بعد التحليل' : 'يحتاج توحيد الوحدة'} tone="remaining" /></div>

        <div className={`rounded-2xl border p-3 ${toneClass(decision.tone)}`}><div className="text-[10px] font-black opacity-60">لماذا ظهرت الحالة؟</div><div className="mt-1 text-sm font-black">{decision.headline}</div><div className="mt-1 text-[11px] font-bold leading-5 opacity-75">{decision.reason}</div></div>

        {selected.mixed_units_detected && <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900"><ShieldAlert className="h-4 w-4 shrink-0" /><div><b>حماية الوحدات:</b> لن يتم طرح أو جمع وحدات مختلفة قبل علاقة تحويل موثوقة.</div></div>}
        <PackagingInsight item={selected} />

        <div className="grid gap-2 lg:grid-cols-2"><InvoiceEvidenceCard title="البيع" branch={branchName(selectedIncident.from)} side="sale" metadata={timeline?.sale} /><InvoiceEvidenceCard title="الشراء" branch={branchName(selectedIncident.to)} side="purchase" metadata={timeline?.purchase} /></div>

        {selected?.residual_progress_status === 'partial' && <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs font-bold text-sky-900"><History className="ml-1 inline h-4 w-4" /> {selected.residual_review_reason}</div>}

        <button onClick={() => setDetailsOpen((v) => !v)} className="flex w-full items-center justify-between rounded-xl border bg-slate-50 px-3 py-2 text-xs font-black text-slate-600"><span className="inline-flex items-center gap-2"><BarChart3 className="h-4 w-4" /> الدليل الكامل والتحليل</span>{detailsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
        {detailsOpen && <div className="space-y-3 rounded-2xl border bg-white p-4"><div className="grid gap-2 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-3"><div className="text-[9px] font-black text-slate-400">ثقة الرحلة</div><div className="text-xl font-black">{selected.decision_intelligence?.journey_confidence?.score || 0}%</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-[9px] font-black text-slate-400">ثقة المشكلة</div><div className="text-xl font-black">{selected.decision_intelligence?.issue_confidence?.score || 0}%</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-[9px] font-black text-slate-400">قرارات سابقة للنمط</div><div className="text-xl font-black">{selectedIncident.triage.previous_decision_count}</div></div></div>{timeline?.sale?.invoiceEvidence?.map((entry) => <div key={`sale-${entry.invoice}`} className="rounded-xl bg-sky-50 p-3 text-xs font-bold"><b>بيع {entry.invoice}:</b> {entry.actor} · {entry.dateLabel} · {entry.qtyLabel}</div>)}{timeline?.purchase?.invoiceEvidence?.map((entry) => <div key={`purchase-${entry.invoice}`} className="rounded-xl bg-emerald-50 p-3 text-xs font-bold"><b>شراء {entry.invoice}:</b> {entry.actor} · {entry.dateLabel} · {entry.qtyLabel}</div>)}{saleReturn?.has_return && <div className="rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-900">{formatTransferReturnEvidence(saleReturn, { movement: 'البيع' })}</div>}{purchaseReturn?.has_return && <div className="rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-900">{formatTransferReturnEvidence(purchaseReturn, { movement: 'الشراء' })}</div>}</div>}

        <div className="sticky bottom-3 z-30 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur">{packagingSuggestion ? <Button onClick={approvePackaging} className="bg-teal-700 font-black hover:bg-teal-800">اعتماد {packagingSuggestion.label}</Button> : unitSuggestion ? <Button onClick={approveUnit} className="bg-teal-700 font-black hover:bg-teal-800">اعتماد تحويل العبوة</Button> : <Button onClick={() => recordDecision('verified', `تم الحل: ${decision.headline}`)} className="bg-teal-700 font-black hover:bg-teal-800"><CheckCircle2 className="ml-1 h-4 w-4" /> تم الحل</Button>}<Button variant="outline" onClick={() => recordDecision('in_progress', decision.headline)} className="font-black">متابعة</Button><Button variant="ghost" onClick={() => recordDecision('dismissed', 'ليست مشكلة بعد المراجعة')} className="font-black text-slate-500">ليست مشكلة</Button><div className="mr-auto"><Button variant="outline" onClick={nextCase} className="font-black">التالي</Button></div></div>
      </div>}</Card>
    </div>
  </div></div>;
}
