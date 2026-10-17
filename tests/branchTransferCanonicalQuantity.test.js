import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCanonicalQuantity } from '../src/lib/branchTransferCanonicalQuantity.js';

function transferCase({ profile = null, saleQty = 3, purchaseQty = 1, purchaseUnit = '' } = {}) {
  return {
    id: 'canonical-case',
    type: 'unit_conversion_review',
    sale_qty: saleQty,
    purchase_qty: purchaseQty,
    sale_lines: [
      { qty: saleQty, unit: 'شريط', source_format: 'flat_transfer_rows', raw: { source_format: 'flat_transfer_rows' } },
    ],
    purchase_lines: [
      { qty: purchaseQty, unit: purchaseUnit, source_format: 'bconnect_purchase_report', raw: { source_format: 'bconnect_purchase_report' } },
    ],
    packaging_profile: profile,
  };
}

test('unitless B-Connect purchase stays explicitly unknown with a compact display when packaging evidence is only probable', () => {
  const item = transferCase({
    profile: {
      status: 'usable', confidence: 'medium', source: 'observed', strips_per_box: 3,
      evidence_count: 1, supporting_count: 1, label: '1 علبة = 3 شرائط',
    },
  });
  const [result] = applyCanonicalQuantity([item]);

  assert.equal(result.sale_quantity.raw_unit, 'strip');
  assert.equal(result.sale_quantity.canonical_unit, 'box');
  assert.equal(result.sale_quantity.canonical_qty, 1);
  assert.equal(result.sale_quantity.conversion_confidence, 'probable');
  assert.equal(result.purchase_quantity.raw_unit, null);
  assert.equal(result.purchase_quantity.canonical_unit, null);
  assert.equal(result.purchase_quantity.conversion_confidence, 'unknown');
  assert.equal(result.canonical_quantity_comparable, false);
  assert.equal(result.purchase_qty_label, '1 وحدة · العبوة غير محددة');
  assert.doesNotMatch(result.purchase_qty_label, /علبة/);
});

test('trusted packaging profile can normalize strip sale and unitless B-Connect purchase to compact box labels', () => {
  const item = transferCase({
    profile: {
      status: 'usable', confidence: 'high', source: 'product_name_and_observed', strips_per_box: 3,
      evidence_count: 3, supporting_count: 3, label: '1 علبة = 3 شرائط',
    },
  });
  const [result] = applyCanonicalQuantity([item]);

  assert.equal(result.sale_quantity.canonical_unit, 'box');
  assert.equal(result.sale_quantity.canonical_qty, 1);
  assert.equal(result.purchase_quantity.canonical_unit, 'box');
  assert.equal(result.purchase_quantity.canonical_qty, 1);
  assert.equal(result.canonical_quantity_comparable, true);
  assert.equal(result.canonical_sale_qty, 1);
  assert.equal(result.canonical_purchase_qty, 1);
  assert.equal(result.sale_qty_label, '3 شريط = 1 علبة');
  assert.equal(result.purchase_qty_label, '1 علبة');
});

test('explicit purchase box unit is canonical even without an inferred packaging profile', () => {
  const item = transferCase({ profile: null, purchaseUnit: 'علبة' });
  const [result] = applyCanonicalQuantity([item]);

  assert.equal(result.purchase_quantity.raw_unit, 'box');
  assert.equal(result.purchase_quantity.canonical_unit, 'box');
  assert.equal(result.purchase_quantity.conversion_source, 'explicit_purchase_unit');
  assert.equal(result.purchase_quantity.conversion_confidence, 'confirmed');
  assert.equal(result.purchase_qty_label, '1 علبة');
});

test('packaging conflicts never turn a unitless purchase into a box fact', () => {
  const item = transferCase({
    profile: {
      status: 'conflicted', confidence: 'low', source: 'evidence_conflict', strips_per_box: null,
      alternatives: [{ strips_per_box: 2 }, { strips_per_box: 3 }],
    },
  });
  const [result] = applyCanonicalQuantity([item]);

  assert.equal(result.packaging_conflict, true);
  assert.equal(result.purchase_quantity.canonical_unit, null);
  assert.equal(result.canonical_quantity_comparable, false);
  assert.equal(result.purchase_qty_label, '1 وحدة · العبوة غير محددة');
});

test('zero side is shown as no movement instead of a noisy zero-unit phrase', () => {
  const [result] = applyCanonicalQuantity([transferCase({ saleQty: 0, purchaseQty: 1 })]);
  assert.equal(result.sale_qty_label, 'لا توجد حركة');
  assert.equal(result.purchase_qty_label, '1 وحدة · العبوة غير محددة');
});
