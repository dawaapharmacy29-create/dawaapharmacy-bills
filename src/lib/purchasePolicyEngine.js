const toNumber = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function firstPositive(values = []) {
  for (const value of values) {
    const parsed = toNumber(value);
    if (parsed > 0) return parsed;
  }
  return 0;
}

export function resolveItemPurchaseLimits(item = {}) {
  const minimum = Math.max(0, firstPositive([
    item.minimum_order_quantity,
    item.min_order_quantity,
    item.item_min_quantity,
    item.min_quantity,
    item.moq_quantity,
  ]));
  const maximum = Math.max(0, firstPositive([
    item.maximum_order_quantity,
    item.max_order_quantity,
    item.item_max_quantity,
    item.max_quantity,
  ]));

  return {
    minimum,
    maximum,
    has_minimum: minimum > 0,
    has_maximum: maximum > 0,
    invalid_range: minimum > 0 && maximum > 0 && minimum > maximum,
  };
}

export function applyItemPurchaseLimits(quantityValue, item = {}, options = {}) {
  const quantity = Math.max(0, Math.floor(toNumber(quantityValue)));
  const limits = resolveItemPurchaseLimits(item);
  const reasons = [];

  if (limits.invalid_range) {
    return {
      input_quantity: quantity,
      quantity,
      ...limits,
      blocked: true,
      adjusted: false,
      status: 'invalid_limits',
      reasons: ['item_min_exceeds_max'],
    };
  }

  if (quantity <= 0) {
    return {
      input_quantity: quantity,
      quantity: 0,
      ...limits,
      blocked: false,
      adjusted: false,
      status: 'not_needed',
      reasons,
    };
  }

  let next = quantity;
  const enforceMinimum = options.enforce_minimum !== false;
  const enforceMaximum = options.enforce_maximum !== false;

  if (enforceMinimum && limits.has_minimum && next < limits.minimum) {
    next = Math.ceil(limits.minimum);
    reasons.push('raised_to_item_minimum');
  }
  if (enforceMaximum && limits.has_maximum && next > limits.maximum) {
    next = Math.floor(limits.maximum);
    reasons.push('capped_at_item_maximum');
  }

  return {
    input_quantity: quantity,
    quantity: Math.max(0, next),
    ...limits,
    blocked: false,
    adjusted: next !== quantity,
    status: reasons.length ? 'adjusted' : 'within_limits',
    reasons,
  };
}

export function resolveOrderValueLimits(policy = {}) {
  const minimum = Math.max(0, firstPositive([
    policy.minimum_order_value,
    policy.min_order_value,
    policy.order_minimum,
    policy.minimum_total,
  ]));
  const maximum = Math.max(0, firstPositive([
    policy.maximum_order_value,
    policy.max_order_value,
    policy.order_maximum,
    policy.maximum_total,
    policy.budget_limit,
    policy.budget,
  ]));

  return {
    minimum,
    maximum,
    has_minimum: minimum > 0,
    has_maximum: maximum > 0,
    invalid_range: minimum > 0 && maximum > 0 && minimum > maximum,
  };
}

export function evaluateOrderValue(totalValue, policy = {}, options = {}) {
  const total = Math.max(0, toNumber(totalValue));
  const limits = resolveOrderValueLimits(policy);
  const warnAtPercent = Math.min(100, Math.max(1, toNumber(options.warn_at_percent || 90)));

  if (limits.invalid_range) {
    return {
      total,
      ...limits,
      status: 'invalid_limits',
      blocked: true,
      warning: false,
      below_minimum: false,
      above_maximum: false,
      remaining_to_minimum: 0,
      remaining_to_maximum: 0,
      usage_percent: 0,
      reasons: ['order_min_exceeds_max'],
    };
  }

  const belowMinimum = limits.has_minimum && total < limits.minimum;
  const aboveMaximum = limits.has_maximum && total > limits.maximum;
  const usagePercent = limits.has_maximum ? (total / limits.maximum) * 100 : 0;
  const nearMaximum = limits.has_maximum && !aboveMaximum && usagePercent >= warnAtPercent;

  let status = 'safe';
  if (aboveMaximum) status = 'above_maximum';
  else if (belowMinimum) status = 'below_minimum';
  else if (nearMaximum) status = 'near_maximum';
  else if (!limits.has_minimum && !limits.has_maximum) status = 'no_limits';

  return {
    total,
    ...limits,
    status,
    blocked: aboveMaximum,
    warning: belowMinimum || nearMaximum,
    below_minimum: belowMinimum,
    above_maximum: aboveMaximum,
    remaining_to_minimum: belowMinimum ? limits.minimum - total : 0,
    remaining_to_maximum: limits.has_maximum ? Math.max(0, limits.maximum - total) : 0,
    usage_percent: usagePercent,
    reasons: [
      ...(belowMinimum ? ['order_below_minimum'] : []),
      ...(nearMaximum ? ['order_near_maximum'] : []),
      ...(aboveMaximum ? ['order_above_maximum'] : []),
    ],
  };
}
