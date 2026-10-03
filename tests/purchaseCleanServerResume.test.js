import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(
  new URL('../supabase/migrations/20260930160000_purchase_clean_sourcing_resume_v2.sql', import.meta.url),
  'utf8'
);

test('server resume is user-scoped, recent, and supports draft or dispatch stage', () => {
  assert.match(sql, /created_by_account_id=a\.id/);
  assert.match(sql, /interval '12 hours'/);
  assert.match(sql, /in \('draft','مسودة'\)/);
  assert.match(sql, /تم الإرسال للمورد/);
  assert.match(sql, /'stage',case/);
  assert.match(sql, /'dispatch'/);
  assert.match(sql, /purchase_order_receipts/);
  assert.match(sql, /purchase_shortage_events/);
  assert.match(sql, /shokry_sourcing_pending/);
  assert.match(sql, /shamy_sourcing_pending/);
  assert.match(sql, /'found',false/);
  assert.match(sql, /'found',true/);
});

test('one branch starting receiving does not hide the other branch sourcing launcher', () => {
  assert.match(sql, /rx\.order_id=d\.shokry_order_id/);
  assert.match(sql, /rx\.order_id=d\.shamy_order_id/);
  assert.match(sql, /sx\.order_id=d\.shokry_order_id/);
  assert.match(sql, /sx\.order_id=d\.shamy_order_id/);
  assert.match(sql, /shokry_sourcing_pending/);
  assert.match(sql, /shamy_sourcing_pending/);
});

test('planning resume ends only after both branches are handed to receiving or shortage follow-up', () => {
  assert.match(sql, /purchase_shortage_events/);
  assert.match(sql, /purchase_order_receipts/);
  assert.match(sql, /'مغلقة','closed'/);
  assert.doesNotMatch(sql, /order_id in \(d\.shokry_order_id,d\.shamy_order_id\)/);
});
