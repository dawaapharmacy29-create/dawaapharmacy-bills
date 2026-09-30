import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(
  new URL('../supabase/migrations/20260930161500_purchase_shortage_handoff_planning_guard_v1.sql', import.meta.url),
  'utf8'
);

test('shortage handoff requires an explicit persistent shortage event', () => {
  assert.match(sql, /purchase_shortage_events e/);
  assert.match(sql, /where e\.order_id=p_order_id/);
});

test('only unallocated sourcing gaps must be represented in shortage events', () => {
  assert.match(sql, /approved_quantity,i\.requested_quantity/);
  assert.match(sql, /sum\(greatest\(0,a\.allocated_quantity\)\)/);
  assert.match(sql, /where e\.order_item_id=i\.id/);
});

test('completed shortage handoff no longer blocks the next planning cycle', () => {
  assert.match(sql, /not public\.smart_purchase_order_shortage_handoff_complete_v1\(o\.id\)/);
  assert.match(sql, /smart_purchase_branch_has_blocking_order_clean_v1/);
});

test('internal guard helpers are fixed-search-path and not client callable', () => {
  assert.match(sql, /set search_path='pg_catalog','public'/);
  assert.match(sql, /smart_purchase_order_shortage_handoff_complete_v1\(uuid\)[\s\S]*from public,anon,authenticated/);
  assert.match(sql, /smart_purchase_branch_has_blocking_order_clean_v1\(text\)[\s\S]*from public,anon,authenticated/);
});

test('fully allocated order does not require a fake shortage event', () => {
  const helper = sql.slice(
    sql.indexOf('create or replace function public.smart_purchase_order_shortage_handoff_complete_v1'),
    sql.indexOf('revoke all on function public.smart_purchase_order_shortage_handoff_complete_v1')
  );
  assert.doesNotMatch(helper, /exists\([\s\S]{0,120}purchase_shortage_events e[\s\S]{0,80}where e\.order_id=p_order_id[\s\S]{0,40}\)\s*and\s*not exists/);
  assert.match(helper, /not exists\([\s\S]*approved_quantity,i\.requested_quantity[\s\S]*sum\(greatest\(0,a\.allocated_quantity\)\)/);
});
