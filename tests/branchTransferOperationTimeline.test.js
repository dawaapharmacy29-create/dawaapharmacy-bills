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
  assert.equal(value.timestamps.length, 1);
  assert.notEqual(value.timeLabel, 'غير متاح في الملف');
  assert.match(value.timeLabel, /·/);
});

test('does not invent missing operator or time data', () => {
  const value = buildSideOperationMetadata(incident([
    { purchase_lines: [{ user: '', invoice: '1', timestamp_ms: null }] },
  ]), 'purchase');
  assert.equal(value.userLabel, 'غير متاح في الملف');
  assert.equal(value.timeLabel, 'غير متاح في الملف');
});

test('shows multiple users explicitly instead of selecting one arbitrarily', () => {
  const value = buildSideOperationMetadata(incident([
    { purchase_lines: [
      { user: 'د أحمد', invoice: '1', timestamp_ms: 1000 },
      { user: 'د محمود', invoice: '1', timestamp_ms: 1000 },
    ] },
  ]), 'purchase');
  assert.match(value.userLabel, /أكثر من مستخدم/);
  assert.match(value.userLabel, /د أحمد/);
  assert.match(value.userLabel, /د محمود/);
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
