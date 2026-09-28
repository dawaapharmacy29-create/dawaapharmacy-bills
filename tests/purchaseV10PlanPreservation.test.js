import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePurchaseCandidates } from '../src/api/smartPurchaseApi.js';

test('V10 preserved plan keeps exact approved quantities without coverage recalculation', () => {
  const result = preparePurchaseCandidates({
    preserve_plan: true,
    coverage_days: 30,
    enforce_budget: true,
    budget_limit: 1,
    rows: [
      {
        product_code: 'A',
        product_name: 'Exact V10 Item',
        approved_quantity: 6,
        requested_quantity: 6,
        suggested_quantity: 99,
        current_stock: 0,
        sales_30: 900,
      },
      {
        product_code: 'B',
        product_name: 'Fractional Transfer-Aware Item',
        approved_quantity: 1.5,
        requested_quantity: 1.5,
        current_stock: 0.5,
        sales_30: 300,
      },
    ],
  });

  assert.equal(result.calculation_method, 'v10_preserved_plan');
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].approved_quantity, 6);
  assert.equal(result.rows[0].suggested_quantity, 6);
  assert.equal(result.rows[1].approved_quantity, 1.5);
  assert.equal(result.rows[1].suggested_quantity, 1.5);
});

test('V10 preserved plan accepts budget_quantity fallback without inventing coverage demand', () => {
  const result = preparePurchaseCandidates({
    preserve_plan: true,
    coverage_days: 999,
    rows: [{
      product_code: 'C',
      product_name: 'Budget Quantity Item',
      budget_quantity: 3,
      current_stock: 0,
      sales_30: 10000,
    }],
  });

  assert.equal(result.rows[0].approved_quantity, 3);
  assert.equal(result.rows[0].requested_quantity, 3);
  assert.equal(result.rows[0].suggested_quantity, 3);
});

test('V10 preserved plan drops zero rows and rejects an empty executable plan', () => {
  assert.throws(() => preparePurchaseCandidates({
    preserve_plan: true,
    rows: [{
      product_code: 'Z',
      product_name: 'Zero Item',
      approved_quantity: 0,
    }],
  }), /خطة V10 لا تحتوي على أصناف صالحة/);
});

test('legacy import path still uses coverage calculation when preserve_plan is false', () => {
  const result = preparePurchaseCandidates({
    preserve_plan: false,
    coverage_days: 7,
    rows: [{
      product_code: 'L',
      product_name: 'Legacy Item',
      current_stock: 0,
      sales_30: 30,
    }],
  });

  assert.equal(result.calculation_method, 'unified_final_coverage_v3');
  assert.equal(result.rows[0].suggested_quantity, 7);
});
