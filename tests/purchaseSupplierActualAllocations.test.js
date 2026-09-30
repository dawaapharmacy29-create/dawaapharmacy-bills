import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(
  new URL('../supabase/migrations/20260930142000_purchase_supplier_actual_allocations_v1.sql', import.meta.url),
  'utf8'
);
const page = await readFile(new URL('../src/pages/SmartPurchaseReceiving.jsx', import.meta.url), 'utf8');
const api = await readFile(new URL('../src/api/smartPurchaseReceivingApi.js', import.meta.url), 'utf8');

test('actual supplier allocation is additive and does not overwrite historical supplier_name', () => {
  assert.match(sql, /create table if not exists public\.purchase_order_supplier_allocations/);
  assert.match(sql, /order_item_id uuid not null references public\.smart_purchase_order_items/);
  assert.match(sql, /allocated_quantity numeric not null/);
  assert.match(sql, /received_quantity numeric not null/);
  assert.doesNotMatch(sql, /update public\.smart_purchase_order_items[\s\S]{0,300}supplier_name=/);
});

test('supplier response atomically replaces unreceived allocations for the same supplier', () => {
  assert.match(sql, /smart_purchase_save_supplier_response_v1/);
  assert.match(sql, /supplier_allocation_above_order/);
  assert.match(sql, /supplier_allocation_below_received/);
  assert.match(sql, /delete from public\.purchase_order_supplier_allocations/);
  assert.match(sql, /coalesce\(x\.received_quantity,0\)=0/);
  assert.match(sql, /Confirmed by branch-wide supplier response/);
});

test('new receiving read exposes actual allocations while preserving latest supplier responses', () => {
  assert.match(sql, /'supplier_allocations'/);
  assert.match(sql, /'supplier_responses'/);
  assert.match(sql, /distinct on \(lower\(trim\(ws\.supplier_name\)\)\)/);
});

test('receipt v5 is allocation-aware and falls back for legacy orders', () => {
  assert.match(sql, /smart_purchase_import_receipt_v5/);
  assert.match(sql, /return public\.smart_purchase_import_receipt_v4\(p_session_token,p_payload\)/);
  assert.match(sql, /supplier_has_no_allocation/);
  assert.match(sql, /receipt_rows_not_allocated/);
  assert.match(sql, /receipt_quantity_above_allocation/);
  assert.match(sql, /allocated_quantity-x\.received_quantity/);
});

test('frontend uses actual allocation suppliers for receipt but keeps branch-wide response sourcing', () => {
  assert.match(page, /selected\?\.supplier_allocations/);
  assert.match(page, /allocationMode/);
  assert.match(page, /allocationRemainingQuantity/);
  assert.match(page, /mode === 'supplier_response' \? responseOrderItems : supplierRemainingItems/);
  assert.match(page, /api\.saveSupplierResponse\(workflowPayload\)/);
  assert.match(api, /smart_purchase_save_supplier_response_v1/);
  assert.match(api, /smart_purchase_import_receipt_v5/);
});

test('security remains session and branch guarded with no direct table grants', () => {
  assert.match(sql, /staff_sessions/);
  assert.match(sql, /smart_purchase_branch_allowed_v2/);
  assert.match(sql, /alter table public\.purchase_order_supplier_allocations enable row level security/);
  assert.match(sql, /revoke all on table public\.purchase_order_supplier_allocations from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.smart_purchase_save_supplier_response_v1\(text,jsonb\) from public/);
  assert.match(sql, /revoke all on function public\.smart_purchase_import_receipt_v5\(text,jsonb\) from public/);
});

test('first actual allocation cannot be retrofitted after legacy receiving starts', () => {
  assert.match(sql, /supplier_allocation_requires_pre_receiving/);
  assert.match(sql, /purchase_order_receipts r where r\.order_id=v_order_id/);
  assert.match(sql, /not exists\([\s\S]{0,160}purchase_order_supplier_allocations/);
});

test('allocation receipt authenticates and authorizes before choosing new or legacy path', () => {
  const v5 = sql.slice(sql.indexOf('create or replace function public.smart_purchase_import_receipt_v5'));
  assert.ok(v5.indexOf('staff_sessions') < v5.indexOf('select exists(\n    select 1\n    from public.purchase_order_supplier_allocations'));
  assert.ok(v5.indexOf('smart_purchase_branch_allowed_v2') < v5.indexOf('return public.smart_purchase_import_receipt_v4'));
  assert.doesNotMatch(v5, /select i\.\*,x\.\*[\s\S]{0,40}into i,al/);
});

test('allocation-mode UI blocks unexpected invoice rows before any write', () => {
  assert.match(page, /allocationMode && receiptResult\?\.unexpected\?\.length > 0/);
  assert.match(page, /صنف في فاتورة المورد غير مخصص له/);
  assert.match(page, /allocationMode && receiptResult\.unexpected\.length > 0/);
});

test('latest corrected supplier response keeps the supplier original round order', () => {
  assert.match(sql, /first_created_at/);
  assert.match(sql, /min\(ws\.created_at\) over/);
  assert.match(sql, /order by latest_response\.first_created_at asc/);
});

test('idempotency compares only with the supplier latest saved response', () => {
  const saveFn = sql.slice(
    sql.indexOf('create or replace function public.smart_purchase_save_supplier_response_v1'),
    sql.indexOf('create or replace function public.smart_purchase_receiving_read_v3')
  );
  assert.match(saveFn, /select ws\.id,ws\.response_type,ws\.details/);
  assert.match(saveFn, /order by ws\.created_at desc,ws\.id desc/);
  assert.match(saveFn, /limit 1/);
  assert.match(saveFn, /v_existing_details=v_details/);
  assert.doesNotMatch(saveFn, /and ws\.details=v_details[\s\S]{0,120}order by ws\.created_at desc/);
});

test('an old historical response can be deliberately restored after a later correction', () => {
  assert.match(sql, /v_existing_response_type/);
  assert.match(sql, /v_existing_details/);
  assert.match(sql, /and coalesce\(v_existing_response_type,''\)=coalesce\(v_response_type,''\)/);
  assert.match(sql, /and v_existing_details=v_details then/);
});
