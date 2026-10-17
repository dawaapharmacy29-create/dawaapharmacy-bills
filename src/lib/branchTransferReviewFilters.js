function text(value) {
  return String(value ?? '').trim().toLowerCase();
}

function firstCase(incident) {
  return incident?.cases?.[0] || {};
}

function branchToken(value) {
  const v = text(value);
  if (v.includes('الشامي') || v.includes('shamy')) return 'shamy';
  if (v.includes('ابو العزم') || v.includes('أبو العزم') || v.includes('شكري') || v.includes('shokry')) return 'shokry';
  return 'unknown';
}

export function incidentDirection(incident) {
  const from = branchToken(incident?.from || firstCase(incident)?.from);
  const to = branchToken(incident?.to || firstCase(incident)?.to);
  if (from === 'shokry' && to === 'shamy') return 'shokry_to_shamy';
  if (from === 'shamy' && to === 'shokry') return 'shamy_to_shokry';
  return 'unknown';
}

export function incidentIssue(incident) {
  const item = firstCase(incident);
  const kind = text(incident?.kind);
  const type = text(item?.type);

  if (incident?.operational_lane === 'waiting') return 'evidence';
  if (kind === 'code_mismatch' || type === 'code_mismatch' || item?.product_identity_conflict) return 'code';
  if (
    kind === 'unit_conversion' || type === 'unit_conversion_review' ||
    item?.mixed_units_detected || item?.unsafe_unit_conversion_blocked ||
    item?.packaging_conflict || item?.packaging_profile?.status === 'conflict' ||
    item?.packaging_profile_candidate
  ) return 'unit_packaging';
  if (kind === 'quantity_mismatch' || type === 'quantity_mismatch') return 'quantity';
  if (
    ['whole_sale_invoice_missing', 'partial_sale_invoice_missing', 'whole_purchase_invoice_missing', 'partial_purchase_invoice_missing', 'single_missing'].includes(kind) ||
    ['sale_without_purchase', 'purchase_without_sale'].includes(type)
  ) return 'missing_side';
  return 'other';
}

export function incidentMatchesBranch(incident, branch) {
  return branch === 'all' || incidentDirection(incident) === branch;
}

export function incidentMatchesIssue(incident, issue) {
  return issue === 'all' || incidentIssue(incident) === issue;
}

export function countByBranch(incidents = []) {
  return incidents.reduce((acc, incident) => {
    acc.all += 1;
    const key = incidentDirection(incident);
    if (key in acc) acc[key] += 1;
    return acc;
  }, { all: 0, shokry_to_shamy: 0, shamy_to_shokry: 0 });
}

export function countByIssue(incidents = []) {
  return incidents.reduce((acc, incident) => {
    acc.all += 1;
    const key = incidentIssue(incident);
    if (key in acc) acc[key] += 1;
    else acc.other += 1;
    return acc;
  }, { all: 0, missing_side: 0, quantity: 0, code: 0, unit_packaging: 0, evidence: 0, other: 0 });
}
