import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSingleSupplierScenarios,
  combineSingleSupplierScenarioSets,
  buildSupplierFinancialRows,
  buildSupplierGroups,
  mergePlanWithHistory,
} from '../src/lib/purchaseSupplierFinancials.js';

const historyRows = [
  {
    product_code: '1',
    product_name: 'A',
    historical_supplier: 'مخزن سونيستا',
    historical_effective_unit_cost: 80,
    historical_last_purchase_date: '2026-09-20',
    unit_cost: 90,
  },
  {
    product_code: '2',
    product_name: 'B',
    historical_supplier: 'فارما',
    historical_effective_unit_cost: 50,
    unit_cost: 55,
  },
];

test('historical average cost becomes the planning reference when available', () => {
  const rows = mergePlanWithHistory([
    { product_code: '1', product_name: 'A', buy_quantity: 3, unit_cost: 95 },
  ], historyRows);
  assert.equal(rows[0].planning_reference_unit_cost, 80);
  assert.equal(rows[0].planning_reference_total, 240);
  assert.equal(rows[0].planning_cost_source, 'historical_average');
  assert.equal(rows[0].historical_supplier, 'مخزن سونيستا');
});

test('current supplier offer takes precedence over historical average', () => {
  const decision = {
    items: [{
      item_id: 'x',
      product_code: '1',
      product_name: 'A',
      needed_qty: 3,
      recommended: {
        supplier_name: 'فارما',
        effective_unit_cost: 70,
        net_unit_cost: 72,
        cash_cost: 216,
        earned_bonus_units: 1,
      },
      alternatives: [],
    }],
  };
  const rows = buildSupplierFinancialRows({ decision, historyRows, branch: 'دواء شكري' });
  assert.equal(rows[0].supplier_name, 'فارما');
  assert.equal(rows[0].cost_source, 'current_offer');
  assert.equal(rows[0].unit_cost, 70);
  assert.equal(rows[0].cash_cost, 216);
  assert.equal(rows[0].price_verified, true);
});

test('historical supplier is used as reference when there is no current offer', () => {
  const decision = {
    items: [{
      item_id: 'x',
      product_code: '2',
      product_name: 'B',
      needed_qty: 4,
      recommended: null,
      alternatives: [],
    }],
  };
  const rows = buildSupplierFinancialRows({ decision, historyRows, branch: 'دواء الشامي' });
  assert.equal(rows[0].supplier_name, 'فارما');
  assert.equal(rows[0].cost_source, 'historical_average');
  assert.equal(rows[0].unit_cost, 50);
  assert.equal(rows[0].cash_cost, 200);
  assert.equal(rows[0].price_verified, false);
});

test('supplier groups preserve verified versus historical-reference counts', () => {
  const groups = buildSupplierGroups([
    { supplier_name: 'فارما', quantity: 2, cash_cost: 100, cost_source: 'current_offer', unit_cost: 50 },
    { supplier_name: 'فارما', quantity: 3, cash_cost: 120, cost_source: 'historical_average', unit_cost: 40 },
  ]);
  assert.equal(groups[0].items_count, 2);
  assert.equal(groups[0].current_offer_items, 1);
  assert.equal(groups[0].historical_reference_items, 1);
  assert.equal(groups[0].estimated_cash_total, 220);
});

test('single supplier scenarios show missing items instead of pretending full coverage', () => {
  const decision = {
    items: [
      {
        product_code: '1',
        product_name: 'A',
        needed_qty: 2,
        recommended: { supplier_name: 'مخزن سونيستا', effective_unit_cost: 75, cash_cost: 150 },
        alternatives: [{ supplier_name: 'فارما', effective_unit_cost: 78, cash_cost: 156 }],
      },
      {
        product_code: '2',
        product_name: 'B',
        needed_qty: 3,
        recommended: null,
        alternatives: [],
      },
    ],
  };

  const scenarios = buildSingleSupplierScenarios({ decision, historyRows, branch: 'دواء شكري' });
  const pharma = scenarios.find((row) => row.supplier_name === 'فارما');
  assert.ok(pharma);
  assert.equal(pharma.current_offer_items, 1);
  assert.equal(pharma.historical_reference_items, 1);
  assert.equal(pharma.missing_items, 0);

  const sonista = scenarios.find((row) => row.supplier_name === 'مخزن سونيستا');
  assert.ok(sonista);
  assert.equal(sonista.current_offer_items, 1);
  assert.equal(sonista.missing_items, 1);
});


test('combines one-supplier coverage across both branch drafts', () => {
  const combined = combineSingleSupplierScenarioSets([
    [{
      supplier_name: 'فارما',
      items_count: 2,
      current_offer_items: 1,
      historical_reference_items: 1,
      missing_items: 0,
      estimated_total: 200,
      rows: [{ branch: 'دواء شكري' }, { branch: 'دواء شكري' }],
    }],
    [{
      supplier_name: 'فارما',
      items_count: 3,
      current_offer_items: 2,
      historical_reference_items: 0,
      missing_items: 1,
      estimated_total: 300,
      rows: [{ branch: 'دواء الشامي' }, { branch: 'دواء الشامي' }, { branch: 'دواء الشامي' }],
    }],
  ]);

  assert.equal(combined[0].supplier_name, 'فارما');
  assert.equal(combined[0].items_count, 5);
  assert.equal(combined[0].current_offer_items, 3);
  assert.equal(combined[0].historical_reference_items, 1);
  assert.equal(combined[0].missing_items, 1);
  assert.equal(combined[0].estimated_total, 500);
  assert.equal(Math.round(combined[0].current_coverage_percent), 60);
  assert.equal(Math.round(combined[0].reference_coverage_percent), 80);
});


test('uses saved draft cost and discount after historical fallbacks are exhausted', () => {
  const decision = {
    items: [{
      item_id: 'x',
      product_code: '3',
      product_name: 'C',
      needed_qty: 5,
      recommended: null,
      alternatives: [],
    }],
  };
  const rows = buildSupplierFinancialRows({
    decision,
    historyRows: [{ product_code: '3', product_name: 'C', unit_cost: 0 }],
    orderItems: [{
      product_code: '3',
      product_name: 'C',
      expected_unit_cost: 42,
      expected_discount: 18,
      public_price: 60,
    }],
    branch: 'دواء شكري',
  });

  assert.equal(rows[0].cost_source, 'draft_saved_cost');
  assert.equal(rows[0].unit_cost, 42);
  assert.equal(rows[0].cash_cost, 210);
  assert.equal(rows[0].discount_percent, 18);
});
