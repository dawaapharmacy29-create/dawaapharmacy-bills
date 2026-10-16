import { parseTransferWorkbook } from './branchTransferShadowParser.js';
import { resolveTransferBranch } from './branchTransferControl.js';
import { enrichSaleRowsWithInvoiceHeaders } from './branchTransferEvidencePreparation.js';

export const AUTO_SOURCE_CONFIG = {
  shokrySale: { label: 'بيع شكري → الشامي', side: 'sale', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
  shamyPurchase: { label: 'شراء الشامي من شكري', side: 'purchase', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shamySale: { label: 'بيع الشامي → شكري', side: 'sale', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
  shokryPurchase: { label: 'شراء شكري من الشامي', side: 'purchase', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
  shokrySaleHeaders: { label: 'بيانات فواتير بيع شكري', side: 'sale_headers', branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' },
  shamySaleHeaders: { label: 'بيانات فواتير بيع الشامي', side: 'sale_headers', branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' },
};

const COUNTERPARTY_CODE_BRANCH = {
  sale: {
    '10': 'shamy',
    '170': 'shokry',
  },
  purchase: {
    '300': 'shokry',
    '475': 'shamy',
  },
};

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeCounterpartyCode(value) {
  const raw = text(value);
  if (!raw) return '';
  if (/^\d+(?:\.0+)?$/.test(raw)) return String(Number(raw));
  return raw;
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

function branchFromCounterpartyCodes(items = [], side) {
  const codeMap = COUNTERPARTY_CODE_BRANCH[side] || {};
  const counts = new Map();
  const matchedCodes = new Set();
  items.forEach((item) => {
    const code = normalizeCounterpartyCode(item?.counterparty_code);
    const branch = codeMap[code];
    if (!branch) return;
    matchedCodes.add(code);
    counts.set(branch, (counts.get(branch) || 0) + 1);
  });
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return {
    branch: ranked[0]?.[0] || null,
    branches: ranked.map(([branch]) => branch),
    codes: [...matchedCodes],
  };
}

function sourceKeyFor(format, counterpartyBranch) {
  if (format === 'flat_transfer_rows') {
    if (counterpartyBranch === 'shamy') return 'shokrySale';
    if (counterpartyBranch === 'shokry') return 'shamySale';
  }
  if (format === 'bconnect_sales_invoice_headers') {
    if (counterpartyBranch === 'shamy') return 'shokrySaleHeaders';
    if (counterpartyBranch === 'shokry') return 'shamySaleHeaders';
  }
  if (format === 'bconnect_purchase_report') {
    if (counterpartyBranch === 'shokry') return 'shamyPurchase';
    if (counterpartyBranch === 'shamy') return 'shokryPurchase';
  }
  return null;
}

export function classifyParsedTransferFile(parsed) {
  if (!parsed?.valid || !parsed.items?.length) {
    return { sourceKey: null, confidence: 'none', reason: 'الملف لا يحتوي على بيانات صالحة.' };
  }

  const format = parsed.meta?.source_format;
  const side = ['flat_transfer_rows', 'bconnect_sales_invoice_headers'].includes(format)
    ? 'sale'
    : format === 'bconnect_purchase_report' ? 'purchase' : null;
  const counterparties = parsed.items.map((item) => item.counterparty).filter(Boolean);
  const branches = parsed.items.map((item) => item.branch).filter(Boolean);
  const nameBranch = majorityBranch(counterparties);

  if (side) {
    const codeEvidence = branchFromCounterpartyCodes(parsed.items, side);
    if (codeEvidence.branches.length > 1) {
      return {
        sourceKey: null,
        confidence: 'none',
        reason: `الملف يحتوي على أكواد فروع متعارضة (${codeEvidence.codes.join('، ')}). لن يتم تصنيفه تلقائيًا.`,
      };
    }
    if (codeEvidence.branch) {
      if (nameBranch && nameBranch !== codeEvidence.branch) {
        return {
          sourceKey: null,
          confidence: 'none',
          reason: `كود الفرع يشير إلى ${codeEvidence.branch === 'shokry' ? 'شكري/أبو العزم' : 'الشامي'} لكن الاسم يشير إلى فرع آخر. يحتاج مراجعة يدوية.`,
        };
      }
      const sourceKey = sourceKeyFor(format, codeEvidence.branch);
      if (sourceKey) {
        return {
          sourceKey,
          confidence: 'high',
          reason: `تم تحديد الاتجاه من كود الفرع الثابت داخل B-Connect (${codeEvidence.codes.join('، ')}).`,
          evidence: 'counterparty_code',
        };
      }
    }
  }

  if (format === 'bconnect_purchase_report') {
    if (nameBranch === 'shokry') return { sourceKey: 'shamyPurchase', confidence: 'medium', reason: 'تقرير مشتريات ومورده فرع شكري/أبو العزم؛ تم الاعتماد على الاسم.' };
    if (nameBranch === 'shamy') return { sourceKey: 'shokryPurchase', confidence: 'medium', reason: 'تقرير مشتريات ومورده فرع الشامي؛ تم الاعتماد على الاسم.' };
  }

  if (format === 'flat_transfer_rows' || format === 'bconnect_sales_invoice_headers') {
    const destination = nameBranch;
    const explicitSource = majorityBranch(branches);
    const headerFile = format === 'bconnect_sales_invoice_headers';
    if (explicitSource === 'shokry' && destination === 'shamy') return { sourceKey: headerFile ? 'shokrySaleHeaders' : 'shokrySale', confidence: 'medium', reason: 'تم تحديد بيع شكري للعميل الشامي من بيانات الملف.' };
    if (explicitSource === 'shamy' && destination === 'shokry') return { sourceKey: headerFile ? 'shamySaleHeaders' : 'shamySale', confidence: 'medium', reason: 'تم تحديد بيع الشامي لشكري من بيانات الملف.' };
    if (destination === 'shamy') return { sourceKey: headerFile ? 'shokrySaleHeaders' : 'shokrySale', confidence: 'medium', reason: 'العميل هو فرع الشامي، إذن المصدر شكري.' };
    if (destination === 'shokry') return { sourceKey: headerFile ? 'shamySaleHeaders' : 'shamySale', confidence: 'medium', reason: 'العميل هو فرع شكري/أبو العزم، إذن المصدر الشامي.' };
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
    text(item.expiration_raw),
    text(item.date),
    text(item.user),
    text(item.row_number),
    text(item.source_format),
  ].join('::');
}

function enrichBuiltSources(sources) {
  if (sources.shokrySale?.items?.length && sources.shokrySaleHeaders?.items?.length) {
    sources.shokrySale.items = enrichSaleRowsWithInvoiceHeaders(sources.shokrySale.items, sources.shokrySaleHeaders.items);
  }
  if (sources.shamySale?.items?.length && sources.shamySaleHeaders?.items?.length) {
    sources.shamySale.items = enrichSaleRowsWithInvoiceHeaders(sources.shamySale.items, sources.shamySaleHeaders.items);
  }
  return sources;
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
      uniqueItems.push({
        ...item,
        source_file: entry.fileName,
        source_fingerprint: entry.fingerprint || '',
      });
    });
    bucket.items.push(...uniqueItems);
    bucket.fileNames.push(entry.fileName);
    bucket.warnings.push(...(entry.parsed.warnings || []));
    bucket.meta.files.push({ fileName: entry.fileName, fingerprint: entry.fingerprint, ...entry.parsed.meta });
    sources[entry.sourceKey] = bucket;
  });

  return { sources: enrichBuiltSources(sources), ambiguous, duplicates, errors };
}
