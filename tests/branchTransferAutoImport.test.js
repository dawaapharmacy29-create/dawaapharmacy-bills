import { describe, expect, it } from 'vitest';
import { buildSourcesFromInspections, classifyParsedTransferFile } from '../src/lib/branchTransferAutoImport.js';

function parsed(format, rows) {
  return { valid: true, items: rows, warnings: [], meta: { source_format: format } };
}

describe('branch transfer automatic import', () => {
  it('classifies flat sale to Shamy as Shokry sale', () => {
    const result = classifyParsedTransferFile(parsed('flat_transfer_rows', [
      { product_name: 'A', qty: 1, counterparty: 'دواء فرع الشامي' },
    ]));
    expect(result.sourceKey).toBe('shokrySale');
    expect(result.confidence).toBe('high');
  });

  it('classifies flat sale to Abu El Azm as Shamy sale', () => {
    const result = classifyParsedTransferFile(parsed('flat_transfer_rows', [
      { product_name: 'A', qty: 1, counterparty: 'فرع ابو اااااالعزم' },
    ]));
    expect(result.sourceKey).toBe('shamySale');
  });

  it('classifies purchase supplier Shokry/Abu El Azm as Shamy purchase', () => {
    const result = classifyParsedTransferFile(parsed('bconnect_purchase_report', [
      { product_name: 'A', qty: 1, counterparty: 'دواء ابو العزم' },
    ]));
    expect(result.sourceKey).toBe('shamyPurchase');
  });

  it('classifies purchase supplier Shamy as Shokry purchase', () => {
    const result = classifyParsedTransferFile(parsed('bconnect_purchase_report', [
      { product_name: 'A', qty: 1, counterparty: 'دواء الشامي' },
    ]));
    expect(result.sourceKey).toBe('shokryPurchase');
  });

  it('groups multiple files for the same direction and rejects exact duplicate files', () => {
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
    expect(result.sources.shokrySale.fileNames).toEqual(['a.xlsx', 'b.xlsx']);
    expect(result.sources.shokrySale.items).toHaveLength(2);
    expect(result.duplicates).toEqual(['a-copy.xlsx']);
  });

  it('keeps ambiguous files out of automatic grouping', () => {
    const result = buildSourcesFromInspections([
      { fileName: 'unknown.xlsx', fileSize: 50, fingerprint: 'x', sourceKey: null, parsed: parsed('flat_transfer_rows', [{ product_name: 'A', qty: 1 }]), reason: 'unclear' },
    ]);
    expect(result.ambiguous).toHaveLength(1);
    expect(Object.keys(result.sources)).toHaveLength(0);
  });
});
