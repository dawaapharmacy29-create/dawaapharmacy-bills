import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOneSecondDecision } from '../src/lib/branchTransferOneSecondDecision.js';

test('waiting evidence never offers resolve', () => {
  const result = buildOneSecondDecision({ operational_lane: 'waiting', cases: [{}] });
  assert.equal(result.mode, 'wait');
  assert.equal(result.can_resolve, false);
  assert.equal(result.title, 'استنى اكتمال الدليل');
});

test('mixed units require review instead of fast resolve', () => {
  const result = buildOneSecondDecision({ operational_lane: 'human', cases: [{ mixed_units_detected: true }] });
  assert.equal(result.mode, 'review');
  assert.equal(result.can_resolve, false);
});

test('packaging learning produces one explicit action', () => {
  const result = buildOneSecondDecision({ operational_lane: 'learning', cases: [{ packaging_profile_candidate: true, packaging_profile: { label: '1 علبة = 4 شرائط' } }] });
  assert.equal(result.mode, 'learn');
  assert.equal(result.primary_label, 'اعتماد 1 علبة = 4 شرائط');
});

test('missing counterpart turns into a short branch action', () => {
  const result = buildOneSecondDecision({ operational_lane: 'quick', side: 'sale', from: 'دواء فرع ابو العزم', to: 'دواء فرع الشامي', cases: [{}] });
  assert.equal(result.mode, 'act');
  assert.equal(result.title, 'راجع شراء الشامي');
  assert.equal(result.can_resolve, true);
});
