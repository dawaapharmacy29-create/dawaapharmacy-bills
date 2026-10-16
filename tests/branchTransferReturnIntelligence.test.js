import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTransferReturnEvidence,
  summarizeTransferReturnEvidence,
} from '../src/lib/branchTransferReturnIntelligence.js';

test('summarizes gross purchase, return, and net transfer movement', () => {
  const summary = summarizeTransferReturnEvidence([{
    qty: 2,
    raw: { gross_qty: 3, return_qty: 1, net_qty: 2 },
  }], 2);

  assert.deepEqual(summary, {
    has_return: true,
    gross_qty: 3,
    return_qty: 1,
    net_qty: 2,
  });
  assert.equal(
    formatTransferReturnEvidence(summary, { movement: 'الشراء', unit: 'علبة' }),
    'صافي الشراء 2 علبة = 3 مسجل − 1 مرتجع',
  );
});

test('aggregates returns across multiple lines in the same journey', () => {
  const summary = summarizeTransferReturnEvidence([
    { qty: 1, raw: { gross_qty: 2, return_qty: 1 } },
    { qty: 2, raw: { gross_qty: 2, return_qty: 0 } },
  ], 3);
  assert.equal(summary.gross_qty, 4);
  assert.equal(summary.return_qty, 1);
  assert.equal(summary.net_qty, 3);
  assert.equal(summary.has_return, true);
});

test('leaves movement without returns unchanged', () => {
  const summary = summarizeTransferReturnEvidence([{ qty: 2, raw: { qty: 2 } }], 2);
  assert.equal(summary.has_return, false);
  assert.equal(summary.net_qty, 2);
  assert.equal(formatTransferReturnEvidence(summary, { movement: 'البيع' }), '');
});
