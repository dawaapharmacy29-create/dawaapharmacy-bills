import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(
  new URL('../supabase/migrations/20260930151500_purchase_shortage_registry_v1.sql', import.meta.url),
  'utf8'
);

test('shortage registry preserves one historical occurrence per purchase order item', () => {
  assert.match(sql, /create table if not exists public\.purchase_shortage_events/);
  assert.match(sql, /purchase_shortage_events_order_item_uidx/);
  assert.match(sql, /initial_shortage_quantity/);
  assert.match(sql, /current_shortage_quantity/);
  assert.match(sql, /initial_shortage_type/);
  assert.match(sql, /current_shortage_type/);
});

test('zero supply and limited supply are distinct shortage types', () => {
  assert.match(sql, /initial_shortage_type in \('unavailable','limited_supply'\)/);
  assert.match(sql, /when v_allocated<=0 then 'unavailable' else 'limited_supply'/);
});

test('later supplier allocation or receipt updates current shortage without deleting history', () => {
  assert.match(sql, /purchase_shortage_allocation_sync_v1/);
  assert.match(sql, /smart_purchase_sync_shortage_event_for_item_v1/);
  assert.match(sql, /current_received_quantity=v_received/);
  assert.match(sql, /when v_shortage<=0 then 'covered_later'/);
  assert.doesNotMatch(sql, /delete from public\.purchase_shortage_events/);
});

test('registering remaining order shortage is server-authoritative, branch-guarded and idempotent', () => {
  assert.match(sql, /p_action='register_order'/);
  assert.match(sql, /smart_purchase_branch_allowed_v2/);
  assert.match(sql, /supplier_response_required/);
  assert.match(sql, /where e\.order_item_id=i\.id/);
  assert.match(sql, /v_existing:=v_existing\+1/);
});

test('registry read exposes recurring and limited-supply signals across purchase cycles', () => {
  assert.match(sql, /p_action='list'/);
  assert.match(sql, /shortage_occurrences/);
  assert.match(sql, /limited_supply_occurrences/);
  assert.match(sql, /is_recurring/);
  assert.match(sql, /is_chronic/);
  assert.match(sql, /supply_coverage_pct/);
  assert.match(sql, /received_coverage_pct/);
});

test('shortage tables are not directly exposed to client roles', () => {
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.purchase_shortage_events from public,anon,authenticated/);
  assert.match(sql, /revoke all on function public\.smart_purchase_shortage_registry_v1\(text,text,jsonb\) from public/);
});

test('a new purchase cycle supersedes the previous open shortage without inflating current shortage', () => {
  assert.match(sql, /status in \('open','covered_later','superseded'\)/);
  assert.match(sql, /set status='superseded'/);
  assert.match(sql, /previous\.branch=o\.branch/);
  assert.match(sql, /previous\.product_key=v_key/);
  assert.match(sql, /previous\.order_item_id is distinct from i\.id/);
  assert.match(sql, /when e\.status='superseded' then 'superseded'/);
  assert.match(sql, /sum\(e\.current_shortage_quantity\) filter\(where e\.status='open'\)/);
});

test('physical partial receipt becomes the authoritative current shortage after receiving starts', () => {
  assert.match(sql, /shortage_basis text not null default 'sourcing'/);
  assert.match(sql, /shortage_basis in \('sourcing','receipt'\)/);
  assert.match(sql, /smart_purchase_ensure_receipt_shortage_event_v1/);
  assert.match(sql, /v_coverage:=case when v_basis='receipt' then v_received else v_allocated end/);
  assert.match(sql, /coalesce\(new\.received_quantity,0\)>coalesce\(old\.received_quantity,0\)/);
  assert.match(sql, /shortage_basis='receipt'/);
});

test('internal shortage helper and trigger functions are not exposed as client RPCs', () => {
  assert.match(sql, /smart_purchase_shortage_product_key_v1\(text,text\) from public,anon,authenticated/);
  assert.match(sql, /smart_purchase_sync_shortage_event_for_item_v1\(uuid\) from public,anon,authenticated/);
  assert.match(sql, /smart_purchase_ensure_receipt_shortage_event_v1\(uuid\) from public,anon,authenticated/);
  assert.match(sql, /purchase_shortage_allocation_sync_trigger_v1\(\) from public,anon,authenticated/);
});
