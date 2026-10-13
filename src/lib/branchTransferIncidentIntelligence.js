function text(value) {
  return String(value ?? '').trim();
}

function first(values = []) {
  return Array.isArray(values) && values.length ? text(values[0]) : '';
}

function caseInvoice(item, side) {
  return first(side === 'sale' ? item?.sale_invoices : item?.purchase_invoices);
}

function caseDirection(item) {
  return `${item?.from || 'unknown'}::${item?.to || 'unknown'}`;
}

function issueScore(item) {
  return Number(item?.decision_intelligence?.issue_confidence?.score || 0);
}

function productCode(item) {
  return first(item?.sale_codes) || first(item?.purchase_codes) || '';
}

function incidentKindLabel(kind) {
  return {
    whole_sale_invoice_missing: 'فاتورة كاملة: الشراء ناقص',
    partial_sale_invoice_missing: 'شراء ناقص',
    whole_purchase_invoice_missing: 'فاتورة كاملة: البيع ناقص',
    partial_purchase_invoice_missing: 'بيع ناقص',
    unit_conversion: 'تحويل عبوة',
    quantity_mismatch: 'فرق كمية',
    code_mismatch: 'اختلاف كود',
    single_missing: 'طرف ناقص',
  }[kind] || 'تحتاج مراجعة';
}

function buildMissingInvoiceIncident({ key, side, invoice, cases, allCases }) {
  const type = side === 'sale' ? 'sale_without_purchase' : 'purchase_without_sale';
  const direction = caseDirection(cases[0]);
  const allInvoiceCases = allCases.filter((item) => caseDirection(item) === direction && caseInvoice(item, side) === invoice);
  const allMissing = allInvoiceCases.length > 0 && allInvoiceCases.every((item) => item.type === type);
  const multiple = cases.length >= 2;
  const whole = allMissing && multiple;
  const kind = side === 'sale'
    ? (whole ? 'whole_sale_invoice_missing' : 'partial_sale_invoice_missing')
    : (whole ? 'whole_purchase_invoice_missing' : 'partial_purchase_invoice_missing');
  const maxIssue = Math.max(...cases.map(issueScore), 0);
  const rootCauseConfidence = whole && cases.length >= 3 ? 96 : whole ? 90 : Math.max(72, maxIssue);
  const productNames = [...new Set(cases.map((item) => text(item.product_name)).filter(Boolean))];
  const productCodes = [...new Set(cases.map(productCode).filter(Boolean))];
  const from = cases[0]?.from;
  const to = cases[0]?.to;

  let summary;
  let recommendedCheck;
  if (side === 'sale' && whole) {
    summary = `كل ${cases.length} أصناف الظاهرة في فاتورة البيع ${invoice} بلا شراء مقابل في الملفات المحملة؛ الاحتمال الأقوى أن الفاتورة نفسها لم تُسجل في الفرع المستلم.`;
    recommendedCheck = `راجع فاتورة البيع ${invoice} مرة واحدة في الفرع المستلم بدل مراجعة ${cases.length} أصناف منفصلة.`;
  } else if (side === 'purchase' && whole) {
    summary = `كل ${cases.length} أصناف فاتورة الشراء ${invoice} بلا بيع مقابل في الملفات المحملة؛ راجع مصدر التحويل أو تصنيف الفاتورة.`;
    recommendedCheck = `راجع فاتورة الشراء ${invoice} ومصدرها مرة واحدة قبل اعتبار الأصناف أخطاء منفصلة.`;
  } else if (side === 'sale') {
    summary = `${cases.length} صنف من فاتورة البيع ${invoice} بلا شراء مقابل، بينما قد تكون أصناف أخرى من نفس الفاتورة مرتبطة بشكل طبيعي.`;
    recommendedCheck = `افتح فاتورة البيع ${invoice} وفاتورة/فواتير الشراء المقابلة وراجع الأصناف الناقصة فقط.`;
  } else {
    summary = `${cases.length} صنف في فاتورة الشراء ${invoice} بلا بيع مقابل في البيانات المحملة.`;
    recommendedCheck = `راجع مصدر فاتورة الشراء ${invoice} ثم ابحث عن فاتورة البيع المقابلة.`;
  }

  return {
    id: key,
    kind,
    label: incidentKindLabel(kind),
    from,
    to,
    side,
    invoice,
    case_ids: cases.map((item) => item.id),
    cases,
    product_count: productNames.length,
    product_names: productNames,
    product_codes: productCodes,
    line_issue_count: cases.length,
    severity: Math.max(...cases.map((item) => Number(item.severity || 0)), 0),
    issue_confidence: maxIssue,
    root_cause_confidence: rootCauseConfidence,
    file_discrepancy_confirmed: true,
    employee_error_confirmed: false,
    summary,
    recommended_check: recommendedCheck,
  };
}

function buildSingleIncident(item) {
  const kind = item.type === 'unit_conversion_review'
    ? 'unit_conversion'
    : item.type === 'quantity_mismatch'
      ? 'quantity_mismatch'
      : item.type === 'code_mismatch'
        ? 'code_mismatch'
        : 'single_missing';
  return {
    id: `case::${item.id}`,
    kind,
    label: incidentKindLabel(kind),
    from: item.from,
    to: item.to,
    side: null,
    invoice: caseInvoice(item, 'sale') || caseInvoice(item, 'purchase'),
    case_ids: [item.id],
    cases: [item],
    product_count: 1,
    product_names: [item.product_name].filter(Boolean),
    product_codes: [productCode(item)].filter(Boolean),
    line_issue_count: 1,
    severity: Number(item.severity || 0),
    issue_confidence: issueScore(item),
    root_cause_confidence: item.type === 'unit_conversion_review' ? 88 : issueScore(item),
    file_discrepancy_confirmed: item.type !== 'unit_conversion_review',
    employee_error_confirmed: false,
    summary: item.decision_intelligence?.summary || item.next_action || 'حالة تحتاج مراجعة.',
    recommended_check: item.decision_intelligence?.recommended_check || item.next_action || 'راجع المستندات المرتبطة بالحالة.',
  };
}

export function buildTransferIncidents(cases = []) {
  const actionable = cases.filter((item) => item.type !== 'matched');
  const grouped = new Map();
  const singles = [];

  actionable.forEach((item) => {
    let side = null;
    if (item.type === 'sale_without_purchase') side = 'sale';
    if (item.type === 'purchase_without_sale') side = 'purchase';
    const invoice = side ? caseInvoice(item, side) : '';
    if (!side || !invoice) {
      singles.push(buildSingleIncident(item));
      return;
    }
    const key = `${side}::${caseDirection(item)}::${invoice}`;
    if (!grouped.has(key)) grouped.set(key, { key, side, invoice, cases: [] });
    grouped.get(key).cases.push(item);
  });

  const incidents = [
    ...[...grouped.values()].map((group) => buildMissingInvoiceIncident({ ...group, allCases: cases })),
    ...singles,
  ];

  return incidents.sort((a, b) =>
    b.root_cause_confidence - a.root_cause_confidence
    || b.severity - a.severity
    || b.line_issue_count - a.line_issue_count,
  );
}

export function summarizeTransferIncidents(incidents = []) {
  return incidents.reduce((acc, incident) => {
    acc.total += 1;
    acc.line_issues += incident.line_issue_count || 0;
    if (incident.kind === 'whole_sale_invoice_missing' || incident.kind === 'whole_purchase_invoice_missing') acc.whole_invoice_missing += 1;
    if (incident.kind === 'unit_conversion') acc.unit_conversion += 1;
    if (incident.root_cause_confidence >= 90) acc.high_root_cause_confidence += 1;
    return acc;
  }, { total: 0, line_issues: 0, whole_invoice_missing: 0, unit_conversion: 0, high_root_cause_confidence: 0 });
}
