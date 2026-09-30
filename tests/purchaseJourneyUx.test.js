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
