const toNumber = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function explicitDiscountPercent(item = {}) {
  const value = toNumber(item.expected_discount ?? item.old_discount);
  return Math.min(100, Math.max(0, value));
}

export function independentReferenceUnitPrice(item = {}) {
  return Math.max(0, toNumber(
    item.public_price
    ?? item.reference_price
    ?? item.last_purchase_price
  ));
}

export function referenceUnitPrice(item = {}) {
  const independent = independentReferenceUnitPrice(item);
  if (independent > 0) return independent;
  return Math.max(0, toNumber(item.expected_unit_cost));
}

export function purchaseUnitCost(item = {}) {
  const explicitCost = Math.max(0, toNumber(
    item.expected_unit_cost
    ?? item.net_unit_cost
    ?? item.purchase_unit_cost
  ));
  if (explicitCost > 0) return explicitCost;

  const reference = referenceUnitPrice(item);
  if (reference <= 0) return 0;
  return reference * (1 - (explicitDiscountPercent(item) / 100));
}

export function purchaseLineTotal(item = {}, quantityValue = null) {
  const quantity = Math.max(0, toNumber(
    quantityValue ?? item.approved_quantity ?? item.requested_quantity ?? item.suggested_quantity
  ));
  return quantity * purchaseUnitCost(item);
}
