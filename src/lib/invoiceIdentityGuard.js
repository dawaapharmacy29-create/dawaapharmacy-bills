function stableRecordId(row) {
  const value = row?.id ?? row?.base44_id ?? null;
  const text = value == null ? '' : String(value).trim();
  return text || null;
}

function parseTimestamp(value) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function rowFreshness(row) {
  return Math.max(
    parseTimestamp(row?.workflow_changed_at),
    parseTimestamp(row?.workflow_updated_at),
    parseTimestamp(row?.status_changed_at),
    parseTimestamp(row?.updated_at),
    parseTimestamp(row?.updated_date),
    parseTimestamp(row?.created_at),
    parseTimestamp(row?.created_date),
  );
}

function hasExplicitWorkflowStatus(row) {
  return typeof row?.workflow_status === 'string' && row.workflow_status.trim().length > 0;
}

function preferCanonicalRow(current, candidate) {
  if (!current) return candidate;

  const currentExplicitWorkflow = hasExplicitWorkflowStatus(current);
  const candidateExplicitWorkflow = hasExplicitWorkflowStatus(candidate);
  if (currentExplicitWorkflow !== candidateExplicitWorkflow) {
    return candidateExplicitWorkflow ? candidate : current;
  }

  const currentFreshness = rowFreshness(current);
  const candidateFreshness = rowFreshness(candidate);
  if (candidateFreshness > currentFreshness) return candidate;
  return current;
}

/**
 * Collapse only repeated transport/query rows that refer to the exact same
 * persistent invoice id. Never dedupe by invoice number: the same number may
 * legitimately exist in another branch, and legacy same-branch collisions must
 * remain visible for manual review.
 */
export function dedupeInvoiceRowsByStableId(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return Array.isArray(rows) ? rows : [];

  const output = [];
  const indexById = new Map();

  rows.forEach((row) => {
    const id = stableRecordId(row);
    if (!id) {
      output.push(row);
      return;
    }

    const existingIndex = indexById.get(id);
    if (existingIndex == null) {
      indexById.set(id, output.length);
      output.push(row);
      return;
    }

    output[existingIndex] = preferCanonicalRow(output[existingIndex], row);
  });

  return output;
}

/**
 * B-Connect number checks can inherit duplicate rows from server-side joins.
 * Collapse repeated rows only when their stable record id is identical. Keep
 * record_count unchanged because it is also used as an authorization/completeness
 * gate and may intentionally exceed the visible rows for the current user.
 */
export function dedupeBconnectGateRows(entries) {
  if (!Array.isArray(entries)) return entries;
  return entries.map((entry) => ({
    ...entry,
    rows: dedupeInvoiceRowsByStableId(Array.isArray(entry?.rows) ? entry.rows : []),
  }));
}
