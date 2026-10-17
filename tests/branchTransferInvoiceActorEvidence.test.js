import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichSaleRowsWithInvoiceHeaders } from '../src/lib/branchTransferEvidencePreparation.js';
import { buildOperationTimeline } from '../src/lib/branchTransferOperationTimeline.js';

test('sales invoice header doctor becomes canonical seller evidence', () => {
  const saleDate = new Date(2026, 9, 13, 16, 54, 0);
  const [row] = enrichSaleRowsWithInvoiceHeaders([
    { invoice: '37534', product_name: 'pravotin plus 30 cap', code: '77654', qty: 3, user: '' },
  ], [
    { invoice: '37534', date: saleDate, user: 'د رضا', source_file: 'بيع الشامي 3.xlsx' },
  ]);

  assert.equal(row.user, 'د رضا');
  assert.equal(row.sale_actor, 'د رضا');
  assert.equal(row.sale_actor_source, 'sales_invoice_header');
  assert.equal(row.invoice_header_user, 'د رضا');
  assert.equal(row.invoice_header_source, 'بيع الشامي 3.xlsx');
});

test('timeline prefers invoice-header seller and exposes invoice/day/date evidence', () => {
  const saleTs = new Date(2026, 9, 13, 16, 54, 0).getTime();
  const purchaseTs = new Date(2026, 9, 13, 17, 12, 0).getTime();
  const timeline = buildOperationTimeline({
    cases: [{
      sale_lines: [{
        invoice: '37534',
        user: '',
        sale_actor: 'د رضا',
        invoice_header_user: 'د رضا',
        timestamp_ms: saleTs,
        source_file: 'بيع الشامي 3.xlsx',
      }],
      purchase_lines: [{
        invoice: '19204',
        user: 'د مي',
        timestamp_ms: purchaseTs,
        source_file: 'شراء شكري.xlsx',
      }],
    }],
  });

  assert.equal(timeline.sale.userLabel, 'د رضا');
  assert.equal(timeline.purchase.userLabel, 'د مي');
  assert.equal(timeline.sale.invoiceEvidence[0].invoice, '37534');
  assert.equal(timeline.sale.invoiceEvidence[0].actor, 'د رضا');
  assert.equal(timeline.sale.invoiceEvidence[0].actorSource, 'sales_invoice_header');
  assert.match(timeline.sale.invoiceEvidence[0].dateLabel, /2026|٢٠٢٦/);
  assert.match(timeline.sale.timeLabel, /37534/);
  assert.match(timeline.purchase.timeLabel, /19204/);
});
