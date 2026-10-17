import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRootCauseIntelligence, rootCauseClusterForIncident } from '../src/lib/branchTransferRootCauseIntelligence.js';

function incident(id, overrides = {}) {
  return {
    id,
    kind: 'quantity_mismatch',
    operational_lane: 'human',
    triage: { confidence: 88 },
    product_names: [`Product ${id}`],
    product_codes: [`C${id}`],
    cases: [{ id: `case-${id}`, product_name: `Product ${id}`, sale_codes: [`C${id}`], purchase_codes: [`C${id}`] }],
    ...overrides,
  };
}

test('groups repeated quantity mismatches into a systematic root cause', () => {
  const input = [incident('a'), incident('b'), incident('c')];
  const result = buildRootCauseIntelligence(input);
  assert.equal(result.clusters.length, 1);
  assert.equal(result.clusters[0].type, 'quantity_mismatch');
  assert.equal(result.clusters[0].count, 3);
  assert.equal(result.clusters[0].systematic, true);
  assert.equal(result.clusters[0].products.length, 3);
});

test('mixed units outrank a normal quantity mismatch as a separate high-risk cause', () => {
  const mixed = incident('mixed', { cases: [{ id: 'm', product_name: 'Mixed', mixed_units_detected: true }] });
  const normal = incident('normal');
  const result = buildRootCauseIntelligence([normal, mixed]);
  assert.equal(result.clusters[0].type, 'mixed_units');
  assert.ok(result.clusters[0].severity > result.clusters.find((entry) => entry.type === 'quantity_mismatch').severity);
});

test('waiting evidence is separated from operational errors', () => {
  const waiting = incident('w', { operational_lane: 'waiting', triage: { confidence: 40 }, kind: 'single_missing' });
  const result = buildRootCauseIntelligence([waiting]);
  assert.equal(result.clusters[0].type, 'evidence_gap');
  assert.equal(result.summary.waiting, 1);
  assert.match(result.clusters[0].recommended_action, /استكمل|انتظر/);
});

test('packaging learning and packaging conflict never collapse into one root cause', () => {
  const learning = incident('l', { kind: 'unit_conversion', cases: [{ id: 'l', product_name: 'A', packaging_profile_candidate: true }] });
  const conflict = incident('c', { cases: [{ id: 'c', product_name: 'B', packaging_conflict: true }] });
  const result = buildRootCauseIntelligence([learning, conflict]);
  assert.equal(result.clusters.length, 2);
  assert.ok(result.clusters.some((entry) => entry.type === 'packaging_learning'));
  assert.ok(result.clusters.some((entry) => entry.type === 'packaging_conflict'));
});

test('can retrieve the root cause cluster for a selected incident', () => {
  const selected = incident('x');
  const result = buildRootCauseIntelligence([selected]);
  const cluster = rootCauseClusterForIncident(result, selected);
  assert.equal(cluster?.count, 1);
  assert.equal(cluster?.incident_ids[0], 'x');
});
