import test from 'node:test';
import assert from 'node:assert/strict';
import { branchReviewQueueForIncident, incidentMatchesBranchQueue } from '../src/lib/branchTransferBranchQueue.js';

const incident = (overrides = {}) => ({
  kind: 'single_missing',
  from: 'shamy',
  to: 'shokry',
  side: 'sale',
  cases: [],
  ...overrides,
});

test('missing purchase belongs to receiving branch review queue', () => {
  const value = incident({ side: 'sale', from: 'shamy', to: 'shokry' });
  assert.equal(branchReviewQueueForIncident(value), 'shokry');
  assert.equal(incidentMatchesBranchQueue(value, 'shokry'), true);
  assert.equal(incidentMatchesBranchQueue(value, 'shamy'), false);
});

test('missing sale belongs to source branch review queue', () => {
  const value = incident({ side: 'purchase', from: 'shamy', to: 'shokry' });
  assert.equal(branchReviewQueueForIncident(value), 'shamy');
});

test('two-sided quantity and code issues stay shared instead of blaming a branch', () => {
  assert.equal(branchReviewQueueForIncident(incident({ side: null, kind: 'quantity_mismatch' })), 'shared');
  assert.equal(branchReviewQueueForIncident(incident({ side: null, kind: 'code_mismatch' })), 'shared');
  assert.equal(incidentMatchesBranchQueue(incident({ side: null, kind: 'quantity_mismatch' }), 'shared'), true);
});

test('all queue includes every incident', () => {
  assert.equal(incidentMatchesBranchQueue(incident(), 'all'), true);
});
