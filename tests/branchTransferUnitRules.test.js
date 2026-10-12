import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLearnedUnitRules, caseMatchesUnitRule, learnUnitRule, removeUnitRule, suggestUnitRule, unitRuleLabel } from '../src/lib/branchTransferUnitRules.js';

const unitCase = (overrides = {}) => ({
  id: '2026-10-12::shamy::shokry::ADW',
  type: 'unit_conversion_review',
  severity: 45,
  from: 'shamy',
  to: 'shokry',
  product_name: 'ADWISTADINE',
  sale_qty: 1,
  purchase_qty: 0.33,
  sale_units: ['شريط'],
  purchase_units: [],
  ...overrides,
});

test('suggests an auditable directional unit rule from a confirmed case', () => {
  const rule = suggestUnitRule(unitCase());
  assert.equal(rule.from, 'shamy');
  assert.equal(rule.to, 'shokry');
  assert.equal(rule.purchase_per_sale, 0.33);
  assert.equal(unitRuleLabel(rule), '1 شريط = 0.33 علبة');
});

test('learned rule auto-matches proportional future quantities', () => {
  const first = unitCase();
  const rules = learnUnitRule(first, {});
  const future = unitCase({ id: 'future', sale_qty: 2, purchase_qty: 0.66 });
  const result = applyLearnedUnitRules([future], rules)[0];
  assert.equal(result.type, 'matched');
  assert.equal(result.matched_by_unit_rule, true);
  assert.equal(result.expected_purchase_qty, 0.66);
});

test('learned rule does not hide a real quantity mismatch', () => {
  const rule = suggestUnitRule(unitCase());
  const future = unitCase({ sale_qty: 4, purchase_qty: 1 });
  assert.equal(caseMatchesUnitRule(future, rule), false);
  const result = applyLearnedUnitRules([future], { [rule.key]: rule })[0];
  assert.equal(result.type, 'unit_conversion_review');
});

test('rule is directional and never applies to the reverse transfer by accident', () => {
  const rule = suggestUnitRule(unitCase());
  const reverse = unitCase({ from: 'shokry', to: 'shamy', sale_qty: 2, purchase_qty: 0.66 });
  assert.equal(caseMatchesUnitRule(reverse, rule), false);
});

test('revoking a learned rule restores manual review behavior', () => {
  const first = unitCase();
  const learned = learnUnitRule(first, {});
  const key = Object.keys(learned)[0];
  const revoked = removeUnitRule(learned, key);
  const result = applyLearnedUnitRules([unitCase({ sale_qty: 2, purchase_qty: 0.66 })], revoked)[0];
  assert.equal(result.type, 'unit_conversion_review');
});
