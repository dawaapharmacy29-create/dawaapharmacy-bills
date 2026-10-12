import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourcesFromInspections, classifyParsedTransferFile } from '../src/lib/branchTransferAutoImport.js';

function parsed(format, rows) {
  return { valid: true, items: rows, warnings: [], meta: { source_format: format } };
}

test('classifies flat sale to Shamy as Shokry sale', () => {
  const result = classifyParsedTransferFile(parsed('flat_transfer_rows', [
    { product_name: 'A', qty: 1, counterparty: 'دواء فرع الشامي' },
  ]));
  assert.equal(result.sourceKey, 'shokrySale');
  assert.equal(result.confidence, 'high');
});

test('classifies flat sale to Abu El Azm as Shamy sale', () => {
  const result = classifyParsedTransferFile(parsed('flat_transfer_rows', [
    { product_name: 'A', qty: 1, counterparty: 'فرع ابو اااااالعزم' },
  ]));
  assert.equal(result.sourceKey, 'shamySale');
});

test('classifies purchase supplier Shokry/Abu El Azm as Shamy purchase', () => {
  const result = classifyParsedTransferFile(parsed('bconnect_purchase_report', [
    { product_name: 'A', qty: 1, counterparty: 'دواء ابو العزم' },
  ]));
  assert.equal(result.sourceKey, 'shamyPurchase');
});

test('classifies purchase supplier Shamy as Shokry purchase', () => {
  const result = classifyParsedTransferFile(parsed('bconnect_purchase_report', [
    { product_name: 'A', qty: 1, counterparty: 'دواء الشامي' },
  ]));
  assert.equal(result.sourceKey, 'shokryPurchase');
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
