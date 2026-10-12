import { parseTransferWorkbook } from './branchTransferShadowParser';
import { resolveTransferBranch } from './branchTransferControl';

export const AUTO_SOURCE_CONFIG = {
  shokrySale: { label: 'بيع شكري → الشامي', side: 'sale', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
  shamyPurchase: { label: 'شراء الشامي من شكري', side: 'purchase', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shamySale: { label: 'بيع الشامي → شكري', side: 'sale', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shokryPurchase: { label: 'شراء شكري من الشامي', side: 'purchase', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
};

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function majorityBranch(values = []) {
  const counts = new Map();
  values.forEach((value) => {
    const branch = resolveTransferBranch(value);
    if (!branch) return;
    counts.set(branch, (counts.get(branch) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

export function classifyParsedTransferFile(parsed) {
  if (!parsed?.valid || !parsed.items?.length) {
    return { sourceKey: null, confidence: 'none', reason: 'الملف لا يحتوي على أصناف صالحة.' };
  }

  const format = parsed.meta?.source_format;
  const counterparties = parsed.items.map((item) => item.counterparty).filter(Boolean);
  const branches = parsed.items.map((item) => item.branch).filter(Boolean);

  if (format === 'bconnect_purchase_report') {
    const sourceBranch = majorityBranch(counterparties);
    if (sourceBranch === 'shokry') return { sourceKey: 'shamyPurchase', confidence: 'high', reason: 'تقرير مشتريات ومورده فرع شكري/أبو العزم.' };
    if (sourceBranch === 'shamy') return { sourceKey: 'shokryPurchase', confidence: 'high', reason: 'تقرير مشتريات ومورده فرع الشامي.' };
  }

  if (format === 'flat_transfer_rows') {
    const destination = majorityBranch(counterparties);
    const explicitSource = majorityBranch(branches);
    if (explicitSource === 'shokry' && destination === 'shamy') return { sourceKey: 'shokrySale', confidence: 'high', reason: 'تقرير بيع من شكري للعميل الشامي.' };
    if (explicitSource === 'shamy' && destination === 'shokry') return { sourceKey: 'shamySale', confidence: 'high', reason: 'تقرير بيع من الشامي للعميل شكري/أبو العزم.' };
    if (destination === 'shamy') return { sourceKey: 'shokrySale', confidence: 'high', reason: 'تقرير بيع والعميل هو فرع الشامي؛ المصدر هو الفرع المقابل.' };
    if (destination === 'shokry') return { sourceKey: 'shamySale', confidence: 'high', reason: 'تقرير بيع والعميل هو فرع شكري/أبو العزم؛ المصدر هو الفرع المقابل.' };
  }

  return { sourceKey: null, confidence: 'low', reason: 'لم أستطع تحديد اتجاه الملف بأمان من بياناته الداخلية.' };
}

function withDirectionDefaults(parsed, sourceKey) {
  const config = AUTO_SOURCE_CONFIG[sourceKey];
  if (!config) return parsed;
  return {
    ...parsed,
    items: parsed.items.map((item) => ({
      ...item,
      branch: item.branch || config.branch,
      counterparty: item.counterparty || config.counterparty,
    })),
  };
}

async function sha256(arrayBuffer) {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', arrayBuffer);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return null;
}

export async function inspectTransferFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const parsed = parseTransferWorkbook(arrayBuffer, {});
  const classification = classifyParsedTransferFile(parsed);
  const normalized = classification.sourceKey ? withDirectionDefaults(parsed, classification.sourceKey) : parsed;
  return {
    fileName: file.name,
    fileSize: file.size,
    fingerprint: await sha256(arrayBuffer),
    ...classification,
    parsed: normalized,
  };
}

function rowFingerprint(item, sourceKey) {
  return [
    sourceKey,
    text(item.invoice),
    text(item.code),
    text(item.product_name),
    String(item.qty ?? ''),
    text(item.date),
    text(item.user),
    text(item.row_number),
    text(item.source_format),
  ].join('::');
}

export function buildSourcesFromInspections(inspections = []) {
  const sources = {};
  const seenFiles = new Set();
  const seenRows = new Set();
  const ambiguous = [];
  const duplicates = [];
  const errors = [];

  inspections.forEach((entry) => {
    if (!entry?.parsed?.valid) {
      errors.push({ fileName: entry?.fileName || 'ملف غير معروف', reason: entry?.parsed?.warnings?.join(' ') || entry?.reason || 'تعذر قراءة الملف.' });
      return;
    }
    if (!entry.sourceKey) {
      ambiguous.push(entry);
      return;
    }
    const fileKey = entry.fingerprint || `${entry.fileName}::${entry.fileSize}`;
    if (seenFiles.has(fileKey)) {
      duplicates.push(entry.fileName);
      return;
    }
    seenFiles.add(fileKey);

    const bucket = sources[entry.sourceKey] || { valid: true, items: [], fileNames: [], warnings: [], meta: { files: [] } };
    const uniqueItems = [];
    entry.parsed.items.forEach((item) => {
      const key = rowFingerprint(item, entry.sourceKey);
      if (seenRows.has(key)) return;
      seenRows.add(key);
      uniqueItems.push(item);
    });
    bucket.items.push(...uniqueItems);
    bucket.fileNames.push(entry.fileName);
    bucket.warnings.push(...(entry.parsed.warnings || []));
    bucket.meta.files.push({ fileName: entry.fileName, fingerprint: entry.fingerprint, ...entry.parsed.meta });
    sources[entry.sourceKey] = bucket;
  });

  return { sources, ambiguous, duplicates, errors };
}
