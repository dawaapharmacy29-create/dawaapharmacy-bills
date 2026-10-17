import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNextBestActionQueue } from '../src/lib/branchTransferNextBestAction.js';

test('next best action prefers quick actionable work over waiting evidence', () => {
  const quick = {
    id: 'quick',
    side: 'sale',
    operational_lane: 'quick',
    triage: { confidence: 95, priority: 90 },
    from: 'شكري',
    to: 'الشامي',
    cases: [{ id: 'q1', product_name: 'A' }],
    case_ids: ['q1'],
  };
  const waiting = {
    id: 'wait',
    operational_lane: 'waiting',
    triage: { confidence: 99, priority: 99 },
    cases: [{ id: 'w1', product_name: 'B' }],
    case_ids: ['w1'],
  };
  const queue = buildNextBestActionQueue([waiting, quick]);
  assert.equal(queue.items[0].incident.id, 'quick');
  assert.equal(queue.summary.fast, 1);
  assert.equal(queue.summary.wait, 1);
});

test('unsafe review is not classified as fast resolve', () => {
  const review = {
    id: 'review',
    kind: 'code_mismatch',
    operational_lane: 'human',
    triage: { confidence: 98, priority: 98 },
    cases: [{ id: 'r1', product_name: 'C' }],
    case_ids: ['r1'],
  };
  const queue = buildNextBestActionQueue([review]);
  assert.equal(queue.items[0].can_resolve, false);
  assert.equal(queue.summary.review, 1);
  assert.equal(queue.summary.fast, 0);
});
