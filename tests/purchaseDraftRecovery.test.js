import test from 'node:test';
import assert from 'node:assert/strict';
import { orderMatchesPurchasePlan } from '../src/lib/purchaseDraftRecovery.js';

test('matches an existing draft only when product, quantity and unit cost match the current plan', () => {
  const plan = [
    { product_code: '10', product_name: 'A', buy_quantity: 2, unit_cost: 12.5 },
    { product_code: '20', product_name: 'B', buy_quantity: 1, unit_cost: 7 },
  ];
  const order = {
    items: [
      { product_code: '20', product_name: 'B', approved_quantity: 1, expected_unit_cost: 7 },
      { product_code: '10', product_name: 'A', approved_quantity: 2, expected_unit_cost: 12.5 },
    ],
  };
  assert.equal(orderMatchesPurchasePlan(order, plan), true);
});

test('rejects an existing draft when quantity or cost changed', () => {
  const plan = [{ product_code: '10', product_name: 'A', buy_quantity: 2, unit_cost: 12.5 }];
  assert.equal(orderMatchesPurchasePlan({
    items: [{ product_code: '10', product_name: 'A', approved_quantity: 3, expected_unit_cost: 12.5 }],
  }, plan), false);
  assert.equal(orderMatchesPurchasePlan({
    items: [{ product_code: '10', product_name: 'A', approved_quantity: 2, expected_unit_cost: 13 }],
  }, plan), false);
});

test('falls back to normalized product name when product code is missing', () => {
  const plan = [{ product_name: '  Panadol   Advance ', buy_quantity: 1, unit_cost: 5 }];
  const order = { items: [{ product_name: 'panadol advance', approved_quantity: 1, expected_unit_cost: 5 }] };
  assert.equal(orderMatchesPurchasePlan(order, plan), true);
});


test('can recover same products and quantities after historical costs are persisted', () => {
  const plan = [{ product_code: '10', product_name: 'A', buy_quantity: 2, unit_cost: 12.5 }];
  const order = { items: [{ product_code: '10', product_name: 'A', approved_quantity: 2, expected_unit_cost: 9.75 }] };
  assert.equal(orderMatchesPurchasePlan(order, plan, { compareCost: false }), true);
  assert.equal(orderMatchesPurchasePlan(order, plan), false);
});
