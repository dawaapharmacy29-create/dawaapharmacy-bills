import test from 'node:test';
import assert from 'node:assert/strict';
import {
  explicitDiscountPercent,
  purchaseLineTotal,
  purchaseUnitCost,
  referenceUnitPrice,
} from '../src/lib/purchasePricing.js';

test('uses expected_unit_cost as the canonical purchase cost without discounting it twice', () => {
  const item = { expected_unit_cost: 80, expected_discount: 20, last_purchase_price: 100 };
  assert.equal(purchaseUnitCost(item), 80);
  assert.equal(purchaseLineTotal({ ...item, approved_quantity: 3 }), 240);
});

test('derives purchase cost from reference price only when explicit unit cost is absent', () => {
  const item = { last_purchase_price: 100, expected_discount: 20 };
  assert.equal(purchaseUnitCost(item), 80);
});

test('does not invent a default discount', () => {
  const item = { last_purchase_price: 100 };
  assert.equal(explicitDiscountPercent(item), 0);
  assert.equal(purchaseUnitCost(item), 100);
});

test('keeps a reference price available for display', () => {
  assert.equal(referenceUnitPrice({ last_purchase_price: 125, expected_unit_cost: 90 }), 125);
});
