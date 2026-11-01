import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261031163000_customer_order_workflow_timestamp_guard.sql', import.meta.url), 'utf8');

test('customer order workflow checks authenticated session and branch permissions', () => {
  assert.match(sql, /s\.token_hash=encode\(digest/);
  assert.match(sql, /a\.status='active'/);
  assert.match(sql, /forbidden_branch/);
  assert.match(sql, /revoke all on function public\.app_customer_order_workflow_v1/);
});

test('drafts and edits have separate audited operations', () => {
  for (const action of ['save_draft','list_drafts','finalize_draft','delete_draft','fulfill_line','edit_line','cancel_line','reopen_line','cancel_group','reopen_group']) {
    assert.ok(sql.includes(`'${action}'`), action);
  }
  assert.match(sql, /stale_quantity_reload/);
  assert.match(sql, /stale_order_reload/);
  assert.match(sql, /timeline=coalesce\(timeline/);
});
