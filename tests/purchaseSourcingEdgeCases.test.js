import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const allocationSql = await readFile(
  new URL('../supabase/migrations/20260930142000_purchase_supplier_actual_allocations_v1.sql', import.meta.url),
  'utf8'
);
const shortageSql = await readFile(
  new URL('../supabase/migrations/20260930151500_purchase_shortage_registry_v1.sql', import.meta.url),
  'utf8'
);
const guardSql = await readFile(
  new URL('../supabase/migrations/20260930161500_purchase_shortage_handoff_planning_guard_v1.sql', import.meta.url),
  'utf8'
);

const sourcingRemaining = (requested, allocations = []) => Math.max(
  0,
  requested - allocations.reduce((sum, value) => sum + Math.max(0, value), 0)
);

const shortageNow = ({ requested, allocated, received, basis }) => {
  const coverage = basis === 'receipt' ? received : allocated;
  return Math.max(0, requested - coverage);
};

test('edge case 1: completely unavailable item becomes an open unavailable shortage', () => {
  const requested = 30;
  const allocated = 0;
  const remaining = sourcingRemaining(requested, []);
  assert.equal(remaining, 30);
  assert.equal(shortageNow({ requested, allocated, received: 0, basis: 'sourcing' }), 30);

  assert.match(shortageSql, /when v_coverage<=0 then 'unavailable'/);
  assert.match(guardSql, /where e\.order_item_id=i\.id/);
});

test('edge case 2: Avil 30 requested and only 4 actually arrive stays shortage 26', () => {
  const requested = 30;
  const allocated = 4;
  const received = 4;

  assert.equal(sourcingRemaining(requested, [allocated]), 26);
  assert.equal(shortageNow({ requested, allocated, received, basis: 'receipt' }), 26);

  assert.match(shortageSql, /v_coverage:=case when v_basis='receipt' then v_received else v_allocated end/);
  assert.match(shortageSql, /shortage_basis='receipt'/);
  assert.match(shortageSql, /when v_coverage<=0 then 'unavailable' else 'limited_supply'/);
});

test('edge case 2b: supplier promised 30 but only 4 arrived also becomes shortage 26', () => {
  const requested = 30;
  const allocated = 30;
  const received = 4;

  assert.equal(sourcingRemaining(requested, [allocated]), 0);
  assert.equal(shortageNow({ requested, allocated, received, basis: 'receipt' }), 26);

  assert.match(shortageSql, /smart_purchase_ensure_receipt_shortage_event_v1/);
  assert.match(shortageSql, /coalesce\(new\.received_quantity,0\)>coalesce\(old\.received_quantity,0\)/);
});

test('edge case 3: full split coverage across suppliers has zero sourcing shortage', () => {
  const requested = 20;
  const allocations = [12, 8];

  assert.equal(sourcingRemaining(requested, allocations), 0);
  assert.match(allocationSql, /v_confirmed>v_capacity\+0\.0001/);

  const helper = guardSql.slice(
    guardSql.indexOf('create or replace function public.smart_purchase_order_shortage_handoff_complete_v1'),
    guardSql.indexOf('revoke all on function public.smart_purchase_order_shortage_handoff_complete_v1')
  );
  assert.doesNotMatch(helper, /where e\.order_id=p_order_id[\s\S]{0,80}and not exists/);
});

test('split allocation cannot exceed the requested order quantity', () => {
  const requested = 20;
  const first = 12;
  const remainingCapacity = requested - first;

  assert.equal(remainingCapacity, 8);
  assert.equal(8 <= remainingCapacity, true);
  assert.equal(9 <= remainingCapacity, false);

  assert.match(allocationSql, /v_capacity:=greatest\(0,greatest\(0,coalesce\(i\.approved_quantity,i\.requested_quantity,0\)\)-v_other_allocated\)/);
  assert.match(allocationSql, /supplier_allocation_above_order/);
});
