import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseTransferProductIdentity, extractTransferProductSignature } from '../src/lib/branchTransferProductIdentity.js';

test('extracts strength, pack count and dosage form from product names', () => {
  const signature = extractTransferProductSignature('Concor 5 mg 30 tab');
  assert.deepEqual(signature.strengths, ['5mg']);
  assert.equal(signature.pack_count, 30);
  assert.equal(signature.form?.key, 'tablet');
});

test('flags 20 tablets versus 30 tablets as different pack SKU', () => {
  const result = diagnoseTransferProductIdentity({
    saleName: 'Concor 5 mg 20 tab',
    purchaseName: 'Concor 5 mg 30 tab',
    saleCodes: ['A1'],
    purchaseCodes: ['B1'],
  });
  assert.equal(result.kind, 'different_pack');
  assert.equal(result.risk, 'high');
  assert.equal(result.auto_resolve, false);
});

test('flags different strengths even when base product name is the same', () => {
  const result = diagnoseTransferProductIdentity({
    saleName: 'Augmentin 625 mg 14 tab',
    purchaseName: 'Augmentin 1 g 14 tab',
    saleCodes: ['A1'],
    purchaseCodes: ['B1'],
  });
  assert.equal(result.kind, 'different_strength');
  assert.equal(result.auto_resolve, false);
});

test('flags syrup volume difference as different size', () => {
  const result = diagnoseTransferProductIdentity({
    saleName: 'Example Syrup 100 ml',
    purchaseName: 'Example Syrup 60 ml',
    saleCodes: ['A1'],
    purchaseCodes: ['B1'],
  });
  assert.equal(result.kind, 'different_size');
});

test('flags tablet versus syrup as different dosage form', () => {
  const result = diagnoseTransferProductIdentity({
    saleName: 'Example 5 mg 20 tab',
    purchaseName: 'Example 5 mg syrup 100 ml',
    saleCodes: ['A1'],
    purchaseCodes: ['B1'],
  });
  assert.equal(result.kind, 'different_form');
});

test('same explicit SKU descriptors with different codes becomes master-data investigation, never auto match', () => {
  const result = diagnoseTransferProductIdentity({
    saleName: 'ADWISTADINE 30 tab',
    purchaseName: 'ADWISTADINE 30 tab',
    saleCodes: ['100'],
    purchaseCodes: ['900'],
  });
  assert.equal(result.kind, 'likely_duplicate_code');
  assert.equal(result.auto_resolve, false);
  assert.match(result.action, /Master Data/i);
});

test('same loose name without enough SKU descriptors remains unresolved', () => {
  const result = diagnoseTransferProductIdentity({
    saleName: 'Example Product',
    purchaseName: 'Example Product',
    saleCodes: ['100'],
    purchaseCodes: ['900'],
  });
  assert.equal(result.kind, 'insufficient_evidence');
  assert.equal(result.auto_resolve, false);
});
