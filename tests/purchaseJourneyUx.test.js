import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../src/pages/PurchaseCenterClean.jsx', import.meta.url),
  'utf8'
);

test('clean purchase journey keeps the five guided steps and one fixed action bar', () => {
  for (const label of [
    'رفع الرصيد',
    'مراجعة الخطة',
    'إنشاء المسودتين',
    'الموردون والأسعار',
    'المراجعة النهائية',
  ]) {
    assert.ok(source.includes(label), `missing journey step: ${label}`);
  }
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
  assert.ok(source.includes('Fast Path: لا توجد أصناف داخل الطلبية تحتاج مراجعة سريعة'));
});

test('heavy plan content renders only while the review step is active', () => {
  assert.ok(source.includes('{activeStep === 2 && ('));
  assert.ok(source.includes('{activeStep === 3 && ('));
  assert.ok(source.includes('draftResult && activeStep === 4'));
  assert.ok(source.includes('activeStep === 5 && draftResult'));
});
