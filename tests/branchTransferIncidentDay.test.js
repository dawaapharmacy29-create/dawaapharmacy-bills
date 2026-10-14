import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareIncidentsByDay,
  incidentDayKey,
  incidentDayOptions,
  incidentMatchesDay,
} from '../src/lib/branchTransferIncidentDay.js';

function incident(id, timestamps = []) {
  return {
    id,
    cases: [{
      id: `${id}-case`,
      sale_lines: timestamps.map((timestamp_ms) => ({ timestamp_ms })),
      purchase_lines: [],
    }],
  };
}

test('uses the first operation timestamp as the primary incident day', () => {
  const value = incident('x', [new Date(2026, 9, 14, 11, 0).getTime(), new Date(2026, 9, 15, 0, 5).getTime()]);
  assert.equal(incidentDayKey(value), '2026-10-14');
});

test('day options are newest first with counts', () => {
  const items = [
    incident('a', [new Date(2026, 9, 12, 10, 0).getTime()]),
    incident('b', [new Date(2026, 9, 14, 10, 0).getTime()]),
    incident('c', [new Date(2026, 9, 14, 12, 0).getTime()]),
  ];
  const options = incidentDayOptions(items);
  assert.equal(options[0].key, '2026-10-14');
  assert.equal(options[0].count, 2);
  assert.equal(options[1].key, '2026-10-12');
});

test('filters by one selected day', () => {
  const value = incident('x', [new Date(2026, 9, 13, 10, 0).getTime()]);
  assert.equal(incidentMatchesDay(value, '2026-10-13'), true);
  assert.equal(incidentMatchesDay(value, '2026-10-14'), false);
  assert.equal(incidentMatchesDay(value, 'all'), true);
});

test('sorts newer days first then keeps priority inside the same day', () => {
  const oldHigh = { ...incident('old', [new Date(2026, 9, 12, 10, 0).getTime()]), priority: 1000 };
  const newLow = { ...incident('new-low', [new Date(2026, 9, 14, 10, 0).getTime()]), priority: 1 };
  const newHigh = { ...incident('new-high', [new Date(2026, 9, 14, 11, 0).getTime()]), priority: 500 };
  const sorted = [oldHigh, newLow, newHigh].sort((a, b) => compareIncidentsByDay(a, b, (item) => item.priority));
  assert.deepEqual(sorted.map((item) => item.id), ['new-high', 'new-low', 'old']);
});
