import {
  reconcileBranchTransfers as reconcileSmartTransfers,
  normalizeTransferText,
  resolveTransferBranch,
  transferBranchLabel,
  normalizeTransferLine,
  summarizeTransferCases,
  transferErrorRate,
  employeeTransferStats,
} from './branchTransferControlSmartEngine.js';
import {
  enrichTransferDecisionIntelligence,
  explainTransferCase,
  summarizeDecisionIntelligence,
} from './branchTransferDecisionIntelligence.js';

export {
  normalizeTransferText,
  resolveTransferBranch,
  transferBranchLabel,
  normalizeTransferLine,
  summarizeTransferCases,
  transferErrorRate,
  employeeTransferStats,
  explainTransferCase,
  summarizeDecisionIntelligence,
};

export function reconcileBranchTransfers(rawSales = [], rawPurchases = []) {
  return reconcileSmartTransfers(rawSales, rawPurchases).map(enrichTransferDecisionIntelligence);
}
