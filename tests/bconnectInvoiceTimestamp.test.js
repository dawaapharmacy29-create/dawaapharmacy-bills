import test from 'node:test';
import assert from 'node:assert/strict';
import { describeBConnectInvoiceTimestamp as describe } from '../src/lib/bconnectInvoiceTimestamp.js';

test('B-Connect local timestamp keeps exact clock and full date independently of browser timezone', () => {
  const t = describe('2026-10-10 18:25:05');
  assert.equal(t.dateISO, '2026-10-10');
  assert.equal(t.time24, '18:25');
  assert.equal(t.hasTime, true);
  assert.match(t.date, /أكتوبر/u);
  assert.notEqual(t.time, 'غير مسجل في الملف');
});

test('date-only export says time not registered rather than guessing midnight', () => {
  const t = describe('2026-10-10');
  assert.equal(t.dateISO, '2026-10-10');
  assert.equal(t.hasTime, false);
  assert.equal(t.time24, null);
  assert.equal(t.time, 'غير مسجل في الملف');
});

test('explicit source midnight is displayed as a real clock value', () => {
  const t = describe('2026-10-10 00:00:00');
  assert.equal(t.hasTime, true);
  assert.equal(t.time24, '00:00');
});

test('supports parser ISO and day-first report timestamp without date reinterpretation', () => {
  const a = describe('2026-10-10T12:15:30.000Z');
  const b = describe('10/10/2026 12:15:30');
  assert.equal(a.dateISO, b.dateISO);
  assert.equal(a.time24, b.time24);
  assert.equal(a.time24, '12:15');
});

test('missing, invalid, and impossible dates do not pretend to have a valid clock', () => {
  for (const value of [null, '', '2026-02-30 14:00', 'arbitrary-date', '2026-10-10 25:10']) {
    const t = describe(value);
    assert.equal(t.hasTime, false);
    assert.equal(t.time24, null);
  }
});
