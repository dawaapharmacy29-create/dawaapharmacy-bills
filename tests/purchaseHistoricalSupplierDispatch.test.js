import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(
  new URL('../supabase/migrations/20260930113000_purchase_mark_historical_supplier_sent_v1.sql', import.meta.url),
  'utf8'
);

test('historical supplier dispatch requires clean approval and historical v2 items', () => {
  assert.match(sql, /clean_approval_required/);
  assert.match(sql, /Approved reviewed historical dual allocation/);
  assert.match(sql, /historical_purchase_v2:%/);
  assert.match(sql, /cost_source<>'reference'/);
  assert.match(sql, /historical_supplier_items_not_send_ready/);
});

test('historical supplier dispatch is idempotent and snapshot-based', () => {
  assert.match(sql, /already_sent/);
  assert.match(sql, /on conflict\(order_id,supplier_name\) do nothing/);
  assert.match(sql, /snapshot_items/);
  assert.match(sql, /snapshot_hash/);
  assert.match(sql, /sha256/);
});

test('order is marked sent only when all suppliers are dispatched', () => {
  assert.match(sql, /v_sent>=v_required/);
  assert.match(sql, /status='تم الإرسال للمورد'/);
  assert.match(sql, /sent_at=coalesce\(sent_at,now\(\)\)/);
  assert.match(sql, /order_receiving_started/);
});
