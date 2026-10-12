import { normalizeSupplierIdentityKey } from './purchaseInvoiceTruth.js';

const GENERIC_PREFIXES = new Set([
  'مخزن', 'مخازن', 'شركة', 'شركه', 'مؤسسة', 'مؤسسه', 'مورد', 'صيدلية', 'صيدليه',
]);

export function normalizeSupplierName(value, { stripGenericPrefix = false } = {}) {
  let normalized = String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (!stripGenericPrefix || !normalized) return normalized;
  const tokens = normalized.split(' ');
  while (tokens.length > 1 && GENERIC_PREFIXES.has(tokens[0])) tokens.shift();
  return tokens.join(' ');
}

function tokenSet(value) {
  return new Set(normalizeSupplierName(value, { stripGenericPrefix: true }).split(' ').filter(Boolean));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  a.forEach((token) => { if (b.has(token)) intersection += 1; });
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

export function supplierMatchScore(sourceName, candidateName) {
  const sourceIdentity = normalizeSupplierIdentityKey(sourceName);
  const candidateIdentity = normalizeSupplierIdentityKey(candidateName);
  if (sourceIdentity && candidateIdentity && sourceIdentity === candidateIdentity) return 1;

  const sourceFull = normalizeSupplierName(sourceName);
  const candidateFull = normalizeSupplierName(candidateName);
  if (!sourceFull || !candidateFull) return 0;
  if (sourceFull === candidateFull) return 1;

  const sourceCore = normalizeSupplierName(sourceName, { stripGenericPrefix: true });
  const candidateCore = normalizeSupplierName(candidateName, { stripGenericPrefix: true });
  if (sourceCore && sourceCore === candidateCore) return 0.99;

  const sourceTokens = tokenSet(sourceName);
  const candidateTokens = tokenSet(candidateName);
  const overlap = jaccard(sourceTokens, candidateTokens);
  const contains = sourceCore && candidateCore && (sourceCore.includes(candidateCore) || candidateCore.includes(sourceCore));

  if (contains && Math.min(sourceTokens.size, candidateTokens.size) >= 2) return Math.max(0.9, overlap);
  return overlap;
}

export function rankSupplierSuggestions(sourceName, suppliers, { limit = 3, minScore = 0.72 } = {}) {
  if (!sourceName || !Array.isArray(suppliers)) return [];
  return suppliers
    .filter((supplier) => supplier?.id && supplier?.name)
    .map((supplier) => ({ ...supplier, matchScore: supplierMatchScore(sourceName, supplier.name) }))
    .filter((supplier) => supplier.matchScore >= minScore)
    .sort((a, b) => b.matchScore - a.matchScore || String(a.name).localeCompare(String(b.name), 'ar'))
    .slice(0, limit);
}

export function supplierSuggestionLabel(score) {
  if (score >= 0.95) return 'تطابق قوي جدًا';
  if (score >= 0.85) return 'تطابق قوي';
  return 'اسم قريب';
}
