function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return text(value)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ـ/g, '')
    .replace(/×/g, 'x')
    .replace(/[,،:;()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FORM_PATTERNS = [
  { key: 'tablet', label: 'أقراص', re: /(?:\btab(?:let)?s?\b|\bقرص\b|\bاقراص\b)/i },
  { key: 'capsule', label: 'كبسولات', re: /(?:\bcap(?:sule)?s?\b|\bكبسول(?:ه|ات)?\b)/i },
  { key: 'syrup', label: 'شراب', re: /(?:\bsyr(?:up)?\b|\bشراب\b)/i },
  { key: 'suspension', label: 'معلق', re: /(?:\bsusp(?:ension)?\b|\bمعلق\b)/i },
  { key: 'ampoule', label: 'أمبول', re: /(?:\bamp(?:oule)?s?\b|\bامبول(?:ه|ات)?\b)/i },
  { key: 'vial', label: 'فيال', re: /(?:\bvials?\b|\bفيال\b)/i },
  { key: 'cream', label: 'كريم', re: /(?:\bcream\b|\bكريم\b)/i },
  { key: 'ointment', label: 'مرهم', re: /(?:\bointment\b|\bمرهم\b)/i },
  { key: 'drops', label: 'نقط', re: /(?:\bdrops?\b|\bنقط\b|\bقطره\b)/i },
  { key: 'sachet', label: 'أكياس', re: /(?:\bsachets?\b|\bكيس\b|\باكياس\b)/i },
  { key: 'suppository', label: 'لبوس', re: /(?:\bsupp(?:ository|ositories)?\b|\بلبوس\b)/i },
  { key: 'spray', label: 'بخاخ', re: /(?:\bspray\b|\bbخاخ\b|\bبخاخ\b)/i },
];

function normalizeNumber(raw) {
  const n = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(4));
}

function extractStrengths(name) {
  const value = normalize(name);
  const results = [];
  const patterns = [
    /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*(mg|g|mcg|µg|٪|%)/gi,
    /(\d+(?:[.,]\d+)?)\s*(mg|g|mcg|µg|٪|%)/gi,
  ];
  for (const re of patterns) {
    let match;
    while ((match = re.exec(value))) {
      if (match[2] && /^(mg|g|mcg|µg|٪|%)$/i.test(match[2])) {
        results.push(`${normalizeNumber(match[1])}${String(match[2]).toLowerCase()}`);
      } else if (match[3]) {
        results.push(`${normalizeNumber(match[1])}/${normalizeNumber(match[2])}${String(match[3]).toLowerCase()}`);
      }
    }
  }
  return [...new Set(results)];
}

function extractPackCount(name) {
  const value = normalize(name);
  const patterns = [
    /(?:x|×)\s*(\d{1,4})\s*(?:tab(?:let)?s?|cap(?:sule)?s?|قرص|اقراص|كبسول(?:ه|ات)?)/i,
    /(\d{1,4})\s*(?:tab(?:let)?s?|cap(?:sule)?s?|قرص|اقراص|كبسول(?:ه|ات)?)/i,
    /(?:pack|عبوه|علبه)\s*(?:of\s*)?(\d{1,4})/i,
  ];
  for (const re of patterns) {
    const match = value.match(re);
    if (match) return Number(match[1]);
  }
  return null;
}

function extractSize(name) {
  const value = normalize(name);
  const match = value.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|gm|g)\b/i);
  if (!match) return null;
  const n = normalizeNumber(match[1]);
  const unitRaw = match[2].toLowerCase();
  if (unitRaw === 'l') return { value: Number((n * 1000).toFixed(4)), unit: 'ml', label: `${n} L` };
  if (unitRaw === 'gm') return { value: n, unit: 'g', label: `${n} gm` };
  return { value: n, unit: unitRaw, label: `${n} ${unitRaw}` };
}

function extractForm(name) {
  const value = normalize(name);
  const found = FORM_PATTERNS.find((item) => item.re.test(value));
  return found ? { key: found.key, label: found.label } : null;
}

function stripDescriptors(name) {
  return normalize(name)
    .replace(/\d+(?:[.,]\d+)?\s*\/\s*\d+(?:[.,]\d+)?\s*(?:mg|g|mcg|µg|٪|%)/gi, ' ')
    .replace(/\d+(?:[.,]\d+)?\s*(?:mg|g|mcg|µg|٪|%|ml|l|gm)\b/gi, ' ')
    .replace(/(?:x|×)?\s*\d{1,4}\s*(?:tab(?:let)?s?|cap(?:sule)?s?|قرص|اقراص|كبسول(?:ه|ات)?)/gi, ' ')
    .replace(/\b(?:tab(?:let)?s?|cap(?:sule)?s?|syr(?:up)?|susp(?:ension)?|amp(?:oule)?s?|vials?|cream|ointment|drops?|sachets?|supp(?:ository|ositories)?|spray)\b/gi, ' ')
    .replace(/\b(?:قرص|اقراص|كبسوله|كبسولات|شراب|معلق|امبول|امبوله|امبولات|فيال|كريم|مرهم|نقط|قطره|كيس|اكياس|لبوس|بخاخ)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractTransferProductSignature(name) {
  return {
    raw_name: text(name),
    normalized_name: normalize(name),
    core_name: stripDescriptors(name),
    strengths: extractStrengths(name),
    pack_count: extractPackCount(name),
    form: extractForm(name),
    size: extractSize(name),
  };
}

function arraysDiffer(a = [], b = []) {
  if (!a.length || !b.length) return false;
  if (a.length !== b.length) return true;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.some((value, index) => value !== right[index]);
}

function sameSize(a, b) {
  if (!a || !b) return null;
  return a.unit === b.unit && Math.abs(a.value - b.value) < 0.0001;
}

export function diagnoseTransferProductIdentity({ saleName, purchaseName, saleCodes = [], purchaseCodes = [] } = {}) {
  const sale = extractTransferProductSignature(saleName);
  const purchase = extractTransferProductSignature(purchaseName);
  const codesDiffer = saleCodes.length && purchaseCodes.length && !saleCodes.some((code) => purchaseCodes.includes(code));

  const base = { sale, purchase, codes_differ: Boolean(codesDiffer), auto_resolve: false };

  if (sale.pack_count != null && purchase.pack_count != null && sale.pack_count !== purchase.pack_count) {
    return {
      ...base,
      kind: 'different_pack',
      risk: 'high',
      label: 'اختلاف عبوة',
      diagnosis: `العبوة مختلفة: ${sale.pack_count} مقابل ${purchase.pack_count}.`,
      action: 'لا توحّد الكودين. راجع هل التحويل تم على الـSKU الصحيح وهل أحد الفرعين سجّل عبوة مختلفة بالخطأ.',
    };
  }

  if (arraysDiffer(sale.strengths, purchase.strengths)) {
    return {
      ...base,
      kind: 'different_strength',
      risk: 'high',
      label: 'اختلاف تركيز',
      diagnosis: `التركيز مختلف: ${sale.strengths.join(' + ')} مقابل ${purchase.strengths.join(' + ')}.`,
      action: 'لا توحّد الكودين. راجع الصنف الفعلي المحوّل لأن ده غالبًا SKU مختلف.',
    };
  }

  if (sale.form && purchase.form && sale.form.key !== purchase.form.key) {
    return {
      ...base,
      kind: 'different_form',
      risk: 'high',
      label: 'اختلاف شكل دوائي',
      diagnosis: `الشكل الدوائي مختلف: ${sale.form.label} مقابل ${purchase.form.label}.`,
      action: 'لا توحّد الكودين. راجع الصنف الفعلي لأن الشكل الدوائي مختلف.',
    };
  }

  const sizeEqual = sameSize(sale.size, purchase.size);
  if (sizeEqual === false) {
    return {
      ...base,
      kind: 'different_size',
      risk: 'high',
      label: 'اختلاف حجم',
      diagnosis: `الحجم مختلف: ${sale.size.label} مقابل ${purchase.size.label}.`,
      action: 'لا توحّد الكودين. راجع الحجم/العبوة المسجلة في كل فرع.',
    };
  }

  const sameCore = Boolean(sale.core_name && purchase.core_name && sale.core_name === purchase.core_name);
  const hasEnoughDescriptors = Boolean(
    sameCore &&
    (sale.pack_count != null || purchase.pack_count != null || sale.strengths.length || purchase.strengths.length || sale.form || purchase.form || sale.size || purchase.size)
  );

  if (codesDiffer && sameCore && hasEnoughDescriptors) {
    return {
      ...base,
      kind: 'likely_duplicate_code',
      risk: 'medium',
      label: 'غالبًا نفس SKU بكودين',
      diagnosis: 'الاسم الأساسي والصفات المتاحة متوافقة، لكن الكود مختلف بين الفرعين.',
      action: 'راجع الـMaster Data والكودين يدويًا. لو ثبت أنه نفس الـSKU، أصلح سبب ازدواج الكود بدل ما نخفيه كمطابقة دائمة.',
    };
  }

  return {
    ...base,
    kind: 'insufficient_evidence',
    risk: 'medium',
    label: 'هوية غير محسومة',
    diagnosis: 'الكود مختلف لكن بيانات الاسم لا تكفي لإثبات هل الصنف واحد أم Variant مختلف.',
    action: 'راجع عدد الأقراص/التركيز/الشكل/الحجم قبل أي قرار. لا يتم دمج الكودين تلقائيًا.',
  };
}
