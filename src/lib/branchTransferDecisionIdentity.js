function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function unique(values = []) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function exactCode(item) {
  const codes = unique([...(item?.sale_codes || []), ...(item?.purchase_codes || [])]);
  return codes.length === 1 ? codes[0] : null;
}

function direction(item) {
  return `${text(item?.from || 'unknown')}::${text(item?.to || 'unknown')}`;
}

export function transferDecisionIdentityKeys(item = {}) {
  const code = exactCode(item) || text(item?.product_name || 'unknown-product').toLowerCase();
  const prefix = `transfer-decision::${direction(item)}::${code}`;
  const saleInvoices = unique(item?.sale_invoices || []);
  const purchaseInvoices = unique(item?.purchase_invoices || []);
  const keys = [];
  if (item?.id) keys.push(text(item.id));
  saleInvoices.forEach((invoice) => keys.push(`${prefix}::sale::${invoice}`));
  purchaseInvoices.forEach((invoice) => keys.push(`${prefix}::purchase::${invoice}`));
  if (!saleInvoices.length && !purchaseInvoices.length && item?.day_key) keys.push(`${prefix}::day::${text(item.day_key)}`);
  return unique(keys);
}

export function findTransferDecision(item, decisions = {}) {
  for (const key of transferDecisionIdentityKeys(item)) {
    if (decisions[key]) return decisions[key];
  }
  return null;
}

export function writeTransferDecision(decisions = {}, item = {}, decision = {}) {
  const next = { ...decisions };
  transferDecisionIdentityKeys(item).forEach((key) => { next[key] = decision; });
  return next;
}
