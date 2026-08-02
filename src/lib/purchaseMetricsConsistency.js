const METRIC_KEYS = [
  'invoice_count',
  'pending_count',
  'gross_purchases',
  'net_purchases',
  'excluded_purchases',
  'returned_value',
];

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizePurchaseMetrics(metrics = {}) {
  return Object.fromEntries(METRIC_KEYS.map((key) => [key, number(metrics[key])]));
}

export function comparePurchaseMetrics(primary = {}, secondary = {}, options = {}) {
  const left = normalizePurchaseMetrics(primary);
  const right = normalizePurchaseMetrics(secondary);
  const moneyTolerance = Number.isFinite(Number(options.moneyTolerance))
    ? Math.max(Number(options.moneyTolerance), 0)
    : 0.01;

  const differences = METRIC_KEYS.map((key) => {
    const delta = left[key] - right[key];
    const tolerance = key.endsWith('_count') ? 0 : moneyTolerance;
    return {
      key,
      primary: left[key],
      secondary: right[key],
      delta,
      matches: Math.abs(delta) <= tolerance,
    };
  });

  return {
    matches: differences.every((item) => item.matches),
    differences,
    mismatchKeys: differences.filter((item) => !item.matches).map((item) => item.key),
  };
}

export function validatePurchaseMetricRelations(metrics = {}, options = {}) {
  const value = normalizePurchaseMetrics(metrics);
  const tolerance = Number.isFinite(Number(options.moneyTolerance))
    ? Math.max(Number(options.moneyTolerance), 0)
    : 0.01;
  const issues = [];

  if (value.pending_count > value.invoice_count) {
    issues.push({ key: 'pending_count', code: 'pending_exceeds_total' });
  }

  if (value.net_purchases - value.gross_purchases > tolerance) {
    issues.push({ key: 'net_purchases', code: 'net_exceeds_gross' });
  }

  if (value.excluded_purchases < 0 || value.returned_value < 0) {
    issues.push({ key: 'adjustments', code: 'negative_adjustment' });
  }

  const expectedNet = value.gross_purchases - value.excluded_purchases - value.returned_value;
  if (Math.abs(value.net_purchases - expectedNet) > tolerance) {
    issues.push({
      key: 'net_purchases',
      code: 'net_formula_mismatch',
      expected: expectedNet,
      actual: value.net_purchases,
      delta: value.net_purchases - expectedNet,
    });
  }

  return { valid: issues.length === 0, issues, normalized: value };
}

export { METRIC_KEYS };
