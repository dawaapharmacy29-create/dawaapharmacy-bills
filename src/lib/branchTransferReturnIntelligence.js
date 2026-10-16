function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function rounded(value) {
  return Number(numeric(value).toFixed(6));
}

export function summarizeTransferReturnEvidence(lines = [], effectiveQty = null) {
  let grossQty = 0;
  let returnQty = 0;
  let hasExplicitGross = false;
  let hasReturnEvidence = false;

  (lines || []).forEach((line) => {
    const raw = line?.raw || line || {};
    const rawReturn = numeric(raw.return_qty);
    const rawGross = raw.gross_qty;
    const lineNet = numeric(line?.qty ?? raw.net_qty ?? raw.qty);

    if (rawGross != null && Number.isFinite(Number(rawGross))) {
      grossQty += numeric(rawGross);
      hasExplicitGross = true;
    } else {
      grossQty += lineNet + rawReturn;
    }

    if (rawReturn > 0) {
      hasReturnEvidence = true;
      returnQty += rawReturn;
    }
  });

  const netQty = effectiveQty == null
    ? Math.max(0, grossQty - returnQty)
    : numeric(effectiveQty);

  if (!hasExplicitGross && !hasReturnEvidence && !lines?.length) grossQty = netQty;

  return {
    has_return: hasReturnEvidence,
    gross_qty: rounded(grossQty),
    return_qty: rounded(returnQty),
    net_qty: rounded(netQty),
  };
}

export function formatTransferReturnEvidence(summary, { movement = 'الحركة', unit = '' } = {}) {
  if (!summary?.has_return) return '';
  const unitText = unit ? ` ${unit}` : '';
  return `صافي ${movement} ${summary.net_qty}${unitText} = ${summary.gross_qty} مسجل − ${summary.return_qty} مرتجع`;
}
