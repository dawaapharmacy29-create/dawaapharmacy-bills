import test from 'node:test';
import assert from 'node:assert/strict';
import { gateTransferReviewCases, isClosedTransferDecisionStatus, latestTransferEvidenceDay } from '../src/lib/branchTransferReviewGate.js';

function item(overrides = {}) {
  return {
    id: Math.random().toString(36),
    type: 'quantity_mismatch',
    from: 'shokry',
    to: 'shamy',
    decision: null,
    sale_lines: [],
    purchase_lines: [],
    ...overrides,
  };
}

function line(timestamp) {
  return { timestamp_ms: new Date(timestamp).getTime() };
}

test('matched evidence is silent and never enters the active decision queue', () => {
  const result = gateTransferReviewCases([item({ type: 'matched' })], {});
  assert.equal(result.actionable.length, 0);
  assert.equal(result.summary.resolved_by_evidence, 1);
});

test('confirmed and dismissed decisions stay out of the active queue', () => {
  const cases = [
    item({ decision: { status: 'waiting_verification' } }),
    item({ decision: { status: 'verified' } }),
    item({ decision: { status: 'dismissed' } }),
    item({ decision: { status: 'in_progress' } }),
  ];
  const result = gateTransferReviewCases(cases, {});
  assert.equal(result.actionable.length, 1);
  assert.equal(result.actionable[0].decision.status, 'in_progress');
  assert.equal(result.summary.already_reviewed, 3);
});

test('missing purchase is not accused when purchase source was not uploaded', () => {
  const result = gateTransferReviewCases([
    item({ type: 'sale_without_purchase', from: 'shokry', to: 'shamy' }),
  ], { shokrySale: true, shamyPurchase: false });
  assert.equal(result.actionable.length, 0);
  assert.equal(result.summary.incomplete_source, 1);
});

test('missing purchase becomes actionable only when counterpart source is actually loaded', () => {
  const result = gateTransferReviewCases([
    item({ type: 'sale_without_purchase', from: 'shokry', to: 'shamy' }),
  ], { shokrySale: true, shamyPurchase: true });
  assert.equal(result.actionable.length, 1);
});

test('newest-day quantity and missing-side cases wait for later evidence instead of becoming problems immediately', () => {
  const newest = item({
    id: 'newest',
    type: 'quantity_mismatch',
    sale_lines: [line('2026-10-16T18:00:00')],
    purchase_lines: [line('2026-10-16T18:20:00')],
  });
  const older = item({
    id: 'older',
    type: 'quantity_mismatch',
    sale_lines: [line('2026-10-15T18:00:00')],
    purchase_lines: [line('2026-10-15T18:20:00')],
  });
  const latestDay = latestTransferEvidenceDay([older, newest]);
  const result = gateTransferReviewCases([older, newest], {}, { latestEvidenceDay: latestDay });
  assert.equal(latestDay, '2026-10-16');
  assert.deepEqual(result.actionable.map((entry) => entry.id), ['older']);
  assert.equal(result.summary.awaiting_later_evidence, 1);
});

test('code conflicts are never hidden just because they are on the newest day', () => {
  const conflict = item({
    type: 'code_mismatch',
    sale_lines: [line('2026-10-16T18:00:00')],
    purchase_lines: [line('2026-10-16T18:20:00')],
  });
  const result = gateTransferReviewCases([conflict], {}, { latestEvidenceDay: '2026-10-16' });
  assert.equal(result.actionable.length, 1);
});

test('waiting verification is a closed active-queue state', () => {
  assert.equal(isClosedTransferDecisionStatus('waiting_verification'), true);
  assert.equal(isClosedTransferDecisionStatus('in_progress'), false);
});
