import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(
  new URL('../supabase/migrations/20260930134000_purchase_supplier_response_cumulative_sourcing_v1.sql', import.meta.url),
  'utf8'
);

test('receiving read returns only the latest branch-wide response per supplier', () => {
  assert.match(sql, /supplier_responses/);
  assert.match(sql, /distinct on \(lower\(trim\(ws\.supplier_name\)\)\)/);
  assert.match(sql, /ws\.workflow_type='supplier_response'/);
  assert.match(sql, /ws\.summary->>'scope'.*branch_remaining_v1/);
  assert.match(sql, /ws\.created_at desc,ws\.id desc/);
});

test('supplier response history keeps existing staff-session and branch authorization', () => {
  assert.match(sql, /staff_sessions/);
  assert.match(sql, /smart_purchase_branch_allowed_v2/);
  assert.match(sql, /revoke all on function public\.smart_purchase_receiving_read_v3\(text,text,jsonb\) from public/);
  assert.match(sql, /grant execute on function public\.smart_purchase_receiving_read_v3\(text,text,jsonb\) to anon,authenticated/);
});
