import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLearnedUnitRules, unitRuleKey } from '../src/lib/branchTransferUnitRules.js';

test('legacy generic unit rule cannot override a packaging-normalized mismatch', () => {
  const item = {
    id: 'pack-mismatch',
    type: 'quantity_mismatch',
    product_name: 'TEST 20 TAB',
    from: 'shokry',
    to: 'shamy',
    sale_qty: 1,
    purchase_qty: 1,
    sale_units: ['شريط'],
    purchase_units: [],
    packaging_normalized_mismatch: true,
    packaging_profile: { status: 'usable', strips_per_box: 2, confidence: 'high' },
    expected_purchase_qty: 0.5,
  };
  const key = unitRuleKey(item);
  const rules = {
    [key]: {
      key,
      active: true,
      purchase_per_sale: 1,
      relative_tolerance: 0.035,
      absolute_tolerance: 0.02,
    },
  };

  const [result] = applyLearnedUnitRules([item], rules);
  assert.equal(result.type, 'quantity_mismatch');
  assert.equal(result.matched_by_unit_rule, undefined);
  assert.equal(result.expected_purchase_qty, 0.5);
});

test('generic unit rule stays available for cases with no packaging intelligence', () => {
  const item = {
    id: 'legacy-unit-case',
    type: 'quantity_mismatch',
    product_name: 'OTHER ITEM',
    from: 'shokry',
    to: 'shamy',
    sale_qty: 2,
    purchase_qty: 1,
    sale_units: ['وحدة بيع'],
    purchase_units: ['علبة'],
  };
  const key = unitRuleKey(item);
  const rules = {
    [key]: {
      key,
      active: true,
      purchase_per_sale: 0.5,
      relative_tolerance: 0.035,
      absolute_tolerance: 0.02,
    },
  };

  const [result] = applyLearnedUnitRules([item], rules);
  assert.equal(result.type, 'matched');
  assert.equal(result.matched_by_unit_rule, true);
});

test('packaging review candidate cannot be auto-closed by a legacy unit rule', () => {
  const item = {
    id: 'pack-review',
    type: 'unit_conversion_review',
    product_name: 'TEST 30 TAB',
    from: 'shamy',
    to: 'shokry',
    sale_qty: 1,
    purchase_qty: 0.34,
    sale_units: ['شريط'],
    purchase_units: [],
    packaging_profile_candidate: true,
    packaging_profile: { status: 'usable', strips_per_box: 3, confidence: 'medium' },
  };
  const key = unitRuleKey(item);
  const rules = {
    [key]: {
      key,
      active: true,
      purchase_per_sale: 0.34,
      relative_tolerance: 0.035,
      absolute_tolerance: 0.02,
    },
  };

  const [result] = applyLearnedUnitRules([item], rules);
  assert.equal(result.type, 'unit_conversion_review');
  assert.equal(result.packaging_profile_candidate, true);
  assert.equal(result.matched_by_unit_rule, undefined);
});
