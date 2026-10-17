import {
  reconcileBranchTransfers as reconcileSmartTransfers,
  normalizeTransferText,
  resolveTransferBranch as resolveSmartTransferBranch,
  transferBranchLabel,
  normalizeTransferLine as normalizeSmartTransferLine,
  summarizeTransferCases,
  transferErrorRate,
  employeeTransferStats,
} from './branchTransferControlSmartEngine.js';
import {
  enrichTransferDecisionIntelligence,
  explainTransferCase,
  summarizeDecisionIntelligence,
} from './branchTransferDecisionIntelligence.js';
import { prepareTransferRawEvidence } from './branchTransferRawEvidencePreparation.js';
import { completeResidualBalancedJourneys } from './branchTransferResidualJourneyCompletion.js';
import { applyPackagingIntelligence } from './branchTransferPackagingIntelligence.js';
import { enforcePackagingProfileConsistency } from './branchTransferPackagingSafety.js';

const INTERNAL_WAREHOUSES = [
  {
    parent: 'shokry',
    canonical: 'دواء فرع ابو العزم',
    aliases: ['مخزن د وائل', 'مخزن د/ وائل', 'مخزن دكتور وائل', 'مخزن الدكتور وائل', 'د وائل', 'د/ وائل'],
  },
  {
    parent: 'shamy',
    canonical: 'دواء فرع الشامي',
    aliases: ['مخزن د معاذ', 'مخزن د/ معاذ', 'مخزن دكتور معاذ', 'مخزن الدكتور معاذ', 'د معاذ', 'د/ معاذ'],
  },
].map((warehouse) => ({
  ...warehouse,
  normalizedAliases: [...new Set(warehouse.aliases.map((alias) => normalizeTransferText(alias)))],
}));

function internalWarehouse(value) {
  const normalized = normalizeTransferText(value);
  if (!normalized) return null;
  return INTERNAL_WAREHOUSES.find((warehouse) =>
    warehouse.normalizedAliases.some((alias) => normalized === alias || normalized.includes(alias)),
  ) || null;
}

function canonicalizeInternalWarehouses(raw = {}) {
  const branchOriginal = raw.branch || raw.location || raw.warehouse || '';
  const counterpartyOriginal = raw.counterparty || raw.supplier || raw.customer || raw.other_branch || '';
  const branchWarehouse = internalWarehouse(branchOriginal);
  const counterpartyWarehouse = internalWarehouse(counterpartyOriginal);

  if (!branchWarehouse && !counterpartyWarehouse) return raw;

  return {
    ...raw,
    ...(branchWarehouse ? {
      branch: branchWarehouse.canonical,
      physical_branch: branchOriginal,
      physical_branch_parent: branchWarehouse.parent,
    } : {}),
    ...(counterpartyWarehouse ? {
      counterparty: counterpartyWarehouse.canonical,
      physical_counterparty: counterpartyOriginal,
      physical_counterparty_parent: counterpartyWarehouse.parent,
    } : {}),
  };
}

function validTimestamp(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeCaseTimestamps(item = {}) {
  const sanitizeLines = (lines = []) => lines.map((line) => ({
    ...line,
    timestamp_ms: validTimestamp(line?.timestamp_ms) ?? undefined,
  }));
  return {
    ...item,
    sale_lines: sanitizeLines(item.sale_lines),
    purchase_lines: sanitizeLines(item.purchase_lines),
  };
}

function caseIdentity(item = {}) {
  return String(item.sale_codes?.[0] || item.purchase_codes?.[0] || item.product_name || 'unknown')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableReviewCaseId(item = {}) {
  const all = [
    ...(item.sale_lines || []).map((line) => ({ side: 'sale', line, timestamp: validTimestamp(line?.timestamp_ms) })),
    ...(item.purchase_lines || []).map((line) => ({ side: 'purchase', line, timestamp: validTimestamp(line?.timestamp_ms) })),
  ].filter((entry) => entry.timestamp != null && entry.line?.invoice);
  if (!all.length) return item.id;
  all.sort((a, b) => a.timestamp - b.timestamp);
  if (all.length > 1 && all[0].timestamp === all[1].timestamp && all[0].side !== all[1].side) return item.id;
  const anchor = all[0];
  const prefix = [item.from || 'unknown', item.to || 'unknown', caseIdentity(item)];
  return anchor.side === 'sale'
    ? [...prefix, String(anchor.line.invoice), 'no-purchase'].join('::')
    : [...prefix, 'no-sale', String(anchor.line.invoice)].join('::');
}

function stabilizeReviewCase(item = {}) {
  const sanitized = sanitizeCaseTimestamps(item);
  if (sanitized.type === 'matched') return sanitized;
  return {
    ...sanitized,
    legacy_case_id: sanitized.id,
    id: stableReviewCaseId(sanitized),
  };
}

export function resolveTransferBranch(value) {
  return internalWarehouse(value)?.parent || resolveSmartTransferBranch(value);
}

export function normalizeTransferLine(raw, side) {
  return normalizeSmartTransferLine(canonicalizeInternalWarehouses(raw), side);
}

export {
  normalizeTransferText,
  transferBranchLabel,
  summarizeTransferCases,
  transferErrorRate,
  employeeTransferStats,
  explainTransferCase,
  summarizeDecisionIntelligence,
};

export function reconcileBranchTransfers(rawSales = [], rawPurchases = [], options = {}) {
  const prepared = prepareTransferRawEvidence(rawSales, rawPurchases);
  const sales = prepared.sales.map(canonicalizeInternalWarehouses);
  const purchases = prepared.purchases.map(canonicalizeInternalWarehouses);
  const smartCases = reconcileSmartTransfers(sales, purchases).map(stabilizeReviewCase);
  const packagingAwareCases = applyPackagingIntelligence(smartCases, options.packagingRules || {});
  const packagingSafeCases = enforcePackagingProfileConsistency(packagingAwareCases);
  const completedJourneys = completeResidualBalancedJourneys(packagingSafeCases);
  return completedJourneys.map(enrichTransferDecisionIntelligence);
}
