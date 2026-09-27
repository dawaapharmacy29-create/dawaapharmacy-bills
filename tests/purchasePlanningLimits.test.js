import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBudgetPlan, calculatePurchaseNeed } from '../src/lib/purchasePlanning.js';
import { independentReferenceUnitPrice, purchaseUnitCost } from '../src/lib/purchasePricing.js';

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


test('budget allocation protects the configured item minimum when possible', () => {
  const rows = [{
    id: 'a',
    product_name: 'Protected Item',
    approved_quantity: 10,
    requested_quantity: 10,
    expected_unit_cost: 10,
    minimum_order_quantity: 4,
    current_stock: 0,
    sales_30: 30,
  }];
  const plan = buildBudgetPlan(rows, 45);
  assert.equal(plan.rows[0].approved_quantity, 4);
  assert.equal(plan.rows[0].protected_minimum_quantity, 4);
  assert.equal(plan.protected_items_unmet, 0);
});

test('budget allocation reports an unmet configured minimum instead of hiding it', () => {
  const rows = [{
    id: 'a',
    product_name: 'Protected Item',
    approved_quantity: 10,
    requested_quantity: 10,
    expected_unit_cost: 10,
    minimum_order_quantity: 4,
    current_stock: 0,
    sales_30: 30,
  }];
  const plan = buildBudgetPlan(rows, 30);
  assert.equal(plan.protected_items_unmet, 1);
  assert.equal(plan.rows[0].protected_minimum_met, false);
});


test('saved product coverage target overrides the order default coverage', () => {
  const row = {
    product_name: 'Policy Coverage Item',
    current_stock: 0,
    sales_30: 30,
    target_coverage_days: 14,
  };
  const result = calculatePurchaseNeed(row, 7);
  assert.equal(result.target_coverage_days, 14);
  assert.equal(result.suggested_quantity, 14);
  assert.equal(result.coverage_policy_source, 'saved_product_policy');
});


test('net purchase cost is not discounted again when no independent reference price exists', () => {
  const item = { expected_unit_cost: 80, expected_discount: 20 };
  assert.equal(independentReferenceUnitPrice(item), 0);
  assert.equal(purchaseUnitCost(item), 80);
});

test('independent reference price remains separate from expected net cost', () => {
  const item = { last_purchase_price: 100, expected_unit_cost: 80, expected_discount: 20 };
  assert.equal(independentReferenceUnitPrice(item), 100);
  assert.equal(purchaseUnitCost(item), 80);
});
