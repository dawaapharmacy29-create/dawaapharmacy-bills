import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTransferSourceCoverage } from '../src/lib/branchTransferSourceCoverage.js';

test('reports actor coverage independently for sale and purchase invoices', () => {
  const coverage = buildTransferSourceCoverage({
    shokrySale: { items: [
      { invoice: '76363', user: 'د دنيا' },
      { invoice: '76363', user: 'د دنيا' },
      { invoice: '76364', user: '' },
    ] },
    shamyPurchase: { items: [
      { invoice: '10985', user: 'د رضا' },
      { invoice: '10986', user: 'د مغازي' },
    ] },
  });

  assert.equal(coverage.shokrySale.total_invoices, 2);
  assert.equal(coverage.shokrySale.covered_invoices, 1);
  assert.equal(coverage.shokrySale.coverage_percent, 50);
  assert.deepEqual(coverage.shokrySale.missing_invoices, ['76364']);
  assert.equal(coverage.shamyPurchase.coverage_percent, 100);
  assert.equal(coverage.overall.ready_for_actor_attribution, false);
});

test('marks actor attribution unsafe when invoice header enrichment is conflicted', () => {
  const coverage = buildTransferSourceCoverage({
    shokrySale: { items: [
      { invoice: '76363', user: '', invoice_header_conflict: true },
    ] },
  });
  assert.deepEqual(coverage.shokrySale.conflict_invoices, ['76363']);
  assert.equal(coverage.overall.ready_for_actor_attribution, false);
});
