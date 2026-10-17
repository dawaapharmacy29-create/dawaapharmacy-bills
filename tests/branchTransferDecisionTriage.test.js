import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDecisionTriage,
  compareDecisionTriage,
  incidentMatchesTriage,
} from '../src/lib/branchTransferDecisionTriage.js';

function incident({ id, kind = 'single_missing', type = 'purchase_without_sale', issue = 90, journey = 85, code = '100', profile = null, mixed = false } = {}) {
  return {
    id,
    kind,
    side: type === 'purchase_without_sale' ? 'purchase' : 'sale',
    cases: [{
      id: `${id}-case`,
      type,
      product_name: `Product ${code}`,
      sale_codes: [code],
      purchase_codes: [code],
      decision_intelligence: {
        issue_confidence: { score: issue },
        journey_confidence: { score: journey },
      },
      packaging_profile: profile,
      packaging_profile_candidate: Boolean(profile),
      sale_quantity: mixed ? { mixed_units: true } : {},
      purchase_quantity: {},
    }],
  };
}

test('high-confidence missing counterpart becomes a quick decision', () => {
  const result = buildDecisionTriage([incident({ id: 'a' })]);
  assert.equal(result.incidents[0].triage.bucket, 'quick');
  assert.equal(result.summary.quick, 1);
  assert.equal(result.incidents[0].triage.recommendation.action, 'missing_counterpart');
});

test('mixed units are forced into human review regardless of confidence', () => {
  const result = buildDecisionTriage([incident({ id: 'a', mixed: true, issue: 99, journey: 99 })]);
  const triage = result.incidents[0].triage;
  assert.equal(triage.bucket, 'human');
  assert.equal(triage.needs_human, true);
  assert.equal(triage.recommendation.action, 'human_review');
});

test('trusted packaging candidate becomes a quick learning decision with impact', () => {
  const profile = { confidence: 'high', label: '1 علبة = 4 شرائط' };
  const result = buildDecisionTriage([
    incident({ id: 'a', kind: 'unit_conversion', type: 'unit_conversion_review', code: '200', profile }),
    incident({ id: 'b', kind: 'unit_conversion', type: 'unit_conversion_review', code: '200', profile }),
  ]);
  const first = result.incidents[0].triage;
  assert.equal(first.bucket, 'quick');
  assert.equal(first.repeat_count, 2);
  assert.equal(first.recommendation.action, 'approve_packaging');
  assert.match(first.recommendation.reason, /2 حالة مشابهة/);
});

test('repeated patterns are counted and exposed in the summary', () => {
  const result = buildDecisionTriage([
    incident({ id: 'a', code: '300' }),
    incident({ id: 'b', code: '300' }),
    incident({ id: 'c', code: '400' }),
  ]);
  assert.equal(result.incidents[0].triage.repeat_count, 2);
  assert.equal(result.summary.repeated, 2);
});

test('triage matcher and comparator prioritize actionable decisions', () => {
  const result = buildDecisionTriage([
    incident({ id: 'slow', issue: 62, journey: 60, kind: 'quantity_mismatch', type: 'quantity_mismatch' }),
    incident({ id: 'fast', issue: 95, journey: 92 }),
  ]);
  const quick = result.incidents.find((item) => item.id === 'fast');
  assert.equal(incidentMatchesTriage(quick, 'quick'), true);
  const sorted = [...result.incidents].sort(compareDecisionTriage);
  assert.equal(sorted[0].id, 'fast');
});
