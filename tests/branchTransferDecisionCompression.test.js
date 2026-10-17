import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionCompression, decisionPatternPeers, sameDecisionPattern } from '../src/lib/branchTransferDecisionCompression.js';

test('summarizes a missing counterpart in one decision line', () => {
  const incident = { kind: 'single_missing', triage: { confidence: 91, repeat_count: 3, impact_count: 3 } };
  const item = { sale_qty: 2, sale_lines: [{ id: 1 }], purchase_qty: 0, purchase_lines: [] };
  const result = buildDecisionCompression(incident, item);
  assert.match(result.fact, /البيع موجود/);
  assert.equal(result.risk, 'طرف مقابل غير موجود');
  assert.equal(result.impact_count, 3);
  assert.match(result.one_line, /طرف مقابل غير موجود/);
});

test('does not mark mixed units as a fast decision', () => {
  const incident = { kind: 'quantity_mismatch', triage: { confidence: 98, quick: true } };
  const item = { sale_qty: 10, purchase_qty: 1, mixed_units_detected: true };
  const result = buildDecisionCompression(incident, item);
  assert.equal(result.risk, 'وحدات مختلفة');
  assert.equal(result.can_fast_decide, false);
});

test('surfaces trusted packaging and consistent history as evidence', () => {
  const incident = { triage: { confidence: 94, repeat_count: 4, previous_decision_count: 3, previous_consistent: true } };
  const item = {
    sale_qty: 3,
    purchase_qty: 1,
    packaging_profile: { confidence: 'confirmed', label: '1 علبة = 3 شرائط' },
    remaining_qty_display: { precise: true, primary: '0 علبة' },
  };
  const result = buildDecisionCompression(incident, item);
  assert.ok(result.evidence.includes('عبوة موثوقة: 1 علبة = 3 شرائط'));
  assert.equal(result.evidence.some((entry) => entry.includes('قرار تاريخي متسق')), true);
});

test('finds only peers with the same decision identity', () => {
  const selected = { id: 'a', triage: { identity: 'code:10::quantity' } };
  const peers = [selected, { id: 'b', triage: { identity: 'code:10::quantity' } }, { id: 'c', triage: { identity: 'code:10::code' } }];
  assert.equal(sameDecisionPattern(selected, peers[1]), true);
  assert.deepEqual(decisionPatternPeers(peers, selected).map((entry) => entry.id), ['b']);
});
