import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(
  new URL('../supabase/migrations/20260930101500_purchase_clean_server_resume_v1.sql', import.meta.url),
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
  assert.match(sql, /'found',false/);
  assert.match(sql, /'found',true/);
});
