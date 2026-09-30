import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(
  new URL('../supabase/migrations/20260930084500_purchase_historical_supplier_owner_v1.sql', import.meta.url),
  'utf8'
);

test('historical supplier selection has one canonical database owner', () => {
  assert.match(sql, /purchase_historical_supplier_choice_v1/);
  assert.match(sql, /row_number\(\) over/);
  assert.match(sql, /historical_confidence/);
  assert.match(sql, /selected_unit_cost/);

  const profileReads = (sql.match(/purchase_supplier_history_profiles/g) || []).length;
  assert.equal(profileReads, 1, 'raw supplier history must be read only by the canonical owner view');

  const ownerReads = (sql.match(/purchase_historical_supplier_choice_v1/g) || []).length;
  assert.ok(ownerReads >= 3, 'view + analysis + persistence must share the same owner');
});

test('analysis and persistence do not duplicate supplier ranking predicates', () => {
  const functionSection = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION'));
  assert.doesNotMatch(functionSection, /not like 'دواء %'/);
  assert.doesNotMatch(functionSection, /purchase_events>=2[\s\S]{0,180}90 days/);
  assert.match(functionSection, /sh\.historical_confidence/);
  assert.match(functionSection, /h\.historical_confidence as confidence/);
});
