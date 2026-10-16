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

export function reconcileBranchTransfers(rawSales = [], rawPurchases = []) {
  const prepared = prepareTransferRawEvidence(rawSales, rawPurchases);
  const sales = prepared.sales.map(canonicalizeInternalWarehouses);
  const purchases = prepared.purchases.map(canonicalizeInternalWarehouses);
  const smartCases = reconcileSmartTransfers(sales, purchases);
  const completedJourneys = completeResidualBalancedJourneys(smartCases);
  return completedJourneys.map(enrichTransferDecisionIntelligence);
}
