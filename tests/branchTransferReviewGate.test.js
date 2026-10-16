import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDirectionalEvidenceCoverage,
  gateTransferReviewCases,
  isClosedTransferDecisionStatus,
  latestTransferEvidenceDay,
} from '../src/lib/branchTransferReviewGate.js';

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

test('matched evidence stays as incident context but never becomes reviewable', () => {
  const result = gateTransferReviewCases([item({ type: 'matched' })], {});
  assert.equal(result.reviewable.length, 0);
  assert.equal(result.actionable.length, 1);
  assert.equal(result.actionable[0].type, 'matched');
  assert.equal(result.summary.actionable, 0);
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
  assert.equal(result.reviewable.length, 1);
  assert.equal(result.reviewable[0].decision.status, 'in_progress');
  assert.equal(result.summary.already_reviewed, 3);
});

test('missing purchase is not accused when purchase source was not uploaded', () => {
  const result = gateTransferReviewCases([
    item({ type: 'sale_without_purchase', from: 'shokry', to: 'shamy' }),
  ], { shokrySale: true, shamyPurchase: false });
  assert.equal(result.reviewable.length, 0);
  assert.equal(result.summary.incomplete_source, 1);
});

test('missing purchase becomes reviewable only when counterpart source is actually loaded', () => {
  const result = gateTransferReviewCases([
    item({ type: 'sale_without_purchase', from: 'shokry', to: 'shamy' }),
  ], { shokrySale: true, shamyPurchase: true }, { latestEvidenceDay: null });
  assert.equal(result.reviewable.length, 1);
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
  assert.deepEqual(result.reviewable.map((entry) => entry.id), ['older']);
  assert.equal(result.summary.awaiting_later_evidence, 1);
});

test('a sale missing purchase stays quiet until purchase evidence for that direction reaches a later day', () => {
  const missing = item({
    id: 'missing-purchase',
    type: 'sale_without_purchase',
    from: 'shokry',
    to: 'shamy',
    sale_lines: [line('2026-10-14T18:00:00')],
  });
  const sameDayPurchaseCoverage = item({
    id: 'purchase-coverage-same-day',
    type: 'matched',
    from: 'shokry',
    to: 'shamy',
    sale_lines: [line('2026-10-14T17:00:00')],
    purchase_lines: [line('2026-10-14T19:00:00')],
  });
  const unrelatedNewer = item({
    id: 'other-direction-newer',
    type: 'matched',
    from: 'shamy',
    to: 'shokry',
    sale_lines: [line('2026-10-16T10:00:00')],
    purchase_lines: [line('2026-10-16T10:10:00')],
  });
  const result = gateTransferReviewCases(
    [missing, sameDayPurchaseCoverage, unrelatedNewer],
    { shokrySale: true, shamyPurchase: true, shamySale: true, shokryPurchase: true },
  );
  assert.equal(result.reviewable.some((entry) => entry.id === 'missing-purchase'), false);
  assert.equal(result.summary.awaiting_directional_coverage, 1);
});

test('the same missing purchase becomes reviewable once counterpart evidence spans the case day and reaches the next day', () => {
  const missing = item({
    id: 'missing-purchase',
    type: 'sale_without_purchase',
    from: 'shokry',
    to: 'shamy',
    sale_lines: [line('2026-10-14T18:00:00')],
  });
  const sameDayCoverage = item({
    id: 'purchase-coverage-same-day',
    type: 'matched',
    from: 'shokry',
    to: 'shamy',
    sale_lines: [line('2026-10-14T16:00:00')],
    purchase_lines: [line('2026-10-14T16:10:00')],
  });
  const nextDayCoverage = item({
    id: 'purchase-coverage-next-day',
    type: 'matched',
    from: 'shokry',
    to: 'shamy',
    sale_lines: [line('2026-10-15T09:00:00')],
    purchase_lines: [line('2026-10-15T09:10:00')],
  });
  const coverage = buildDirectionalEvidenceCoverage([missing, sameDayCoverage, nextDayCoverage]);
  const result = gateTransferReviewCases(
    [missing, sameDayCoverage, nextDayCoverage],
    { shokrySale: true, shamyPurchase: true },
    { latestEvidenceDay: '2026-10-15', directionalCoverage: coverage },
  );
  assert.equal(result.reviewable.some((entry) => entry.id === 'missing-purchase'), true);
});

test('a counterpart file that starts after the case day does not falsely prove a missing movement', () => {
  const missing = item({
    id: 'old-sale',
    type: 'sale_without_purchase',
    from: 'shokry',
    to: 'shamy',
    sale_lines: [line('2026-10-10T18:00:00')],
  });
  const laterOnlyCoverage = item({
    id: 'later-only',
    type: 'matched',
    from: 'shokry',
    to: 'shamy',
    sale_lines: [line('2026-10-12T09:00:00')],
    purchase_lines: [line('2026-10-12T09:10:00')],
  });
  const result = gateTransferReviewCases(
    [missing, laterOnlyCoverage],
    { shokrySale: true, shamyPurchase: true },
    { latestEvidenceDay: '2026-10-12' },
  );
  assert.equal(result.reviewable.some((entry) => entry.id === 'old-sale'), false);
  assert.equal(result.summary.awaiting_directional_coverage, 1);
});

test('quantity differences wait until both sale and purchase evidence have moved beyond the case day', () => {
  const mismatch = item({
    id: 'qty-gap',
    type: 'quantity_mismatch',
    from: 'shokry',
    to: 'shamy',
    sale_lines: [line('2026-10-14T18:00:00')],
    purchase_lines: [line('2026-10-14T18:10:00')],
  });
  const purchaseAheadOnly = item({
    id: 'purchase-ahead',
    type: 'purchase_without_sale',
    from: 'shokry',
    to: 'shamy',
    purchase_lines: [line('2026-10-15T08:00:00')],
  });
  const result = gateTransferReviewCases(
    [mismatch, purchaseAheadOnly],
    { shokrySale: true, shamyPurchase: true },
    { latestEvidenceDay: '2026-10-15' },
  );
  assert.equal(result.reviewable.some((entry) => entry.id === 'qty-gap'), false);
  assert.equal(result.summary.awaiting_directional_coverage >= 1, true);
});

test('code conflicts are never hidden just because they are on the newest day', () => {
  const conflict = item({
    type: 'code_mismatch',
    sale_lines: [line('2026-10-16T18:00:00')],
    purchase_lines: [line('2026-10-16T18:20:00')],
  });
  const result = gateTransferReviewCases([conflict], {}, { latestEvidenceDay: '2026-10-16' });
  assert.equal(result.reviewable.length, 1);
});

test('waiting verification is a closed active-queue state', () => {
  assert.equal(isClosedTransferDecisionStatus('waiting_verification'), true);
  assert.equal(isClosedTransferDecisionStatus('in_progress'), false);
});
