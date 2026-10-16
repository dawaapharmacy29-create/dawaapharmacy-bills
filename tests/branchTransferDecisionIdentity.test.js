import test from 'node:test';
import assert from 'node:assert/strict';
import { findTransferDecision, transferDecisionIdentityKeys, writeTransferDecision } from '../src/lib/branchTransferDecisionIdentity.js';

function base(overrides = {}) {
  return {
    id: 'old-id',
    from: 'shamy',
    to: 'shokry',
    product_name: 'TEST PRODUCT',
    sale_codes: ['100'],
    purchase_codes: ['100'],
    sale_invoices: ['S-1'],
    purchase_invoices: [],
    day_key: '2026-10-10',
    ...overrides,
  };
}

test('decision survives when a later counterpart changes the generated case id', () => {
  const original = base();
  const decision = { status: 'verified', action: 'تم الحل' };
  const ledger = writeTransferDecision({}, original, decision);
  const regrouped = base({ id: 'new-id-after-late-purchase', purchase_invoices: ['P-9'] });
  assert.deepEqual(findTransferDecision(regrouped, ledger), decision);
});

test('purchase-origin decision survives when a later sale changes the case id', () => {
  const original = base({ id: 'purchase-only', sale_invoices: [], purchase_invoices: ['P-2'] });
  const decision = { status: 'dismissed', action: 'ليست مشكلة' };
  const ledger = writeTransferDecision({}, original, decision);
  const regrouped = base({ id: 'paired-later', sale_invoices: ['S-8'], purchase_invoices: ['P-2'] });
  assert.deepEqual(findTransferDecision(regrouped, ledger), decision);
});

test('identity aliases are isolated by direction and exact product code', () => {
  const item = base();
  const decision = { status: 'verified' };
  const ledger = writeTransferDecision({}, item, decision);
  assert.equal(findTransferDecision(base({ id: 'other', from: 'shokry', to: 'shamy' }), ledger), null);
  assert.equal(findTransferDecision(base({ id: 'other-code', sale_codes: ['200'], purchase_codes: ['200'] }), ledger), null);
});

test('current case id remains the first lookup key for backward compatibility', () => {
  const keys = transferDecisionIdentityKeys(base());
  assert.equal(keys[0], 'old-id');
});
