const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670]/g;

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
  shokry: {
    key: 'shokry',
    label: 'شكري',
    aliases: ['شكري', 'دواء شكري', 'دواء فرع ابو العزم', 'دواء ابو العزم', 'فرع ابو العزم', 'ابو العزم'],
  },
  shamy: {
    key: 'shamy',
    label: 'الشامي',
    aliases: ['الشامي', 'دواء الشامي', 'دواء فرع الشامي', 'فرع الشامي'],
  },
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
  const number = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(number) ? number : 0;
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = text(value);
  if (!raw) return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;
  const match = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayKey(value) {
  const date = parseDate(value);
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

export function normalizeTransferLine(raw, side) {
  const branch = resolveTransferBranch(raw.branch || raw.location || raw.warehouse);
  const counterparty = resolveTransferBranch(raw.counterparty || raw.supplier || raw.customer || raw.other_branch);
  const from = side === 'sale' ? branch : counterparty;
  const to = side === 'sale' ? counterparty : branch;
  return {
    id: text(raw.id || `${side}-${raw.invoice || raw.serial || ''}-${raw.row_number || raw.row || ''}`),
    side,
    branch,
    counterparty,
    from,
    to,
    product_name: text(raw.product_name || raw.item_name || raw.product || raw.item),
    product_name_key: productNameKey(raw.product_name || raw.item_name || raw.product || raw.item),
    code: normalizeCode(raw.code || raw.product_code || raw.item_code || raw.barcode),
    qty: Math.abs(quantity(raw.qty ?? raw.quantity ?? raw.count)),
    unit: normalizeTransferText(raw.unit || raw.sale_unit || raw.purchase_unit),
    invoice: text(raw.invoice || raw.invoice_number || raw.serial),
    user: text(raw.user || raw.doctor || raw.employee || raw.entered_by),
    date: raw.date || raw.datetime || raw.created_at || '',
    day_key: dayKey(raw.date || raw.datetime || raw.created_at),
    raw,
  };
}

function candidateScore(sale, purchase) {
  if (!sale.from || !sale.to || sale.from !== purchase.from || sale.to !== purchase.to) return -1;
  if (sale.day_key !== purchase.day_key) return -1;
  if (sale.code && purchase.code && sale.code === purchase.code) return 100;
  if (sale.product_name_key && purchase.product_name_key && sale.product_name_key === purchase.product_name_key) return 80;
  return -1;
}

function aggregate(lines, side) {
  const first = lines[0];
  return {
    side,
    qty: lines.reduce((sum, line) => sum + line.qty, 0),
    codes: [...new Set(lines.map((line) => line.code).filter(Boolean))],
    users: [...new Set(lines.map((line) => line.user).filter(Boolean))],
    units: [...new Set(lines.map((line) => line.unit).filter(Boolean))],
    invoices: [...new Set(lines.map((line) => line.invoice).filter(Boolean))],
    product_name: first?.product_name || '',
    day_key: first?.day_key || 'unknown-day',
    from: first?.from || null,
    to: first?.to || null,
    lines,
  };
}

function severity(caseType) {
  return {
    purchase_without_sale: 100,
    sale_without_purchase: 95,
    quantity_mismatch: 85,
    code_mismatch: 55,
    unit_conversion_review: 45,
    matched: 0,
  }[caseType] ?? 40;
}

function nextAction(caseType, result) {
  const target = transferBranchLabel(result.to);
  const source = transferBranchLabel(result.from);
  if (caseType === 'purchase_without_sale') return `راجع بيع ${source} أولًا؛ يوجد شراء في ${target} بدون بيع مقابل.`;
  if (caseType === 'sale_without_purchase') return `تأكد هل الصنف وصل ${target}. إن وصل، راجع تسجيل الشراء؛ وإن لم يصل لا تسجل شراء وافتح متابعة نقل.`;
  if (caseType === 'quantity_mismatch') {
    const diff = Math.abs(result.sale_qty - result.purchase_qty);
    return result.sale_qty > result.purchase_qty
      ? `راجع شراء ${target}: الكمية أقل من البيع بـ ${diff}.`
      : `راجع شراء ${target}: الكمية أعلى من البيع بـ ${diff}، أو راجع بيع ${source}.`;
  }
  if (caseType === 'unit_conversion_review') return 'الكمية مختلفة لكن النمط يشبه تحويل وحدة (مثل شريط مقابل جزء من علبة). أكّد معامل التحويل مرة واحدة قبل احتسابها كخطأ.';
  if (caseType === 'code_mismatch') return 'راجع الكودين: إن كانا لنفس العبوة اربطهما كهوية صنف واحدة، وإلا اترك الحالة للمراجعة.';
  return 'لا يوجد إجراء مطلوب.';
}

function hasCommonCode(sales, purchases) {
  const saleCodes = new Set(sales.map((line) => line.code).filter(Boolean));
  const purchaseCodes = new Set(purchases.map((line) => line.code).filter(Boolean));
  return [...saleCodes].some((code) => purchaseCodes.has(code));
}

function looksLikeUnitConversion(sales, purchases) {
  if (!sales.length || !purchases.length || !hasCommonCode(sales, purchases)) return false;
  const saleQty = sales.reduce((sum, line) => sum + line.qty, 0);
  const purchaseQty = purchases.reduce((sum, line) => sum + line.qty, 0);
  if (saleQty <= 0 || purchaseQty <= 0 || saleQty === purchaseQty) return false;
  const saleFractional = Math.abs(saleQty - Math.round(saleQty)) > 0.0001;
  const purchaseFractional = Math.abs(purchaseQty - Math.round(purchaseQty)) > 0.0001;
  if (saleFractional === purchaseFractional) return false;
  const ratio = Math.max(saleQty, purchaseQty) / Math.min(saleQty, purchaseQty);
  if (ratio < 1.5 || ratio > 30) return false;
  const saleUnits = new Set(sales.map((line) => line.unit).filter(Boolean));
  const nonBoxUnit = [...saleUnits].some((unit) => unit && !['علبه', 'علبة', 'box'].includes(unit));
  return nonBoxUnit || purchaseFractional || saleFractional;
}

function caseTypeFrom(sales, purchases) {
  if (!sales.length) return 'purchase_without_sale';
  if (!purchases.length) return 'sale_without_purchase';
  const saleQty = sales.reduce((sum, line) => sum + line.qty, 0);
  const purchaseQty = purchases.reduce((sum, line) => sum + line.qty, 0);
  if (saleQty !== purchaseQty) {
    if (looksLikeUnitConversion(sales, purchases)) return 'unit_conversion_review';
    return 'quantity_mismatch';
  }
  if (!hasCommonCode(sales, purchases)) {
    const saleCodes = new Set(sales.map((line) => line.code).filter(Boolean));
    const purchaseCodes = new Set(purchases.map((line) => line.code).filter(Boolean));
    if (saleCodes.size && purchaseCodes.size) return 'code_mismatch';
  }
  return 'matched';
}

function buildCase(sales, purchases) {
  const saleAgg = aggregate(sales, 'sale');
  const purchaseAgg = aggregate(purchases, 'purchase');
  const first = sales[0] || purchases[0];
  const type = caseTypeFrom(sales, purchases);
  const result = {
    id: [first.day_key, first.from || 'unknown', first.to || 'unknown', first.code || first.product_name_key || 'unknown'].join('::'),
    type,
    severity: severity(type),
    from: first.from,
    to: first.to,
    day_key: first.day_key,
    product_name: saleAgg.product_name || purchaseAgg.product_name,
    sale_qty: saleAgg.qty || 0,
    purchase_qty: purchaseAgg.qty || 0,
    sale_units: saleAgg.units,
    purchase_units: purchaseAgg.units,
    sale_codes: saleAgg.codes,
    purchase_codes: purchaseAgg.codes,
    sale_users: saleAgg.users,
    purchase_users: purchaseAgg.users,
    sale_invoices: saleAgg.invoices,
    purchase_invoices: purchaseAgg.invoices,
    sale_lines: sales,
    purchase_lines: purchases,
  };
  return { ...result, next_action: nextAction(type, result) };
}

export function reconcileBranchTransfers(rawSales = [], rawPurchases = []) {
  const sales = rawSales.map((line) => normalizeTransferLine(line, 'sale')).filter((line) => line.from && line.to && line.from !== line.to && line.product_name && line.qty > 0);
  const purchases = rawPurchases.map((line) => normalizeTransferLine(line, 'purchase')).filter((line) => line.from && line.to && line.from !== line.to && line.product_name && line.qty > 0);

  const unusedPurchases = new Set(purchases.map((_, index) => index));
  const cases = [];

  const saleGroups = new Map();
  sales.forEach((sale) => {
    const key = `${sale.day_key}::${sale.from}::${sale.to}::${sale.code || sale.product_name_key}`;
    if (!saleGroups.has(key)) saleGroups.set(key, []);
    saleGroups.get(key).push(sale);
  });

  for (const groupSales of saleGroups.values()) {
    const candidates = [];
    purchases.forEach((purchase, index) => {
      if (!unusedPurchases.has(index)) return;
      const score = Math.max(...groupSales.map((sale) => candidateScore(sale, purchase)));
      if (score >= 0) candidates.push({ index, purchase, score });
    });
    const bestScore = candidates.length ? Math.max(...candidates.map((candidate) => candidate.score)) : -1;
    const matched = candidates.filter((candidate) => candidate.score === bestScore && bestScore >= 0);
    matched.forEach((candidate) => unusedPurchases.delete(candidate.index));
    cases.push(buildCase(groupSales, matched.map((candidate) => candidate.purchase)));
  }

  unusedPurchases.forEach((index) => cases.push(buildCase([], [purchases[index]])));

  return cases.sort((a, b) => b.severity - a.severity || String(a.product_name).localeCompare(String(b.product_name), 'ar'));
}

export function summarizeTransferCases(cases = []) {
  return cases.reduce((summary, item) => {
    summary.total += 1;
    if (item.type === 'matched') summary.matched += 1;
    else if (item.type === 'unit_conversion_review') summary.unit_review += 1;
    else {
      summary.needs_action += 1;
      if (item.severity >= 90) summary.critical += 1;
    }
    return summary;
  }, { total: 0, matched: 0, unit_review: 0, needs_action: 0, critical: 0 });
}

export function transferErrorRate(cases = [], branchKey) {
  const relevant = cases.filter((item) => (item.from === branchKey || item.to === branchKey) && item.type !== 'unit_conversion_review');
  if (!relevant.length) return 0;
  const errors = relevant.filter((item) => item.type !== 'matched').length;
  return Number(((errors / relevant.length) * 100).toFixed(1));
}

export function employeeTransferStats(cases = []) {
  const map = new Map();
  cases.filter((item) => item.type !== 'matched' && item.type !== 'unit_conversion_review').forEach((item) => {
    const users = [
      ...item.sale_users.map((name) => ({ name, role: 'sale' })),
      ...item.purchase_users.map((name) => ({ name, role: 'purchase' })),
    ];
    users.forEach(({ name, role }) => {
      if (!name) return;
      const key = normalizeTransferText(name);
      const current = map.get(key) || { name, cases: 0, sale_cases: 0, purchase_cases: 0, weighted_score: 0 };
      current.cases += 1;
      current.weighted_score += item.severity;
      if (role === 'sale') current.sale_cases += 1;
      if (role === 'purchase') current.purchase_cases += 1;
      map.set(key, current);
    });
  });
  return [...map.values()].sort((a, b) => b.weighted_score - a.weighted_score || b.cases - a.cases);
}
