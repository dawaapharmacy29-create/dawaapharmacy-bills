/**
 * Read-only prioritisation for uploaded B-Connect evidence.
 * Decisions are made by the existing review policy. These functions never
 * authorize a database write or alter a reconciliation outcome.
 */
export function hasUploadedReturns(row) {
  const source = row?.bconnect;
  if (!source) return false;
  if (Array.isArray(source.items) && source.items.some((item) => Number(item.returned_quantity) > 0)) return true;
  return source.return_value !== null && source.return_value !== undefined &&
    Number.isFinite(Number(source.return_value)) && Number(source.return_value) > 0;
}

export function isReturnReviewed(decisions, key) {
  return decisions?.[key]?.action === 'reviewed';
}

export function needsReturnInspection(row, decisions, key) {
  return hasUploadedReturns(row) &&
    !isReturnReviewed(decisions, key) &&
    decisions?.[key]?.action !== 'accepted';
}

export function matchesReviewSearch(row, query) {
  const search = String(query || '').trim().toLowerCase();
  if (!search) return true;
  const source = row?.bconnect || {};
  const app = row?.app || {};
  const fields = [
    row?.number, source.supplier, app.supplier_name,
    source.user, app.entered_by_name, app.entered_by,
    source.serial, source.supplier_invoice_number, source.source_file,
    app.notes,
  ];
  if (fields.some((value) => String(value ?? '').toLowerCase().includes(search))) return true;
  return Array.isArray(source.items) && source.items.some(
    (item) => [item.name, item.code].some((value) => String(value ?? '').toLowerCase().includes(search))
  );
}

export function reviewQueuePriority(row, view) {
  // Hard problems and unexplained monetary discrepancies stay on top.
  if (view?.lane === 'investigate') return 0;
  if (view?.lane === 'explain') return 1;
  if (hasUploadedReturns(row)) return 2;
  if (view?.lane === 'correct') return 3;
  if (view?.lane === 'register') return 4;
  if (view?.lane === 'approve') return 5;
  return 9;
}

export function reviewAttentionSummary(rows, decisions = {}, keyForRow = (row) => String(row?.number ?? '')) {
  const data = { returnsTotal: 0, returnsToInspect: 0, returnsReviewed: 0 };
  for (const row of rows || []) {
    if (!hasUploadedReturns(row)) continue;
    data.returnsTotal += 1;
    if (isReturnReviewed(decisions, keyForRow(row))) data.returnsReviewed += 1;
    else if (needsReturnInspection(row, decisions, keyForRow(row))) data.returnsToInspect += 1;
  }
  return data;
}


/**
 * Recovered approvals are historical decisions, not fresh proofs. Do not
 * conceal an invoice that now carries a note, item return or new source
 * discrepancy even if its previous approval fingerprint still matches.
 */
export function canRestoreBConnectAcceptance(row, view) {
  if (!row?.app?.id || !row?.number) return false;
  if (view?.hasReturn || view?.hasNote || view?.returnIssue) return false;
  if (!['approve', 'clean'].includes(view?.lane)) return false;
  return row?.status === 'clean' ||
    (row?.identity === 'confirmed' && view?.fastAccept === true);
}
