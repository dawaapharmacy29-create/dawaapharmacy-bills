import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOperationTimeline, buildSideOperationMetadata } from '../src/lib/branchTransferOperationTimeline.js';

function incident(cases) {
  return { cases };
}

test('extracts invoice user and timestamp once from grouped sale lines', () => {
  const value = buildSideOperationMetadata(incident([
    { sale_lines: [
      { user: 'د علياء سامي', invoice: '10769', timestamp_ms: new Date(2026, 9, 13, 23, 42).getTime() },
      { user: 'د علياء سامي', invoice: '10769', timestamp_ms: new Date(2026, 9, 13, 23, 42).getTime() },
    ] },
  ]), 'sale');
  assert.equal(value.userLabel, 'د علياء سامي');
  assert.deepEqual(value.invoices, ['10769']);
  assert.equal(value.invoiceLabel, 'فاتورة 10769');
  assert.equal(value.timestamps.length, 1);
  assert.match(value.timeLabel, /فاتورة 10769/);
  assert.match(value.timeLabel, /·/);
});

test('does not invent missing operator or time data while preserving known invoice identity', () => {
  const value = buildSideOperationMetadata(incident([
    { purchase_lines: [{ user: '', invoice: '1', timestamp_ms: null }] },
  ]), 'purchase');
  assert.equal(value.userLabel, 'غير متاح في الملف');
  assert.equal(value.invoiceLabel, 'فاتورة 1');
  assert.match(value.timeLabel, /فاتورة 1/);
  assert.match(value.timeLabel, /الوقت غير متاح/);
});

test('shows multiple users and invoices explicitly instead of selecting one arbitrarily', () => {
  const value = buildSideOperationMetadata(incident([
    { purchase_lines: [
      { user: 'د أحمد', invoice: '1', timestamp_ms: 1000 },
      { user: 'د محمود', invoice: '2', timestamp_ms: 1000 },
    ] },
  ]), 'purchase');
  assert.match(value.userLabel, /أكثر من مستخدم/);
  assert.match(value.userLabel, /د أحمد/);
  assert.match(value.userLabel, /د محمود/);
  assert.match(value.invoiceLabel, /1/);
  assert.match(value.invoiceLabel, /2/);
  assert.match(value.timeLabel, /فواتير/);
});

test('calculates readable gap only when both sides have timestamps', () => {
  const saleTime = new Date(2026, 9, 13, 23, 58).getTime();
  const purchaseTime = new Date(2026, 9, 14, 0, 5).getTime();
  const value = buildOperationTimeline(incident([
    {
      sale_lines: [{ user: 'أ', invoice: 'S', timestamp_ms: saleTime }],
      purchase_lines: [{ user: 'ب', invoice: 'P', timestamp_ms: purchaseTime }],
    },
  ]));
  assert.equal(Math.round(value.gapMinutes), 7);
  assert.equal(value.gapLabel, '7 دقيقة بين الطرفين');
});

test('unitless B-Connect purchase evidence never claims a box before packaging is trusted', () => {
  const value = buildSideOperationMetadata(incident([
    {
      purchase_lines: [{
        user: 'د عمر', invoice: '19893', qty: 1, unit: '', timestamp_ms: new Date(2026, 9, 12, 20, 21).getTime(),
        raw: { source_format: 'bconnect_purchase_report' },
      }],
    },
  ]), 'purchase');

  assert.equal(value.invoiceEvidence.length, 1);
  assert.equal(value.invoiceEvidence[0].qtyLabel, '1 وحدة · العبوة غير محددة');
  assert.doesNotMatch(value.invoiceEvidence[0].qtyLabel, /علبة/);
});

test('invoice evidence keeps mixed units separate instead of showing their numeric sum', () => {
  const value = buildSideOperationMetadata(incident([
    {
      sale_lines: [
        { user: 'د اختبار', invoice: 'S10', qty: 10, unit: 'وحدة', timestamp_ms: 1000 },
        { user: 'د اختبار', invoice: 'S10', qty: 1, unit: 'علبة', timestamp_ms: 1000 },
      ],
    },
  ]), 'sale');

  assert.equal(value.invoiceEvidence.length, 1);
  assert.equal(value.invoiceEvidence[0].mixedUnits, true);
  assert.equal(value.invoiceEvidence[0].qtyDisplay.kind, 'mixed');
  assert.equal(value.invoiceEvidence[0].qtyLabel, '10 وحدة + 1 علبة');
  assert.doesNotMatch(value.invoiceEvidence[0].qtyLabel, /^11\b/);
});
