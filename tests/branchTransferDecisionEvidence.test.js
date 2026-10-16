import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionEvidence } from '../src/lib/branchTransferDecisionEvidence.js';

test('explains invoice consolidation with multiple expiries as a matched quantity', () => {
  const evidence = buildDecisionEvidence({
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
      { invoice: '76363', qty: 1, raw: { expiration_raw: '2029/04' } },
      { invoice: '76363', qty: 1, raw: { expiration_raw: '2029/05' } },
    ],
    purchase_lines: [{ invoice: '10985', qty: 2, raw: { expiration_raw: '2029/05' } }],
  });
  assert.equal(evidence.decision, 'matched');
  assert.ok(evidence.decision_score >= 92);
  assert.equal(evidence.quantity.consolidated, true);
  assert.deepEqual(evidence.quantity.sale_expiries, ['2029/04', '2029/05']);
  assert.match(evidence.explanation, /تجميع سطور/);
  assert.equal(evidence.actor.detail, 'البائع: د دنيا · المشتري: د رضا');
});

test('one sale invoice can be explained as a balanced journey against multiple purchase invoices', () => {
  const evidence = buildDecisionEvidence({
    type: 'matched', episode_balanced: true,
    sale_qty: 3, purchase_qty: 3,
    sale_codes: ['70001'], purchase_codes: ['70001'],
    sale_invoices: ['76000'], purchase_invoices: ['11001', '11002'],
    sale_lines: [{ invoice: '76000' }],
    purchase_lines: [{ invoice: '11001' }, { invoice: '11002' }],
    time_gap_minutes: 22,
  });
  assert.equal(evidence.journey.status, 'episode');
  assert.match(evidence.journey.detail, /بيع واحد/);
  assert.equal(evidence.decision, 'matched');
});

test('code conflict caps confidence and blocks automatic match even with equal quantities', () => {
  const evidence = buildDecisionEvidence({
    type: 'code_mismatch',
    sale_qty: 1, purchase_qty: 1,
    sale_codes: ['100'], purchase_codes: ['200'],
    sale_product_name: 'Same Product', purchase_product_name: 'Same Product',
    sale_lines: [{}], purchase_lines: [{}], time_gap_minutes: 5,
    identity_diagnosis: { risk: 'high' },
  });
  assert.equal(evidence.decision, 'identity_review');
  assert.ok(evidence.decision_score <= 45);
  assert.equal(evidence.identity.status, 'conflict');
});

test('real quantity mismatch remains a review after consolidation', () => {
  const evidence = buildDecisionEvidence({
    type: 'quantity_mismatch',
    sale_qty: 2, purchase_qty: 3,
    sale_codes: ['67630'], purchase_codes: ['67630'],
    sale_lines: [{ qty: 1 }, { qty: 1 }],
    purchase_lines: [{ qty: 3 }],
    sale_invoices: ['76363'], purchase_invoices: ['10985'],
    time_gap_minutes: 17,
  });
  assert.equal(evidence.decision, 'quantity_review');
  assert.equal(evidence.quantity.status, 'mismatch');
  assert.match(evidence.explanation, /بعد تجميع سطور الفاتورة/);
});
