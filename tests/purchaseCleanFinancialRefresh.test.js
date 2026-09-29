import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const cleanPageSource = await readFile(new URL('../src/pages/PurchaseCenterClean.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../src/api/smartPurchaseUnifiedApi.js', import.meta.url), 'utf8');

test('clean planning refreshes financial readiness before the planner', () => {
  const refreshIndex = cleanPageSource.indexOf("refreshDecisionDailySnapshot('all')");
  const plannerIndex = cleanPageSource.indexOf('dualBranchInstantPlan()');
  assert.ok(refreshIndex >= 0);
  assert.ok(plannerIndex > refreshIndex);
  assert.ok(apiSource.includes('smart_purchase_decision_daily_change_v1'));
});

test('negative stock is review-only in the clean UI', () => {
  assert.ok(!cleanPageSource.includes('hasNegativeStock'));
  assert.ok(cleanPageSource.includes('تمت معاملة الأرصدة السالبة كصفر في الفرع المتأثر فقط'));
});
