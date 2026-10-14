import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTransferCodeConflict, findRollingEvidence, mergeRollingEvidence } from '../src/lib/branchTransferRollingEvidence.js';

const branch = { branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' };

test('finds a delayed exact-code sale that fully explains a purchase-heavy quantity difference', () => {
  const base = new Date(2026, 9, 10, 20, 0).getTime();
  const archive = mergeRollingEvidence([], [
    { ...branch, code: '36034', product_name: 'IRUXOL OINT', qty: 1, invoice: 'S1', user: 'د أحمد', date: new Date(base) },
    { ...branch, code: '36034', product_name: 'IRUXOL OINT', qty: 1, invoice: 'S2', user: 'د محمد', date: new Date(base + 2 * 86400000) },
  ], []);
  const item = {
    type: 'quantity_mismatch', from: 'shamy', to: 'shokry', product_name: 'IRUXOL OINT',
    sale_qty: 1, purchase_qty: 2, sale_codes: ['36034'], purchase_codes: ['36034'],
    sale_lines: [{ side: 'sale', from: 'shamy', to: 'shokry', invoice: 'S1', code: '36034', product_name: 'IRUXOL OINT', qty: 1, user: 'د أحمد', timestamp_ms: base, day_key: '2026-10-10' }],
    purchase_lines: [{ side: 'purchase', from: 'shamy', to: 'shokry', invoice: 'P1', code: '36034', product_name: 'IRUXOL OINT', qty: 2, user: 'د محمود', timestamp_ms: base + 10 * 60000, day_key: '2026-10-10' }],
  };
  const evidence = findRollingEvidence(item, archive);
  assert.equal(evidence.missingQty, 1);
  assert.equal(evidence.best?.invoice, 'S2');
  assert.equal(evidence.best?.user, 'د محمد');
  assert.equal(evidence.mayExplainFully, true);
});

test('same normalized name with different branch codes is always surfaced as a conflict', () => {
  const conflict = detectTransferCodeConflict({
    product_name: 'IRUXOL OINT', sale_product_name: 'IRUXOL OINT', purchase_product_name: 'IRUXOL OINT',
    sale_codes: ['36034'], purchase_codes: ['99999'],
  });
  assert.equal(conflict.conflict, true);
  assert.deepEqual(conflict.saleCodes, ['36034']);
  assert.deepEqual(conflict.purchaseCodes, ['99999']);
});

test('different-code same-name delayed evidence never auto-explains the gap', () => {
  const base = new Date(2026, 9, 10, 20, 0).getTime();
  const archive = mergeRollingEvidence([], [
    { ...branch, code: '99999', product_name: 'IRUXOL OINT', qty: 1, invoice: 'S2', user: 'د محمد', date: new Date(base + 86400000) },
  ], []);
  const item = {
    type: 'quantity_mismatch', from: 'shamy', to: 'shokry', product_name: 'IRUXOL OINT',
    sale_qty: 1, purchase_qty: 2, sale_codes: ['36034'], purchase_codes: ['36034'],
    sale_lines: [{ side: 'sale', from: 'shamy', to: 'shokry', invoice: 'S1', code: '36034', product_name: 'IRUXOL OINT', qty: 1, timestamp_ms: base, day_key: '2026-10-10' }],
    purchase_lines: [{ side: 'purchase', from: 'shamy', to: 'shokry', invoice: 'P1', code: '36034', product_name: 'IRUXOL OINT', qty: 2, timestamp_ms: base + 10 * 60000, day_key: '2026-10-10' }],
  };
  const evidence = findRollingEvidence(item, archive);
  assert.equal(evidence.best?.differentCodeSameName, true);
  assert.equal(evidence.mayExplainFully, false);
});
