function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function invoiceKey(value) {
  return text(value).replace(/\.0$/, '');
}

function unique(values = []) {
  return [...new Set(values.map(invoiceKey).filter(Boolean))];
}

function percent(done, total) {
  return total ? Number(((done / total) * 100).toFixed(1)) : 0;
}

function saleCoverage(lines = []) {
  const invoices = unique(lines.map((line) => line?.invoice));
  const covered = invoices.filter((invoice) => lines.some((line) => invoiceKey(line?.invoice) === invoice && text(line?.user)));
  const conflicts = invoices.filter((invoice) => lines.some((line) => invoiceKey(line?.invoice) === invoice && line?.invoice_header_conflict));
  return {
    total_invoices: invoices.length,
    covered_invoices: covered.length,
    missing_invoices: invoices.filter((invoice) => !covered.includes(invoice)),
    conflict_invoices: conflicts,
    coverage_percent: percent(covered.length, invoices.length),
  };
}

function purchaseCoverage(lines = []) {
  const invoices = unique(lines.map((line) => line?.invoice));
  const covered = invoices.filter((invoice) => lines.some((line) => invoiceKey(line?.invoice) === invoice && text(line?.user)));
  return {
    total_invoices: invoices.length,
    covered_invoices: covered.length,
    missing_invoices: invoices.filter((invoice) => !covered.includes(invoice)),
    conflict_invoices: [],
    coverage_percent: percent(covered.length, invoices.length),
  };
}

export function buildTransferSourceCoverage(sources = {}) {
  const shokrySale = saleCoverage(sources?.shokrySale?.items || []);
  const shamySale = saleCoverage(sources?.shamySale?.items || []);
  const shamyPurchase = purchaseCoverage(sources?.shamyPurchase?.items || []);
  const shokryPurchase = purchaseCoverage(sources?.shokryPurchase?.items || []);

  const sides = { shokrySale, shamySale, shamyPurchase, shokryPurchase };
  const total = Object.values(sides).reduce((sum, side) => sum + side.total_invoices, 0);
  const covered = Object.values(sides).reduce((sum, side) => sum + side.covered_invoices, 0);
  const conflicts = Object.values(sides).reduce((sum, side) => sum + side.conflict_invoices.length, 0);

  return {
    ...sides,
    overall: {
      total_invoices: total,
      covered_invoices: covered,
      coverage_percent: percent(covered, total),
      conflict_invoices: conflicts,
      ready_for_actor_attribution: total > 0 && covered === total && conflicts === 0,
    },
  };
}
