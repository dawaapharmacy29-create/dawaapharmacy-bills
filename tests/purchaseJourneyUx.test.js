import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../src/pages/PurchaseCenterClean.jsx', import.meta.url),
  'utf8'
);
const receivingSource = await readFile(
  new URL('../src/pages/SmartPurchaseReceiving.jsx', import.meta.url),
  'utf8'
);

test('clean purchase journey exposes three simple stages and one fixed action bar', () => {
  for (const label of [
    'الرصيد',
    'الطلبية',
    'الموردين والتكلفة',
    'إرسال الموردين',
  ]) {
    assert.ok(source.includes(label), `missing journey stage: ${label}`);
  }
  assert.doesNotMatch(source, /مرحلة \{item\.id\} من 3/);
  assert.ok(source.includes('function JourneyActionBar'));
  assert.ok(source.includes('fixed inset-x-3 bottom-3'));
});

test('clean purchase journey safely resumes the last atomic stock sync after refresh', () => {
  assert.ok(source.includes("JOURNEY_RESUME_KEY = 'purchase-center-clean-resume-v1'"));
  assert.ok(source.includes('writeJourneyResume({'));
  assert.ok(source.includes("runPlannerOnly(resume.stock_sync_id, resume.plan_hash || '')"));
  assert.ok(source.includes('clearJourneyResume()'));
  assert.ok(source.includes('بدء طلبية جديدة'));
});

test('new plans enter review while exact recovered drafts resume at supplier result', () => {
  assert.ok(source.includes('if (recoveredDrafts) {'));
  assert.ok(source.includes('setActiveStep(2)'));
  assert.ok(source.includes('setActiveStep(5)'));
  assert.doesNotMatch(source, /fastPathReady/);
});

test('heavy content stays scoped to review, supplier details, and final result steps', () => {
  assert.ok(source.includes('{activeStep === 2 && ('));
  assert.doesNotMatch(source, /\{activeStep === 3 && \(/);
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
  assert.ok(source.includes("✓ تم تثبيت أفضل مورد وتكلفة تاريخية على المسودتين"));
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


test('refresh treats the server as authoritative and resumes the exact open journey safely', () => {
  assert.ok(source.includes("purchaseApi.resumeCleanJourney()"));
  assert.ok(source.includes("serverResumeResolved = true"));
  assert.ok(source.includes("serverResumeResolved && serverResume?.found === false"));
  assert.ok(source.includes("clearJourneyResume();"));
  assert.ok(source.includes("runPlannerOnly(resume.stock_sync_id, resume.plan_hash || '')"));
  assert.ok(source.includes("result?.plan_hash !== expectedPlanHash"));
});


test('plan review keeps the primary decision compact and user-facing', () => {
  assert.ok(source.includes('label="إجمالي الطلبية"'));
  assert.ok(source.includes('label="مراجعة اختيارية"'));
  assert.ok(source.includes('تفاصيل إضافية للطلبية'));
  assert.doesNotMatch(source, /تفاصيل تقنية وتشغيلية/);
  assert.doesNotMatch(source, />Watchlist</);
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


test('journey navigation is one compact three-stage control without a repeated guide', () => {
  assert.ok(source.includes("label: 'الرصيد'"));
  assert.ok(source.includes("label: 'الطلبية'"));
  assert.ok(source.includes("'الموردين والتكلفة'"));
  assert.ok(source.includes("'إرسال الموردين'"));
  assert.doesNotMatch(source, /function CurrentStepGuide/);
  assert.doesNotMatch(source, /المطلوب منك الآن:/);
  assert.doesNotMatch(source, /مرحلة \{item\.id\} من 3/);
});


test('navigation and fixed actions do not repeat stage chrome', () => {
  assert.doesNotMatch(source, /مسار مبسط/);
  assert.doesNotMatch(source, /المرحلة \{step === 1/);
  assert.ok(source.includes('إعادة التحليل'));
});


test('simplified purchase page keeps no dead timing or review aggregate state', () => {
  assert.doesNotMatch(source, /const \[timings, setTimings\]/);
  assert.doesNotMatch(source, /setTimings\(/);
  assert.doesNotMatch(source, /reviewAlertsTotal/);
  assert.doesNotMatch(source, /countPlanQuickReviews/);
});


test('draft identity is persisted locally after create or exact recovery', () => {
  assert.ok(source.includes("function persistDraftJourneyResume"));
  assert.ok(source.includes("plan_hash: currentPlan.plan_hash"));
  assert.ok(source.includes("shokry_order_id: drafts.shokry_order_id"));
  assert.ok(source.includes("shamy_order_id: drafts.shamy_order_id"));
  assert.ok((source.match(/persistDraftJourneyResume\(/g) || []).length >= 4);
});


test('clean final step approves both reviewed drafts explicitly without auto-send', () => {
  assert.ok(source.includes("approveReviewedDual"));
  assert.ok(source.includes("اعتماد مسودتي شكري والشامي"));
  assert.ok(source.includes("الاعتماد لن يرسل أي طلبية للمورد تلقائيًا"));
  assert.ok(source.includes("تم اعتماد المسودتين ✓"));
  assert.ok(source.includes("clearJourneyResume()"));
});


test('approved journey resumes directly into supplier dispatch without replanning', () => {
  assert.ok(source.includes("async function loadDispatchWorkspace"));
  assert.ok(source.includes("resume.stage === 'dispatch'"));
  assert.ok(source.includes("await loadDispatchWorkspace(resumedDrafts)"));
  assert.ok(source.includes("persistDispatchJourneyResume"));
  assert.ok(source.includes("تم استكمال الطلبية المعتمدة من السيرفر"));
});


test('approved clean journey renders supplier-by-supplier dispatch cards', () => {
  assert.ok(source.includes("function SupplierDispatchBranchCard"));
  assert.ok(source.includes("تسجيل تم الإرسال"));
  assert.ok(source.includes("markHistoricalSupplierSent"));
  assert.ok(source.includes("لن يتم إرسال رسالة أو ملف تلقائيًا"));
  assert.ok(source.includes("تم تسجيل إرسال كل الموردين للفرعين"));
  assert.ok(source.includes("المرحلة التالية هي الاستلام ومطابقة الفاتورة"));
});


test('receiving handoff appears only after all supplier sends are recorded and carries the exact dual-order scope', () => {
  assert.ok(source.includes('/smart-purchase-receiving?orderIds='));
  assert.ok(source.includes('draftResult.shokry_order_id'));
  assert.ok(source.includes('draftResult.shamy_order_id'));
  assert.ok(source.includes('selectedOrderId='));
  assert.ok(source.includes('الانتقال للاستلام'));
  assert.ok(source.includes('dispatchState.suppliers.shokry.every((supplier) => supplier.sent)'));
  assert.ok(source.includes('dispatchState.suppliers.shamy.every((supplier) => supplier.sent)'));
  assert.ok(receivingSource.includes("searchParams.get('orderIds')"));
  assert.ok(receivingSource.includes("searchParams.get('selectedOrderId')"));
  assert.ok(receivingSource.includes('availableOrders.filter((order) => scopedOrderIds.includes(String(order.id)))'));
  assert.ok(receivingSource.includes("تم فتح شكري والشامي مباشرة من رحلة المشتريات الحالية."));
});


test('scoped receiving journey ends with a clear completion state after both orders close', () => {
  assert.ok(receivingSource.includes('scopedJourneyComplete'));
  assert.ok(receivingSource.includes('تم إغلاق طلبيتي شكري والشامي ✓'));
  assert.ok(receivingSource.includes('تم إنهاء استلام طلبيتي شكري والشامي ✓'));
  assert.ok(receivingSource.includes('to="/purchase-center"'));
});


test('authoritative server resume clears stale local execution after receiving starts or journey closes', () => {
  assert.ok(source.includes('serverResumeResolved = true'));
  assert.ok(source.includes("serverResumeResolved && serverResume?.found === false"));
  assert.ok(source.includes('clearJourneyResume();'));
  assert.ok(source.includes('return;'));
});
