import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourcesFromInspections, classifyParsedTransferFile } from '../src/lib/branchTransferAutoImport.js';

function parsed(format, rows) {
  return { valid: true, items: rows, warnings: [], meta: { source_format: format } };
}

test('classifies flat sale to Shamy by stable customer code 10', () => {
  const result = classifyParsedTransferFile(parsed('flat_transfer_rows', [
    { product_name: 'A', qty: 1, counterparty: 'دواء فرع الشامي', counterparty_code: '10' },
  ]));
  assert.equal(result.sourceKey, 'shokrySale');
  assert.equal(result.confidence, 'high');
  assert.equal(result.evidence, 'counterparty_code');
});

test('classifies flat sale to Abu El Azm by stable customer code 170 even with noisy name', () => {
  const result = classifyParsedTransferFile(parsed('flat_transfer_rows', [
    { product_name: 'A', qty: 1, counterparty: 'فرع ابو اااااالعزم', counterparty_code: 170 },
  ]));
  assert.equal(result.sourceKey, 'shamySale');
  assert.equal(result.confidence, 'high');
});

test('classifies purchase from Shokry by stable supplier code 300', () => {
  const result = classifyParsedTransferFile(parsed('bconnect_purchase_report', [
    { product_name: 'A', qty: 1, counterparty: 'دواء ابو العزم', counterparty_code: '300' },
  ]));
  assert.equal(result.sourceKey, 'shamyPurchase');
  assert.equal(result.confidence, 'high');
});

test('classifies purchase from Shamy by stable supplier code 475', () => {
  const result = classifyParsedTransferFile(parsed('bconnect_purchase_report', [
    { product_name: 'A', qty: 1, counterparty: 'دواء الشامي', counterparty_code: 475 },
  ]));
  assert.equal(result.sourceKey, 'shokryPurchase');
  assert.equal(result.confidence, 'high');
});

test('falls back to branch name when a known counterparty code is unavailable', () => {
  const result = classifyParsedTransferFile(parsed('flat_transfer_rows', [
    { product_name: 'A', qty: 1, counterparty: 'دواء فرع الشامي' },
  ]));
  assert.equal(result.sourceKey, 'shokrySale');
  assert.equal(result.confidence, 'medium');
});

test('fails closed when stable code and branch name contradict each other', () => {
  const result = classifyParsedTransferFile(parsed('flat_transfer_rows', [
    { product_name: 'A', qty: 1, counterparty: 'دواء الشامي', counterparty_code: '170' },
  ]));
  assert.equal(result.sourceKey, null);
  assert.equal(result.confidence, 'none');
});

test('fails closed when one file mixes stable codes for both branches', () => {
  const result = classifyParsedTransferFile(parsed('flat_transfer_rows', [
    { product_name: 'A', qty: 1, counterparty_code: '10' },
    { product_name: 'B', qty: 1, counterparty_code: '170' },
  ]));
  assert.equal(result.sourceKey, null);
  assert.match(result.reason, /متعارضة/);
});

test('groups multiple files for the same direction and rejects exact duplicate files', () => {
  const baseParsed = parsed('flat_transfer_rows', [
    { invoice: '1', code: '10', product_name: 'A', qty: 1, date: '2026-10-12', row_number: 2, source_format: 'flat_transfer_rows' },
  ]);
  const result = buildSourcesFromInspections([
    { fileName: 'a.xlsx', fileSize: 100, fingerprint: 'same-file', sourceKey: 'shokrySale', parsed: baseParsed },
    { fileName: 'a-copy.xlsx', fileSize: 100, fingerprint: 'same-file', sourceKey: 'shokrySale', parsed: baseParsed },
    { fileName: 'b.xlsx', fileSize: 120, fingerprint: 'other-file', sourceKey: 'shokrySale', parsed: parsed('flat_transfer_rows', [
      { invoice: '2', code: '11', product_name: 'B', qty: 2, date: '2026-10-12', row_number: 2, source_format: 'flat_transfer_rows' },
    ]) },
  ]);
  assert.deepEqual(result.sources.shokrySale.fileNames, ['a.xlsx', 'b.xlsx']);
  assert.equal(result.sources.shokrySale.items.length, 2);
  assert.deepEqual(result.duplicates, ['a-copy.xlsx']);
});

test('keeps ambiguous files out of automatic grouping', () => {
  const result = buildSourcesFromInspections([
    { fileName: 'unknown.xlsx', fileSize: 50, fingerprint: 'x', sourceKey: null, parsed: parsed('flat_transfer_rows', [{ product_name: 'A', qty: 1 }]), reason: 'unclear' },
  ]);
  assert.equal(result.ambiguous.length, 1);
  assert.equal(Object.keys(result.sources).length, 0);
});
