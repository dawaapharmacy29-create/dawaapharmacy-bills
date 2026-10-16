import test from 'node:test';
import assert from 'node:assert/strict';
import { auditTransferAnalysis } from '../src/lib/branchTransferAnalysisAudit.js';

test('counts expiry consolidation as a prevented false positive when matched', () => {
  const audit = auditTransferAnalysis([{
    type: 'matched',
    sale_qty: 2,
    purchase_qty: 2,
    sale_codes: ['67630'],
    purchase_codes: ['67630'],
    sale_users: ['د دنيا'],
    purchase_users: ['د رضا'],
    sale_invoices: ['76363'],
    purchase_invoices: ['10985'],
    time_gap_minutes: 17,
    sale_lines: [
      { raw: { expiration_raw: '2029/04' } },
      { raw: { expiration_raw: '2029/05' } },
    ],
    purchase_lines: [{}],
  }]);

  assert.equal(audit.expiry_consolidation_matched, 1);
  assert.equal(audit.false_positive_prevented, 1);
  assert.equal(audit.actor_complete, 1);
  assert.equal(audit.exact_code_matched, 1);
});

test('counts balanced one-to-many journey as a prevented false positive', () => {
  const audit = auditTransferAnalysis([{
    type: 'matched',
    sale_qty: 3,
    purchase_qty: 3,
    sale_codes: ['100'],
    purchase_codes: ['100'],
    sale_users: ['د أ'],
    purchase_users: ['د ب'],
    sale_invoices: ['S1'],
    purchase_invoices: ['P1', 'P2'],
    episode_balanced: true,
    time_gap_minutes: 20,
    sale_lines: [{}],
    purchase_lines: [{}, {}],
  }]);
  assert.equal(audit.composite_journey_matched, 1);
  assert.equal(audit.false_positive_prevented, 1);
});

test('keeps quantity mismatch in review even after consolidation', () => {
  const audit = auditTransferAnalysis([{
    type: 'quantity_mismatch',
    sale_qty: 2,
    purchase_qty: 3,
    sale_codes: ['200'],
    purchase_codes: ['200'],
    sale_invoices: ['S2'],
    purchase_invoices: ['P2'],
    sale_lines: [{}, {}],
    purchase_lines: [{}],
  }]);
  assert.equal(audit.quantity_reviews_after_consolidation, 1);
  assert.equal(audit.false_positive_prevented, 0);
});
