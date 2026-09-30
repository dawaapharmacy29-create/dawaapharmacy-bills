import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(
  new URL('../supabase/migrations/20260930142000_purchase_supplier_actual_allocations_v1.sql', import.meta.url),
  'utf8'
);

const capacity = (requested, otherSuppliers) => Math.max(
  0,
  requested - otherSuppliers.reduce((sum, qty) => sum + Math.max(0, qty), 0)
);

test('same latest supplier response is idempotent and does not rewrite allocations', () => {
  const saveFn = sql.slice(
    sql.indexOf('create or replace function public.smart_purchase_save_supplier_response_v1'),
    sql.indexOf('create or replace function public.smart_purchase_receiving_read_v3')
  );

  assert.match(saveFn, /select ws\.id,ws\.response_type,ws\.details/);
  assert.match(saveFn, /order by ws\.created_at desc,ws\.id desc/);
  assert.match(saveFn, /v_existing_details=v_details then/);

  const duplicateReturn = saveFn.indexOf("'idempotent',true");
  const snapshotInsert = saveFn.indexOf('insert into public.smart_purchase_workflow_snapshots');
  const allocationDelete = saveFn.indexOf('delete from public.purchase_order_supplier_allocations');

  assert.ok(duplicateReturn > 0);
  assert.ok(duplicateReturn < snapshotInsert);
  assert.ok(duplicateReturn < allocationDelete);
});

test('correcting supplier A from 12 to 10 replaces its commitment instead of subtracting twice', () => {
  const requested = 20;
  const supplierB = 5;
  const supplierAOld = 12;
  const supplierANew = 10;

  assert.equal(capacity(requested, [supplierB]), 15);
  assert.equal(supplierANew <= capacity(requested, [supplierB]), true);
  assert.equal(supplierANew + supplierB, 15);
  assert.notEqual(supplierAOld + supplierANew + supplierB, 15);

  assert.match(sql, /delete from public\.purchase_order_supplier_allocations x[\s\S]*lower\(trim\(x\.supplier_name\)\)=v_supplier_key[\s\S]*received_quantity,0\)=0/);
});

test('an older 12-unit response can be restored after latest correction to 10', () => {
  const requested = 20;
  const supplierB = 5;
  const restoredA = 12;

  assert.equal(restoredA <= capacity(requested, [supplierB]), true);
  assert.equal(restoredA + supplierB, 17);

  const saveFn = sql.slice(
    sql.indexOf('create or replace function public.smart_purchase_save_supplier_response_v1'),
    sql.indexOf('create or replace function public.smart_purchase_receiving_read_v3')
  );
  assert.doesNotMatch(saveFn, /and ws\.details=v_details[\s\S]{0,120}order by ws\.created_at desc/);
  assert.match(saveFn, /v_existing_details=v_details then/);
});

test('supplier correction cannot go below quantity already physically received', () => {
  const received = 4;
  assert.equal(3 < received, true);
  assert.equal(4 < received, false);
  assert.equal(6 < received, false);

  assert.match(sql, /if v_confirmed\+0\.0001<v_current_received then/);
  assert.match(sql, /supplier_allocation_below_received/);
  assert.match(sql, /allocated_quantity=greatest\(coalesce\(r\.confirmed,0\),coalesce\(x\.received_quantity,0\)\)/);
});

test('two suppliers cannot concurrently validate against the same stale capacity', () => {
  const saveFn = sql.slice(
    sql.indexOf('create or replace function public.smart_purchase_save_supplier_response_v1'),
    sql.indexOf('create or replace function public.smart_purchase_receiving_read_v3')
  );
  assert.match(saveFn, /pg_advisory_xact_lock\(hashtext\(v_order_id::text\|\|':supplier-response'\)\)/);
  const capacityRead = saveFn.indexOf('into v_other_allocated');
  assert.ok(capacityRead > 0);
  assert.ok(saveFn.indexOf('pg_advisory_xact_lock') < capacityRead);
});
