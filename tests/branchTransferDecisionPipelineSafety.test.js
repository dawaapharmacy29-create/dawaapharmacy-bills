import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLearnedUnitRules, learnUnitRule } from '../src/lib/branchTransferUnitRules.js';
import { completeResidualBalancedJourneys } from '../src/lib/branchTransferResidualJourneyCompletion.js';
import { settleAggregateProductJourneys } from '../src/lib/branchTransferAggregateJourneySettlement.js';

function line(timestamp, qty, extra = {}) {
  return { timestamp_ms: new Date(timestamp).getTime(), qty, ...extra };
}

function base(overrides = {}) {
  return {
    id: 'case',
    type: 'quantity_mismatch',
    severity: 85,
    from: 'shamy',
    to: 'shokry',
    product_name: 'TEST PRODUCT',
    sale_codes: ['100'],
    purchase_codes: ['100'],
    sale_qty: 0,
    purchase_qty: 0,
    sale_units: [],
    purchase_units: [],
    sale_lines: [],
    purchase_lines: [],
    sale_invoices: [],
    purchase_invoices: [],
    ...overrides,
  };
}

test('a likely unit conversion is not auto-closed by late-registration settlement before approval', () => {
  const conversion = base({
    id: 'conversion',
    sale_qty: 3,
    purchase_qty: 1,
    sale_units: ['شريط'],
    purchase_units: ['علبة'],
    sale_lines: [line('2026-10-10T10:00:00', 3)],
    purchase_lines: [line('2026-10-10T10:10:00', 1)],
  });
  const latePurchase = base({
    id: 'late',
    type: 'purchase_without_sale',
    sale_qty: 0,
    purchase_qty: 2,
    sale_codes: [],
    purchase_units: ['علبة'],
    purchase_lines: [line('2026-10-10T12:00:00', 2)],
  });
  const unitAware = applyLearnedUnitRules([conversion, latePurchase], {});
  assert.equal(unitAware[0].type, 'unit_conversion_review');
  const residual = completeResidualBalancedJourneys(unitAware);
  const settled = settleAggregateProductJourneys(residual);
  assert.equal(settled.some((item) => item.id === 'conversion' && item.type === 'unit_conversion_review'), true);
  assert.equal(settled.some((item) => item.aggregate_journey_settled), false);
});

test('after a unit rule is learned, an extra later purchase remains visible instead of being absorbed into the solved conversion', () => {
  const conversion = base({
    id: 'conversion',
    sale_qty: 3,
    purchase_qty: 1,
    sale_units: ['شريط'],
    purchase_units: ['علبة'],
    sale_lines: [line('2026-10-10T10:00:00', 3)],
    purchase_lines: [line('2026-10-10T10:10:00', 1)],
  });
  const suggestionRules = learnUnitRule({ ...conversion, type: 'unit_conversion_review', unit_conversion_evidence: { ratio: 3 } }, {});
  const latePurchase = base({
    id: 'late',
    type: 'purchase_without_sale',
    sale_qty: 0,
    purchase_qty: 1,
    sale_codes: [],
    purchase_units: ['علبة'],
    purchase_lines: [line('2026-10-10T12:00:00', 1)],
  });
  const unitAware = applyLearnedUnitRules([conversion, latePurchase], suggestionRules);
  assert.equal(unitAware[0].type, 'matched');
  const settled = settleAggregateProductJourneys(completeResidualBalancedJourneys(unitAware));
  assert.equal(settled.some((item) => item.id === 'late' && item.type === 'purchase_without_sale'), true);
});

test('net quantity after return can be completed by one later exact-code registration without double-counting gross quantity', () => {
  const netAfterReturn = base({
    id: 'return-anchor',
    sale_qty: 3,
    purchase_qty: 2,
    sale_lines: [line('2026-10-10T10:00:00', 3)],
    purchase_lines: [line('2026-10-10T10:10:00', 2, { gross_qty: 3, return_qty: 1, net_qty: 2, has_return: true })],
  });
  const laterPurchase = base({
    id: 'later-purchase',
    type: 'purchase_without_sale',
    sale_qty: 0,
    purchase_qty: 1,
    sale_codes: [],
    purchase_lines: [line('2026-10-10T12:00:00', 1)],
  });
  const result = completeResidualBalancedJourneys([netAfterReturn, laterPurchase]);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'matched');
  assert.equal(result[0].sale_qty, 3);
  assert.equal(result[0].purchase_qty, 3);
  assert.equal(result[0].residual_journey_completed, true);
});
