import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, ChevronDown, ChevronUp, Copy, FileSpreadsheet, Files, History, Search, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { inspectTransferFile, buildSourcesFromInspections } from '@/lib/branchTransferAutoImport';
import { reconcileBranchTransfers, explainTransferCase, transferBranchLabel } from '@/lib/branchTransferControl';
import { applyLearnedUnitRules, learnUnitRule, suggestUnitRule, humanUnitRuleLabel } from '@/lib/branchTransferUnitRules';
import { learnPackagingRule, packagingRuleSuggestion } from '@/lib/branchTransferPackagingIntelligence';
import { buildTransferIncidents } from '@/lib/branchTransferIncidentIntelligence';
import { completeResidualBalancedJourneys } from '@/lib/branchTransferResidualJourneyCompletion';
import { settleAggregateProductJourneys, summarizeAggregateSettlement } from '@/lib/branchTransferAggregateJourneySettlement';
import { gateTransferReviewCases } from '@/lib/branchTransferReviewGate';
import { branchReviewQueueForIncident, incidentMatchesBranchQueue } from '@/lib/branchTransferBranchQueue';
import { compareIncidentsByDay, formatIncidentDayLabel, incidentDayKey, incidentDayOptions, incidentMatchesDay } from '@/lib/branchTransferIncidentDay';
import { summarizeTransferReturnEvidence, formatTransferReturnEvidence } from '@/lib/branchTransferReturnIntelligence';
import { buildOperationTimeline } from '@/lib/branchTransferOperationTimeline';

const STORAGE_KEY = 'dawaa.branch-transfer-control.shadow.v1';

const sourceConfig = {
  shokrySale: { label: 'بيع شكري → الشامي', side: 'sale', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
  shamyPurchase: { label: 'شراء الشامي من شكري', side: 'purchase', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shamySale: { label: 'بيع الشامي → شكري', side: 'sale', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shokryPurchase: { label: 'شراء شكري من الشامي', side: 'purchase', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
};

const issueFilters = [
  ['all', 'كل القرارات'], ['quantity', 'فرق كمية'], ['missing', 'طرف ناقص'], ['invoice', 'فاتورة كاملة'], ['code', 'اختلاف كود'], ['unit', 'تحويل عبوة'],
];
const queueFilters = [['all', 'كل الفروع'], ['shamy', 'الشامي'], ['shokry', 'شكري'], ['shared', 'مشترك']];

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

function incidentPriority(incident) {
  if (incident.kind === 'code_mismatch') return 700;
  if (incident.kind === 'quantity_mismatch') return 600;
  if (['whole_sale_invoice_missing', 'whole_purchase_invoice_missing'].includes(incident.kind)) return 520;
  if (incident.kind === 'unit_conversion') return 300;
  return 440;
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
  const sale = Number(item?.sale_qty || 0);
  const purchase = Number(item?.purchase_qty || 0);
  const diff = Number(Math.abs(sale - purchase).toFixed(3));
  if (item?.packaging_profile_candidate && item?.packaging_profile?.label) return {
    headline: `أكد ${item.packaging_profile.label}`,
    reason: item.packaging_reason || 'العقل شايف إن الفرق سببه طريقة تسجيل الشريط مقابل العلبة، لكنه محتاج تأكيد واحد قبل حفظ قاعدة دائمة.',
    tone: 'sky',
  };
  if (item?.packaging_normalized_mismatch) {
    const boxDiff = Number(Math.abs(Number(item.packaging_normalized_sale_boxes || 0) - purchase).toFixed(3));
    return {
      headline: `راجع فرق ${boxDiff} علبة`,
      reason: item.packaging_reason || 'تم توحيد الشريط والعلبة أولًا ثم حساب الفرق الحقيقي.',
      tone: 'amber',
    };
  }
  if (item?.residual_progress_status === 'partial') return {
    headline: `راجع فقط المتبقي ${item.residual_remaining_qty}`,
    reason: `العقل احتسب ${item.residual_progress_qty} تم تسجيلها لاحقًا من أصل فرق ${item.residual_needed_qty}.`,
    tone: 'amber',
  };
  if (incident.side === 'sale') return { headline: `راجع شراء ${to}`, reason: `البيع موجود في ${from} ومصدر الشراء المقابل موجود، لكن الحركة المقابلة لم تُحسم.`, tone: 'rose' };
  if (incident.side === 'purchase') return { headline: `راجع بيع ${from}`, reason: `الشراء موجود في ${to} ومصدر البيع المقابل موجود، لكن الحركة المقابلة لم تُحسم.`, tone: 'rose' };
  if (incident.kind === 'quantity_mismatch') return { headline: `راجع المتبقي ${diff}`, reason: 'ده فرق صافي بعد التجميع والمرتجعات والحركات اللاحقة التي أمكن حسمها.', tone: 'amber' };
  if (incident.kind === 'code_mismatch') return { headline: 'راجع هوية الصنف', reason: 'الكود مختلف؛ النظام لن يدمج الصنف تلقائيًا حتى لو الاسم قريب.', tone: 'violet' };
  if (incident.kind === 'unit_conversion') {
    const rule = suggestUnitRule(item);
    return { headline: rule ? `أكد ${humanUnitRuleLabel(rule)}` : 'أكد علاقة العبوة', reason: 'بعد الاعتماد يتعلم النظام نفس التحويل لهذا الصنف والاتجاه.', tone: 'sky' };
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

function quantityParts(value) {
  const normalized = clean(value);
  if (!normalized) return { primary: '—', detail: '', empty: true };
  if (normalized === 'لا توجد حركة') return { primary: normalized, detail: '', empty: true };
  const [primary, ...detail] = normalized.split(' · ');
  return { primary, detail: detail.join(' · '), empty: false };
}

function quantityTone(tone) {
  if (tone === 'sale') return 'border-sky-200 bg-sky-50/70';
  if (tone === 'purchase') return 'border-emerald-200 bg-emerald-50/70';
  if (tone === 'remaining') return 'border-amber-200 bg-amber-50/70';
  return 'border-slate-200 bg-slate-50';
}

function Qty({ label, value, hint, tone = 'neutral' }) {
  const parts = quantityParts(value);
  return <div className={`min-h-[112px] rounded-2xl border p-3.5 ${quantityTone(tone)}`}>
    <div className="flex items-center justify-between gap-2">
      <div className="text-[10px] font-black tracking-wide text-slate-400">{label}</div>
      {hint && <span className="rounded-full bg-white/90 px-2 py-1 text-[9px] font-black text-slate-500 shadow-sm">{hint}</span>}
    </div>
    <div className={`mt-3 font-black leading-tight ${parts.empty ? 'text-sm text-slate-400' : 'text-xl text-slate-950 sm:text-2xl'}`}>{parts.primary}</div>
    {parts.detail && <div className="mt-2 inline-flex rounded-lg bg-white/80 px-2 py-1 text-[10px] font-black text-slate-500">{parts.detail}</div>}
  </div>;
}

function packagingConfidenceLabel(profile) {
  if (profile?.confidence === 'confirmed') return 'مؤكدة';
  if (profile?.confidence === 'high') return 'عالية';
  if (profile?.confidence === 'medium') return 'محتملة';
  return 'مبدئية';
}

function packagingSourceLabel(profile) {
  if (profile?.source === 'confirmed_rule') return 'قاعدة معتمدة';
  if (profile?.source === 'product_name_and_observed') return 'الاسم + الحركات السابقة';
  if (profile?.source === 'product_name_explicit') return 'اسم العبوة';
  if (profile?.source === 'observed') return 'الحركات السابقة';
  return 'تحليل العبوة';
}

function PackagingInsight({ item }) {
  const profile = item?.packaging_profile;
  if (!profile?.strips_per_box) return null;
  const confirmed = profile.source === 'confirmed_rule';
  return <div className={`rounded-2xl border p-4 ${confirmed ? 'border-emerald-200 bg-emerald-50/70' : 'border-sky-200 bg-sky-50/70'}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 font-black text-slate-950"><Sparkles className="h-4 w-4 text-teal-600" /> فهم العبوة</div>
      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-slate-700 shadow-sm">{profile.label}</span>
        <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-slate-600 shadow-sm">الثقة: {packagingConfidenceLabel(profile)}</span>
        <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-slate-600 shadow-sm">المصدر: {packagingSourceLabel(profile)}</span>
      </div>
    </div>
    <div className="mt-2 text-xs font-bold leading-6 text-slate-600">{item.packaging_reason || 'تم ربط الكمية بوحدة العبوة قبل مقارنة البيع بالشراء.'}</div>
    {confirmed && <div className="mt-2 text-[10px] font-black text-emerald-700">✓ قاعدة محفوظة ومعتمدة لهذا الكود وتُستخدم تلقائيًا في الملفات الجديدة.</div>}
  </div>;
}

function InvoiceEvidenceCard({ title, branch, side, metadata }) {
  const invoices = metadata?.invoiceEvidence || [];
  const first = invoices[0] || null;
  const actorLabel = side === 'sale' ? 'باع/سجل الفاتورة' : 'اشترى/سجل الفاتورة';
  const border = side === 'sale' ? 'border-sky-200 bg-sky-50/60' : 'border-emerald-200 bg-emerald-50/60';
  const badge = side === 'sale' ? 'bg-sky-100 text-sky-800' : 'bg-emerald-100 text-emerald-800';
  const quantity = quantityParts(first?.qtyLabel || first?.qty);

  return <div className={`rounded-2xl border p-4 ${border}`}>
    <div className="flex items-center justify-between gap-2">
      <div className="font-black text-slate-950">{title} — {branch}</div>
      <span className={`rounded-full px-2 py-1 text-[9px] font-black ${badge}`}>{invoices.length ? `${invoices.length} فاتورة` : 'لا توجد فاتورة'}</span>
    </div>
    {!metadata?.available || !first ? <div className="mt-3 rounded-xl bg-white/70 p-3 text-xs font-bold text-slate-500">لا توجد حركة مسجلة في الملفات الحالية.</div> : <>
      <div className="mt-3 rounded-xl bg-white/80 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="text-[9px] font-black text-slate-400">الكمية داخل الرحلة</div><div className="mt-1 text-lg font-black text-slate-950">{quantity.primary}</div>{quantity.detail && <div className="mt-1 text-[10px] font-black text-slate-500">{quantity.detail}</div>}</div>
          <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[10px] font-black text-slate-600">فاتورة {first.invoice}</span>
        </div>
      </div>
      <div className="mt-3 grid gap-1.5 text-xs font-bold text-slate-700">
        <div><span className="text-slate-400">{actorLabel}:</span> <b className="text-slate-950">{first.actor}</b></div>
        <div><span className="text-slate-400">التاريخ:</span> <b className="text-slate-950">{first.dateLabel}</b></div>
      </div>
      {first.actorConflict && <div className="mt-2 rounded-lg bg-amber-100 px-2.5 py-2 text-[10px] font-black text-amber-900">فيه أكثر من مستخدم على نفس الفاتورة؛ راجع الدليل قبل الاعتماد.</div>}
      {first.timeConflict && <div className="mt-2 rounded-lg bg-amber-100 px-2.5 py-2 text-[10px] font-black text-amber-900">توقيتات نفس الفاتورة غير متطابقة؛ لم يتم تبسيطها كتوقيت واحد موثوق.</div>}
      {invoices.length > 1 && <div className="mt-2 text-[10px] font-black text-slate-500">+ {invoices.length - 1} فاتورة أخرى داخل «تفاصيل الدليل».</div>}
    </>}
  </div>;
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
  const [day, setDay] = useState('all');
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
  const settlementSummary = useMemo(() => summarizeAggregateSettlement(residualCases, settledCases), [residualCases, settledCases]);
  const decoratedCases = useMemo(() => settledCases.map((item) => ({
    ...item,
    decision_intelligence: explainTransferCase(item),
    decision: ledger.decisions[item.id],
  })), [settledCases, ledger.decisions]);
  const gate = useMemo(() => gateTransferReviewCases(decoratedCases, sourcePresence), [decoratedCases, sourcePresence]);
  const incidents = useMemo(() => buildTransferIncidents(gate.actionable), [gate.actionable]);
  const dayOptions = useMemo(() => incidentDayOptions(incidents.filter((entry) => incidentMatchesBranchQueue(entry, queue) && issueMatches(entry, issue))), [incidents, queue, issue]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return incidents.filter((entry) => incidentMatchesBranchQueue(entry, queue))
      .filter((entry) => issueMatches(entry, issue))
      .filter((entry) => incidentMatchesDay(entry, day))
      .filter((entry) => !q || searchText(entry).includes(q))
      .sort((a, b) => compareIncidentsByDay(a, b, incidentPriority));
  }, [incidents, queue, issue, day, query]);

  const selectedIncident = useMemo(() => visible.find((entry) => entry.case_ids.includes(selectedId)) || visible[0] || null, [visible, selectedId]);
  const selected = useMemo(() => selectedIncident?.cases.find((entry) => entry.id === selectedId) || selectedIncident?.cases?.[0] || null, [selectedIncident, selectedId]);
  const decision = selectedIncident && selected ? decisionFor(selectedIncident, selected) : null;
  const code = selected ? unique([...(selected.sale_codes || []), ...(selected.purchase_codes || [])])[0] || '' : '';
  const saleQty = Number(selected?.sale_qty || 0);
  const purchaseQty = Number(selected?.purchase_qty || 0);
  const rawRemaining = selected?.residual_progress_status === 'partial' ? selected.residual_remaining_qty : Number(Math.abs(saleQty - purchaseQty).toFixed(3));
  const remaining = selected?.packaging_normalized_mismatch
    ? `${Number(Math.abs(Number(selected.packaging_normalized_sale_boxes || 0) - purchaseQty).toFixed(3))} علبة`
    : rawRemaining;
  const packagingSuggestion = selected?.packaging_profile_candidate ? packagingRuleSuggestion(selected) : null;
  const unitSuggestion = selected?.type === 'unit_conversion_review' && !packagingSuggestion ? suggestUnitRule(selected) : null;
  const timeline = useMemo(() => selectedIncident ? buildOperationTimeline(selectedIncident) : null, [selectedIncident]);
  const saleReturn = selected ? summarizeTransferReturnEvidence(selected.sale_lines || [], saleQty) : null;
  const purchaseReturn = selected ? summarizeTransferReturnEvidence(selected.purchase_lines || [], purchaseQty) : null;

  useEffect(() => { setDetailsOpen(false); }, [selectedIncident?.id]);
  useEffect(() => { if (day !== 'all' && !dayOptions.some((entry) => entry.key === day)) setDay('all'); }, [day, dayOptions]);

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
      setSelectedId(''); setQueue('all'); setIssue('all'); setDay('all'); setQuery('');
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

  const recordDecision = (status, action) => {
    if (!selectedIncident) return;
    const at = nowIso();
    setLedger((old) => {
      const decisions = { ...old.decisions }; const events = [];
      selectedIncident.cases.forEach((item) => {
        decisions[item.id] = { status, action, updated_at: at, incident_id: selectedIncident.id };
        events.push({ case_id: item.id, incident_id: selectedIncident.id, action, status, at, product_name: item.product_name });
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
      events: [{ case_id: selected.id, action: 'packaging_rule_learned', status: 'verified', at, product_name: selected.product_name, packaging: packagingSuggestion.label }, ...old.events].slice(0, 1000),
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
      events: [{ case_id: selected.id, action: 'unit_rule_learned', status: 'verified', at, product_name: selected.product_name }, ...old.events].slice(0, 1000),
    }));
    setSelectedId('');
  };

  const copyCode = async () => {
    if (!code) return;
    try { await navigator.clipboard.writeText(code); } catch { /* no-op */ }
    setCopied(code); window.setTimeout(() => setCopied(''), 1200);
  };

  const autoSolved = Math.max(0, rawCases.filter((item) => item.type !== 'matched').length - settledCases.filter((item) => item.type !== 'matched').length);
  const activeDecisions = incidents.length;

  return <div dir="rtl" className="min-h-full bg-slate-50"><div className="mx-auto max-w-[1480px] space-y-3 px-3 py-3 sm:px-5">
    {copied && <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-white">تم نسخ {copied}</div>}

    <Card className="border-0 bg-slate-950 p-4 text-white shadow-lg sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2 text-[11px] font-black text-teal-300"><Sparkles className="h-4 w-4" /> غرفة القرار</div><h1 className="mt-1 text-xl font-black sm:text-2xl">تحويلات الفروع</h1><div className="mt-1 text-xs font-bold text-slate-400">المحلول يختفي. المعروض هنا فقط ما زال يحتاج قرارًا.</div></div><Button size="sm" variant="secondary" onClick={() => setUploadOpen((v) => !v)} className="font-black"><Files className="ml-1 h-4 w-4" /> الملفات {uploadOpen ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}</Button></div></Card>

    {uploadOpen && <Card className="p-3 shadow-sm"><label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-teal-300 bg-teal-50/60 p-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-white p-2 shadow-sm"><FileSpreadsheet className="h-5 w-5 text-teal-700" /></div><div><div className="font-black text-slate-950">ارفع كل ملفات البيع والشراء للفترة</div><div className="text-[11px] font-bold text-slate-500">العقل يجمع الفواتير والمرتجعات والتسجيلات المتأخرة ووحدات البيع قبل إنشاء أي قرار.</div></div></div><span className="rounded-full bg-teal-700 px-3 py-1.5 text-xs font-black text-white">{isInspecting ? 'جاري التحليل...' : 'اختيار'}</span><input className="hidden" type="file" multiple accept=".xlsx,.xls,.csv" disabled={isInspecting} onChange={(e) => handleFiles(Array.from(e.target.files || []))} /></label>{message && <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">{message}</div>}{autoReport.ambiguous.length > 0 && <div className="mt-2 space-y-2">{autoReport.ambiguous.map((entry) => <div key={entry.fileName} className="rounded-xl border bg-white p-3"><div className="text-xs font-black">{entry.fileName}</div><div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(sourceConfig).map(([key, config]) => <Button key={key} size="sm" variant="outline" onClick={() => assignAmbiguous(entry, key)} className="text-[10px] font-black">{config.label}</Button>)}</div></div>)}</div>}</Card>}

    {(sales.length || purchases.length) > 0 && <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-600 shadow-sm"><b className="text-slate-950">{activeDecisions} قرار فعلي</b><span className="mx-2 text-slate-300">•</span>العقل قفل تلقائيًا <b className="text-emerald-700">{autoSolved}</b> حالة كانت ستظهر كمشكلة<span className="mx-2 text-slate-300">•</span>قواعد عبوة محفوظة <b className="text-teal-700">{Object.keys(ledger.packagingRules || {}).length}</b><span className="mx-2 text-slate-300">•</span>مراجعات مقفولة سابقًا <b>{gate.summary.already_reviewed}</b>{gate.summary.incomplete_source > 0 && <><span className="mx-2 text-slate-300">•</span><span className="text-amber-700">{gate.summary.incomplete_source} مستبعدة لأن الملف المقابل غير محمل</span></>}</div>}

    <Card className="p-3 shadow-sm"><div className="grid gap-2 md:grid-cols-[150px_160px_190px_minmax(240px,1fr)]"><select value={queue} onChange={(e) => { setQueue(e.target.value); setDay('all'); }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black">{queueFilters.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select value={issue} onChange={(e) => { setIssue(e.target.value); setDay('all'); }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black">{issueFilters.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select value={day} onChange={(e) => setDay(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black"><option value="all">الفترة كلها</option>{dayOptions.map((entry) => <option key={entry.key} value={entry.key}>{entry.label} · {entry.count}</option>)}</select><div className="relative"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="اسم الصنف أو الكود أو الفاتورة" className="w-full rounded-xl border border-slate-200 py-2 pr-9 pl-3 text-xs font-bold outline-none focus:border-teal-400" /></div></div></Card>

    <div className="grid gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="max-h-[72vh] overflow-y-auto p-2 shadow-sm"><div className="px-2 py-2 text-xs font-black text-slate-500">{visible.length} قرار في الفلتر الحالي</div><div className="space-y-1.5">{visible.map((incident) => { const item = incident.cases?.[0]; const itemCode = unique([...(item?.sale_codes || []), ...(item?.purchase_codes || [])])[0] || '—'; const selectedRow = selectedIncident?.id === incident.id; const short = decisionFor(incident, item); return <button key={incident.id} onClick={() => setSelectedId(item?.id || '')} className={`w-full rounded-2xl border p-3 text-right ${selectedRow ? 'border-teal-400 bg-teal-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}><div className="flex items-start justify-between gap-2"><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black text-slate-500">{incidentTitle(incident)}</span><span className="text-[9px] font-black text-slate-400">{formatIncidentDayLabel(incidentDayKey(incident))}</span></div><div className="mt-2 truncate text-sm font-black text-slate-950">{item?.product_name || 'صنف'}</div><div className="mt-1 text-[11px] font-black text-slate-500">كود {itemCode} · {queueLabel(incident)}</div>{(item?.sale_qty_label || item?.purchase_qty_label) && <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] font-bold text-slate-500"><span className="rounded-md bg-sky-50 px-1.5 py-1">{quantityParts(item?.sale_qty_label || 'لا توجد حركة').primary}</span><span className="text-slate-300">↔</span><span className="rounded-md bg-emerald-50 px-1.5 py-1">{quantityParts(item?.purchase_qty_label || 'لا توجد حركة').primary}</span></div>}<div className="mt-2 text-xs font-black text-teal-800">{short.headline}</div></button>; })}{!visible.length && <div className="rounded-2xl bg-emerald-50 p-8 text-center"><CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600" /><div className="mt-2 text-sm font-black text-emerald-900">مفيش قرار مطلوب هنا</div><div className="mt-1 text-xs font-bold text-emerald-700">الحالات المتوازنة أو المقفولة لا تظهر في قائمة المشاكل.</div></div>}</div></Card>

      <Card className="p-4 shadow-sm sm:p-5">{!selectedIncident || !selected ? <div className="flex min-h-[430px] items-center justify-center text-sm font-bold text-slate-400">اختر قرارًا من القائمة.</div> : <div className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4"><div><div className="text-[10px] font-black text-slate-400">{incidentTitle(selectedIncident)} · {queueLabel(selectedIncident)}</div><h2 className="mt-1 text-xl font-black text-slate-950">{selected.product_name || selectedIncident.product_names?.[0]}</h2><div className="mt-2 flex flex-wrap items-center gap-2"><button onClick={copyCode} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-black"><Copy className="h-3.5 w-3.5 text-teal-600" /> كود {code || 'غير متاح'}</button>{selectedIncident.invoice && <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-black">فاتورة {selectedIncident.invoice}</span>}</div></div><div className="text-[10px] font-black text-slate-400">{formatIncidentDayLabel(incidentDayKey(selectedIncident))}</div></div>

        <div className={`rounded-2xl border p-5 ${toneClass(decision.tone)}`}><div className="text-[10px] font-black opacity-60">القرار المطلوب الآن</div><div className="mt-1 text-2xl font-black sm:text-3xl">{decision.headline}</div><div className="mt-2 text-xs font-bold leading-6 opacity-75">{decision.reason}</div></div>

        <div className="grid gap-2 sm:grid-cols-3"><Qty label="بيع" value={selected.sale_qty_label || saleQty} hint={branchName(selectedIncident.from)} tone="sale" /><Qty label="شراء" value={selected.purchase_qty_label || purchaseQty} hint={branchName(selectedIncident.to)} tone="purchase" /><Qty label="المتبقي" value={remaining} hint={selected?.packaging_normalized_mismatch ? 'بعد توحيد العبوة' : selected?.residual_progress_status === 'partial' ? 'بعد الاستكمالات' : 'بعد التحليل'} tone="remaining" /></div>

        <PackagingInsight item={selected} />

        <div className="grid gap-2 lg:grid-cols-2"><InvoiceEvidenceCard title="البيع" branch={branchName(selectedIncident.from)} side="sale" metadata={timeline?.sale} /><InvoiceEvidenceCard title="الشراء" branch={branchName(selectedIncident.to)} side="purchase" metadata={timeline?.purchase} /></div>

        {selected?.residual_progress_status === 'partial' && <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs font-bold leading-6 text-sky-900"><div className="flex items-center gap-2 font-black"><History className="h-4 w-4" /> جزء من الفرق اتسجل بعد الحركة الأصلية</div><div className="mt-1">{selected.residual_review_reason}</div></div>}

        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">{packagingSuggestion ? <Button onClick={approvePackaging} className="bg-teal-700 font-black hover:bg-teal-800">اعتماد {packagingSuggestion.label}</Button> : unitSuggestion ? <Button onClick={approveUnit} className="bg-teal-700 font-black hover:bg-teal-800">اعتماد تحويل العبوة</Button> : <Button onClick={() => recordDecision('verified', `تم الحل: ${decision.headline}`)} className="bg-teal-700 font-black hover:bg-teal-800"><CheckCircle2 className="ml-1 h-4 w-4" /> تم الحل</Button>}<Button variant="outline" onClick={() => recordDecision('in_progress', decision.headline)} className="font-black">متابعة</Button><Button variant="ghost" onClick={() => recordDecision('dismissed', 'ليست مشكلة بعد المراجعة')} className="font-black text-slate-500">ليست مشكلة</Button></div>

        <button onClick={() => setDetailsOpen((v) => !v)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-600"><span>تفاصيل الدليل</span>{detailsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
        {detailsOpen && <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"><div className="grid gap-2 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-3"><div className="text-[9px] font-black text-slate-400">ثقة الرحلة</div><div className="mt-1 text-xl font-black">{selected.decision_intelligence?.journey_confidence?.score || 0}%</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-[9px] font-black text-slate-400">ثقة المشكلة</div><div className="mt-1 text-xl font-black">{selected.decision_intelligence?.issue_confidence?.score || 0}%</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-[9px] font-black text-slate-400">استكمالات لاحقة</div><div className="mt-1 text-xl font-black">{selected.residual_progress_candidate_count || selected.residual_candidate_count || 0}</div></div></div>{timeline?.sale?.invoiceEvidence?.map((entry) => <div key={`sale-${entry.invoice}`} className="rounded-xl bg-sky-50 p-3 text-xs font-bold text-slate-700"><b className="text-slate-950">بيع فاتورة {entry.invoice}:</b> {entry.actor} · {entry.dateLabel} · {entry.qtyLabel || `كمية ${entry.qty}`}{entry.sourceFiles?.length ? ` · ${entry.sourceFiles.join('، ')}` : ''}</div>)}{timeline?.purchase?.invoiceEvidence?.map((entry) => <div key={`purchase-${entry.invoice}`} className="rounded-xl bg-emerald-50 p-3 text-xs font-bold text-slate-700"><b className="text-slate-950">شراء فاتورة {entry.invoice}:</b> {entry.actor} · {entry.dateLabel} · {entry.qtyLabel || `كمية ${entry.qty}`}{entry.sourceFiles?.length ? ` · ${entry.sourceFiles.join('، ')}` : ''}</div>)}{selected.packaging_reason && <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs font-bold text-sky-900">{selected.packaging_reason}</div>}{saleReturn?.has_return && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-900">{formatTransferReturnEvidence(saleReturn, { movement: 'البيع' })}</div>}{purchaseReturn?.has_return && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-900">{formatTransferReturnEvidence(purchaseReturn, { movement: 'الشراء' })}</div>}{selected.residual_review_reason && <div className="text-xs font-bold leading-6 text-slate-600">{selected.residual_review_reason}</div>}{selected.match_reason && <div className="text-xs font-bold leading-6 text-slate-500">{selected.match_reason}</div>}</div>}
      </div>}</Card>
    </div>
  </div></div>;
}
