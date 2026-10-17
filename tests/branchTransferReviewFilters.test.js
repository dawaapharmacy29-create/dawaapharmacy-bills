import test from 'node:test';
import assert from 'node:assert/strict';
import {
  incidentDirection,
  incidentIssue,
  incidentMatchesBranch,
  incidentMatchesIssue,
  countByBranch,
  countByIssue,
} from '../src/lib/branchTransferReviewFilters.js';

function incident(overrides = {}) {
  return {
    from: 'دواء فرع ابو العزم',
    to: 'دواء فرع الشامي',
    kind: 'quantity_mismatch',
    operational_lane: 'human',
    cases: [{ type: 'quantity_mismatch' }],
    ...overrides,
  };
}

test('direction filter separates both branch routes', () => {
  const forward = incident();
  const reverse = incident({ from: 'دواء فرع الشامي', to: 'دواء فرع ابو العزم' });
  assert.equal(incidentDirection(forward), 'shokry_to_shamy');
  assert.equal(incidentDirection(reverse), 'shamy_to_shokry');
  assert.equal(incidentMatchesBranch(forward, 'shokry_to_shamy'), true);
  assert.equal(incidentMatchesBranch(forward, 'shamy_to_shokry'), false);
  assert.deepEqual(countByBranch([forward, reverse]), { all: 2, shokry_to_shamy: 1, shamy_to_shokry: 1 });
});

test('issue filter keeps operational categories mutually clear', () => {
  const missing = incident({ kind: 'partial_sale_invoice_missing', cases: [{ type: 'sale_without_purchase' }] });
  const quantity = incident();
  const code = incident({ kind: 'code_mismatch', cases: [{ type: 'code_mismatch' }] });
  const unit = incident({ kind: 'unit_conversion', cases: [{ type: 'unit_conversion_review' }] });
  const evidence = incident({ operational_lane: 'waiting' });

  assert.equal(incidentIssue(missing), 'missing_side');
  assert.equal(incidentIssue(quantity), 'quantity');
  assert.equal(incidentIssue(code), 'code');
  assert.equal(incidentIssue(unit), 'unit_packaging');
  assert.equal(incidentIssue(evidence), 'evidence');
  assert.equal(incidentMatchesIssue(code, 'code'), true);
  assert.equal(incidentMatchesIssue(code, 'quantity'), false);

  const counts = countByIssue([missing, quantity, code, unit, evidence]);
  assert.equal(counts.all, 5);
  assert.equal(counts.missing_side, 1);
  assert.equal(counts.quantity, 1);
  assert.equal(counts.code, 1);
  assert.equal(counts.unit_packaging, 1);
  assert.equal(counts.evidence, 1);
});

test('packaging and mixed-unit safety are grouped under unit/package', () => {
  assert.equal(incidentIssue(incident({ kind: 'single_missing', cases: [{ packaging_conflict: true }] })), 'unit_packaging');
  assert.equal(incidentIssue(incident({ kind: 'single_missing', cases: [{ mixed_units_detected: true }] })), 'unit_packaging');
});
