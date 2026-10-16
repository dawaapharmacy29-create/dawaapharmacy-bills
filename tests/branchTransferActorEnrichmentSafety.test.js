import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichSaleRowsWithInvoiceHeaders, saleHeaderCoverage } from '../src/lib/branchTransferEvidencePreparation.js';

test('exact invoice timestamp disambiguates duplicate header evidence safely', () => {
  const lineTime = new Date(2026, 9, 6, 18, 21);
  const rows = enrichSaleRowsWithInvoiceHeaders([
    { invoice: '76363', date: lineTime, user: '', product_name: 'Mirage', qty: 2 },
  ], [
    { invoice: '76363', date: lineTime, user: 'د دنيا', source_file: 'بيع شكري يوم 6.xlsx' },
    { invoice: '76363', date: new Date(2026, 9, 7, 10, 0), user: 'د أحمد', source_file: 'ملف آخر.xlsx' },
  ]);
  assert.equal(rows[0].user, 'د دنيا');
  assert.equal(rows[0].invoice_header_conflict, false);
  assert.equal(rows[0].invoice_header_match_reason, 'exact_time');
});

test('conflicting duplicate invoice headers never invent a doctor when time cannot disambiguate', () => {
  const lines = [{ invoice: '76363', date: '', user: '', product_name: 'Mirage', qty: 2 }];
  const headers = [
    { invoice: '76363', date: new Date(2026, 9, 6, 18, 21), user: 'د دنيا' },
    { invoice: '76363', date: new Date(2026, 9, 7, 10, 0), user: 'د أحمد' },
  ];
  const rows = enrichSaleRowsWithInvoiceHeaders(lines, headers);
  assert.equal(rows[0].user, '');
  assert.equal(rows[0].invoice_header_enriched, false);
  assert.equal(rows[0].invoice_header_conflict, true);
  assert.equal(rows[0].invoice_header_candidates.length, 2);
  const coverage = saleHeaderCoverage(lines, headers);
  assert.equal(coverage.covered_invoices, 0);
  assert.equal(coverage.ambiguous_invoices, 1);
  assert.deepEqual(coverage.ambiguous_invoice_numbers, ['76363']);
});

test('equivalent duplicate headers remain safe and count as covered', () => {
  const date = new Date(2026, 9, 6, 18, 21);
  const lines = [{ invoice: '76363', date, user: '' }];
  const headers = [
    { invoice: '76363', date, user: 'د دنيا' },
    { invoice: '76363', date, user: 'د دنيا' },
  ];
  const rows = enrichSaleRowsWithInvoiceHeaders(lines, headers);
  assert.equal(rows[0].user, 'د دنيا');
  assert.equal(rows[0].invoice_header_conflict, false);
  assert.equal(saleHeaderCoverage(lines, headers).coverage_percent, 100);
});
