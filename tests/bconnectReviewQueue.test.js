import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasUploadedReturns,
  isReturnReviewed,
  matchesReviewSearch,
  needsReturnInspection,
  reviewAttentionSummary,
  reviewQueuePriority,
  canRestoreBConnectAcceptance,
} from '../src/lib/bconnectReviewQueue.js';

const base = {
  number: '11102',
  bconnect: {
    branch: 'دواء الشامي',
    supplier: 'دواء ابو العزم',
    source_file: 'مشتريات الشامي.xlsx',
    supplier_invoice_number: 'SH-24',
    items: [
      { code: '66807', name: 'Zinctron 30 capsules', purchased_quantity: 1, returned_quantity: 1, return_total: 126 },
      { code: '80458', name: 'OSMOPEEL CREAM', purchased_quantity: 1, returned_quantity: 0, return_total: 0 },
    ],
    return_value: 126,
  },
  app: { entered_by_name: 'د عمر', notes: '' },
};

test('source-return detection uses actual uploaded detail and not a synthetic app warning', () => {
  assert.equal(hasUploadedReturns(base), true);
  assert.equal(hasUploadedReturns({ ...base, bconnect: { items: [], return_value: 0 } }), false);
  assert.equal(hasUploadedReturns({ ...base, bconnect: { return_value: 25 } }), true);
  assert.equal(hasUploadedReturns({ ...base, bconnect: { items: [] }, app: { returned_value: 22 } }), false);
  assert.equal(hasUploadedReturns({ ...base, bconnect: { return_value: null } }), false);
});

test('product code, product name, supplier invoice number, and uploaded filename are searchable', () => {
  for (const q of ['66807', 'Zinctron', 'osmopeel', 'SH-24', 'مشتريات الشامي', '11102', 'د عمر']) {
    assert.equal(matchesReviewSearch(base, q), true, q);
  }
  assert.equal(matchesReviewSearch(base, 'not-present'), false);
});

test('return inspection is a transient UI decision, never implied from matching totals', () => {
  const key = 'دواء الشامي::11102';
  assert.equal(needsReturnInspection(base, {}, key), true);
  assert.equal(needsReturnInspection(base, { [key]: { action: 'reviewed' } }, key), false);
  assert.equal(isReturnReviewed({ [key]: { action: 'reviewed' } }, key), true);
  assert.equal(needsReturnInspection(base, { [key]: { action: 'accepted' } }, key), false);
  assert.equal(needsReturnInspection({ ...base, bconnect: { items: [], return_value: 0 } }, {}, key), false);
});

test('priority puts hard problems, money differences and returns before routine corrections', () => {
  assert.equal(reviewQueuePriority(base, { lane: 'investigate' }), 0);
  assert.equal(reviewQueuePriority(base, { lane: 'explain' }), 1);
  assert.equal(reviewQueuePriority(base, { lane: 'clean' }), 2);
  assert.equal(reviewQueuePriority({ ...base, bconnect: { items: [], return_value: 0 } }, { lane: 'correct' }), 3);
  assert.equal(reviewQueuePriority({ ...base, bconnect: { items: [], return_value: 0 } }, { lane: 'approve' }), 5);
});

test('return counts separate pending, inspected, and total without double-counting', () => {
  const rows = [
    base,
    { ...base, number: '11103', bconnect: { return_value: 0, items: [] } },
    { ...base, number: '11104' },
  ];
  const summary = reviewAttentionSummary(
    rows, { '11104': { action: 'reviewed' } }, (row) => row.number
  );
  assert.deepEqual(summary, { returnsTotal: 2, returnsToInspect: 1, returnsReviewed: 1 });
});


test('previous approval is never restored after a new note or supplier return appears', () => {
  const row = { ...base, status: 'review', identity: 'confirmed' };
  const normalView = { lane: 'approve', fastAccept: true, hasNote: false, hasReturn: false, returnIssue: false };
  assert.equal(canRestoreBConnectAcceptance(row, normalView), false); // missing stable application record
  const withApp = { ...row, app: { id: 'invoice-1', supplier_name: 'مورد', notes: '' } };
  assert.equal(canRestoreBConnectAcceptance(withApp, normalView), true);
  assert.equal(canRestoreBConnectAcceptance(withApp, { ...normalView, hasNote: true }), false);
  assert.equal(canRestoreBConnectAcceptance(withApp, { ...normalView, hasReturn: true }), false);
  assert.equal(canRestoreBConnectAcceptance(withApp, { ...normalView, returnIssue: true }), false);
  assert.equal(canRestoreBConnectAcceptance(withApp, { ...normalView, fastAccept: false }), false);
  assert.equal(canRestoreBConnectAcceptance(withApp, { ...normalView, lane: 'investigate' }), false);
  assert.equal(canRestoreBConnectAcceptance({ ...withApp, status: 'clean' }, { ...normalView, lane: 'clean', fastAccept: false }), true);
});
