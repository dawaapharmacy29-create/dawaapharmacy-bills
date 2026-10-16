import test from 'node:test';
import assert from 'node:assert/strict';
import { explainTransferCase } from '../src/lib/branchTransferDecisionIntelligence.js';

test('decision intelligence explains consolidated multi-expiry match without creating an issue', () => {
  const intel = explainTransferCase({
    type: 'matched', severity: 0, confidence_score: 96, time_gap_minutes: 17,
    sale_qty: 2, purchase_qty: 2,
    sale_codes: ['67630'], purchase_codes: ['67630'],
    sale_users: ['د دنيا'], purchase_users: ['د رضا'],
    sale_invoices: ['76363'], purchase_invoices: ['10985'],
    sale_lines: [
      { invoice: '76363', raw: { expiration_raw: '2029/04' } },
      { invoice: '76363', raw: { expiration_raw: '2029/05' } },
    ],
    purchase_lines: [{ invoice: '10985', raw: { expiration_raw: '2029/05' } }],
    match_reason: 'نفس كود الصنف · نفس الكمية · الفارق الزمني 17 دقيقة',
  });
  assert.equal(intel.version, 'decision-intelligence-v2');
  assert.equal(intel.mode, 'silent');
  assert.equal(intel.issue_confidence.score, 0);
  assert.equal(intel.evidence.quantity.consolidated, true);
  assert.match(intel.summary, /تجميع سطور/);
  assert.ok(intel.signals.some((signal) => signal.key === 'invoice-consolidation'));
  assert.ok(intel.signals.some((signal) => signal.key === 'actor-coverage'));
});

test('actor header conflict is surfaced as uncertainty instead of assigning blame', () => {
  const intel = explainTransferCase({
    type: 'quantity_mismatch', severity: 85, confidence_score: 92, time_gap_minutes: 20,
    sale_qty: 1, purchase_qty: 2,
    sale_codes: ['1'], purchase_codes: ['1'],
    sale_lines: [{ raw: { invoice_header_conflict: true } }],
    purchase_lines: [{}],
  });
  assert.ok(intel.uncertainties.some((value) => /أكثر من رأس فاتورة بيع متعارض/.test(value)));
  assert.notEqual(intel.mode, 'silent');
});
