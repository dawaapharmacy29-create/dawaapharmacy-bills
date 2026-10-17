import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceUnitEvidenceSafety, unsafeDosageCountConversion } from '../src/lib/branchTransferUnitEvidenceSafety.js';

function caseWithPackCount(productName, packCount = 30) {
  return {
    id: 'unsafe-pack-count',
    type: 'unit_conversion_review',
    severity: 45,
    product_name: productName,
    sale_product_name: productName,
    purchase_product_name: productName,
    sale_lines: [{ product_name: productName }],
    purchase_lines: [{ product_name: productName }],
    unit_conversion_evidence: {
      kind: 'pack_count',
      pack_count: packCount,
      ratio: packCount,
      confidence: 'high',
      reason: `ratio looks like pack ${packCount}`,
    },
  };
}

test('30 TAB is SKU content evidence, not strips-per-box conversion evidence', () => {
  const item = caseWithPackCount('SOLUPRED 5 MG 30 TAB', 30);
  const blocked = unsafeDosageCountConversion(item);
  assert.ok(blocked);
  assert.equal(blocked.blocked_pack_count, 30);

  const [result] = enforceUnitEvidenceSafety([item]);
  assert.equal(result.type, 'quantity_mismatch');
  assert.equal(result.unsafe_unit_conversion_blocked, true);
  assert.equal(result.unit_conversion_evidence, null);
  assert.match(result.next_action, /عدد الأقراص\/الكبسولات/);
});

test('20 CAP is also blocked from becoming a physical strip conversion by itself', () => {
  const item = caseWithPackCount('OMEGA TEST 20 CAP', 20);
  const [result] = enforceUnitEvidenceSafety([item]);
  assert.equal(result.type, 'quantity_mismatch');
  assert.equal(result.unsafe_unit_conversion_blocked, true);
});

test('an explicit strip count in the product name is not blocked by the dosage-count safety gate', () => {
  const item = caseWithPackCount('TEST 30 TAB 3 STRIPS', 3);
  const blocked = unsafeDosageCountConversion(item);
  assert.equal(blocked, null);
  const [result] = enforceUnitEvidenceSafety([item]);
  assert.equal(result.type, 'unit_conversion_review');
  assert.equal(result.unsafe_unit_conversion_blocked, undefined);
});
