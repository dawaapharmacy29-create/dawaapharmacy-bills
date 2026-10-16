import test from 'node:test';
import assert from 'node:assert/strict';
import { settleAggregateProductJourneys, summarizeAggregateSettlement } from '../src/lib/branchTransferAggregateJourneySettlement.js';

function line(timestamp, qty = 0, invoice = '') {
  return { timestamp_ms: new Date(timestamp).getTime(), qty, invoice };
}

function base(overrides = {}) {
  return {
    id: Math.random().toString(36),
    type: 'quantity_mismatch',
    severity: 3,
    from: 'shamy',
    to: 'shokry',
    product_name: 'TEST PRODUCT',
    sale_codes: ['100'],
    purchase_codes: ['100'],
    sale_qty: 0,
    purchase_qty: 0,
    sale_lines: [],
    purchase_lines: [],
    sale_invoices: [],
    purchase_invoices: [],
    ...overrides,
  };
}

test('silences same-day invoice ambiguity when one real mismatch is completed by missing-side registrations', () => {
  const cases = [
    base({ id: 'a', sale_qty: 3, purchase_qty: 1, sale_lines: [line('2026-10-01T10:00:00', 3, 'S1')], purchase_lines: [line('2026-10-01T10:20:00', 1, 'P1')], sale_invoices: ['S1'], purchase_invoices: ['P1'] }),
    base({ id: 'b', type: 'purchase_without_sale', purchase_qty: 1, sale_codes: [], purchase_lines: [line('2026-10-01T12:00:00', 1, 'P2')], purchase_invoices: ['P2'] }),
    base({ id: 'c', type: 'purchase_without_sale', purchase_qty: 1, sale_codes: [], purchase_lines: [line('2026-10-01T16:00:00', 1, 'P3')], purchase_invoices: ['P3'] }),
  ];
  const result = settleAggregateProductJourneys(cases);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'matched');
  assert.equal(result[0].aggregate_journey_settled, true);
  assert.equal(result[0].sale_qty, 3);
  assert.equal(result[0].purchase_qty, 3);
});

test('allows a journey to finish on the next calendar day', () => {
  const cases = [
    base({ id: 'a', sale_qty: 2, purchase_qty: 1, sale_lines: [line('2026-10-01T23:00:00', 2)], purchase_lines: [line('2026-10-01T23:10:00', 1)] }),
    base({ id: 'b', type: 'purchase_without_sale', purchase_qty: 1, sale_codes: [], purchase_lines: [line('2026-10-02T09:00:00', 1)] }),
  ];
  const result = settleAggregateProductJourneys(cases);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'matched');
  assert.equal(result[0].aggregate_settlement_scope, 'same-or-next-day');
});

test('does not hide a real remaining quantity difference', () => {
  const cases = [
    base({ id: 'a', sale_qty: 3, purchase_qty: 1, sale_lines: [line('2026-10-01T10:00:00', 3)], purchase_lines: [line('2026-10-01T10:20:00', 1)] }),
    base({ id: 'b', type: 'purchase_without_sale', purchase_qty: 1, sale_codes: [], purchase_lines: [line('2026-10-01T12:00:00', 1)] }),
  ];
  const result = settleAggregateProductJourneys(cases);
  assert.equal(result.filter((item) => item.type !== 'matched').length, 2);
});

test('never cancels two opposite quantity mismatches merely because their daily totals balance', () => {
  const cases = [
    base({ id: 'm1', sale_qty: 3, purchase_qty: 1, sale_lines: [line('2026-10-01T10:00:00', 3)], purchase_lines: [line('2026-10-01T10:10:00', 1)] }),
    base({ id: 'm2', sale_qty: 1, purchase_qty: 3, sale_lines: [line('2026-10-01T15:00:00', 1)], purchase_lines: [line('2026-10-01T15:10:00', 3)] }),
  ];
  const result = settleAggregateProductJourneys(cases);
  assert.equal(result.length, 2);
  assert.equal(result.every((item) => item.type === 'quantity_mismatch'), true);
  assert.equal(result.some((item) => item.aggregate_journey_settled), false);
});

test('does not auto-pair two independent one-sided movements without a mismatch anchor', () => {
  const cases = [
    base({ id: 'sale-only', type: 'sale_without_purchase', sale_qty: 1, purchase_qty: 0, purchase_codes: [], sale_lines: [line('2026-10-01T10:00:00', 1)] }),
    base({ id: 'purchase-only', type: 'purchase_without_sale', sale_qty: 0, purchase_qty: 1, sale_codes: [], purchase_lines: [line('2026-10-01T18:00:00', 1)] }),
  ];
  const result = settleAggregateProductJourneys(cases);
  assert.equal(result.length, 2);
  assert.equal(result.every((item) => item.type !== 'matched'), true);
});

test('never aggregates different codes or directions', () => {
  const cases = [
    base({ id: 'a', sale_qty: 2, purchase_qty: 1, sale_lines: [line('2026-10-01T10:00:00', 2)], purchase_lines: [line('2026-10-01T10:10:00', 1)] }),
    base({ id: 'b', type: 'purchase_without_sale', purchase_qty: 1, sale_codes: [], purchase_codes: ['200'], purchase_lines: [line('2026-10-01T11:00:00', 1)] }),
    base({ id: 'c', type: 'purchase_without_sale', from: 'shokry', to: 'shamy', purchase_qty: 1, sale_codes: [], purchase_lines: [line('2026-10-01T11:00:00', 1)] }),
  ];
  const result = settleAggregateProductJourneys(cases);
  assert.equal(result.filter((item) => item.type !== 'matched').length, 3);
});

test('blank timestamps do not create a fake 1970 aggregate journey', () => {
  const cases = [
    base({ id: 'undated-sale', type: 'sale_without_purchase', sale_qty: 1, purchase_qty: 0, purchase_codes: [], sale_lines: [{ timestamp_ms: '', qty: 1, invoice: 'S1' }], sale_invoices: ['S1'] }),
    base({ id: 'undated-purchase', type: 'purchase_without_sale', sale_qty: 0, purchase_qty: 1, sale_codes: [], purchase_lines: [{ timestamp_ms: null, qty: 1, invoice: 'P1' }], purchase_invoices: ['P1'] }),
  ];
  const result = settleAggregateProductJourneys(cases);
  assert.equal(result.length, 2);
  assert.equal(result.every((item) => item.type !== 'matched'), true);
});

test('reports how many noisy review cases were silenced by aggregate settlement', () => {
  const before = [base({ id: 'a' }), base({ id: 'b', type: 'purchase_without_sale' }), base({ id: 'c', type: 'purchase_without_sale' })];
  const after = [{ ...base({ id: 'settled' }), type: 'matched', aggregate_journey_settled: true }];
  assert.deepEqual(summarizeAggregateSettlement(before, after), {
    before_review: 3,
    after_review: 0,
    hidden_resolved_cases: 3,
    settled_journeys: 1,
  });
});
