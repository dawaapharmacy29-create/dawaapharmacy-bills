import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeftRight, CheckCircle2, ChevronDown, ChevronUp, Copy, FileSpreadsheet,
  Files, Filter, History, Search, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { inspectTransferFile, buildSourcesFromInspections } from '@/lib/branchTransferAutoImport';
import { reconcileBranchTransfers, explainTransferCase, transferBranchLabel } from '@/lib/branchTransferControl';
import { applyLearnedUnitRules, learnUnitRule, suggestUnitRule, humanUnitRuleLabel } from '@/lib/branchTransferUnitRules';
import { buildTransferIncidents } from '@/lib/branchTransferIncidentIntelligence';
import { completeResidualBalancedJourneys } from '@/lib/branchTransferResidualJourneyCompletion';
import { branchReviewQueueForIncident, incidentMatchesBranchQueue } from '@/lib/branchTransferBranchQueue';
import { compareIncidentsByDay, formatIncidentDayLabel, incidentDayKey, incidentDayOptions, incidentMatchesDay } from '@/lib/branchTransferIncidentDay';
import { summarizeTransferReturnEvidence, formatTransferReturnEvidence } from '@/lib/branchTransferReturnIntelligence';

const STORAGE_KEY = 'dawaa.branch-transfer-control.shadow.v1';

const sourceConfig = {
  shokrySale: { label: 'بيع شكري → الشامي', side: 'sale' },
  shamyPurchase: { label: 'شراء الشامي من شكري', side: 'purchase' },
  shamySale: { label: 'بيع الشامي → شكري', side: 'sale' },
  shokryPurchase: { label: 'شراء شكري من الشامي', side: 'purchase' },
};

const issueFilters = [
  ['all', 'كل الحالات'],
  ['quantity', 'فرق كمية'],
  ['missing', 'طرف ناقص'],
  ['invoice', 'فاتورة كاملة'],
  ['code', 'اختلاف كود'],
  ['unit', 'تحويل عبوة'],
];

const queueFilters = [
  ['all', 'كل الفروع'],
  ['shamy', 'الشامي'],
  ['shokry', 'شكري'],
  ['shared', 'مشترك'],
];

function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function unique(values = []) { return [...new Set(values.map(clean).filter(Boolean))]; }
function nowIso() { return new Date().toISOString(); }

function loadLedger() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { decisions: value.decisions || {}, events: Array.isArray(value.events) ? value.events : [], unitRules: value.unitRules || {} };
  } catch {
    return { decisions: {}, events: [], unitRules: {} };
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

function incidentPriority(incident) {
  if (incident.kind === 'code_mismatch') return 700;
  if (incident.kind === 'quantity_mismatch') return 600;
  if (['whole_sale_invoice_missing', 'whole_purchase_invoice_missing'].includes(incident.kind)) return 520;
  if (['partial_sale_invoice_missing', 'partial_purchase_invoice_missing', 'single_missing'].includes(incident.kind)) return 440;
  if (incident.kind === 'unit_conversion') return 300;
  return 100;
}

function searchText(incident) {
  return [incident.invoice, ...(incident.product_names || []), ...(incident.product_codes || []), ...(incident.cases || []).flatMap((item) => [item.product_name, ...(item.sale_codes || []), ...(item.purchase_codes || []), ...(item.sale_invoices || []), ...(item.purchase_invoices || [])])].join(' ').toLowerCase();
}

function queueLabel(incident) {
  const queue = branchReviewQueueForIncident(incident);
  if (queue === 'shamy') return 'الشامي';
  if (queue === 'shokry') return 'شكري';
  return 'مشترك';
}

function incidentTitle(incident) {
  if (incident.kind === 'quantity_mismatch') return 'فرق كمية';
  if (incident.kind === 'code_mismatch') return 'اختلاف كود';
  if (incident.kind === 'unit_conversion') return 'تحويل عبوة';
  if (['whole_sale_invoice_missing', 'whole_purchase_invoice_missing'].includes(incident.kind)) return 'فاتورة كاملة ناقصة';
  return 'طرف ناقص';
}

function decisionFor(incident, item) {
  const from = branchName(incident.from);
  const to = branchName(incident.to);
  const sale = Number(item?.sale_qty || 0);
  const purchase = Number(item?.purchase_qty || 0);
  const rawDiff = Math.abs(sale - purchase);

  if (item?.residual_progress_status === 'partial') {
    return {
      headline: `راجع فقط المتبقي ${item.residual_remaining_qty}`,
      reason: `الفرق الأصلي ${item.residual_needed_qty}، وظهر لاحقًا ${item.residual_progress_qty} لنفس الكود.`,
      tone: 'amber',
    };
  }
  if (incident.side === 'sale') return { headline: `راجع شراء ${to}`, reason: `البيع موجود في ${from} ولم نجد الشراء المقابل.`, tone: 'rose' };
  if (incident.side === 'purchase') return { headline: `راجع بيع ${from}`, reason: `الشراء موجود في ${to} ولم نجد البيع المقابل.`, tone: 'rose' };
  if (incident.kind === 'quantity_mismatch') return { headline: `راجع فرق ${Number(rawDiff.toFixed(3))}`, reason: 'راجع رحلة الصنف كاملة والحركات اللاحقة قبل اعتبار الفرق عجزًا.', tone: 'amber' };
  if (incident.kind === 'code_mismatch') return { headline: 'راجع هوية الصنف', reason: 'نفس الاسم لا يكفي لو الكود مختلف.', tone: 'violet' };
  if (incident.kind === 'unit_conversion') {
    const rule = suggestUnitRule(item);
    return { headline: rule ? `أكد ${humanUnitRuleLabel(rule)}` : 'أكد علاقة العبوة', reason: 'اعتماد العلاقة مرة واحدة يمنع تكرار نفس المراجعة.', tone: 'sky' };
  }
  return { headline: 'راجع الحركة', reason: incident.summary || '', tone: 'slate' };
}

function toneClasses(tone) {
  if (tone === 'rose') return 'border-rose-200 bg-rose-50 text-rose-950';
  if (tone === 'violet') return 'border-violet-200 bg-violet-50 text-violet-950';
  if (tone === 'sky') return 'border-sky-200 bg-sky-50 text-sky-950';
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-950';
  return 'border-slate-200 bg-slate-50 text-slate-950';
}

function QtyBox({ label, value, hint }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center shadow-sm">
    <div className="text-[10px] font-black text-slate-400">{label}</div>
    <div className="mt-1 text-2xl font-black text-slate-950">{value}</div>
    {hint && <div className="mt-1 text-[10px] font-bold text-slate-400">{hint}</div>}
  </div>;
}

export default function BranchTransferDecisionRoom() {
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
  const rawCases = useMemo(() => reconcileBranchTransfers(sales, purchases), [sales, purchases]);
  const journeyCases = useMemo(() => completeResidualBalancedJourneys(rawCases), [rawCases]);
  const cases = useMemo(() => applyLearnedUnitRules(journeyCases, ledger.unitRules).map((item) => ({ ...item, decision_intelligence: explainTransferCase(item), decision: ledger.decisions[item.id] })), [journeyCases, ledger]);
  const reviewCases = useMemo(() => cases.filter((item) => item.type !== 'matched' && !['dismissed', 'verified'].includes(item.decision?.status)), [cases]);
  const incidents = useMemo(() => buildTransferIncidents(reviewCases), [reviewCases]);
  const dayOptions = useMemo(() => incidentDayOptions(incidents.filter((entry) => incidentMatchesBranchQueue(entry, queue) && issueMatches(entry, issue))), [incidents, queue, issue]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return incidents
      .filter((entry) => incidentMatchesBranchQueue(entry, queue))
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
  const remaining = selected?.residual_progress_status === 'partial' ? selected.residual_remaining_qty : Number(Math.abs(saleQty - purchaseQty).toFixed(3));
  const unitSuggestion = selected?.type === 'unit_conversion_review' ? suggestUnitRule(selected) : null;

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
    const items = entry.parsed?.items || [];
    setSources((old) => {
      const bucket = old[sourceKey] || { valid: true, items: [], fileNames: [] };
      return { ...old, [sourceKey]: { ...bucket, valid: true, items: [...bucket.items, ...items], fileNames: [...(bucket.fileNames || []), entry.fileName] } };
    });
    setAutoReport((old) => ({ ...old, ambiguous: old.ambiguous.filter((item) => item !== entry) }));
  };

  const copyCode = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(code);
    window.setTimeout(() => setCopied(''), 1200);
  };

  const decide = (status, action) => {
    if (!selectedIncident) return;
    const at = nowIso();
    setLedger((old) => {
      const decisions = { ...old.decisions };
      const events = [];
      selectedIncident.cases.forEach((item) => {
        decisions[item.id] = { status, action, updated_at: at, incident_id: selectedIncident.id };
        events.push({ case_id: item.id, incident_id: selectedIncident.id, action, status, at, product_name: item.product_name });
      });
      return { ...old, decisions, events: [...events, ...old.events].slice(0, 1000) };
    });
    const index = visible.findIndex((entry) => entry.id === selectedIncident.id);
    const next = visible[index + 1] || visible[index - 1];
    setSelectedId(next?.cases?.[0]?.id || '');
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
  };

  const stats = {
    total: incidents.length,
    quantity: incidents.filter((entry) => entry.kind === 'quantity_mismatch').length,
    missing: incidents.filter((entry) => ['whole_sale_invoice_missing', 'partial_sale_invoice_missing', 'whole_purchase_invoice_missing', 'partial_purchase_invoice_missing', 'single_missing'].includes(entry.kind)).length,
  };

  return <div dir="rtl" className="min-h-full bg-slate-50"><div className="mx-auto max-w-[1500px] space-y-3 px-3 py-3 sm:px-5">
    {copied && <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-white">تم نسخ {copied}</div>}

    <Card className="border-0 bg-slate-950 p-4 text-white shadow-lg sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><div className="flex items-center gap-2 text-[11px] font-black text-teal-300"><Sparkles className="h-4 w-4" /> غرفة القرار</div><h1 className="mt-1 text-xl font-black sm:text-2xl">تحويلات الفروع</h1><div className="mt-1 text-xs font-bold text-slate-400">شوف المشكلة، افهم المتبقي الحقيقي، وخد القرار. التفاصيل الإضافية تظهر فقط لما تحتاجها.</div></div>
        <Button size="sm" variant="secondary" onClick={() => setUploadOpen((v) => !v)} className="font-black"><Files className="ml-1 h-4 w-4" /> الملفات {uploadOpen ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}</Button>
      </div>
    </Card>

    {uploadOpen && <Card className="border-slate-200 p-3 shadow-sm">
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-teal-300 bg-teal-50/60 p-4">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-white p-2 shadow-sm"><FileSpreadsheet className="h-5 w-5 text-teal-700" /></div><div><div className="font-black text-slate-950">ارفع ملفات البيع والشراء</div><div className="text-[11px] font-bold text-slate-500">النظام يصنفها ويحلل رحلة الصنف تلقائيًا.</div></div></div>
        <span className="rounded-full bg-teal-700 px-3 py-1.5 text-xs font-black text-white">{isInspecting ? 'جاري التحليل...' : 'اختيار'}</span>
        <input className="hidden" type="file" multiple accept=".xlsx,.xls,.csv" disabled={isInspecting} onChange={(e) => handleFiles(Array.from(e.target.files || []))} />
      </label>
      {message && <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">{message}</div>}
      {autoReport.ambiguous.length > 0 && <div className="mt-2 space-y-2">{autoReport.ambiguous.map((entry) => <div key={entry.fileName} className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-xs font-black">{entry.fileName}</div><div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(sourceConfig).map(([key, config]) => <Button key={key} size="sm" variant="outline" onClick={() => assignAmbiguous(entry, key)} className="text-[10px] font-black">{config.label}</Button>)}</div></div>)}</div>}
    </Card>}

    <div className="grid grid-cols-3 gap-2">
      <Card className="p-3"><div className="text-[10px] font-black text-slate-400">تحتاج قرار</div><div className="mt-1 text-2xl font-black">{stats.total}</div></Card>
      <Card className="p-3"><div className="text-[10px] font-black text-slate-400">فرق كمية</div><div className="mt-1 text-2xl font-black">{stats.quantity}</div></Card>
      <Card className="p-3"><div className="text-[10px] font-black text-slate-400">طرف ناقص</div><div className="mt-1 text-2xl font-black">{stats.missing}</div></Card>
    </div>

    <Card className="border-slate-200 p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-slate-400" />
        {queueFilters.map(([key, label]) => <button key={key} onClick={() => { setQueue(key); setDay('all'); }} className={`rounded-full px-3 py-1.5 text-xs font-black ${queue === key ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600'}`}>{label}</button>)}
        <select value={issue} onChange={(e) => { setIssue(e.target.value); setDay('all'); }} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700">{issueFilters.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <select value={day} onChange={(e) => setDay(e.target.value)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700"><option value="all">كل الأيام</option>{dayOptions.map((entry) => <option key={entry.key} value={entry.key}>{entry.label} ({entry.count})</option>)}</select>
        <div className="relative min-w-[220px] flex-1"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="اسم الصنف أو الكود أو الفاتورة" className="w-full rounded-full border border-slate-200 bg-white py-2 pr-9 pl-3 text-xs font-bold outline-none focus:border-teal-400" /></div>
      </div>
    </Card>

    <div className="grid gap-3 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="max-h-[72vh] overflow-y-auto border-slate-200 p-2 shadow-sm">
        <div className="px-2 py-2 text-xs font-black text-slate-500">{visible.length} حالة</div>
        <div className="space-y-1.5">{visible.map((incident) => {
          const item = incident.cases?.[0];
          const itemCode = unique([...(item?.sale_codes || []), ...(item?.purchase_codes || [])])[0] || '—';
          const selectedRow = selectedIncident?.id === incident.id;
          const shortDecision = decisionFor(incident, item);
          return <button key={incident.id} onClick={() => setSelectedId(item?.id || '')} className={`w-full rounded-2xl border p-3 text-right transition ${selectedRow ? 'border-teal-400 bg-teal-50 ring-1 ring-teal-200' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
            <div className="flex items-start justify-between gap-2"><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black text-slate-500">{incidentTitle(incident)}</span><span className="text-[9px] font-black text-slate-400">{formatIncidentDayLabel(incidentDayKey(incident))}</span></div>
            <div className="mt-2 truncate text-sm font-black text-slate-950">{item?.product_name || incident.product_names?.[0] || 'صنف'}</div>
            <div className="mt-1 text-[11px] font-black text-slate-500">كود {itemCode} · {queueLabel(incident)}</div>
            <div className="mt-2 text-xs font-black text-teal-800">{shortDecision.headline}</div>
          </button>;
        })}{!visible.length && <div className="rounded-2xl bg-slate-50 p-6 text-center text-xs font-bold text-slate-400">لا توجد حالات في الفلتر الحالي.</div>}</div>
      </Card>

      <Card className="border-slate-200 p-4 shadow-sm sm:p-5">
        {!selectedIncident || !selected ? <div className="flex min-h-[420px] items-center justify-center text-sm font-bold text-slate-400">ارفع الملفات أو اختر حالة للمراجعة.</div> : <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div><div className="text-[10px] font-black text-slate-400">{incidentTitle(selectedIncident)} · مراجعة {queueLabel(selectedIncident)}</div><h2 className="mt-1 text-xl font-black text-slate-950">{selected.product_name || selectedIncident.product_names?.[0]}</h2><div className="mt-2 flex items-center gap-2"><button onClick={copyCode} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-black text-slate-700"><Copy className="h-3.5 w-3.5 text-teal-600" /> كود {code || 'غير متاح'}</button>{selectedIncident.invoice && <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-black text-slate-600">فاتورة {selectedIncident.invoice}</span>}</div></div>
            <div className="text-left text-[10px] font-black text-slate-400">{formatIncidentDayLabel(incidentDayKey(selectedIncident))}</div>
          </div>

          <div className={`rounded-2xl border p-4 ${toneClasses(decision.tone)}`}><div className="text-[10px] font-black opacity-60">القرار المطلوب الآن</div><div className="mt-1 text-2xl font-black">{decision.headline}</div><div className="mt-2 text-xs font-bold leading-5 opacity-75">{decision.reason}</div></div>

          <div className="grid grid-cols-3 gap-2"><QtyBox label="بيع" value={saleQty} hint={branchName(selectedIncident.from)} /><QtyBox label="شراء" value={purchaseQty} hint={branchName(selectedIncident.to)} /><QtyBox label="المتبقي الحقيقي" value={remaining} hint={selected?.residual_progress_status === 'partial' ? 'بعد الحركات اللاحقة' : 'الحالي'} /></div>

          {selected?.residual_progress_status === 'partial' && <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4"><div className="flex items-center gap-2 text-sm font-black text-sky-950"><History className="h-4 w-4" /> النظام فهم جزءًا من الرحلة لاحقًا</div><div className="mt-2 text-xs font-bold leading-6 text-sky-900">{selected.residual_review_reason}</div></div>}

          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            {unitSuggestion ? <Button onClick={approveUnit} className="bg-teal-700 font-black hover:bg-teal-800"><CheckCircle2 className="ml-1 h-4 w-4" /> اعتماد تحويل العبوة</Button> : <Button onClick={() => decide('waiting_verification', `تمت مراجعة: ${decision.headline}`)} className="bg-teal-700 font-black hover:bg-teal-800"><CheckCircle2 className="ml-1 h-4 w-4" /> تم التأكد</Button>}
            <Button variant="outline" onClick={() => decide('in_progress', decision.headline)} className="font-black">جاري المراجعة</Button>
            <Button variant="ghost" onClick={() => decide('dismissed', 'ليست مشكلة بعد المراجعة')} className="font-black text-slate-500">ليست مشكلة</Button>
          </div>

          <button onClick={() => setDetailsOpen((v) => !v)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-600"><span>تفاصيل الدليل</span>{detailsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
          {detailsOpen && <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="grid gap-2 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-3"><div className="text-[9px] font-black text-slate-400">ثقة الرحلة</div><div className="mt-1 text-xl font-black">{selected.decision_intelligence?.journey_confidence?.score || 0}%</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-[9px] font-black text-slate-400">ثقة وجود مشكلة</div><div className="mt-1 text-xl font-black">{selected.decision_intelligence?.issue_confidence?.score || 0}%</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-[9px] font-black text-slate-400">الحركات اللاحقة</div><div className="mt-1 text-xl font-black">{selected.residual_progress_candidate_count || selected.residual_candidate_count || 0}</div></div></div>
            {selected.residual_review_reason && <div className="text-xs font-bold leading-6 text-slate-600">{selected.residual_review_reason}</div>}
            {selected.match_reason && <div className="text-xs font-bold leading-6 text-slate-600">{selected.match_reason}</div>}
            {selected.decision_intelligence?.uncertainties?.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="flex items-center gap-2 text-xs font-black text-amber-900"><AlertTriangle className="h-4 w-4" /> قبل اعتبارها خطأ موظف</div>{selected.decision_intelligence.uncertainties.slice(0, 3).map((value, index) => <div key={index} className="mt-1 text-[11px] font-bold text-amber-900">• {value}</div>)}</div>}
            {(() => { const saleReturn = summarizeTransferReturnEvidence(selected.sale_lines || [], saleQty); const purchaseReturn = summarizeTransferReturnEvidence(selected.purchase_lines || [], purchaseQty); const texts = [saleReturn.has_return ? formatTransferReturnEvidence(saleReturn, { movement: 'البيع' }) : '', purchaseReturn.has_return ? formatTransferReturnEvidence(purchaseReturn, { movement: 'الشراء' }) : ''].filter(Boolean); return texts.length ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold leading-6 text-emerald-900">{texts.join(' · ')}</div> : null; })()}
          </div>}
        </div>}
      </Card>
    </div>
  </div></div>;
}
