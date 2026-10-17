import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCaseActionPlan, buildDecisionPlan, decisionLaneForIncident, incidentMatchesDecisionLane } from '../src/lib/branchTransferDecisionPlan.js';

test('routes high-confidence quick triage to quick lane when no safety blocker exists', () => {
  const incident = { kind: 'single_missing', triage: { quick: true, confidence: 94 }, cases: [{}] };
  assert.equal(decisionLaneForIncident(incident), 'quick');
  const plan = buildCaseActionPlan(incident);
  assert.equal(plan.can_batch_execute, false);
  assert.match(plan.next_step, /الحالة الحالية فقط/);
});

test('routes packaging candidates to learning before quick approval', () => {
  const incident = { kind: 'unit_conversion', triage: { quick: true, confidence: 97 }, cases: [{ packaging_profile_candidate: true }] };
  assert.equal(decisionLaneForIncident(incident), 'learning');
  assert.match(buildCaseActionPlan(incident).stop_condition, /توقف/);
});

test('unsafe units and identity conflicts always require human investigation', () => {
  const mixed = { kind: 'quantity_mismatch', triage: { quick: true, confidence: 99 }, cases: [{ mixed_units_detected: true }] };
  const code = { kind: 'code_mismatch', triage: { quick: true, confidence: 99 }, cases: [{}] };
  assert.equal(decisionLaneForIncident(mixed), 'human');
  assert.equal(decisionLaneForIncident(code), 'human');
});

test('low confidence waits for more evidence instead of forcing a decision', () => {
  const incident = { kind: 'single_missing', triage: { confidence: 52 }, cases: [{}] };
  assert.equal(decisionLaneForIncident(incident), 'waiting');
  assert.match(buildCaseActionPlan(incident).next_step, /لا تحسم الآن/);
});

test('plan summary counts operational lanes and matcher reads enriched lane', () => {
  const plan = buildDecisionPlan([
    { id: 'a', kind: 'single_missing', triage: { quick: true, confidence: 95 }, cases: [{}] },
    { id: 'b', kind: 'unit_conversion', triage: { confidence: 88 }, cases: [{ type: 'unit_conversion_review' }] },
    { id: 'c', kind: 'code_mismatch', triage: { confidence: 96 }, cases: [{}] },
    { id: 'd', kind: 'single_missing', triage: { confidence: 40 }, cases: [{}] },
  ]);
  assert.deepEqual(plan.summary, { total: 4, quick: 1, learning: 1, human: 1, waiting: 1 });
  assert.equal(incidentMatchesDecisionLane(plan.incidents[0], 'quick'), true);
  assert.equal(incidentMatchesDecisionLane(plan.incidents[0], 'human'), false);
});
