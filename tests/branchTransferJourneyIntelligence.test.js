import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTransferRows } from '../src/lib/branchTransferShadowParser.js';
import { buildSourcesFromInspections, classifyParsedTransferFile } from '../src/lib/branchTransferAutoImport.js';
import { enrichSaleRowsWithInvoiceHeaders, saleHeaderCoverage } from '../src/lib/branchTransferEvidencePreparation.js';
import { reconcileBranchTransfers } from '../src/lib/branchTransferControlSmartEngine.js';

test('preserves two sale rows of the same invoice/code when expiry differs and reconciles their summed quantity', () => {
  const parsed = parseTransferRows([
    ['فاتورة', 'نوع', 'كود', 'عميل', 'م', 'ك.صنف', 'صنف', 'صلاحية', 'كمية', 'وحدة', 'تاريخ'],
    [76363, 'آجل', 10, 'دواء الشامي', 1, 67630, 'Mirage 1 g 1 ampoule 20%', '2029/04', 1, 'علبة', new Date(2026, 9, 6, 18, 21)],
    [76363, 'آجل', 10, 'دواء الشامي', 2, 67630, 'Mirage 1 g 1 ampoule 20%', '2029/05', 1, 'علبة', new Date(2026, 9, 6, 18, 21)],
  ], { branch: 'الادارة فرع شكري' });

  assert.equal(parsed.valid, true);
  assert.equal(parsed.items.length, 2);
  assert.deepEqual(parsed.items.map((item) => item.expiration_raw), ['2029/04', '2029/05']);

  const purchase = [{
    invoice: '10985', code: '67630', product_name: 'Mirage 1 g 1 ampoule 20%', qty: 2,
    date: new Date(2026, 9, 6, 18, 38), user: 'د رضا', branch: 'الفرعية الشامي', counterparty: 'دواء ابو العزم',
  }];
  const cases = reconcileBranchTransfers(parsed.items, purchase);
  const item = cases.find((entry) => entry.sale_codes?.includes('67630') || entry.purchase_codes?.includes('67630'));
  assert.ok(item);
  assert.equal(item.type, 'matched');
  assert.equal(item.sale_qty, 2);
  assert.equal(item.purchase_qty, 2);
  assert.equal(item.sale_lines.length, 2);
});

test('balances one sale invoice against multiple nearby purchase invoices as one journey', () => {
  const sale = [{
    invoice: '80001', code: '55555', product_name: 'Journey Product', qty: 3,
    date: new Date(2026, 9, 10, 10, 0), branch: 'الادارة فرع شكري', counterparty: 'دواء الشامي',
  }];
  const purchases = [
    { invoice: '12001', code: '55555', product_name: 'Journey Product', qty: 2, date: new Date(2026, 9, 10, 10, 15), branch: 'الفرعية الشامي', counterparty: 'دواء ابو العزم' },
    { invoice: '12002', code: '55555', product_name: 'Journey Product', qty: 1, date: new Date(2026, 9, 10, 10, 35), branch: 'الفرعية الشامي', counterparty: 'دواء ابو العزم' },
  ];
  const cases = reconcileBranchTransfers(sale, purchases);
  const item = cases.find((entry) => entry.sale_codes?.includes('55555'));
  assert.ok(item);
  assert.equal(item.type, 'matched');
  assert.equal(item.sale_qty, 3);
  assert.equal(item.purchase_qty, 3);
  assert.equal(item.episode_balanced, true);
  assert.deepEqual(item.purchase_invoices.sort(), ['12001', '12002']);
});

test('parses the B-Connect sales invoice header report and classifies it as Shokry sale enrichment', () => {
  const parsed = parseTransferRows([
    ['الرقم', 'النوع', 'الكود', 'العميل', 'التاريخ', 'ع.أصناف', 'المستخدم'],
    [76363, 'آجل', 10, 'دواء الشامي', new Date(2026, 9, 6, 18, 21), 3, 'د دنيا'],
  ]);
  assert.equal(parsed.meta.source_format, 'bconnect_sales_invoice_headers');
  assert.equal(parsed.items[0].invoice, '76363');
  assert.equal(parsed.items[0].user, 'د دنيا');

  const classification = classifyParsedTransferFile(parsed);
  assert.equal(classification.sourceKey, 'shokrySaleHeaders');
  assert.equal(classification.confidence, 'high');
});

test('enriches sale lines with the doctor from matching invoice headers without changing product evidence', () => {
  const lines = [{ invoice: '76363', code: '67630', product_name: 'Mirage', qty: 1, date: new Date(2026, 9, 6, 18, 21), user: '' }];
  const headers = [{ invoice: '76363', date: new Date(2026, 9, 6, 18, 21), user: 'د دنيا', source_file: 'بيع شكرررررري.xlsx' }];
  const enriched = enrichSaleRowsWithInvoiceHeaders(lines, headers);
  assert.equal(enriched[0].user, 'د دنيا');
  assert.equal(enriched[0].code, '67630');
  assert.equal(enriched[0].qty, 1);
  assert.equal(enriched[0].invoice_header_enriched, true);
  assert.equal(saleHeaderCoverage(lines, headers).coverage_percent, 100);
});

test('auto import enriches Shokry sale rows when both detail and header files are uploaded together', () => {
  const result = buildSourcesFromInspections([
    {
      fileName: 'بيع شكري(1).xlsx', fileSize: 100, fingerprint: 'details', sourceKey: 'shokrySale',
      parsed: { valid: true, warnings: [], meta: { source_format: 'flat_transfer_rows' }, items: [{ row_number: 5, invoice: '76363', code: '67630', product_name: 'Mirage', qty: 1, date: new Date(2026, 9, 6, 18, 21), user: '', branch: 'الادارة فرع شكري', counterparty: 'دواء الشامي', source_format: 'flat_transfer_rows' }] },
    },
    {
      fileName: 'بيع شكرررررري.xlsx', fileSize: 50, fingerprint: 'headers', sourceKey: 'shokrySaleHeaders',
      parsed: { valid: true, warnings: [], meta: { source_format: 'bconnect_sales_invoice_headers' }, items: [{ row_number: 3, invoice: '76363', date: new Date(2026, 9, 6, 18, 21), user: 'د دنيا', branch: 'الادارة فرع شكري', counterparty: 'دواء الشامي', source_format: 'bconnect_sales_invoice_headers' }] },
    },
  ]);
  assert.equal(result.sources.shokrySale.items[0].user, 'د دنيا');
  assert.equal(result.sources.shokrySale.items[0].invoice_header_enriched, true);
  assert.equal(result.sources.shokrySaleHeaders.items.length, 1);
});
