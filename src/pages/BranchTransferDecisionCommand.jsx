import { useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon, AlertTriangle, ArrowLeftRight, BrainCircuit, CheckCircle2, ChevronDown, ChevronUp,
  CircleHelp, Clock3, Copy, FileSpreadsheet, Files, History, Keyboard, RefreshCw, Route, ScanSearch,
  Search, ShieldCheck, Sparkles, UserRound, WandSparkles, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { parseTransferWorkbook } from '@/lib/branchTransferShadowParser';
import { buildSourcesFromInspections, inspectTransferFile } from '@/lib/branchTransferAutoImport';
import {
  employeeTransferStats, reconcileBranchTransfers, summarizeTransferCases,
  transferBranchLabel, transferErrorRate, explainTransferCase,
} from '@/lib/branchTransferControl';
import {
  applyLearnedUnitRules, humanUnitRuleLabel, learnUnitRule, removeUnitRule, suggestUnitRule, unitRuleLabel,
} from '@/lib/branchTransferUnitRules';
import { buildTransferIncidents, summarizeTransferIncidents } from '@/lib/branchTransferIncidentIntelligence';
import { buildOperationTimeline } from '@/lib/branchTransferOperationTimeline';
import { detectTransferCodeConflict, findRollingEvidence, mergeRollingEvidence } from '@/lib/branchTransferRollingEvidence';
import { branchReviewQueueForIncident, incidentMatchesBranchQueue } from '@/lib/branchTransferBranchQueue';

const STORAGE_KEY = 'dawaa.branch-transfer-control.shadow.v1';
const EVIDENCE_KEY = 'dawaa.branch-transfer-evidence.v1';

const sourceConfig = {
  shokrySale: { label: 'بيع شكري → الشامي', side: 'sale', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
  shamyPurchase: { label: 'شراء الشامي من شكري', side: 'purchase', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shamySale: { label: 'بيع الشامي → شكري', side: 'sale', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shokryPurchase: { label: 'شراء شكري من الشامي', side: 'purchase', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
};

const filters = [
  ['all', 'كل القرارات'],
  ['code', 'اختلاف كود'],
  ['quantity', 'فرق كمية'],
  ['invoice', 'فاتورة كاملة'],
  ['missing', 'طرف ناقص'],
  ['unit', 'تحويل عبوة'],
];

const branchQueues = [
  ['all', 'كل الفروع'],
  ['shamy', 'مشاكل الشامي'],
  ['shokry', 'مشاكل شكري'],
  ['shared', 'مشترك / غير محسوم'],
];

function loadLedger() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { decisions: value.decisions || {}, events: Array.isArray(value.events) ? value.events : [], unitRules: value.unitRules || {} };
  } catch {
    return { decisions: {}, events: [], unitRules: {} };
  }
}

function loadEvidence() {
  try {
    const value = JSON.parse(localStorage.getItem(EVIDENCE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function nowIso() { return new Date().toISOString(); }
function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function unique(values = []) { return [...new Set(values.map(clean).filter(Boolean))]; }

function branchName(value) {
  const label = transferBranchLabel(value);
  if (/شكري|العزم/i.test(label)) return 'شكري';
  if (/شامي/i.test(label)) return 'الشامي';
  return label || value || 'الفرع';
}

function incidentMatches(incident, filter) {
  if (filter === 'invoice') return ['whole_sale_invoice_missing', 'whole_purchase_invoice_missing'].includes(incident.kind);
  if (filter === 'missing') return ['whole_sale_invoice_missing', 'partial_sale_invoice_missing', 'whole_purchase_invoice_missing', 'partial_purchase_invoice_missing', 'single_missing'].includes(incident.kind);
  if (filter === 'unit') return incident.kind === 'unit_conversion';
  if (filter === 'quantity') return incident.kind === 'quantity_mismatch';
  if (filter === 'code') return incident.kind === 'code_mismatch' || incident.cases?.some((item) => detectTransferCodeConflict(item).conflict);
  return true;
}

function incidentAccent(kind) {
  if (kind === 'code_mismatch') return 'violet';
  if (kind === 'quantity_mismatch') return 'amber';
  if (kind === 'unit_conversion') return 'sky';
  return 'rose';
}

function incidentPriority(incident) {
  const hasCodeConflict = incident.kind === 'code_mismatch' || incident.cases?.some((item) => detectTransferCodeConflict(item).conflict);
  const base = hasCodeConflict ? 700
    : incident.kind === 'quantity_mismatch' ? 600
      : ['whole_sale_invoice_missing', 'whole_purchase_invoice_missing'].includes(incident.kind) ? 520
        : ['partial_sale_invoice_missing', 'partial_purchase_invoice_missing', 'single_missing'].includes(incident.kind) ? 440
          : incident.kind === 'unit_conversion' ? 300 : 100;
  return base + Number(incident.issue_confidence || 0) + Math.min(50, Number(incident.line_issue_count || 0) * 4);
}

function incidentSearchText(incident) {
  return [
    incident.invoice,
    ...(incident.product_names || []),
    ...(incident.product_codes || []),
    ...(incident.cases || []).flatMap((item) => [
      item.product_name, item.sale_product_name, item.purchase_product_name,
      ...(item.sale_codes || []), ...(item.purchase_codes || []),
      ...(item.sale_invoices || []), ...(item.purchase_invoices || []),
    ]),
  ].join(' ').toLowerCase();
}

function SourceUpload({ sourceKey, source, onFiles }) {
  const config = sourceConfig[sourceKey];
  const loaded = source?.items?.length > 0;
  return <label className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${loaded ? 'border-emerald-200 bg-emerald-50' : 'border-dashed border-slate-300 bg-white'}`}>
    <div className="min-w-0"><div className="text-xs font-black text-slate-900">{config.label}</div><div className="mt-0.5 truncate text-[10px] font-bold text-slate-400">{loaded ? `${source.fileNames?.length || 0} ملف · ${source.items?.length || 0} سطر` : 'اختيار يدوي'}</div></div>
    <FileSpreadsheet className={`h-4 w-4 ${loaded ? 'text-emerald-600' : 'text-slate-400'}`} />
    <input className="hidden" type="file" multiple accept=".xlsx,.xls,.csv" onChange={(event) => onFiles(sourceKey, Array.from(event.target.files || []))} />
  </label>;
}

function CopyChip({ value, label, onCopy, strong = false }) {
  if (!value) return null;
  return <button type="button" onClick={() => onCopy(value, label || value)} title="نسخ" className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-right font-black shadow-sm transition hover:border-teal-300 hover:bg-teal-50 ${strong ? 'text-sm text-slate-950' : 'text-[11px] text-slate-700'}`}>
    <span className="truncate">{value}</span><Copy className="h-3.5 w-3.5 shrink-0 text-teal-600" />
  </button>;
}

function OperationMeta({ operation }) {
  if (!operation?.available) return null;
  return <div className="mt-3 space-y-1.5 border-t border-black/5 pt-3">
    <div className="flex items-start gap-2 text-[11px] font-bold leading-5 text-slate-600"><UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /><span><b className="text-slate-700">مدخل الفاتورة:</b> {operation.userLabel}</span></div>
    <div className="flex items-start gap-2 text-[11px] font-bold leading-5 text-slate-600"><Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /><span>{operation.timeLabel}</span></div>
  </div>;
}

function FlowNode({ branch, title, value, status = 'done', note, operation }) {
  const classes = status === 'done' ? 'border-emerald-200 bg-emerald-50' : status === 'review' ? 'border-amber-200 bg-amber-50' : 'border-rose-200 bg-rose-50';
  const badge = status === 'done' ? 'تم' : status === 'review' ? 'راجع' : 'مطلوب';
  const badgeClass = status === 'done' ? 'text-emerald-700' : status === 'review' ? 'text-amber-700' : 'text-rose-700';
  return <div className={`min-w-0 flex-1 rounded-2xl border p-4 ${classes}`}>
    <div className="flex items-center justify-between gap-2"><div className="text-sm font-black text-slate-950">{branch} — {title}</div><span className={`rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-black ${badgeClass}`}>{badge}</span></div>
    <div className="mt-2 text-3xl font-black text-slate-950">{value}</div>
    {note && <div className="mt-1.5 text-[11px] font-bold leading-5 text-slate-500">{note}</div>}
    <OperationMeta operation={operation} />
  </div>;
}

function transferFlow(incident, item) {
  const from = branchName(incident.from);
  const to = branchName(incident.to);
  const saleQty = Number(item?.sale_qty || 0);
  const purchaseQty = Number(item?.purchase_qty || 0);
  const saleUnit = item?.sale_units?.join('، ') || '';
  const purchaseUnit = item?.purchase_units?.join('، ') || '';
  const timeline = buildOperationTimeline(incident);

  if (incident.side === 'sale') return {
    from, to,
    left: { title: 'البيع', value: saleQty || 'مسجل', status: 'done', note: saleUnit || 'الحركة موجودة', operation: timeline.sale },
    right: { title: 'الشراء', value: purchaseQty || 'غير مسجل', status: 'missing', note: 'لم نجد شراءً مقابلًا', operation: timeline.purchase },
    step: `سجّل شراء ${to}`, detail: incident.invoice ? `فاتورة ${incident.invoice} · البيع موجود في ${from}` : `البيع موجود في ${from}`,
    doneLabel: `تم التأكد من شراء ${to}`, gapLabel: timeline.gapLabel,
  };
  if (incident.side === 'purchase') return {
    from, to,
    left: { title: 'البيع', value: saleQty || 'غير مسجل', status: 'missing', note: 'لم نجد بيعًا مقابلًا', operation: timeline.sale },
    right: { title: 'الشراء', value: purchaseQty || 'مسجل', status: 'done', note: purchaseUnit || 'الحركة موجودة', operation: timeline.purchase },
    step: `سجّل بيع ${from}`, detail: incident.invoice ? `فاتورة ${incident.invoice} · الشراء موجود في ${to}` : `الشراء موجود في ${to}`,
    doneLabel: `تم التأكد من بيع ${from}`, gapLabel: timeline.gapLabel,
  };
  if (incident.kind === 'unit_conversion') {
    const suggestion = suggestUnitRule(item); const relation = suggestion ? humanUnitRuleLabel(suggestion) : '';
    return { from, to, left: { title: 'خرج', value: saleQty, status: 'done', note: saleUnit || 'وحدة البيع', operation: timeline.sale }, right: { title: 'دخل', value: purchaseQty, status: 'done', note: purchaseUnit || 'وحدة الشراء', operation: timeline.purchase }, step: relation ? `أكد: ${relation}` : 'أكد علاقة العبوة مرة واحدة', detail: 'بعد الاعتماد، النظام يتعلم نفس العلاقة لهذا الصنف والاتجاه.', doneLabel: 'تمت مراجعة تحويل العبوة', gapLabel: timeline.gapLabel };
  }
  if (incident.kind === 'quantity_mismatch') {
    const diff = Math.abs(purchaseQty - saleQty);
    return { from, to, left: { title: 'خرج', value: saleQty, status: 'review', note: saleUnit || 'كمية البيع', operation: timeline.sale }, right: { title: 'دخل', value: purchaseQty, status: 'review', note: purchaseUnit || 'كمية الشراء', operation: timeline.purchase }, step: `راجع فرق الكمية (${Number(diff.toFixed(3))})`, detail: 'تأكد من الوحدة، ثم شوف الحركات اللاحقة قبل اعتباره عجزًا.', doneLabel: 'تمت مراجعة فرق الكمية', gapLabel: timeline.gapLabel };
  }
  if (incident.kind === 'code_mismatch') return { from, to, left: { title: 'البيع', value: saleQty, status: 'review', note: 'الكود موضح بالأعلى', operation: timeline.sale }, right: { title: 'الشراء', value: purchaseQty, status: 'review', note: 'الكود موضح بالأعلى', operation: timeline.purchase }, step: 'راجع هوية الصنف قبل أي دمج', detail: 'نفس الاسم لا يكفي وحده لو الكود مختلف.', doneLabel: 'تمت مراجعة هوية الصنف', gapLabel: timeline.gapLabel };
  return { from, to, left: { title: 'المصدر', value: saleQty, status: 'review', operation: timeline.sale }, right: { title: 'المستلم', value: purchaseQty, status: 'review', operation: timeline.purchase }, step: 'راجع الحركة', detail: incident.recommended_check || '', doneLabel: 'تمت المراجعة', gapLabel: timeline.gapLabel };
}

function formatEvidenceTime(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return 'وقت غير متاح';
  return new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(Number(timestamp)));
}

function RollingEvidencePanel({ evidence, onCopy }) {
  const best = evidence?.best;
  if (!best) return null;
  const unsafeCode = best.differentCodeSameName;
  const strong = evidence.mayExplainFully;
  return <div className={`rounded-2xl border p-4 ${unsafeCode ? 'border-violet-200 bg-violet-50' : strong ? 'border-sky-200 bg-sky-50' : 'border-slate-200 bg-slate-50'}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className={`flex items-center gap-2 text-sm font-black ${unsafeCode ? 'text-violet-900' : strong ? 'text-sky-900' : 'text-slate-800'}`}><History className="h-4 w-4" />{unsafeCode ? 'حركة لاحقة بنفس الاسم لكن بكود مختلف' : strong ? 'حركة لاحقة قد تفسر فرق الكمية بالكامل' : 'حركة لاحقة مرتبطة بالصنف'}</div>
      <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-500">{best.gapLabel}</span>
    </div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <div><div className="text-[9px] font-black text-slate-400">الحركة</div><div className="mt-1 text-sm font-black text-slate-900">{best.side === 'sale' ? 'بيع لاحق' : 'شراء لاحق'} · {best.qty}</div></div>
      <div><div className="text-[9px] font-black text-slate-400">المستخدم</div><div className="mt-1 text-sm font-black text-slate-900">{best.user || 'غير متاح'}</div></div>
      <div><div className="text-[9px] font-black text-slate-400">الفاتورة</div><div className="mt-1 text-sm font-black text-slate-900">{best.invoice || 'غير متاح'}</div></div>
      <div><div className="text-[9px] font-black text-slate-400">الكود</div><div className="mt-1"><CopyChip value={best.code || 'غير متاح'} label="كود الحركة اللاحقة" onCopy={onCopy} /></div></div>
    </div>
    <div className="mt-2 text-[11px] font-bold leading-5 text-slate-600">{formatEvidenceTime(best.timestamp_ms)}</div>
    {strong && <div className="mt-2 text-xs font-black text-sky-900">الفرق المطلوب {evidence.missingQty}، والحركة اللاحقة بنفس الكود والكمية. دي قرينة قوية للمراجعة وليست إغلاقًا تلقائيًا.</div>}
    {unsafeCode && <div className="mt-2 text-xs font-black text-violet-900">ممنوع اعتبارها تصحيح تلقائي لأن الكود مختلف. راجع هوية الصنف أولًا.</div>}
  </div>;
}

function WhyPanel({ incident, item }) {
  const intel = item?.decision_intelligence || explainTransferCase(item || {});
  return <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
    <div className="grid gap-2 sm:grid-cols-3">
      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-100"><div className="text-[10px] font-black text-slate-400">ثقة السبب</div><div className="mt-1 text-2xl font-black">{incident.root_cause_confidence}%</div></div>
      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-100"><div className="text-[10px] font-black text-slate-400">ثقة وجود مشكلة</div><div className="mt-1 text-2xl font-black">{intel.issue_confidence?.score || 0}%</div></div>
      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-100"><div className="text-[10px] font-black text-slate-400">ثقة ربط الرحلة</div><div className="mt-1 text-2xl font-black">{intel.journey_confidence?.score || 0}%</div></div>
    </div>
    <div className="text-xs font-bold leading-6 text-slate-600">{incident.summary}</div>
    {intel.uncertainties?.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="text-xs font-black text-amber-900">قبل ما تعتبرها خطأ موظف</div>{intel.uncertainties.slice(0, 3).map((value, index) => <div key={`${value}-${index}`} className="mt-1 text-[11px] font-bold text-amber-900">• {value}</div>)}</div>}
    {incident.line_issue_count > 1 && <div className="flex flex-wrap gap-1.5">{incident.cases.slice(0, 15).map((entry) => <span key={entry.id} className="rounded-full border bg-white px-2 py-1 text-[10px] font-bold">{entry.product_name}</span>)}</div>}
  </div>;
}

export default function BranchTransferDecisionCommand() {
  const [sources, setSources] = useState({});
  const [ledger, setLedger] = useState(loadLedger);
  const [evidenceArchive, setEvidenceArchive] = useState(loadEvidence);
  const [message, setMessage] = useState('');
  const [autoReport, setAutoReport] = useState({ inspections: [], ambiguous: [], duplicates: [], errors: [] });
  const [isInspecting, setIsInspecting] = useState(false);
  const [sourcePanel, setSourcePanel] = useState(true);
  const [manualPanel, setManualPanel] = useState(false);
  const [view, setView] = useState('now');
  const [filter, setFilter] = useState('all');
  const [branchQueue, setBranchQueue] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [showWhy, setShowWhy] = useState(false);
  const [copied, setCopied] = useState('');

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger)); }, [ledger]);

  const sales = useMemo(() => Object.entries(sources).flatMap(([key, source]) => sourceConfig[key]?.side === 'sale' ? (source.items || []) : []), [sources]);
  const purchases = useMemo(() => Object.entries(sources).flatMap(([key, source]) => sourceConfig[key]?.side === 'purchase' ? (source.items || []) : []), [sources]);

  useEffect(() => {
    if (!sales.length && !purchases.length) return;
    setEvidenceArchive((old) => {
      const next = mergeRollingEvidence(old, sales, purchases, { retentionDays: 14 });
      localStorage.setItem(EVIDENCE_KEY, JSON.stringify(next));
      return next;
    });
  }, [sales, purchases]);

  const rawCases = useMemo(() => reconcileBranchTransfers(sales, purchases), [sales, purchases]);
  const cases = useMemo(() => applyLearnedUnitRules(rawCases, ledger.unitRules).map((item) => ({ ...item, decision_intelligence: explainTransferCase(item) })), [rawCases, ledger.unitRules]);
  const summary = useMemo(() => summarizeTransferCases(cases), [cases]);
  const decorated = useMemo(() => cases.map((item) => ({ ...item, decision: ledger.decisions[item.id] })), [cases, ledger.decisions]);
  const incidentCases = useMemo(() => decorated.filter((item) => item.type === 'matched' || !['dismissed', 'verified'].includes(item.decision?.status)), [decorated]);
  const incidents = useMemo(() => buildTransferIncidents(incidentCases), [incidentCases]);
  const incidentSummary = useMemo(() => summarizeTransferIncidents(incidents), [incidents]);
  const visibleIncidents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return incidents
      .filter((incident) => incidentMatchesBranchQueue(incident, branchQueue))
      .filter((incident) => incidentMatches(incident, filter))
      .filter((incident) => !q || incidentSearchText(incident).includes(q))
      .sort((a, b) => incidentPriority(b) - incidentPriority(a));
  }, [incidents, branchQueue, filter, query]);
  const selectedIncident = useMemo(() => visibleIncidents.find((incident) => incident.case_ids.includes(selectedId)) || visibleIncidents[0] || null, [visibleIncidents, selectedId]);
  const selected = useMemo(() => selectedIncident?.cases.find((item) => item.id === selectedId) || selectedIncident?.cases?.[0] || null, [selectedIncident, selectedId]);
  const followup = useMemo(() => decorated.filter((item) => ['in_progress', 'waiting_verification'].includes(item.decision?.status)), [decorated]);
  const employees = useMemo(() => employeeTransferStats(decorated), [decorated]);
  const learnedRules = useMemo(() => Object.values(ledger.unitRules || {}).filter((rule) => rule?.active), [ledger.unitRules]);
  const loadedFileCount = Object.values(sources).reduce((sum, source) => sum + (source?.fileNames?.length || 0), 0);
  const flow = selectedIncident && selected ? transferFlow(selectedIncident, selected) : null;
  const unitSuggestion = selected?.type === 'unit_conversion_review' ? suggestUnitRule(selected) : null;
  const rollingEvidence = useMemo(() => selected ? findRollingEvidence(selected, evidenceArchive, { beforeDays: 3, afterDays: 7 }) : null, [selected, evidenceArchive]);
  const codeConflict = selected ? detectTransferCodeConflict(selected) : null;
  const allCodes = selected ? unique([...(selected.sale_codes || []), ...(selected.purchase_codes || [])]) : [];
  const branchHealth = { shokry: transferErrorRate(decorated, 'shokry'), shamy: transferErrorRate(decorated, 'shamy') };

  const copyValue = async (value, label) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(String(value));
    } catch {
      const textarea = document.createElement('textarea'); textarea.value = String(value); document.body.appendChild(textarea); textarea.select(); document.execCommand('copy'); textarea.remove();
    }
    setCopied(label || String(value));
    window.setTimeout(() => setCopied(''), 1300);
  };

  const selectNext = () => {
    if (!selectedIncident) return;
    const index = visibleIncidents.findIndex((item) => item.id === selectedIncident.id);
    const next = visibleIncidents[index + 1] || visibleIncidents[0];
    if (next) setSelectedId(next.cases?.[0]?.id || '');
  };

  const recordIncidentDecision = (incident, status, action) => {
    if (!incident) return;
    const at = nowIso();
    setLedger((old) => {
      const decisions = { ...old.decisions }; const events = [];
      incident.cases.forEach((item) => {
        decisions[item.id] = { status, action, updated_at: at, incident_id: incident.id };
        events.push({ case_id: item.id, incident_id: incident.id, action, status, at, type: item.type, from: item.from, to: item.to, product_name: item.product_name });
      });
      return { ...old, decisions, events: [...events, ...old.events].slice(0, 1000) };
    });
    const index = visibleIncidents.findIndex((candidate) => candidate.id === incident.id);
    const next = visibleIncidents[index + 1] || visibleIncidents[index - 1];
    setSelectedId(next?.cases?.[0]?.id || '');
  };

  const approveUnitRule = (item) => {
    const suggestion = suggestUnitRule(item); if (!suggestion) return;
    const at = nowIso(); const label = unitRuleLabel(suggestion);
    setLedger((old) => ({ ...old, unitRules: learnUnitRule(item, old.unitRules || {}), decisions: { ...old.decisions, [item.id]: { status: 'verified', action: `اعتماد تحويل العبوة: ${label}`, updated_at: at } }, events: [{ case_id: item.id, action: 'unit_rule_learned', status: 'verified', at, type: item.type, from: item.from, to: item.to, product_name: item.product_name, rule: suggestion }, ...old.events].slice(0, 1000) }));
    selectNext();
  };

  useEffect(() => { setShowWhy(false); }, [selectedIncident?.id]);
  useEffect(() => {
    if (selectedId && !visibleIncidents.some((incident) => incident.case_ids.includes(selectedId))) setSelectedId('');
  }, [visibleIncidents, selectedId]);
  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || event.target?.isContentEditable || !selectedIncident || view !== 'now') return;
      const key = event.key.toLowerCase();
      if (key === '1') { event.preventDefault(); if (unitSuggestion) approveUnitRule(selected); else recordIncidentDecision(selectedIncident, 'waiting_verification', flow?.doneLabel || 'تمت المراجعة'); }
      if (key === '2') { event.preventDefault(); recordIncidentDecision(selectedIncident, 'in_progress', `بدأت المراجعة: ${flow?.step || 'راجع الحركة'}`); }
      if (key === '3') { event.preventDefault(); recordIncidentDecision(selectedIncident, 'dismissed', 'ليست مشكلة بعد المراجعة'); }
      if (key === 'c' && allCodes[0]) { event.preventDefault(); copyValue(allCodes[0], `الكود ${allCodes[0]}`); }
      if (key === 'n') { event.preventDefault(); selectNext(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIncident, selected, flow, unitSuggestion, view, visibleIncidents, allCodes]);

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
      setAutoReport({ inspections, ambiguous: grouped.ambiguous, duplicates: grouped.duplicates, errors: grouped.errors });
      const notes = [];
      if (grouped.duplicates.length) notes.push(`تم تجاهل ${grouped.duplicates.length} ملف مكرر.`);
      if (grouped.ambiguous.length) notes.push(`${grouped.ambiguous.length} ملف يحتاج تحديد اتجاه.`);
      if (grouped.errors.length) notes.push(`${grouped.errors.length} ملف تعذر قراءته.`);
      setMessage(notes.join(' ')); setSelectedId(''); setFilter('all'); setBranchQueue('all'); setQuery('');
      setSourcePanel(Boolean(grouped.ambiguous.length || grouped.errors.length));
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
      return { ...old, [sourceKey]: { ...bucket, valid: true, items: [...bucket.items, ...items], fileNames: [...bucket.fileNames, entry.fileName], meta: { files: [...(bucket.meta?.files || []), { fileName: entry.fileName, ...entry.parsed?.meta }] } } };
    });
    setAutoReport((old) => ({ ...old, ambiguous: old.ambiguous.filter((item) => item !== entry) }));
  };

  const revokeUnitRule = (rule) => {
    const at = nowIso();
    setLedger((old) => ({ ...old, unitRules: removeUnitRule(old.unitRules || {}, rule.key), events: [{ action: 'unit_rule_revoked', at, product_name: rule.product_name, from: rule.from, to: rule.to, rule_key: rule.key }, ...old.events].slice(0, 1000) }));
  };

  const reset = () => { setSources({}); setMessage(''); setSelectedId(''); setFilter('all'); setBranchQueue('all'); setQuery(''); setSourcePanel(true); setAutoReport({ inspections: [], ambiguous: [], duplicates: [], errors: [] }); };
  const filterCount = (key) => incidents.filter((incident) => incidentMatchesBranchQueue(incident, branchQueue) && incidentMatches(incident, key)).length;
  const branchQueueCount = (key) => incidents.filter((incident) => incidentMatchesBranchQueue(incident, key)).length;

  return <div dir="rtl" className="min-h-full bg-slate-50/80"><div className="mx-auto w-full max-w-[1500px] space-y-3 px-3 py-3 sm:px-5">
    {copied && <div className="fixed left-1/2 top-4 z-[100] -translate-x-1/2 rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-white shadow-xl">تم نسخ {copied}</div>}

    <Card className="overflow-hidden border-0 bg-gradient-to-l from-slate-950 via-slate-900 to-teal-950 text-white shadow-lg"><div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5"><div><div className="flex items-center gap-2 text-[11px] font-black text-teal-300"><Sparkles className="h-4 w-4" /> مركز القرار السريع</div><h1 className="mt-1 text-xl font-black sm:text-2xl">تحويلات شكري ↔ الشامي</h1><div className="mt-1 text-xs font-bold text-slate-300">الاسم والكود والقرار والحركة اللاحقة قدامك في نفس الشاشة.</div></div><div className="flex items-center gap-2"><div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-center"><div className="text-[9px] font-bold text-slate-400">الملفات</div><div className="text-lg font-black">{loadedFileCount}</div></div><Button size="sm" variant="secondary" onClick={() => setSourcePanel((v) => !v)} className="font-black">الملفات {sourcePanel ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}</Button><Button size="sm" variant="outline" onClick={reset} className="border-white/20 bg-transparent font-black text-white hover:bg-white/10 hover:text-white"><RefreshCw className="ml-1 h-4 w-4" /> مسح</Button></div></div></Card>

    {sourcePanel && <Card className="border-slate-200 p-4 shadow-sm"><label className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-teal-300 bg-teal-50/50 p-4 text-center hover:border-teal-500"><Files className="h-7 w-7 text-teal-700" /><div className="mt-2 text-base font-black text-slate-950">ارفع ملفات اليوم أو عدة أيام</div><div className="mt-1 text-xs font-bold text-slate-500">النظام يحتفظ محليًا بنافذة أدلة 14 يومًا ويبحث عن التصحيحات المتأخرة حتى 7 أيام.</div><div className="mt-3 rounded-full bg-teal-700 px-4 py-2 text-xs font-black text-white">{isInspecting ? 'جاري التحليل...' : 'اختيار الملفات'}</div><input className="hidden" type="file" multiple accept=".xlsx,.xls,.csv" disabled={isInspecting} onChange={(e) => handleAutoFiles(Array.from(e.target.files || []))} /></label>{autoReport.ambiguous.length > 0 && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="flex items-center gap-2 text-sm font-black text-amber-900"><CircleHelp className="h-4 w-4" /> ملفات تحتاج تحديد اتجاه</div>{autoReport.ambiguous.map((entry) => <div key={`${entry.fileName}-${entry.fileSize}`} className="mt-2 rounded-xl bg-white p-3"><div className="font-black text-slate-900">{entry.fileName}</div><div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(sourceConfig).map(([key, config]) => <Button key={key} size="sm" variant="outline" onClick={() => assignAmbiguous(entry, key)} className="text-[11px] font-black">{config.label}</Button>)}</div></div>)}</div>}{message && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">{message}</div>}<button type="button" onClick={() => setManualPanel((v) => !v)} className="mt-3 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-600"><span>رفع يدوي متقدم</span>{manualPanel ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>{manualPanel && <div className="mt-2 grid gap-2 md:grid-cols-2">{Object.keys(sourceConfig).map((key) => <SourceUpload key={key} sourceKey={key} source={sources[key]} onFiles={handleFiles} />)}</div>}</Card>}

    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4"><Card className="p-3"><div className="text-[10px] font-black text-slate-400">قرارات فعلية</div><div className="mt-1 text-2xl font-black">{incidentSummary.total}</div><div className="text-[10px] font-bold text-slate-400">بدل {incidentSummary.line_issues} فرق خام</div></Card><Card className="border-violet-100 bg-violet-50 p-3"><div className="text-[10px] font-black text-violet-500">هوية/كود</div><div className="mt-1 text-2xl font-black text-violet-800">{filterCount('code')}</div></Card><Card className="border-amber-100 bg-amber-50 p-3"><div className="text-[10px] font-black text-amber-500">فرق كمية</div><div className="mt-1 text-2xl font-black text-amber-800">{filterCount('quantity')}</div></Card><Card className="border-emerald-100 bg-emerald-50 p-3"><div className="text-[10px] font-black text-emerald-500">سليم</div><div className="mt-1 text-2xl font-black text-emerald-800">{summary.matched}</div></Card></div>

    <div className="sticky top-2 z-20 grid grid-cols-3 gap-1 rounded-2xl border border-slate-200 bg-slate-100/95 p-1 shadow-sm backdrop-blur">{[['now', 'القرار'], ['followup', 'المتابعة'], ['intel', 'الذكاء']].map(([key, label]) => <button key={key} onClick={() => setView(key)} className={`rounded-xl px-3 py-2.5 text-sm font-black ${view === key ? 'bg-white text-teal-800 shadow-sm ring-1 ring-slate-200' : 'text-slate-500'}`}>{label}</button>)}</div>

    {view === 'now' && <>
      <Card className="border-slate-200 p-2 shadow-sm"><div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{branchQueues.map(([key, label]) => { const active = branchQueue === key; const count = branchQueueCount(key); return <button key={key} onClick={() => { setBranchQueue(key); setSelectedId(''); }} className={`rounded-xl border px-3 py-3 text-sm font-black transition ${active ? key === 'shamy' ? 'border-sky-300 bg-sky-50 text-sky-900 ring-1 ring-sky-200' : key === 'shokry' ? 'border-emerald-300 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200' : key === 'shared' ? 'border-amber-300 bg-amber-50 text-amber-900 ring-1 ring-amber-200' : 'border-teal-300 bg-teal-50 text-teal-900 ring-1 ring-teal-200' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}><span>{label}</span><span className="mr-1 text-xs opacity-70">({count})</span></button>; })}</div>{branchQueue !== 'all' && <div className="mt-2 px-2 pb-1 text-[11px] font-bold leading-5 text-slate-500">{branchQueue === 'shared' ? 'الحالات المشتركة فيها الطرفان مسجلان، لذلك لا ينسب النظام الخطأ لفرع واحد قبل المراجعة.' : `يعرض هنا فقط القرارات التي تحتاج مراجعة ${branchQueue === 'shamy' ? 'الشامي' : 'شكري'} مباشرة.`}</div>}</Card>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center"><div className="relative flex-1"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(e) => { setQuery(e.target.value); setSelectedId(''); }} placeholder="ابحث باسم الصنف أو الكود أو رقم الفاتورة..." className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-10 pl-3 text-sm font-bold outline-none focus:border-teal-400" /></div><div className="flex gap-2 overflow-x-auto pb-1">{filters.map(([key, label]) => <button key={key} onClick={() => { setFilter(key); setSelectedId(''); }} className={`shrink-0 rounded-full border px-3 py-2 text-xs font-black ${filter === key ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{label} <span className="opacity-70">({filterCount(key)})</span></button>)}</div></div>

      {!sales.length && !purchases.length ? <Card className="flex min-h-56 flex-col items-center justify-center border-dashed border-teal-200 bg-teal-50/30 p-6 text-center"><BrainCircuit className="h-9 w-9 text-teal-700" /><div className="mt-3 text-lg font-black">ارفع الملفات وابدأ من القرار، مش من البيانات</div></Card> : !selectedIncident || !selected || !flow ? <Card className="flex min-h-48 flex-col items-center justify-center border-emerald-200 bg-emerald-50 p-6 text-center"><CheckCircle2 className="h-8 w-8 text-emerald-600" /><div className="mt-2 font-black">لا توجد قرارات في البحث/الفلتر الحالي</div></Card> : <div className="grid gap-3 lg:grid-cols-[330px_minmax(0,1fr)]">
        <Card className="h-fit max-h-[74vh] overflow-y-auto border-slate-200 p-2 shadow-sm"><div className="px-2 py-2"><div className="text-xs font-black text-slate-700">{visibleIncidents.length} قرار</div><div className="text-[10px] font-bold text-slate-400">الأخطر والأوضح أولًا</div></div><div className="space-y-1.5">{visibleIncidents.map((incident) => { const active = incident.id === selectedIncident.id; const accent = incidentAccent(incident.kind); const firstCase = incident.cases?.[0]; const codes = unique([...(firstCase?.sale_codes || []), ...(firstCase?.purchase_codes || [])]); const conflict = firstCase ? detectTransferCodeConflict(firstCase).conflict : false; const queue = branchReviewQueueForIncident(incident); return <button key={incident.id} onClick={() => setSelectedId(incident.cases?.[0]?.id || '')} className={`w-full rounded-xl border p-3 text-right ${active ? 'border-teal-300 bg-teal-50 ring-1 ring-teal-200' : 'border-slate-100 bg-white hover:bg-slate-50'}`}><div className="flex items-center justify-between gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-black ${conflict || accent === 'violet' ? 'bg-violet-50 text-violet-700' : accent === 'amber' ? 'bg-amber-50 text-amber-700' : accent === 'sky' ? 'bg-sky-50 text-sky-700' : 'bg-rose-50 text-rose-700'}`}>{conflict ? '⚠ كود مختلف' : incident.label}</span><span className="text-[10px] font-black text-slate-400">{incident.line_issue_count > 1 ? `${incident.line_issue_count} حالات` : `${incident.issue_confidence || incident.root_cause_confidence}%`}</span></div><div className="mt-2 text-sm font-black text-slate-950">{incident.product_names?.[0] || (incident.invoice ? `فاتورة ${incident.invoice}` : 'حالة')}</div><div className="mt-1 flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-slate-400">{branchName(incident.from)} → {branchName(incident.to)}</span><span className="text-[10px] font-black text-slate-500">{queue === 'shared' ? 'مراجعة مشتركة' : `مراجعة ${branchName(queue)}`}</span></div><div className="mt-1 text-[11px] font-black text-slate-700">{codes[0] ? `كود ${codes[0]}` : incident.invoice ? `فاتورة ${incident.invoice}` : ''}</div></button>; })}</div></Card>

        <Card className="overflow-hidden border-slate-200 shadow-md"><div className="border-b border-slate-100 bg-white p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="text-xs font-black text-slate-400">الصنف والهوية</div><div className="mt-1 flex flex-wrap items-center gap-2"><CopyChip value={selected.product_name} label="اسم الصنف" onCopy={copyValue} strong />{allCodes.map((code) => <CopyChip key={code} value={`كود ${code}`} label={`الكود ${code}`} onCopy={() => copyValue(code, `الكود ${code}`)} strong />)}</div><div className="mt-2 text-xs font-bold text-slate-500">{selected.sale_qty} بيع · {selected.purchase_qty} شراء · {branchName(selected.from)} → {branchName(selected.to)} {selectedIncident.invoice ? `· فاتورة ${selectedIncident.invoice}` : ''}</div></div><div className="rounded-xl bg-slate-100 px-3 py-2 text-center"><div className="text-[9px] font-black text-slate-400">ثقة وجود مشكلة</div><div className="text-xl font-black">{selected.decision_intelligence?.issue_confidence?.score || selectedIncident.issue_confidence || 0}%</div></div></div></div>

          <div className="space-y-4 p-4 sm:p-5">
            {codeConflict?.conflict && <div className="rounded-2xl border-2 border-violet-300 bg-violet-50 p-4"><div className="flex items-center gap-2 text-sm font-black text-violet-950"><AlertOctagon className="h-5 w-5" /> نفس الاسم ظاهر بكود مختلف بين الفرعين — راجع الهوية قبل أي دمج</div><div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-xl bg-white p-3"><div className="text-[10px] font-black text-slate-400">كود البيع</div><div className="mt-2 flex flex-wrap gap-1">{codeConflict.saleCodes.map((code) => <CopyChip key={code} value={code} label={`كود البيع ${code}`} onCopy={copyValue} />)}</div></div><div className="rounded-xl bg-white p-3"><div className="text-[10px] font-black text-slate-400">كود الشراء</div><div className="mt-2 flex flex-wrap gap-1">{codeConflict.purchaseCodes.map((code) => <CopyChip key={code} value={code} label={`كود الشراء ${code}`} onCopy={copyValue} />)}</div></div></div></div>}

            <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center"><FlowNode branch={flow.from} {...flow.left} /><div className="flex shrink-0 flex-col items-center justify-center px-2 text-teal-700"><ArrowLeftRight className="h-6 w-6" /><span className="mt-1 text-[9px] font-black text-slate-400">{flow.gapLabel || 'تحويل'}</span></div><FlowNode branch={flow.to} {...flow.right} /></div>

            <RollingEvidencePanel evidence={rollingEvidence} onCopy={copyValue} />

            <div className="rounded-2xl border-2 border-teal-200 bg-gradient-to-l from-teal-50 to-white p-4"><div className="text-[11px] font-black text-teal-700">الخطوة التالية</div><div className="mt-1 text-xl font-black leading-8 text-slate-950">{flow.step}</div>{flow.detail && <div className="mt-1 text-xs font-bold text-slate-500">{flow.detail}</div>}{selectedIncident.line_issue_count > 1 && <div className="mt-1 text-xs font-bold text-slate-500">قرار واحد بدل مراجعة {selectedIncident.line_issue_count} أصناف منفصلة.</div>}</div>

            <div className="flex flex-wrap gap-2">{unitSuggestion ? <Button onClick={() => approveUnitRule(selected)} className="gap-2 bg-sky-600 font-black hover:bg-sky-700"><WandSparkles className="h-4 w-4" /> اعتماد: {humanUnitRuleLabel(unitSuggestion)}</Button> : <Button onClick={() => recordIncidentDecision(selectedIncident, 'waiting_verification', flow.doneLabel)} className="gap-2 bg-teal-700 font-black hover:bg-teal-800"><ShieldCheck className="h-4 w-4" /> {flow.doneLabel}</Button>}<Button variant="outline" onClick={() => recordIncidentDecision(selectedIncident, 'in_progress', `بدأت المراجعة: ${flow.step}`)} className="font-black">جاري المراجعة</Button><Button variant="outline" onClick={() => recordIncidentDecision(selectedIncident, 'dismissed', 'ليست مشكلة بعد المراجعة')} className="font-black">ليست مشكلة</Button><Button variant="ghost" onClick={() => setShowWhy((v) => !v)} className="gap-2 font-black text-slate-600"><ScanSearch className="h-4 w-4" /> ليه؟ {showWhy ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button></div>
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[10px] font-bold text-slate-500"><Keyboard className="h-3.5 w-3.5" /> <span>1 تم</span><span>2 جاري</span><span>3 ليست مشكلة</span><span>C نسخ الكود</span><span>N التالي</span></div>
            {showWhy && <WhyPanel incident={selectedIncident} item={selected} />}
          </div>
        </Card>
      </div>}
    </>}

    {view === 'followup' && <Card className="border-slate-200 p-4 shadow-sm"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-black"><Clock3 className="h-4 w-4 text-sky-600" /> متابعة القرارات</div><span className="rounded-full bg-sky-50 px-2 py-1 text-[10px] font-black text-sky-700">{followup.length}</span></div>{!followup.length ? <div className="rounded-2xl bg-slate-50 p-6 text-center text-sm font-bold text-slate-500">لا توجد متابعة معلقة.</div> : <div className="divide-y divide-slate-100">{followup.slice(0, 25).map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><div className="font-black">{item.product_name}</div><div className="mt-1 text-xs font-bold text-slate-400">{item.decision?.action}</div></div><Button size="sm" variant="outline" onClick={() => { setView('now'); setBranchQueue('all'); setFilter('all'); setQuery(''); setSelectedId(item.id); }} className="font-black">فتح</Button></div>)}</div>}</Card>}

    {view === 'intel' && <div className="grid gap-3 lg:grid-cols-2"><Card className="border-slate-200 p-4 shadow-sm"><div className="flex items-center gap-2 text-sm font-black"><BrainCircuit className="h-4 w-4 text-teal-600" /> جودة التحليل</div><div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs font-black text-slate-500">شكري</div><div className="mt-1 text-2xl font-black">{branchHealth.shokry}%</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs font-black text-slate-500">الشامي</div><div className="mt-1 text-2xl font-black">{branchHealth.shamy}%</div></div></div><div className="mt-3 text-xs font-bold leading-6 text-slate-500">حالات عبر منتصف الليل: <b>{summary.cross_midnight}</b> · قواعد عبوات متعلمة: <b>{learnedRules.length}</b> · أدلة زمنية محفوظة محليًا: <b>{evidenceArchive.length}</b></div>{learnedRules.length > 0 && <div className="mt-3 space-y-2">{learnedRules.slice(0, 8).map((rule) => <div key={rule.key} className="flex items-center justify-between rounded-xl border border-sky-100 bg-sky-50 px-3 py-2"><div><div className="font-black">{rule.product_name}</div><div className="text-[10px] font-bold text-slate-500">{humanUnitRuleLabel(rule)}</div></div><Button size="sm" variant="ghost" onClick={() => revokeUnitRule(rule)} className="text-rose-600"><XCircle className="h-4 w-4" /></Button></div>)}</div>}</Card><Card className="border-slate-200 p-4 shadow-sm"><div className="flex items-center gap-2 text-sm font-black"><UserRound className="h-4 w-4 text-violet-600" /> إشارات الموظفين</div>{!employees.length ? <div className="mt-4 rounded-xl bg-slate-50 p-6 text-center text-sm font-bold text-slate-500">لا توجد إشارات مؤكدة مرتبطة بموظفين.</div> : <div className="mt-3 space-y-2">{employees.slice(0, 8).map((employee) => <div key={employee.name} className="flex items-center justify-between rounded-xl border border-slate-100 p-3"><div><div className="font-black">{employee.name}</div><div className="text-[10px] font-bold text-slate-400">بيع {employee.sale_cases} · شراء {employee.purchase_cases}</div></div><span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-black text-violet-700">{employee.cases}</span></div>)}</div>}</Card></div>}

    <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-bold leading-5 text-amber-900"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> قرارات المراجعة وقواعد التعلم ونافذة الأدلة الزمنية محفوظة محليًا في هذا المتصفح فقط؛ لا توجد كتابة على بيانات الفواتير أو Supabase.</div>
  </div></div>;
}
