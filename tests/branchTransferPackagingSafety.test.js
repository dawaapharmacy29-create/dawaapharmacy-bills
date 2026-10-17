import test from 'node:test';
import assert from 'node:assert/strict';
import { enforcePackagingProfileConsistency, packagingRuleDrift } from '../src/lib/branchTransferPackagingSafety.js';

function itemWithProfile(overrides = {}) {
  return {
    id: 'x',
    type: overrides.type || 'matched',
    severity: overrides.severity ?? 0,
    packaging_profile: overrides.packaging_profile || {
      status: 'usable',
      confidence: 'confirmed',
      source: 'confirmed_rule',
      strips_per_box: 2,
      observed_profile: {
        status: 'usable',
        confidence: 'high',
        source: 'observed',
        strips_per_box: 3,
        supporting_count: 2,
        label: '1 علبة = 3 شرائط',
      },
    },
  };
}

test('strong repeated current evidence reopens a stale confirmed packaging rule for explicit reapproval', () => {
  const item = itemWithProfile();
  const drift = packagingRuleDrift(item);
  assert.equal(drift.learned_strips_per_box, 2);
  assert.equal(drift.current_strips_per_box, 3);

  const [result] = enforcePackagingProfileConsistency([item]);
  assert.equal(result.type, 'unit_conversion_review');
  assert.equal(result.packaging_rule_drift, true);
  assert.equal(result.packaging_profile_candidate, true);
  assert.equal(result.matched_by_packaging_profile, false);
  assert.equal(result.packaging_normalized_mismatch, false);
  assert.equal(result.packaging_profile.status, 'usable');
  assert.equal(result.packaging_profile.strips_per_box, 3);
  assert.equal(result.packaging_profile.label, '1 علبة = 3 شرائط');
  assert.match(result.next_action, /اعتمد العلاقة الجديدة/);
});

test('one weak contradictory observation does not erase a confirmed packaging rule', () => {
  const item = itemWithProfile({
    packaging_profile: {
      status: 'usable', confidence: 'confirmed', source: 'confirmed_rule', strips_per_box: 2,
      observed_profile: { status: 'usable', confidence: 'medium', source: 'observed', strips_per_box: 3, supporting_count: 1 },
    },
  });
  assert.equal(packagingRuleDrift(item), null);
  const [result] = enforcePackagingProfileConsistency([item]);
  assert.equal(result.type, 'matched');
  assert.equal(result.packaging_rule_drift, undefined);
});

test('matching confirmed and current profiles stay untouched', () => {
  const item = itemWithProfile({
    packaging_profile: {
      status: 'usable', confidence: 'confirmed', source: 'confirmed_rule', strips_per_box: 2,
      observed_profile: { status: 'usable', confidence: 'high', source: 'observed', strips_per_box: 2, supporting_count: 3 },
    },
  });
  const [result] = enforcePackagingProfileConsistency([item]);
  assert.equal(result.type, 'matched');
  assert.equal(result.packaging_rule_drift, undefined);
});
