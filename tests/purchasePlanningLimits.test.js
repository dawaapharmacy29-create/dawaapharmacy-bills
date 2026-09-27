import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePurchaseNeed } from '../src/lib/purchasePlanning.js';

test('purchase planning raises a real need to the configured item minimum', () => {
  const row = {
    product_name: 'Test Item',
    current_stock: 6,
    sales_30: 30,
    minimum_order_quantity: 4,
  };
  const result = calculatePurchaseNeed(row, 7);
  assert.equal(result.raw_suggested_quantity, 1);
  assert.equal(result.suggested_quantity, 4);
  assert.equal(result.purchase_limit_status, 'adjusted');
  assert.deepEqual(result.purchase_limit_reasons, ['raised_to_item_minimum']);
});

test('purchase planning caps a real need at the configured item maximum', () => {
  const row = {
    product_name: 'Fast Item',
    current_stock: 0,
    sales_30: 60,
    maximum_order_quantity: 5,
  };
  const result = calculatePurchaseNeed(row, 7);
  assert.equal(result.raw_suggested_quantity, 14);
  assert.equal(result.suggested_quantity, 5);
  assert.equal(result.purchase_limit_status, 'adjusted');
  assert.deepEqual(result.purchase_limit_reasons, ['capped_at_item_maximum']);
});

test('item minimum never creates demand when calculated need is zero', () => {
  const row = {
    product_name: 'Covered Item',
    current_stock: 20,
    sales_30: 30,
    minimum_order_quantity: 5,
  };
  const result = calculatePurchaseNeed(row, 7);
  assert.equal(result.raw_suggested_quantity, 0);
  assert.equal(result.suggested_quantity, 0);
  assert.equal(result.purchase_limit_status, 'not_needed');
});
