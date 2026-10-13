import { diagnoseTransferProductIdentity, extractTransferProductSignature } from './branchTransferProductIdentity.js';

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670]/g;
const PRIMARY_WINDOW_MINUTES = 8 * 60;
const EXTENDED_WINDOW_MINUTES = 18 * 60;
const EPISODE_BALANCE_WINDOW_MINUTES = 90;
const EPSILON = 0.0001;

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeTransferText(value) {
  return text(value)
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ـ/g, '')
    .replace(/[()\[\]{}.,،:;\/\\_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BRANCHES = {
  shokry: { key: 'shokry', label: 'شكري', aliases: ['شكري', 'دواء شكري', 'دواء فرع ابو العزم', 'دواء ابو العزم', 'فرع ابو العزم', 'ابو العزم'] },
  shamy: { key: 'shamy', label: 'الشامي', aliases: ['الشامي', 'دواء الشامي', 'دواء فرع الشامي', 'فرع الشامي'] },
};

const BRANCH_ALIAS_MAP = Object.values(BRANCHES).flatMap((branch) =>
  branch.aliases.map((alias) => [normalizeTransferText(alias), branch.key]),
);

export function resolveTransferBranch(value) {
  const normalized = normalizeTransferText(value).replace(/ا{3,}/g, 'ا');
  if (!normalized) return null;
  const exact = BRANCH_ALIAS_MAP.find(([alias]) => normalized === alias);
  if (exact) return exact[1];
  const contained = BRANCH_ALIAS_MAP.find(([alias]) => normalized.includes(alias));
  return contained?.[1] || null;
}

export function transferBranchLabel(key) {
  return BRANCHES[key]?.label || key || 'غير معروف';
}

function normalizeCode(value) {
  return text(value).replace(/\.0$/, '').replace(/\s+/g, '').toUpperCase();
}

function quantity(value) {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const parsed = new Date(excelEpoch + value * 86400000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const raw = text(value);
  if (!raw) return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;
  const match = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  const parsed = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dayKey(date) {
  if (!date) return 'unknown-day';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function productNameKey(value) {
  return normalizeTransferText(value)
    .replace(/\b(?:tab|tabs|tablet|tablets|cap|caps|capsule|capsules|amp|amps|ampoule|ampoules|ml|gm|g|mg)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nearlyEqual(a, b, tolerance = EPSILON) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= tolerance;
}

function minuteGap(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(a - b) / 60000;
}

function signedMinuteGap(saleMs, purchaseMs) {
  if (!Number.isFinite(saleMs) || !Number.isFinite(purchaseMs)) return null;
  return (purchaseMs - saleMs) / 60000;
}

export function normalizeTransferLine(raw, side) {
  const branch = resolveTransferBranch(raw.branch || raw.location || raw.warehouse);
  const counterparty = resolveTransferBranch(raw.counterparty || raw.supplier || raw.customer || raw.other_branch);
  const from = side === 'sale' ? branch : counterparty;
  const to = side === 'sale' ? counterparty : branch;
  const productName = text(raw.product_name || raw.item_name || raw.product || raw.item);
  const parsedDate = parseDate(raw.date || raw.datetime || raw.created_at || '');
  return {
    id: text(raw.id || `${side}-${raw.invoice || raw.serial || ''}-${raw.row_number || raw.row || ''}`),
    side,
    branch,
    counterparty,
    from,
    to,
    product_name: productName,
    product_name_key: productNameKey(productName),
    product_core_key: extractTransferProductSignature(productName).core_name,
    code: normalizeCode(raw.code || raw.product_code || raw.item_code || raw.barcode),
    qty: Math.abs(quantity(raw.qty ?? raw.quantity ?? raw.count)),
    unit: normalizeTransferText(raw.unit || raw.sale_unit || raw.purchase_unit),
    invoice: text(raw.invoice || raw.invoice_number || raw.serial),
    user: text(raw.user || raw.doctor || raw.employee || raw.entered_by),
    date: raw.date || raw.datetime || raw.created_at || '',
    timestamp_ms: parsedDate?.getTime() ?? null,
    day_key: dayKey(parsedDate),
    raw,
  };
}

function lineFingerprint(line) {
  return [line.side, line.from, line.to, line.invoice, line.code, line.product_name_key, line.qty, line.unit,
    Number.isFinite(line.timestamp_ms) ? Math.round(line.timestamp_ms / 1000) : line.day_key,
    text(line.raw?.expiration_raw || line.raw?.expiration || line.raw?.expiry || ''), line.user].join('::');
}

function dedupeLines(lines) {
  const seen = new Set();
  return lines.filter((line) => {
    const key = lineFingerprint(line);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function aggregate(lines, side) {
  const first = lines[0];
  const timestamps = lines.map((line) => line.timestamp_ms).filter(Number.isFinite);
  return {
    side,
    qty: lines.reduce((sum, line) => sum + line.qty, 0),
    codes: [...new Set(lines.map((line) => line.code).filter(Boolean))],
    users: [...new Set(lines.map((line) => line.user).filter(Boolean))],
    units: [...new Set(lines.map((line) => line.unit).filter(Boolean))],
    invoices: [...new Set(lines.map((line) => line.invoice).filter(Boolean))],
    product_name: first?.product_name || '',
    product_name_key: first?.product_name_key || '',
    product_core_key: first?.product_core_key || '',
    day_key: first?.day_key || 'unknown-day',
    from: first?.from || null,
    to: first?.to || null,
    timestamp_ms: timestamps.length ? Math.min(...timestamps) : null,
    lines,
  };
}

function invoiceGroupKey(line) {
  const identity = line.code || line.product_name_key || line.product_core_key || line.product_name;
  if (line.invoice) return `${line.from}::${line.to}::${line.invoice}::${identity}`;
  const timeBucket = Number.isFinite(line.timestamp_ms) ? Math.floor(line.timestamp_ms / 60000) : line.day_key;
  return `${line.from}::${line.to}::no-invoice::${identity}::${timeBucket}`;
}

function groupByInvoice(lines, side) {
  const groups = new Map();
  lines.forEach((line) => {
    const key = invoiceGroupKey(line);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  });
  return [...groups.entries()].map(([key, grouped]) => ({ key, ...aggregate(grouped, side) }));
}

function groupsShareExactCode(a, b) {
  return a.codes.some((code) => b.codes.includes(code));
}

function identityEvidence(sale, purchase) {
  if (groupsShareExactCode(sale, purchase)) return { kind: 'exact_code', score: 120, reason: 'نفس كود الصنف' };
  if (sale.product_name_key && sale.product_name_key === purchase.product_name_key) return { kind: 'same_name', score: 82, reason: 'نفس اسم الصنف بعد التنظيف' };
  if (sale.product_core_key && sale.product_core_key === purchase.product_core_key) return { kind: 'same_core', score: 52, reason: 'نفس الاسم الأساسي للصنف' };
  return null;
}

function genericPackCount(name) {
  const value = normalizeTransferText(name);
  const patterns = [
    /(\d{1,4})\s*(?:syringes?|syringe|amps?|ampoules?|vials?|pcs?|pieces?|pads?|sachets?|strips?)/i,
    /(\d{1,4})\s*(?:سرنجات?|امبولات?|فيالات?|قطع|قطعه|فوط|اكياس|شرائط)/i,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function unitConversionEvidence(sale, purchase) {
  if (nearlyEqual(sale.qty, purchase.qty) || sale.qty <= 0 || purchase.qty <= 0) return null;
  const ratio = Math.max(sale.qty, purchase.qty) / Math.min(sale.qty, purchase.qty);
  const signatures = [extractTransferProductSignature(sale.product_name), extractTransferProductSignature(purchase.product_name)];
  const packCounts = [...new Set([
    ...signatures.map((signature) => signature.pack_count), genericPackCount(sale.product_name), genericPackCount(purchase.product_name),
  ].filter((value) => Number.isFinite(value) && value >= 2))];
  const packHit = packCounts.find((pack) => Math.abs(ratio - pack) <= Math.max(0.08, pack * 0.04));
  if (packHit) return { kind: 'pack_count', ratio, pack_count: packHit, confidence: 'high', reason: `نسبة الكمية ${Number(ratio.toFixed(3))} تطابق عبوة ${packHit} المذكورة في اسم الصنف` };

  const saleFractional = Math.abs(sale.qty - Math.round(sale.qty)) > EPSILON;
  const purchaseFractional = Math.abs(purchase.qty - Math.round(purchase.qty)) > EPSILON;
  const nonBoxSaleUnit = sale.units.some((unit) => unit && !['علبه', 'علبة', 'box', 'one unit'].includes(unit));
  if (saleFractional !== purchaseFractional && ratio >= 1.45 && ratio <= 30 && (nonBoxSaleUnit || saleFractional || purchaseFractional)) {
    return { kind: 'fractional_unit', ratio, confidence: 'medium', reason: `النمط يشبه تحويل وحدة بنسبة ${Number(ratio.toFixed(3))}` };
  }
  return null;
}

function candidateScore(sale, purchase) {
  if (!sale.from || !sale.to || sale.from !== purchase.from || sale.to !== purchase.to) return null;
  const identity = identityEvidence(sale, purchase);
  if (!identity) return null;
  const gap = minuteGap(sale.timestamp_ms, purchase.timestamp_ms);
  const signedGap = signedMinuteGap(sale.timestamp_ms, purchase.timestamp_ms);
  const qtyExact = nearlyEqual(sale.qty, purchase.qty);
  const conversion = groupsShareExactCode(sale, purchase) ? unitConversionEvidence(sale, purchase) : null;

  if (gap != null) {
    const window = identity.kind === 'exact_code' && qtyExact ? EXTENDED_WINDOW_MINUTES : PRIMARY_WINDOW_MINUTES;
    if (gap > window) return null;
  } else if (sale.day_key !== 'unknown-day' && purchase.day_key !== 'unknown-day' && sale.day_key !== purchase.day_key) return null;

  let score = identity.score;
  const reasons = [identity.reason];
  if (qtyExact) { score += 36; reasons.push('نفس الكمية'); }
  else if (conversion) { score += 28; reasons.push(conversion.reason); }
  else {
    const relativeDiff = Math.abs(sale.qty - purchase.qty) / Math.max(sale.qty, purchase.qty, 1);
    score += Math.max(0, 14 - relativeDiff * 18);
    reasons.push(`الكمية ${sale.qty} مقابل ${purchase.qty}`);
  }

  if (gap != null) {
    if (gap <= 15) score += 34;
    else if (gap <= 60) score += 27;
    else if (gap <= 240) score += 18;
    else if (gap <= PRIMARY_WINDOW_MINUTES) score += 10;
    else score += 3;
    if (signedGap != null && signedGap >= -20) score += 3;
    reasons.push(`الفارق الزمني ${Math.round(gap)} دقيقة`);
  } else { score += 4; reasons.push('الوقت غير مكتمل'); }
  return { score, identity, gap, signedGap, qtyExact, conversion, reasons };
}

function confidence(candidate) {
  if (!candidate) return { level: 'none', score: 0 };
  let score = Math.round(Math.min(99, Math.max(1, candidate.score / 2.05)));
  if (candidate.identity.kind === 'exact_code' && candidate.qtyExact && candidate.gap != null && candidate.gap <= 120) score = Math.max(score, 96);
  else if (candidate.identity.kind === 'exact_code' && candidate.qtyExact && candidate.gap != null && candidate.gap <= PRIMARY_WINDOW_MINUTES) score = Math.max(score, 90);
  else if (candidate.identity.kind === 'exact_code' && candidate.conversion && candidate.gap != null && candidate.gap <= 120) score = Math.max(score, 88);
  return { level: score >= 90 ? 'high' : score >= 72 ? 'medium' : 'low', score };
}

function identityDiagnosis(sale, purchase) {
  if (!sale?.lines?.length || !purchase?.lines?.length || groupsShareExactCode(sale, purchase)) return null;
  if (!sale.codes.length || !purchase.codes.length) return null;
  return diagnoseTransferProductIdentity({ saleName: sale.product_name, purchaseName: purchase.product_name, saleCodes: sale.codes, purchaseCodes: purchase.codes });
}

function caseType(sale, purchase) {
  if (!sale?.lines?.length) return { type: 'purchase_without_sale', conversion: null, diagnosis: null };
  if (!purchase?.lines?.length) return { type: 'sale_without_purchase', conversion: null, diagnosis: null };
  const diagnosis = identityDiagnosis(sale, purchase);
  if (diagnosis) return { type: 'code_mismatch', conversion: null, diagnosis };
  if (!nearlyEqual(sale.qty, purchase.qty)) {
    const conversion = groupsShareExactCode(sale, purchase) ? unitConversionEvidence(sale, purchase) : null;
    if (conversion) return { type: 'unit_conversion_review', conversion, diagnosis: null };
    return { type: 'quantity_mismatch', conversion: null, diagnosis: null };
  }
  return { type: 'matched', conversion: null, diagnosis: null };
}

function severity(type, diagnosis) {
  if (type === 'code_mismatch' && diagnosis?.risk === 'high') return 92;
  return { purchase_without_sale: 100, sale_without_purchase: 95, quantity_mismatch: 85, code_mismatch: 65, unit_conversion_review: 45, matched: 0 }[type] ?? 40;
}

function nextAction(type, result) {
  const target = transferBranchLabel(result.to);
  const source = transferBranchLabel(result.from);
  if (type === 'purchase_without_sale') return `راجع بيع ${source} أولًا؛ يوجد شراء في ${target} بدون بيع مقابل داخل نافذة المطابقة الذكية.`;
  if (type === 'sale_without_purchase') return `تأكد هل الصنف وصل ${target}. إن وصل، راجع تسجيل الشراء؛ وإن لم يصل افتح متابعة نقل.`;
  if (type === 'quantity_mismatch') {
    const diff = Math.abs(result.sale_qty - result.purchase_qty);
    return result.sale_qty > result.purchase_qty ? `راجع شراء ${target}: الكمية أقل من البيع بـ ${Number(diff.toFixed(3))}.` : `راجع شراء ${target}: الكمية أعلى من البيع بـ ${Number(diff.toFixed(3))}، أو راجع بيع ${source}.`;
  }
  if (type === 'unit_conversion_review') return `${result.unit_conversion_evidence?.reason || 'النمط يشبه تحويل وحدة'}. أكّد معامل التحويل مرة واحدة قبل احتسابها كخطأ.`;
  if (type === 'code_mismatch') {
    const diagnosis = result.identity_diagnosis;
    const quantityNote = result.sale_qty !== result.purchase_qty ? ` ويوجد أيضًا فرق كمية: بيع ${result.sale_qty} مقابل شراء ${result.purchase_qty}.` : '';
    return diagnosis ? `${diagnosis.diagnosis} ${diagnosis.action}${quantityNote}` : `راجع الكودين وهوية الصنف يدويًا.${quantityNote}`;
  }
  return 'لا يوجد إجراء مطلوب.';
}

function buildCase(saleGroups = [], purchaseGroups = [], candidate = null, extra = {}) {
  const saleLines = saleGroups.flatMap((group) => group.lines || []);
  const purchaseLines = purchaseGroups.flatMap((group) => group.lines || []);
  const sale = aggregate(saleLines, 'sale');
  const purchase = aggregate(purchaseLines, 'purchase');
  const first = saleLines[0] || purchaseLines[0];
  const classification = caseType(sale, purchase);
  const conf = confidence(candidate);
  const gap = candidate?.gap ?? minuteGap(sale.timestamp_ms, purchase.timestamp_ms);
  const crossMidnight = Boolean(saleLines.length && purchaseLines.length && sale.day_key !== purchase.day_key && sale.day_key !== 'unknown-day' && purchase.day_key !== 'unknown-day');
  const reasons = [...(candidate?.reasons || [])];
  if (crossMidnight) reasons.push('الحركة عبرت منتصف الليل');
  if (extra.matchReason) reasons.push(extra.matchReason);
  const result = {
    id: [first?.from || 'unknown', first?.to || 'unknown', first?.code || first?.product_name_key || 'unknown', sale.invoices.join('+') || 'no-sale', purchase.invoices.join('+') || 'no-purchase'].join('::'),
    type: classification.type,
    severity: severity(classification.type, classification.diagnosis),
    from: first?.from,
    to: first?.to,
    day_key: sale.day_key !== 'unknown-day' ? sale.day_key : purchase.day_key,
    product_name: sale.product_name || purchase.product_name,
    sale_product_name: sale.product_name,
    purchase_product_name: purchase.product_name,
    sale_qty: sale.qty || 0,
    purchase_qty: purchase.qty || 0,
    sale_units: sale.units,
    purchase_units: purchase.units,
    sale_codes: sale.codes,
    purchase_codes: purchase.codes,
    sale_users: sale.users,
    purchase_users: purchase.users,
    sale_invoices: sale.invoices,
    purchase_invoices: purchase.invoices,
    sale_lines: saleLines,
    purchase_lines: purchaseLines,
    identity_diagnosis: classification.diagnosis,
    unit_conversion_evidence: classification.conversion,
    match_confidence: saleLines.length && purchaseLines.length ? conf.level : 'none',
    confidence_score: saleLines.length && purchaseLines.length ? conf.score : 0,
    match_reason: reasons.join(' · '),
    time_gap_minutes: gap == null ? null : Number(gap.toFixed(1)),
    cross_midnight: crossMidnight,
    episode_balanced: Boolean(extra.episodeBalanced),
  };
  return { ...result, next_action: nextAction(classification.type, result) };
}

function exactCodeKey(group) {
  return group.codes.length === 1 ? `${group.from}::${group.to}::${group.codes[0]}` : null;
}

function balancedEpisodes(saleGroups, purchaseGroups) {
  const usedSales = new Set();
  const usedPurchases = new Set();
  const cases = [];
  const keys = new Set([...saleGroups.map(exactCodeKey), ...purchaseGroups.map(exactCodeKey)].filter(Boolean));
  for (const key of keys) {
    const all = [
      ...saleGroups.filter((group) => exactCodeKey(group) === key).map((group) => ({ side: 'sale', group })),
      ...purchaseGroups.filter((group) => exactCodeKey(group) === key).map((group) => ({ side: 'purchase', group })),
    ].filter((entry) => Number.isFinite(entry.group.timestamp_ms)).sort((a, b) => a.group.timestamp_ms - b.group.timestamp_ms);
    if (all.length < 3) continue;
    let cluster = [all[0]];
    const flush = () => {
      const sales = cluster.filter((entry) => entry.side === 'sale').map((entry) => entry.group).filter((group) => !usedSales.has(group.key));
      const purchases = cluster.filter((entry) => entry.side === 'purchase').map((entry) => entry.group).filter((group) => !usedPurchases.has(group.key));
      const saleQty = sales.reduce((sum, group) => sum + group.qty, 0);
      const purchaseQty = purchases.reduce((sum, group) => sum + group.qty, 0);
      if (sales.length && purchases.length && (sales.length > 1 || purchases.length > 1) && nearlyEqual(saleQty, purchaseQty)) {
        const gap = minuteGap(sales[0].timestamp_ms, purchases[0].timestamp_ms);
        const candidate = { score: 190, identity: { kind: 'exact_code' }, qtyExact: true, gap, reasons: ['نفس كود الصنف', 'إجمالي الدفعة متوازن'] };
        cases.push(buildCase(sales, purchases, candidate, { episodeBalanced: true, matchReason: 'عدة فواتير قريبة زمنيًا ومتوازنة كرحلة واحدة' }));
        sales.forEach((group) => usedSales.add(group.key));
        purchases.forEach((group) => usedPurchases.add(group.key));
      }
    };
    for (let i = 1; i < all.length; i += 1) {
      if ((all[i].group.timestamp_ms - all[i - 1].group.timestamp_ms) / 60000 <= EPISODE_BALANCE_WINDOW_MINUTES) cluster.push(all[i]);
      else { flush(); cluster = [all[i]]; }
    }
    flush();
  }
  return { cases, usedSales, usedPurchases };
}

function matchRemaining(saleGroups, purchaseGroups, usedSales, usedPurchases) {
  const candidates = [];
  saleGroups.forEach((sale) => {
    if (usedSales.has(sale.key)) return;
    purchaseGroups.forEach((purchase) => {
      if (usedPurchases.has(purchase.key)) return;
      const evidence = candidateScore(sale, purchase);
      if (evidence) candidates.push({ sale, purchase, evidence });
    });
  });
  candidates.sort((a, b) => b.evidence.score - a.evidence.score || (a.evidence.gap ?? Infinity) - (b.evidence.gap ?? Infinity));
  const cases = [];
  candidates.forEach((item) => {
    if (usedSales.has(item.sale.key) || usedPurchases.has(item.purchase.key)) return;
    usedSales.add(item.sale.key);
    usedPurchases.add(item.purchase.key);
    cases.push(buildCase([item.sale], [item.purchase], item.evidence));
  });
  return cases;
}

export function reconcileBranchTransfers(rawSales = [], rawPurchases = []) {
  const sales = dedupeLines(rawSales.map((line) => normalizeTransferLine(line, 'sale'))).filter((line) => line.from && line.to && line.from !== line.to && line.product_name && line.qty > 0);
  const purchases = dedupeLines(rawPurchases.map((line) => normalizeTransferLine(line, 'purchase'))).filter((line) => line.from && line.to && line.from !== line.to && line.product_name && line.qty > 0);
  const saleGroups = groupByInvoice(sales, 'sale');
  const purchaseGroups = groupByInvoice(purchases, 'purchase');
  const episode = balancedEpisodes(saleGroups, purchaseGroups);
  const cases = [...episode.cases, ...matchRemaining(saleGroups, purchaseGroups, episode.usedSales, episode.usedPurchases)];
  saleGroups.forEach((group) => { if (!episode.usedSales.has(group.key)) cases.push(buildCase([group], [])); });
  purchaseGroups.forEach((group) => { if (!episode.usedPurchases.has(group.key)) cases.push(buildCase([], [group])); });
  return cases.sort((a, b) => b.severity - a.severity || b.confidence_score - a.confidence_score || String(a.product_name).localeCompare(String(b.product_name), 'ar'));
}

export function summarizeTransferCases(cases = []) {
  return cases.reduce((summary, item) => {
    summary.total += 1;
    if (item.type === 'matched') summary.matched += 1;
    else if (item.type === 'unit_conversion_review') summary.unit_review += 1;
    else { summary.needs_action += 1; if (item.severity >= 90) summary.critical += 1; }
    if (item.cross_midnight) summary.cross_midnight += 1;
    if (item.match_confidence === 'high') summary.high_confidence += 1;
    return summary;
  }, { total: 0, matched: 0, unit_review: 0, needs_action: 0, critical: 0, cross_midnight: 0, high_confidence: 0 });
}

export function transferErrorRate(cases = [], branchKey) {
  const relevant = cases.filter((item) => item.from === branchKey || item.to === branchKey);
  const denominator = relevant.filter((item) => item.type !== 'unit_conversion_review').length;
  if (!denominator) return 0;
  const errors = relevant.filter((item) => !['matched', 'unit_conversion_review'].includes(item.type)).length;
  return Number(((errors / denominator) * 100).toFixed(1));
}

export function employeeTransferStats(cases = []) {
  const map = new Map();
  const add = (name, side, item) => {
    const clean = text(name);
    if (!clean || ['matched', 'unit_conversion_review'].includes(item.type)) return;
    const current = map.get(clean) || { name: clean, cases: 0, sale_cases: 0, purchase_cases: 0, critical: 0, weighted_score: 0 };
    current.cases += 1;
    if (side === 'sale') current.sale_cases += 1; else current.purchase_cases += 1;
    if (item.severity >= 90) current.critical += 1;
    current.weighted_score += item.severity;
    map.set(clean, current);
  };
  cases.forEach((item) => {
    item.sale_users?.forEach((user) => add(user, 'sale', item));
    item.purchase_users?.forEach((user) => add(user, 'purchase', item));
  });
  return [...map.values()].sort((a, b) => b.weighted_score - a.weighted_score || b.cases - a.cases);
}
