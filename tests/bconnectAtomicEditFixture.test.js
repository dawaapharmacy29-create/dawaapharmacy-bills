import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../docs/sql-staging/bconnect_atomic_edit_fixture_test_v1.sql', import.meta.url),'utf8');

test('fixture cannot run without staging approval and explicit test identities',()=>{
  assert.match(sql,/staging_approval_required/);
  assert.match(sql,/test_fixture_not_configured/);
  assert.match(sql,/ROLLBACK;/);
});
test('fixture checks retry, mismatched payload and stale revision',()=>{
  assert.match(sql,/idempotent_retry_mismatch/);
  assert.match(sql,/idempotency_conflict/);
  assert.match(sql,/stale_revision_not_rejected/);
});
