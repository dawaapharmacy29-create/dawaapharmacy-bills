import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareIncidentsByDay,
  incidentDayKey,
  incidentDayOptions,
  incidentMatchesDay,
  incidentMatchesSmartDay,
  smartDayFilterCount,
  smartDayFilterKeys,
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

test('day options expose compact review presets before specific recent days', () => {
  const items = [
    incident('a', [new Date(2026, 9, 12, 10, 0).getTime()]),
    incident('b', [new Date(2026, 9, 14, 10, 0).getTime()]),
    incident('c', [new Date(2026, 9, 14, 12, 0).getTime()]),
  ];
  const options = incidentDayOptions(items);
  assert.equal(options[0].preset, 'latest');
  assert.equal(options[0].count, 2);
  assert.match(options[0].label, /أحدث يوم/);
  assert.equal(options[1].preset, 'last3');
  assert.equal(options[1].count, 3);
  assert.equal(options[3].key, '2026-10-14');
  assert.equal(options[3].count, 2);
});

test('filters by one selected day', () => {
  const value = incident('x', [new Date(2026, 9, 13, 10, 0).getTime()]);
  assert.equal(incidentMatchesDay(value, '2026-10-13'), true);
  assert.equal(incidentMatchesDay(value, '2026-10-14'), false);
  assert.equal(incidentMatchesDay(value, 'all'), true);
});

test('smart presets select newest available review days instead of calendar arithmetic', () => {
  const items = [
    incident('a', [new Date(2026, 9, 10, 10, 0).getTime()]),
    incident('b', [new Date(2026, 9, 13, 10, 0).getTime()]),
    incident('c', [new Date(2026, 9, 16, 10, 0).getTime()]),
  ];
  const options = incidentDayOptions(items);
  const latest = options.find((item) => item.preset === 'latest');
  const last3 = options.find((item) => item.preset === 'last3');
  assert.deepEqual([...smartDayFilterKeys(options, latest.key)], ['2026-10-16']);
  assert.deepEqual([...smartDayFilterKeys(options, last3.key)], ['2026-10-16', '2026-10-13', '2026-10-10']);
  assert.equal(incidentMatchesDay(items[1], latest.key), false);
  assert.equal(incidentMatchesSmartDay(items[1], last3.key, options), true);
  assert.equal(smartDayFilterCount(items, last3.key, options), 3);
});

test('sorts newer days first then keeps priority inside the same day', () => {
  const oldHigh = { ...incident('old', [new Date(2026, 9, 12, 10, 0).getTime()]), priority: 1000 };
  const newLow = { ...incident('new-low', [new Date(2026, 9, 14, 10, 0).getTime()]), priority: 1 };
  const newHigh = { ...incident('new-high', [new Date(2026, 9, 14, 11, 0).getTime()]), priority: 500 };
  const sorted = [oldHigh, newLow, newHigh].sort((a, b) => compareIncidentsByDay(a, b, (item) => item.priority));
  assert.deepEqual(sorted.map((item) => item.id), ['new-high', 'new-low', 'old']);
});
