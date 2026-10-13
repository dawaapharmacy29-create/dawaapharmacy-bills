import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBranchTransfers, summarizeDecisionIntelligence } from '../src/lib/branchTransferControl.js';

const sale = (overrides = {}) => ({
  branch: 'دواء فرع ابو العزم',
  counterparty: 'دواء فرع الشامي',
  product_name: 'Naviluca 200 mg 7 cap',
  code: '68511',
  qty: 1,
  unit: 'علبة',
  invoice: '77452',
  date: '2026-10-12 23:58',
  ...overrides,
});

const purchase = (overrides = {}) => ({
  branch: 'دواء فرع الشامي',
  counterparty: 'دواء فرع ابو العزم',
  product_name: 'Naviluca 200 mg 7 cap',
  code: '68511',
  qty: 1,
  invoice: '11300',
  date: '2026-10-13 00:05',
  ...overrides,
});

test('separates high journey confidence from low issue confidence for pack conversion evidence', () => {
  const [item] = reconcileBranchTransfers(
    [sale({ product_name: 'bonosome 7 syringes', code: '79767', qty: 7, unit: 'One Unit', invoice: '77456', date: '2026-10-13 00:26' })],
    [purchase({ product_name: 'bonosome 7 syringes', code: '79767', qty: 1, invoice: '11303', date: '2026-10-13 00:33' })],
  );
  assert.equal(item.type, 'unit_conversion_review');
  assert.ok(item.decision_intelligence.journey_confidence.score >= 88);
  assert.ok(item.decision_intelligence.issue_confidence.score <= 24);
  assert.equal(item.decision_intelligence.mode, 'review_conversion');
  assert.match(item.decision_intelligence.summary, /غير واثق أن فرق الكمية خطأ/);
});

test('high-confidence journey plus unexplained quantity mismatch produces strong issue confidence', () => {
  const [item] = reconcileBranchTransfers(
    [sale({ code: '50001', product_name: 'Example 20 tab', qty: 4, invoice: 'S-500', date: '2026-10-13 10:00' })],
    [purchase({ code: '50001', product_name: 'Example 20 tab', qty: 1, invoice: 'P-500', date: '2026-10-13 10:08' })],
  );
  assert.equal(item.type, 'quantity_mismatch');
  assert.ok(item.decision_intelligence.journey_confidence.score >= 75);
  assert.ok(item.decision_intelligence.issue_confidence.score >= 75);
  assert.equal(item.decision_intelligence.mode, 'investigate');
  assert.match(item.decision_intelligence.recommended_check, /الوحدة\/العبوة/);
});

test('matched case stays silent even when journey confidence is high', () => {
  const [item] = reconcileBranchTransfers([sale()], [purchase()]);
  assert.equal(item.type, 'matched');
  assert.equal(item.decision_intelligence.mode, 'silent');
  assert.equal(item.decision_intelligence.issue_confidence.score, 0);
  assert.equal(item.decision_intelligence.human_decision_required, false);
});

test('missing counterpart is an alert, not an accusation of a confirmed employee error', () => {
  const [item] = reconcileBranchTransfers([sale({ code: '90001', product_name: 'Missing purchase example' })], []);
  assert.equal(item.type, 'sale_without_purchase');
  assert.equal(item.decision_intelligence.journey_confidence.score, 0);
  assert.ok(item.decision_intelligence.issue_confidence.score >= 55);
  assert.ok(item.decision_intelligence.issue_confidence.score < 90);
  assert.match(item.decision_intelligence.issue_confidence.reason, /ملف شراء ناقص|تسجيل متأخر/);
});

test('decision intelligence summary counts silent, conversion review and high issue confidence separately', () => {
  const cases = [
    ...reconcileBranchTransfers([sale()], [purchase()]),
    ...reconcileBranchTransfers(
      [sale({ product_name: 'bonosome 7 syringes', code: '79767', qty: 7, unit: 'One Unit', invoice: 'S-B', date: '2026-10-13 11:00' })],
      [purchase({ product_name: 'bonosome 7 syringes', code: '79767', qty: 1, invoice: 'P-B', date: '2026-10-13 11:05' })],
    ),
    ...reconcileBranchTransfers(
      [sale({ product_name: 'Mismatch', code: '50001', qty: 5, invoice: 'S-M', date: '2026-10-13 12:00' })],
      [purchase({ product_name: 'Mismatch', code: '50001', qty: 1, invoice: 'P-M', date: '2026-10-13 12:05' })],
    ),
  ];
  const summary = summarizeDecisionIntelligence(cases);
  assert.equal(summary.silent, 1);
  assert.equal(summary.review_conversion, 1);
  assert.equal(summary.investigate, 1);
  assert.ok(summary.high_journey_confidence >= 2);
  assert.ok(summary.high_issue_confidence >= 1);
});
