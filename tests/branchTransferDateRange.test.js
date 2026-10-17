import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarPeriodRange, incidentMatchesCalendarPeriod } from '../src/lib/branchTransferDateRange.js';

function incidentAt(year, month, day, hour = 12) {
  return {
    cases: [{ sale_lines: [{ timestamp_ms: new Date(year, month - 1, day, hour).getTime() }], purchase_lines: [] }],
  };
}

const now = new Date(2026, 9, 17, 12).getTime();

test('today and yesterday use real calendar days', () => {
  assert.equal(incidentMatchesCalendarPeriod(incidentAt(2026, 10, 17), 'today', { now }), true);
  assert.equal(incidentMatchesCalendarPeriod(incidentAt(2026, 10, 16), 'today', { now }), false);
  assert.equal(incidentMatchesCalendarPeriod(incidentAt(2026, 10, 16), 'yesterday', { now }), true);
});

test('last7 includes today plus previous six calendar days', () => {
  assert.equal(incidentMatchesCalendarPeriod(incidentAt(2026, 10, 11), 'last7', { now }), true);
  assert.equal(incidentMatchesCalendarPeriod(incidentAt(2026, 10, 10), 'last7', { now }), false);
});

test('last14 includes a full fourteen day window', () => {
  assert.equal(incidentMatchesCalendarPeriod(incidentAt(2026, 10, 4), 'last14', { now }), true);
  assert.equal(incidentMatchesCalendarPeriod(incidentAt(2026, 10, 3), 'last14', { now }), false);
});

test('custom range is inclusive and rejects inverted dates', () => {
  const options = { from: '2026-10-10', to: '2026-10-12', now };
  assert.equal(incidentMatchesCalendarPeriod(incidentAt(2026, 10, 10, 0), 'custom', options), true);
  assert.equal(incidentMatchesCalendarPeriod(incidentAt(2026, 10, 12, 23), 'custom', options), true);
  assert.equal(incidentMatchesCalendarPeriod(incidentAt(2026, 10, 13), 'custom', options), false);
  assert.equal(calendarPeriodRange('custom', { from: '2026-10-13', to: '2026-10-12', now }).valid, false);
});
