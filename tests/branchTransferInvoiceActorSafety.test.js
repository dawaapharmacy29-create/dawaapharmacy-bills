import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichSaleRowsWithInvoiceHeaders, saleHeaderCoverage } from '../src/lib/branchTransferEvidencePreparation.js';
import { buildOperationTimeline } from '../src/lib/branchTransferOperationTimeline.js';

test('rejects seller attribution when same invoice number has a conflicting timestamp', () => {
  const detailTime = new Date(2026, 9, 13, 16, 10, 0);
  const headerTime = new Date(2026, 9, 14, 16, 10, 0);
  const [row] = enrichSaleRowsWithInvoiceHeaders([
    { invoice: '39451', date: detailTime, user: '', product_name: 'FASTCURE 40 MG 14 CAP', qty: 1 },
  ], [
    { invoice: '39451', date: headerTime, user: 'د مغازي', source_file: 'بيع الشامي 3.xlsx' },
  ]);

  assert.equal(row.sale_actor, '');
  assert.equal(row.invoice_header_enriched, false);
  assert.equal(row.invoice_header_conflict, true);
  assert.equal(row.invoice_header_conflict_reason, 'invoice_time_mismatch');
  assert.equal(row.invoice_header_time_gap_minutes, 1440);
});

test('uses invoice header seller when invoice and timestamp agree within tolerance', () => {
  const detailTime = new Date(2026, 9, 13, 4, 10, 0);
  const headerTime = new Date(2026, 9, 13, 4, 11, 0);
  const [row] = enrichSaleRowsWithInvoiceHeaders([
    { invoice: '39451', date: detailTime, user: 'old-detail-user', product_name: 'FASTCURE 40 MG 14 CAP', qty: 1 },
  ], [
    { invoice: '39451', date: headerTime, user: 'د مغازي', source_file: 'بيع الشامي 3.xlsx' },
  ]);

  assert.equal(row.sale_line_user, 'old-detail-user');
  assert.equal(row.sale_actor, 'د مغازي');
  assert.equal(row.sale_actor_source, 'sales_invoice_header');
  assert.equal(row.sale_actor_confidence, 'verified_invoice_time');
  assert.equal(row.invoice_header_match_reason, 'time_aligned');
  assert.equal(row.invoice_header_time_gap_minutes, 1);
});

test('coverage separates timestamp mismatches from genuinely covered invoices', () => {
  const lines = [
    { invoice: '39451', date: new Date(2026, 9, 13, 4, 10, 0) },
    { invoice: '37740', date: new Date(2026, 9, 1, 23, 7, 0) },
  ];
  const headers = [
    { invoice: '39451', date: new Date(2026, 9, 13, 4, 10, 0), user: 'د مغازي' },
    { invoice: '37740', date: new Date(2026, 9, 2, 23, 7, 0), user: 'د عمرو صلاح' },
  ];
  const coverage = saleHeaderCoverage(lines, headers);
  assert.equal(coverage.covered_invoices, 1);
  assert.equal(coverage.time_mismatch_invoices, 1);
  assert.deepEqual(coverage.time_mismatch_invoice_numbers, ['37740']);
});

test('timeline exposes each invoice actor, Arabic date, quantity and source without mixing parties', () => {
  const saleTs = new Date(2026, 9, 13, 4, 10, 0).getTime();
  const purchaseTs = new Date(2026, 9, 13, 4, 45, 0).getTime();
  const timeline = buildOperationTimeline({
    cases: [{
      sale_lines: [
        { invoice: '39451', qty: 0.5, sale_actor: 'د مغازي', sale_actor_source: 'sales_invoice_header', sale_actor_confidence: 'verified_invoice_time', invoice_header_user: 'د مغازي', timestamp_ms: saleTs, source_file: 'بيع الشامي 3.xlsx' },
        { invoice: '39451', qty: 0.5, sale_actor: 'د مغازي', sale_actor_source: 'sales_invoice_header', sale_actor_confidence: 'verified_invoice_time', invoice_header_user: 'د مغازي', timestamp_ms: saleTs, source_file: 'بيع الشامي(1).xlsx' },
      ],
      purchase_lines: [
        { invoice: '19204', qty: 1, user: 'د مي', timestamp_ms: purchaseTs, source_file: 'شراء شكري 1.xlsx' },
      ],
    }],
  });

  const sale = timeline.sale.invoiceEvidence[0];
  const purchase = timeline.purchase.invoiceEvidence[0];
  assert.equal(sale.invoice, '39451');
  assert.equal(sale.actor, 'د مغازي');
  assert.equal(sale.qty, 1);
  assert.equal(sale.lineCount, 2);
  assert.equal(sale.actorConfidence, 'verified_invoice_time');
  assert.deepEqual(sale.sourceFiles.sort(), ['بيع الشامي 3.xlsx', 'بيع الشامي(1).xlsx'].sort());
  assert.match(sale.dateLabel, /الثلاثاء|Tuesday|الثلاثا/);
  assert.equal(purchase.invoice, '19204');
  assert.equal(purchase.actor, 'د مي');
  assert.equal(purchase.qty, 1);
  assert.equal(purchase.actorSource, 'purchase_invoice_header');
  assert.equal(timeline.gapMinutes, 35);
});
