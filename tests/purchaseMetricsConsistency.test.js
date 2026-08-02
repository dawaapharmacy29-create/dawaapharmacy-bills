import test from 'node:test';
import assert from 'node:assert/strict';
import {
  comparePurchaseMetrics,
  normalizePurchaseMetrics,
  validatePurchaseMetricRelations,
} from '../src/lib/purchaseMetricsConsistency.js';

test('normalizes missing and invalid values safely', () => {
  assert.deepEqual(normalizePurchaseMetrics({ invoice_count: '12', gross_purchases: 'bad' }), {
    invoice_count: 12,
    pending_count: 0,
    gross_purchases: 0,
    net_purchases: 0,
    excluded_purchases: 0,
    returned_value: 0,
  });
});

test('detects matching metrics with money tolerance', () => {
  const result = comparePurchaseMetrics(
    { invoice_count: 10, pending_count: 2, gross_purchases: 100, net_purchases: 90, excluded_purchases: 5, returned_value: 5 },
    { invoice_count: 10, pending_count: 2, gross_purchases: 100.004, net_purchases: 90, excluded_purchases: 5, returned_value: 5 },
  );
  assert.equal(result.matches, true);
  assert.deepEqual(result.mismatchKeys, []);
});

test('detects count and monetary mismatches', () => {
  const result = comparePurchaseMetrics(
    { invoice_count: 10, pending_count: 2, gross_purchases: 100 },
    { invoice_count: 9, pending_count: 1, gross_purchases: 98 },
  );
  assert.equal(result.matches, false);
  assert.deepEqual(result.mismatchKeys, ['invoice_count', 'pending_count', 'gross_purchases']);
});

test('validates the purchase net formula', () => {
  const valid = validatePurchaseMetricRelations({
    invoice_count: 20,
    pending_count: 3,
    gross_purchases: 1000,
    excluded_purchases: 100,
    returned_value: 50,
    net_purchases: 850,
  });
  assert.equal(valid.valid, true);

  const invalid = validatePurchaseMetricRelations({
    invoice_count: 20,
    pending_count: 21,
    gross_purchases: 1000,
    excluded_purchases: 100,
    returned_value: 50,
    net_purchases: 900,
  });
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.issues.map((issue) => issue.code), [
    'pending_exceeds_total',
    'net_formula_mismatch',
  ]);
});
