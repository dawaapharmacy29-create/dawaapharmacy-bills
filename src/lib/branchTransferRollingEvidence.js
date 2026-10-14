import { normalizeTransferLine, normalizeTransferText } from './branchTransferControlSmartEngine.js';

const DAY_MS = 86400000;
const EPSILON = 0.0001;

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function nearlyEqual(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= EPSILON;
}

function lineKey(line) {
  return [line.side, line.from, line.to, line.invoice, line.code, normalizeTransferText(line.product_name), line.qty,
    Number.isFinite(line.timestamp_ms) ? Math.round(line.timestamp_ms / 1000) : line.day_key, line.user].join('::');
}

function slim(line) {
  return {
    key: lineKey(line),
    side: line.side,
    from: line.from,
    to: line.to,
    code: line.code,
    product_name: line.product_name,
    product_key: normalizeTransferText(line.product_name),
    qty: line.qty,
    invoice: line.invoice,
    user: line.user,
    timestamp_ms: line.timestamp_ms,
    day_key: line.day_key,
  };
}

export function mergeRollingEvidence(existing = [], rawSales = [], rawPurchases = [], options = {}) {
  const retentionDays = Number(options.retentionDays || 14);
  const fresh = [
    ...rawSales.map((row) => slim(normalizeTransferLine(row, 'sale'))),
    ...rawPurchases.map((row) => slim(normalizeTransferLine(row, 'purchase'))),
  ];
  const map = new Map();
  [...existing, ...fresh].forEach((line) => {
    if (!line?.key) return;
    map.set(line.key, line);
  });
  const all = [...map.values()];
  const knownTimes = all.map((line) => line.timestamp_ms).filter(Number.isFinite);
  if (!knownTimes.length) return all.slice(-5000);
  const newest = Math.max(...knownTimes);
  const cutoff = newest - retentionDays * DAY_MS;
  return all.filter((line) => !Number.isFinite(line.timestamp_ms) || line.timestamp_ms >= cutoff).slice(-5000);
}

function unique(values = []) {
  return [...new Set(values.map(text).filter(Boolean))];
}

export function detectTransferCodeConflict(item = {}) {
  const saleCodes = unique(item.sale_codes || []);
  const purchaseCodes = unique(item.purchase_codes || []);
  const saleName = normalizeTransferText(item.sale_product_name || item.product_name || '');
  const purchaseName = normalizeTransferText(item.purchase_product_name || item.product_name || '');
  const sameName = Boolean(saleName && purchaseName && saleName === purchaseName);
  const overlapping = saleCodes.some((code) => purchaseCodes.includes(code));
  const conflict = sameName && saleCodes.length > 0 && purchaseCodes.length > 0 && !overlapping;
  return { conflict, saleCodes, purchaseCodes, sameName, overlapping };
}

function currentCaseKeys(item) {
  return new Set([...(item.sale_lines || []), ...(item.purchase_lines || [])].map(lineKey));
}

function caseAnchor(item) {
  const times = [...(item.sale_lines || []), ...(item.purchase_lines || [])]
    .map((line) => Number(line.timestamp_ms)).filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}

function commonCodes(item) {
  return unique([...(item.sale_codes || []), ...(item.purchase_codes || [])]);
}

function wantedSideAndQty(item) {
  const saleQty = Number(item.sale_qty || 0);
  const purchaseQty = Number(item.purchase_qty || 0);
  if (item.type === 'sale_without_purchase') return { side: 'purchase', qty: saleQty };
  if (item.type === 'purchase_without_sale') return { side: 'sale', qty: purchaseQty };
  if (item.type === 'quantity_mismatch' || item.type === 'unit_conversion_review') {
    if (purchaseQty > saleQty) return { side: 'sale', qty: purchaseQty - saleQty };
    if (saleQty > purchaseQty) return { side: 'purchase', qty: saleQty - purchaseQty };
  }
  return { side: null, qty: 0 };
}

function gapLabel(minutes) {
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 60) return `بعد ${Math.round(minutes)} دقيقة`;
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins ? `بعد ${hours} س ${mins} د` : `بعد ${hours} ساعة`;
  }
  const days = Math.floor(minutes / 1440);
  const hours = Math.round((minutes % 1440) / 60);
  return hours ? `بعد ${days} يوم و${hours} س` : `بعد ${days} يوم`;
}

export function findRollingEvidence(item = {}, archive = [], options = {}) {
  const afterDays = Number(options.afterDays || 7);
  const beforeDays = Number(options.beforeDays || 3);
  const { side, qty: missingQty } = wantedSideAndQty(item);
  const anchor = caseAnchor(item);
  if (!side || !Number.isFinite(anchor) || missingQty <= EPSILON) {
    return { candidates: [], best: null, missingQty, side, codeConflict: detectTransferCodeConflict(item) };
  }

  const excluded = currentCaseKeys(item);
  const codes = commonCodes(item);
  const nameKeys = unique([item.product_name, item.sale_product_name, item.purchase_product_name].map(normalizeTransferText));
  const minTime = anchor - beforeDays * DAY_MS;
  const maxTime = anchor + afterDays * DAY_MS;

  const candidates = archive.filter((line) => {
    if (!line || excluded.has(line.key) || line.side !== side) return false;
    if (line.from !== item.from || line.to !== item.to) return false;
    if (!Number.isFinite(line.timestamp_ms) || line.timestamp_ms < minTime || line.timestamp_ms > maxTime) return false;
    const exactCode = Boolean(line.code && codes.includes(line.code));
    const sameName = Boolean(line.product_key && nameKeys.includes(line.product_key));
    return exactCode || sameName;
  }).map((line) => {
    const exactCode = Boolean(line.code && codes.includes(line.code));
    const sameName = Boolean(line.product_key && nameKeys.includes(line.product_key));
    const quantityClosesGap = nearlyEqual(line.qty, missingQty);
    const minutes = (line.timestamp_ms - anchor) / 60000;
    const future = minutes >= 0;
    const score = (exactCode ? 70 : 30) + (quantityClosesGap ? 25 : 0) + (future ? 5 : 0) - Math.min(20, Math.abs(minutes) / 720);
    const differentCodeSameName = sameName && line.code && codes.length > 0 && !codes.includes(line.code);
    return {
      ...line,
      exactCode,
      sameName,
      differentCodeSameName,
      quantityClosesGap,
      gapMinutes: minutes,
      gapLabel: gapLabel(Math.abs(minutes)),
      score,
      confidence: exactCode && quantityClosesGap ? 'high' : exactCode || quantityClosesGap ? 'medium' : 'low',
    };
  }).sort((a, b) => b.score - a.score || Math.abs(a.gapMinutes) - Math.abs(b.gapMinutes));

  const best = candidates.find((candidate) => candidate.gapMinutes >= 0 && !candidate.differentCodeSameName) || candidates[0] || null;
  return {
    candidates: candidates.slice(0, 8),
    best,
    missingQty: Number(missingQty.toFixed(3)),
    side,
    codeConflict: detectTransferCodeConflict(item),
    mayExplainFully: Boolean(best?.gapMinutes >= 0 && best?.exactCode && best?.quantityClosesGap),
  };
}
