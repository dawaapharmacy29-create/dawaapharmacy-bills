function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function sourceIdentity(row = {}) {
  return text(row.source_fingerprint || row.source_file || '');
}

function semanticFingerprint(row = {}, side = '') {
  return [
    side,
    text(row.invoice || row.invoice_number || row.serial),
    text(row.code || row.product_code || row.item_code || row.barcode),
    text(row.product_name || row.item_name || row.product || row.item).toLowerCase(),
    String(Number(row.qty ?? row.quantity ?? row.count ?? 0)),
    text(row.unit || row.sale_unit || row.purchase_unit).toLowerCase(),
    text(row.date || row.datetime || row.created_at),
    text(row.user || row.doctor || row.employee || row.entered_by),
    text(row.expiration_raw || row.expiration || row.expiry),
  ].join('::');
}

export function preserveRepeatedRowsWithinSource(rows = [], side = '') {
  const prepared = [];
  const grouped = new Map();

  rows.forEach((row) => {
    const source = sourceIdentity(row);
    if (!source) {
      prepared.push({ ...row });
      return;
    }
    const key = `${source}::${semanticFingerprint(row, side)}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        row: { ...row },
        evidenceRows: [row],
      });
      return;
    }
    current.evidenceRows.push(row);
  });

  grouped.forEach(({ row, evidenceRows }) => {
    if (evidenceRows.length === 1) {
      prepared.push(row);
      return;
    }
    const totalQty = evidenceRows.reduce((sum, item) => sum + Math.abs(Number(item.qty ?? item.quantity ?? item.count ?? 0) || 0), 0);
    prepared.push({
      ...row,
      qty: totalQty,
      evidence_row_count: evidenceRows.length,
      evidence_rows: evidenceRows.map((item) => ({
        row_number: item.row_number ?? item.row ?? null,
        qty: Number(item.qty ?? item.quantity ?? item.count ?? 0) || 0,
        expiration_raw: item.expiration_raw ?? item.expiration ?? item.expiry ?? null,
      })),
      consolidated_identical_rows: true,
    });
  });

  return prepared;
}

export function prepareTransferRawEvidence(sales = [], purchases = []) {
  return {
    sales: preserveRepeatedRowsWithinSource(sales, 'sale'),
    purchases: preserveRepeatedRowsWithinSource(purchases, 'purchase'),
  };
}
