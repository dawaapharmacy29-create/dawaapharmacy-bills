import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBranchTransfers } from '../src/lib/branchTransferControl.js';

const sale = (name, code, qty = 1) => ({
  branch: 'دواء فرع الشامي',
  counterparty: 'دواء فرع ابو العزم',
  product_name: name,
  code,
  qty,
  invoice: 'S-1',
  date: '2026-10-12 10:00',
});

const purchase = (name, code, qty = 1) => ({
  branch: 'دواء فرع ابو العزم',
  counterparty: 'دواء فرع الشامي',
  product_name: name,
  code,
  qty,
  invoice: 'P-1',
  date: '2026-10-12 10:20',
});

test('different pack count stays one visible code-mismatch investigation case', () => {
  const cases = reconcileBranchTransfers(
    [sale('Concor 5 mg 20 tab', 'A1')],
    [purchase('Concor 5 mg 30 tab', 'B1')],
  );
  assert.equal(cases.length, 1);
  assert.equal(cases[0].type, 'code_mismatch');
  assert.equal(cases[0].identity_diagnosis?.kind, 'different_pack');
  assert.equal(cases[0].severity, 92);
  assert.match(cases[0].next_action, /20 مقابل 30/);
});

test('different strength is never reduced to a quantity mismatch or auto match', () => {
  const cases = reconcileBranchTransfers(
    [sale('Augmentin 625 mg 14 tab', 'A1', 2)],
    [purchase('Augmentin 1 g 14 tab', 'B1', 1)],
  );
  assert.equal(cases.length, 1);
  assert.equal(cases[0].type, 'code_mismatch');
  assert.equal(cases[0].identity_diagnosis?.kind, 'different_strength');
  assert.match(cases[0].next_action, /فرق كمية/);
});

test('same explicit SKU with two codes remains code mismatch and points to master data', () => {
  const cases = reconcileBranchTransfers(
    [sale('ADWISTADINE 30 tab', '100')],
    [purchase('ADWISTADINE 30 tab', '900')],
  );
  assert.equal(cases[0].type, 'code_mismatch');
  assert.equal(cases[0].identity_diagnosis?.kind, 'likely_duplicate_code');
  assert.equal(cases[0].identity_diagnosis?.auto_resolve, false);
  assert.match(cases[0].next_action, /Master Data/i);
});
