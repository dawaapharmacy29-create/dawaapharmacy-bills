export function purchaseBudgetGuard(totalValue, limitValue, warningAt = 90) {
  const total = Math.max(0, Number(totalValue || 0));
  const limit = Math.max(0, Number(limitValue || 0));
  if (!limit) return { status: 'no_limit', blocked: false, warning: false, total, limit, remaining: 0, over: 0, usage: 0 };
  const usage = (total / limit) * 100;
  const over = Math.max(0, total - limit);
  return {
    status: over > 0 ? 'blocked' : usage >= warningAt ? 'warning' : 'safe',
    blocked: over > 0,
    warning: over <= 0 && usage >= warningAt,
    total,
    limit,
    remaining: Math.max(0, limit - total),
    over,
    usage,
  };
}

export function invoiceValueGuard(expectedValue, actualValue, limitValue = 0, tolerancePercent = 2, toleranceValue = 100) {
  const expected = Math.max(0, Number(expectedValue || 0));
  const actual = Math.max(0, Number(actualValue || 0));
  const limit = Math.max(0, Number(limitValue || 0));
  const allowedDifference = Math.max(Math.max(0, Number(toleranceValue || 0)), expected * Math.max(0, Number(tolerancePercent || 0)) / 100);
  const varianceLimit = expected + allowedDifference;
  const effectiveLimit = limit > 0 ? Math.min(limit, varianceLimit) : varianceLimit;
  const difference = actual - expected;
  return {
    status: actual > effectiveLimit ? 'blocked' : difference > 0 ? 'review' : 'accepted',
    blocked: actual > effectiveLimit,
    needsReview: actual <= effectiveLimit && difference > 0,
    expected,
    actual,
    limit,
    allowedDifference,
    effectiveLimit,
    difference,
    differencePercent: expected > 0 ? difference / expected * 100 : 0,
  };
}
