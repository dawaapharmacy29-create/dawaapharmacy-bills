import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const unifiedApiSource = await readFile(new URL('../src/api/smartPurchaseUnifiedApi.js', import.meta.url), 'utf8');
const receivingApiSource = await readFile(new URL('../src/api/smartPurchaseReceivingApi.js', import.meta.url), 'utf8');
const cleanPageSource = await readFile(new URL('../src/pages/PurchaseCenterClean.jsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const layoutSource = await readFile(new URL('../src/components/layout/AppLayout.jsx', import.meta.url), 'utf8');
const roleSource = await readFile(new URL('../src/lib/useUserRole.js', import.meta.url), 'utf8');
const allocationMigrationSource = await readFile(
  new URL('../supabase/migrations/20260930142000_purchase_supplier_actual_allocations_v1.sql', import.meta.url),
  'utf8'
);

test('clean purchase path keeps the four critical backend RPC contracts explicit', () => {
  for (const rpc of [
    'smart_purchase_stage_dual_stock_master_v1',
    'smart_purchase_finalize_dual_stock_master_v1',
    'smart_purchase_dual_branch_instant_plan_v1',
    'smart_purchase_create_dual_drafts_v1',
  ]) {
    assert.match(unifiedApiSource, new RegExp(rpc));
  }
});

test('clean stock flow stages before one finalize and uses bounded concurrency', () => {
  const poolAt = unifiedApiSource.indexOf('runBoundedChunkPool');
  const stageAt = unifiedApiSource.indexOf("smart_purchase_stage_dual_stock_master_v1");
  const finalizeAt = unifiedApiSource.indexOf("smart_purchase_finalize_dual_stock_master_v1");

  assert.ok(poolAt >= 0);
  assert.ok(stageAt > poolAt);
  assert.ok(finalizeAt > stageAt);
  assert.match(unifiedApiSource, /stageConcurrency\s*=\s*2/);
});

test('execution pending contract remains tied to supplier dispatch snapshot and allocation-aware receipt with legacy v4 fallback', () => {
  assert.match(unifiedApiSource, /smart_purchase_supplier_dispatch_guarded_v3/);
  assert.match(receivingApiSource, /smart_purchase_import_receipt_v5/);
  assert.match(allocationMigrationSource, /smart_purchase_import_receipt_v5/);
  assert.match(allocationMigrationSource, /return public\.smart_purchase_import_receipt_v4\(p_session_token,p_payload\)/);
});

test('clean page only creates drafts from returned stock_sync_id and plan_hash', () => {
  assert.match(cleanPageSource, /stockSyncId:\s*plan\.stock_sync_id/);
  assert.match(cleanPageSource, /planHash:\s*plan\.plan_hash/);
  assert.match(cleanPageSource, /dual_atomic_finalize/);
  assert.match(cleanPageSource, /row_count_verified/);
});


test('clean planner is the single visible purchase-center entry and remains permission-guarded', () => {
  assert.ok(appSource.includes('<Route path="/purchase-center" element={<RoleRouteGuard permission="canPlanPurchases"><PurchaseCenterClean /></RoleRouteGuard>} />'));
  assert.ok(appSource.includes('<Route path="/purchase-center-clean" element={<RoleRouteGuard permission="canPlanPurchases"><PurchaseCenterClean /></RoleRouteGuard>} />'));
  assert.ok(layoutSource.includes('{ path: "/purchase-center", label: "مركز المشتريات والطلبية", icon: BrainCircuit, permission: "canPlanPurchases" }'));
  assert.doesNotMatch(layoutSource, /path: "\/purchase-center-clean"/);
  assert.match(roleSource, /canPlanPurchases\s*=\s*isAdmin\s*\|\|[\s\S]*purchasing/);
  assert.doesNotMatch(roleSource, /canPlanPurchases\s*=.*isBranchManager/);
});
test('clean page does not fall back to legacy purchase creation paths', () => {
  assert.doesNotMatch(cleanPageSource, /createSafeDraft\s*\(/);
  assert.doesNotMatch(cleanPageSource, /demandTransferPreview\s*\(/);
  assert.doesNotMatch(cleanPageSource, /saveDualBranchStockMaster\s*\(/);
  assert.match(cleanPageSource, /saveDualBranchStockMasterClean\s*\(/);
  assert.match(cleanPageSource, /dualBranchInstantPlan\s*\(/);
  assert.match(cleanPageSource, /createDualDrafts\s*\(/);
});


test('clean page freezes replan after dual drafts are created', () => {
  assert.match(cleanPageSource, /if \(runRef\.current \|\| !saveResult \|\| draftResult\) return/);
  assert.match(cleanPageSource, /\{step === 2 && !draftResult && \(/);
});


test('negative stock remains review-only instead of blocking dual draft creation', async () => {
  assert.doesNotMatch(cleanPageSource, /hasNegativeStock/);
  assert.doesNotMatch(cleanPageSource, /إنشاء المسودتين متوقف لأن ملف الرصيد يحتوي على أرصدة سالبة/);
  assert.match(cleanPageSource, /يوجد رصيد سالب في الملف؛ تم التعامل معه كصفر في الفرع المتأثر فقط وسيستمر التحليل/);
});


test('clean path never auto-approves or auto-dispatches after historical persistence', () => {
  assert.match(unifiedApiSource, /smart_purchase_apply_historical_allocation_v2/);
  assert.match(cleanPageSource, /applyHistoricalAllocation/);
  assert.doesNotMatch(cleanPageSource, /approveOrder\s*\(/);
  assert.doesNotMatch(cleanPageSource, /approveAndReserve\s*\(/);
  assert.doesNotMatch(cleanPageSource, /markSupplierSent\s*\(/);
});


test('clean historical path contains no current-offer workspace state and exposes draft identity', () => {
  assert.doesNotMatch(cleanPageSource, /currentOfferPlans/);
  assert.match(cleanPageSource, /draftMeta/);
  assert.match(cleanPageSource, /ثقة منخفضة/);
});


test('clean supplier review uses one canonical historical snapshot and no current-offer decision RPC', () => {
  assert.match(cleanPageSource, /historicalAllocationPreview/);
  assert.match(cleanPageSource, /allocationHash/);
  assert.match(cleanPageSource, /الاختيار الموحّد من سجل فواتير المشتريات/);
  assert.doesNotMatch(cleanPageSource, /purchaseApi\.supplierDecision\(/);
  assert.doesNotMatch(cleanPageSource, /buildSupplierFinancialRows\(/);
  assert.doesNotMatch(cleanPageSource, /buildSingleSupplierScenarios\(/);
});


test('clean stock upload retries transport failure once on the same sync identity', () => {
  assert.match(unifiedApiSource, /function isRetryableTransportError/);
  assert.match(unifiedApiSource, /async function withOneTransportRetry/);
  assert.match(unifiedApiSource, /withOneTransportRetry\(\(\) => standaloneRpc\('smart_purchase_stage_dual_stock_master_v1'/);
  assert.match(unifiedApiSource, /withOneTransportRetry\(\(\) => standaloneRpc\('smart_purchase_finalize_dual_stock_master_v1'/);
  assert.ok(unifiedApiSource.includes('const syncId = `dual-stock-${syncNonce}`;'));
});

test('clean historical persistence contract points at snapshot-checked v2', () => {
  assert.match(unifiedApiSource, /smart_purchase_historical_allocation_preview_v1/);
  assert.match(unifiedApiSource, /smart_purchase_apply_historical_allocation_v2/);
  assert.doesNotMatch(unifiedApiSource, /smart_purchase_apply_historical_allocation_v1/);
});


test('clean API exposes only the snapshot-checked dual approval for the new journey', () => {
  assert.match(unifiedApiSource, /smart_purchase_approve_reviewed_dual_v1/);
  assert.match(unifiedApiSource, /approveReviewedDual/);
  assert.match(unifiedApiSource, /reviewed_allocation_not_persisted/);
  assert.match(unifiedApiSource, /reviewed_total_mismatch/);
});


test('clean execution uses the historical supplier dispatch writer and guarded list reader', () => {
  assert.match(unifiedApiSource, /markHistoricalSupplierSent/);
  assert.match(unifiedApiSource, /smart_purchase_mark_historical_supplier_sent_v1/);
  assert.match(unifiedApiSource, /supplierDispatches/);
  assert.match(unifiedApiSource, /historical_supplier_items_not_send_ready/);
});


test('demand evidence remains shadow-only and does not replace the canonical planner', () => {
  assert.match(unifiedApiSource, /smart_purchase_upsert_demand_evidence_v1/);
  assert.match(unifiedApiSource, /smart_purchase_demand_evidence_shadow_v1/);
  assert.match(unifiedApiSource, /smart_purchase_demand_evidence_shadow_summary_v1/);
  assert.match(unifiedApiSource, /smart_purchase_dual_branch_instant_plan_v1/);
  assert.doesNotMatch(unifiedApiSource, /smart_purchase_refresh_consumption_from_demand_evidence/);
});
