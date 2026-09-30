import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../src/pages/PurchaseCenterClean.jsx', import.meta.url),
  'utf8'
);

test('clean purchase journey exposes three simple stages and one fixed action bar', () => {
  for (const label of [
    'رفع الرصيد',
    'راجع وأنشئ',
    'المورد والنتيجة',
  ]) {
    assert.ok(source.includes(label), `missing journey stage: ${label}`);
  }
  assert.ok(source.includes('مرحلة {item.id} من 3'));
  assert.ok(source.includes('function JourneyActionBar'));
  assert.ok(source.includes('fixed inset-x-3 bottom-3'));
});

test('clean purchase journey safely resumes the last atomic stock sync after refresh', () => {
  assert.ok(source.includes("JOURNEY_RESUME_KEY = 'purchase-center-clean-resume-v1'"));
  assert.ok(source.includes('writeJourneyResume({'));
  assert.ok(source.includes('runPlannerOnly(resume.stock_sync_id)'));
  assert.ok(source.includes('clearJourneyResume()'));
  assert.ok(source.includes('بدء طلبية جديدة'));
});

test('fast path only skips detailed review when guards are green and quick review is empty', () => {
  assert.ok(source.includes("result?.creation_guard?.can_create_dual === true && quickReviewCount === 0"));
  assert.ok(source.includes('setActiveStep(fastPathReady ? 3 : 2)'));
  assert.ok(source.includes('لا توجد مراجعات سريعة مطلوبة؛ الطلبية جاهزة لإنشاء المسودتين.'));
});

test('heavy plan content renders only while the review step is active', () => {
  assert.ok(source.includes('{activeStep === 2 && ('));
  assert.ok(source.includes('{activeStep === 3 && ('));
  assert.ok(source.includes('draftResult && activeStep === 4'));
  assert.ok(source.includes('activeStep === 5 && draftResult'));
});


test('open drafts lock a new stock journey and stage 1', () => {
  assert.ok(source.includes("if (draftResult) {"));
  assert.ok(source.includes("ready: !draftResult"));
  assert.ok(source.includes("disabled={busy || Boolean(draftResult)}"));
});

test('final readiness requires persisted historical allocation', () => {
  assert.ok(source.includes("finalReviewReady"));
  assert.ok(source.includes("جاهزة لتثبيت التحليل التاريخي"));
  assert.ok(source.includes("جاهزة للمراجعة قبل الاعتماد"));
});


test('final screen has one primary historical persistence action in the sticky action bar', () => {
  assert.ok(source.includes("onApplyHistorical"));
  assert.ok(source.includes("تثبيت المورد والتكلفة التاريخية"));
  assert.ok(source.includes("زر التثبيت موجود أسفل الشاشة"));
  assert.ok(source.includes("تم التثبيت ✓"));
});


test('primary purchase journey has only three real user stages', () => {
  assert.ok(source.includes("target: 5"));
  assert.ok(source.includes("setActiveStep(5)"));
  assert.ok(source.includes("setActiveStep(2)"));
  assert.doesNotMatch(source, /التالي: إنشاء المسودتين/);
  assert.doesNotMatch(source, /activeStep === 3 &&/);
});

test('blocking drafts are resolved inside review-and-create instead of a separate page', () => {
  assert.ok(source.includes("مسودات مفتوحة تمنع إنشاء طلبية مكررة"));
  assert.ok(source.includes("إلغاء المسودة"));
  assert.ok(source.includes("إنشاء مسودتي شكري والشامي"));
});


test('final result hides loading noise and collapses audit details by default', () => {
  assert.ok(source.includes("جاري تحليل تاريخ المشتريات وتجهيز الموردين"));
  assert.ok(source.includes("إعادة المحاولة"));
  assert.ok(source.includes("تفاصيل التحقق والجاهزية • 5 نقاط"));
  assert.ok(source.includes("القيمة التاريخية المقترحة"));
  assert.ok(source.includes("نتيجة الطلبية"));
});


test('supplier distribution is collapsed by default on the final result', () => {
  assert.ok(source.includes("توزيع الموردين • {supplierDecision.supplierCount} مورد"));
  assert.ok(source.includes("فتح التفاصيل الكاملة"));
  assert.ok(source.includes("مورد إضافي موجود في التفاصيل الكاملة"));
});


test('branch totals reconcile to persisted draft totals after historical allocation', () => {
  assert.ok(source.includes("persistedBranchTotal"));
  assert.ok(source.includes("supplierWorkspace.historicalApplied && persistedBranchTotal > 0"));
  assert.doesNotMatch(source, /readyForFinalReview:/);
});


test('historical supplier details contain only decision-useful columns', async () => {
  const workspace = await readFile(
    new URL('../src/components/purchases/CleanSupplierFinancialWorkspace.jsx', import.meta.url),
    'utf8'
  );
  assert.ok(workspace.includes("['الفرع','الصنف','الكمية','المورد','الثقة','مرات الشراء','آخر شراء','تكلفة الوحدة','القيمة']"));
  assert.doesNotMatch(workspace, /مقارنة مخزن واحد/);
  assert.doesNotMatch(workspace, /خصم أساسي/);
  assert.doesNotMatch(workspace, /بونص متوقع/);
  assert.doesNotMatch(workspace, /بدائل مسجلة/);
});


test('clean purchase page keeps no dead history/scenario state after canonical snapshot refactor', () => {
  assert.doesNotMatch(source, /historyByBranch/);
  assert.doesNotMatch(source, /setHistoryByBranch/);
  assert.doesNotMatch(source, /scenarios:\s*\[\]/);
});


test('stale historical snapshot refreshes automatically and cannot be applied silently', () => {
  assert.ok(source.includes("hasHistoricalSnapshot"));
  assert.ok(source.includes("err?.code === 'historical_allocation_changed'"));
  assert.ok(source.includes("راجع القيم الجديدة ثم اضغط التثبيت مرة أخرى"));
});


test('draft creation recovers exact matching drafts when the create response is lost', () => {
  assert.ok(source.includes("recoverDraftsAfterCreateError"));
  assert.ok(source.includes("latestPlan.stock_sync_id !== expectedSyncId"));
  assert.ok(source.includes("recoverMatchingOpenDrafts(latestPlan)"));
  assert.ok(source.includes("setDraftResult(recovered)"));
  assert.ok(source.includes("setActiveStep(5)"));
});


test('refresh can resume an exact open journey from the server when local storage is missing', () => {
  assert.ok(source.includes("purchaseApi.resumeCleanJourney()"));
  assert.ok(source.includes("if (!serverResume?.found) return"));
  assert.ok(source.includes("expectedPlanHash"));
  assert.ok(source.includes("result?.plan_hash !== expectedPlanHash"));
  assert.ok(source.includes("آخر طلبية مفتوحة محفوظة على السيرفر"));
});


test('plan review keeps the primary decision compact and user-facing', () => {
  assert.ok(source.includes('label="إجمالي الطلبية"'));
  assert.ok(source.includes('label="مراجعة اختيارية"'));
  assert.ok(source.includes('تفاصيل إضافية للطلبية'));
  assert.doesNotMatch(source, /تفاصيل تقنية وتشغيلية/);
  assert.doesNotMatch(source, /Watchlist/);
  assert.doesNotMatch(source, />Smart Monthly</);
  assert.doesNotMatch(source, /قيمة V10/);
});


test('branch detail cards keep only decision-useful metrics and columns', () => {
  assert.ok(source.includes('بيانات الفرع جاهزة للطلبية'));
  assert.ok(source.includes('المورد التاريخي'));
  assert.doesNotMatch(source, /<th className="p-2 text-right">Min<\/th>/);
  assert.doesNotMatch(source, /<th className="p-2 text-right">Reorder<\/th>/);
  assert.doesNotMatch(source, /<th className="p-2 text-right">Max<\/th>/);
  assert.doesNotMatch(source, /مزامنة الرصيد \{/);
  assert.doesNotMatch(source, /حد شراء آمن اليوم/);
});


test('stock upload keeps technical file diagnostics collapsed and hides internal sync ids', () => {
  assert.ok(source.includes('تفاصيل الملف'));
  assert.ok(source.includes('تم حفظ رصيد الفرعين بنجاح وجاري تجهيز الخطة'));
  assert.doesNotMatch(source, /font-mono text-\[10px\].*stock_sync_id/);
  assert.doesNotMatch(source, /الحالات محفوظة بعلامة للمراجعة في B-Connect/);
});
