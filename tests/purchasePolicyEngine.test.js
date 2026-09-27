import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyItemPurchaseLimits,
  evaluateOrderValue,
  resolveItemPurchaseLimits,
  resolveOrderValueLimits,
} from '../src/lib/purchasePolicyEngine.js';

test('resolves item min/max aliases without inventing limits', () => {
  assert.deepEqual(resolveItemPurchaseLimits({ min_quantity: 3, max_quantity: 12 }), {
    minimum: 3,
    maximum: 12,
    has_minimum: true,
    has_maximum: true,
    invalid_range: false,
  });
  assert.equal(resolveItemPurchaseLimits({}).has_minimum, false);
});

test('raises a positive purchase need to the item minimum', () => {
  const result = applyItemPurchaseLimits(1, { minimum_order_quantity: 4 });
  assert.equal(result.quantity, 4);
  assert.equal(result.adjusted, true);
  assert.deepEqual(result.reasons, ['raised_to_item_minimum']);
});

test('does not force an item into the order when calculated need is zero', () => {
  const result = applyItemPurchaseLimits(0, { minimum_order_quantity: 4 });
  assert.equal(result.quantity, 0);
  assert.equal(result.status, 'not_needed');
});

test('caps quantity at item maximum', () => {
  const result = applyItemPurchaseLimits(15, { maximum_order_quantity: 8 });
  assert.equal(result.quantity, 8);
  assert.deepEqual(result.reasons, ['capped_at_item_maximum']);
});

test('blocks invalid item ranges', () => {
  const result = applyItemPurchaseLimits(5, { min_quantity: 10, max_quantity: 4 });
  assert.equal(result.blocked, true);
  assert.equal(result.status, 'invalid_limits');
});

test('resolves order value limits with budget as maximum fallback', () => {
  assert.deepEqual(resolveOrderValueLimits({ minimum_order_value: 5000, budget: 20000 }), {
    minimum: 5000,
    maximum: 20000,
    has_minimum: true,
    has_maximum: true,
    invalid_range: false,
  });
});

test('evaluates below-minimum, near-maximum and above-maximum order values', () => {
  const policy = { minimum_order_value: 5000, maximum_order_value: 20000 };

  const below = evaluateOrderValue(3000, policy);
  assert.equal(below.status, 'below_minimum');
  assert.equal(below.blocked, false);
  assert.equal(below.remaining_to_minimum, 2000);

  const near = evaluateOrderValue(18500, policy);
  assert.equal(near.status, 'near_maximum');
  assert.equal(near.warning, true);

  const above = evaluateOrderValue(21000, policy);
  assert.equal(above.status, 'above_maximum');
  assert.equal(above.blocked, true);
});

test('rejects an invalid order range', () => {
  const result = evaluateOrderValue(7000, { minimum_order_value: 10000, maximum_order_value: 5000 });
  assert.equal(result.status, 'invalid_limits');
  assert.equal(result.blocked, true);
});
