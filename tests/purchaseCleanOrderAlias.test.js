import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20260929134500_purchase_clean_order_alias_fix_v1.sql', import.meta.url),
  'utf8'
);

test('clean order creation does not reuse the PL/pgSQL x variable as a JSON table alias', () => {
  assert.ok(migration.includes('from jsonb_array_elements(p_items) as item(value)'));
  assert.ok(!migration.includes('from jsonb_array_elements(p_items) x'));
  assert.ok(migration.includes("item.value->>'approved_quantity'"));
});
