import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPackagingIntelligence,
  buildPackagingProfiles,
  caseQuantityLabels,
  learnPackagingRule,
  packagingRuleSuggestion,
} from '../src/lib/branchTransferPackagingIntelligence.js';

function saleLine({ invoice, qty, unit = 'شريط', code = '43012' }) {
  return { invoice, qty, unit, code, source_format: 'flat_transfer_rows' };
}

function purchaseLine({ invoice, qty, code = '43012', unit = '' }) {
  return {
    invoice,
    qty,
    unit,
    code,
    source_format: 'bconnect_purchase_report',
    raw: { source_format: 'bconnect_purchase_report' },
  };
}

function transferCase({ id, saleQty, purchaseQty, saleInvoice, purchaseInvoice, type = 'quantity_mismatch', code = '43012', productName = 'TEGRETOL CR 200MG 20 TAB' }) {
  return {
    id,
    type,
    severity: type === 'matched' ? 0 : 70,
    from: 'shokry',
    to: 'shamy',
    product_name: productName,
    sale_qty: saleQty,
    purchase_qty: purchaseQty,
    sale_codes: [code],
    purchase_codes: [code],
    sale_invoices: [saleInvoice],
    purchase_invoices: [purchaseInvoice],
    sale_lines: [saleLine({ invoice: saleInvoice, qty: saleQty, code })],
    purchase_lines: [purchaseLine({ invoice: purchaseInvoice, qty: purchaseQty, code })],
  };
}

test('learns two strips per box only after repeated same-code evidence', () => {
  const cases = [
    transferCase({ id: 'a', saleQty: 1, purchaseQty: 0.5, saleInvoice: 'S1', purchaseInvoice: 'P1' }),
    transferCase({ id: 'b', saleQty: 2, purchaseQty: 1, saleInvoice: 'S2', purchaseInvoice: 'P2' }),
  ];
  const profiles = buildPackagingProfiles(cases);
  assert.equal(profiles['43012'].status, 'usable');
  assert.equal(profiles['43012'].confidence, 'high');
  assert.equal(profiles['43012'].strips_per_box, 2);
  assert.equal(profiles['43012'].label, '1 علبة = 2 شرائط');
});

test('real B-Connect pattern 1 strip versus 0.34 box-equivalent infers three strips per box', () => {
  const item = transferCase({
    id: 'solupred', code: '55750', productName: 'SOLUPRED 5 MG 30 TAB',
    saleQty: 1, purchaseQty: 0.34, saleInvoice: '70952', purchaseInvoice: '47757',
  });
  const [result] = applyPackagingIntelligence([item]);
  assert.equal(result.type, 'unit_conversion_review');
  assert.equal(result.packaging_profile.strips_per_box, 3);
  assert.equal(result.sale_qty_label, '1 شريط');
  assert.equal(result.purchase_qty_label, '0.34 علبة مكافئة');
  assert.match(result.packaging_reason, /1 علبة = 3 شرائط/);
});

test('high-confidence packaging profile matches strips against box-equivalent quantity', () => {
  const cases = [
    transferCase({ id: 'a', saleQty: 1, purchaseQty: 0.5, saleInvoice: 'S1', purchaseInvoice: 'P1' }),
    transferCase({ id: 'b', saleQty: 2, purchaseQty: 1, saleInvoice: 'S2', purchaseInvoice: 'P2' }),
    transferCase({ id: 'c', saleQty: 3, purchaseQty: 1.5, saleInvoice: 'S3', purchaseInvoice: 'P3' }),
  ];
  const result = applyPackagingIntelligence(cases).find((item) => item.id === 'c');
  assert.equal(result.type, 'matched');
  assert.equal(result.matched_by_packaging_profile, true);
  assert.equal(result.expected_purchase_qty, 1.5);
  assert.equal(result.sale_qty_label, '3 شريط');
  assert.equal(result.purchase_qty_label, '1.5 علبة مكافئة');
});

test('raw numeric equality is not green when learned pack profile says one box contains two strips', () => {
  const cases = [
    transferCase({ id: 'a', saleQty: 1, purchaseQty: 0.5, saleInvoice: 'S1', purchaseInvoice: 'P1' }),
    transferCase({ id: 'b', saleQty: 2, purchaseQty: 1, saleInvoice: 'S2', purchaseInvoice: 'P2' }),
    transferCase({ id: 'danger', saleQty: 1, purchaseQty: 1, saleInvoice: 'S3', purchaseInvoice: 'P3', type: 'matched' }),
  ];
  const result = applyPackagingIntelligence(cases).find((item) => item.id === 'danger');
  assert.equal(result.type, 'quantity_mismatch');
  assert.equal(result.packaging_normalized_mismatch, true);
  assert.equal(result.expected_purchase_qty, 0.5);
  assert.match(result.packaging_reason, /1 علبة = 2 شرائط/);
});

test('one conversion observation stays review-only instead of teaching an automatic rule', () => {
  const cases = [
    transferCase({ id: 'single', saleQty: 1, purchaseQty: 0.5, saleInvoice: 'S1', purchaseInvoice: 'P1' }),
  ];
  const profiles = buildPackagingProfiles(cases);
  assert.equal(profiles['43012'].confidence, 'medium');
  const [result] = applyPackagingIntelligence(cases);
  assert.equal(result.type, 'unit_conversion_review');
  assert.equal(result.packaging_profile_candidate, true);
});

test('confirmed packaging rule persists and auto-matches a future single-file observation', () => {
  const first = transferCase({ id: 'confirm', saleQty: 1, purchaseQty: 0.5, saleInvoice: 'S1', purchaseInvoice: 'P1' });
  const [candidate] = applyPackagingIntelligence([first]);
  assert.equal(packagingRuleSuggestion(candidate).label, '1 علبة = 2 شرائط');
  const rules = learnPackagingRule(candidate, {});

  const future = transferCase({ id: 'future', saleQty: 3, purchaseQty: 1.5, saleInvoice: 'S9', purchaseInvoice: 'P9' });
  const [result] = applyPackagingIntelligence([future], rules);
  assert.equal(result.type, 'matched');
  assert.equal(result.matched_by_packaging_profile, true);
  assert.equal(result.packaging_rule_source, 'confirmed_rule');
});

test('confirmed packaging rule catches false raw equality on a future upload', () => {
  const seed = transferCase({ id: 'confirm', saleQty: 1, purchaseQty: 0.5, saleInvoice: 'S1', purchaseInvoice: 'P1' });
  const [candidate] = applyPackagingIntelligence([seed]);
  const rules = learnPackagingRule(candidate, {});

  const dangerous = transferCase({ id: 'future-equal', saleQty: 1, purchaseQty: 1, saleInvoice: 'S10', purchaseInvoice: 'P10', type: 'matched' });
  const [result] = applyPackagingIntelligence([dangerous], rules);
  assert.equal(result.type, 'quantity_mismatch');
  assert.equal(result.packaging_normalized_mismatch, true);
  assert.equal(result.expected_purchase_qty, 0.5);
});

test('conflicting two-strip and three-strip evidence never auto-learns a pack profile', () => {
  const cases = [
    transferCase({ id: 'a', saleQty: 1, purchaseQty: 0.5, saleInvoice: 'S1', purchaseInvoice: 'P1' }),
    transferCase({ id: 'b', saleQty: 1, purchaseQty: 0.333333, saleInvoice: 'S2', purchaseInvoice: 'P2' }),
  ];
  const profiles = buildPackagingProfiles(cases);
  assert.equal(profiles['43012'].status, 'conflicted');
  assert.equal(profiles['43012'].strips_per_box, null);
  const result = applyPackagingIntelligence(cases);
  assert.equal(result.some((item) => item.matched_by_packaging_profile), false);
});

test('ambiguous one-to-one strip versus unitless purchase is never used as learning evidence', () => {
  const cases = [
    transferCase({ id: 'raw-equal', saleQty: 1, purchaseQty: 1, saleInvoice: 'S1', purchaseInvoice: 'P1', type: 'matched' }),
  ];
  const profiles = buildPackagingProfiles(cases);
  assert.equal(profiles['43012'], undefined);
});

test('quantity labels keep the physical sales unit visible', () => {
  const item = transferCase({ id: 'labels', saleQty: 1, purchaseQty: 0.5, saleInvoice: 'S1', purchaseInvoice: 'P1' });
  const labels = caseQuantityLabels(item);
  assert.equal(labels.sale, '1 شريط');
  assert.equal(labels.purchase, '0.5 علبة مكافئة');
});
