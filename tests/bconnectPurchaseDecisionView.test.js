import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBConnectPurchaseDecision, countBConnectDecisionLanes } from '../src/lib/bconnectPurchaseDecisionView.js';

function baseRow(overrides = {}) {
  return {
    number: '19794',
    status: 'review',
    identity: 'confirmed',
    checks: { system_invoice_number: 'match', branch: 'match', supplier: 'match', invoice_date: 'match' },
    financial: { comparable: true, match: true, difference: 0 },
    app: { id: 'a1', total_value: 300, returned_value: 0, invoice_date: '2026-10-11', notes: '' },
    bconnect: { invoice_value: 300, return_value: 0, date: '2026-10-11' },
    evidence: { app: {}, bconnect: {} },
    ...overrides,
  };
}

test('routes value-matched supplier mismatch to fast approve', () => {
  const row = baseRow({ checks: { system_invoice_number: 'match', branch: 'match', supplier: 'mismatch', invoice_date: 'match' } });
  const view = buildBConnectPurchaseDecision(row);
  assert.equal(view.lane, 'approve');
  assert.equal(view.fastAccept, true);
  assert.equal(view.nextAction, 'accept_as_is');
});

test('never exposes fast accept when execution policy is blocked by missing evidence', () => {
  const row = baseRow({
    checks: { system_invoice_number: 'match', branch: 'match', supplier: 'mismatch', invoice_date: 'match' },
    evidence: { app: null, bconnect: null },
  });
  const view = buildBConnectPurchaseDecision(row);
  assert.equal(view.lane, 'investigate');
  assert.equal(view.fastAccept, false);
  assert.equal(view.selectable, false);
});

test('routes unexplained money difference to explain lane', () => {
  const row = baseRow({ financial: { comparable: true, match: false, difference: 246 }, app: { id: 'a1', total_value: 300, returned_value: 0, invoice_date: '2026-10-11', notes: '' }, bconnect: { invoice_value: 546, return_value: 0, date: '2026-10-11' } });
  const view = buildBConnectPurchaseDecision(row);
  assert.equal(view.lane, 'explain');
  assert.equal(view.absoluteFinancialDifference, 246);
  assert.equal(view.hasNote, false);
  assert.equal(view.evidence, null);
});

test('marks an exact return delta as high-confidence evidence without auto-accepting it', () => {
  const row = baseRow({
    financial: { comparable: true, match: false, difference: 200 },
    app: { id: 'a1', total_value: 800, returned_value: 200, invoice_date: '2026-10-11', notes: '' },
    bconnect: { invoice_value: 1000, return_value: 0, date: '2026-10-11' },
  });
  const view = buildBConnectPurchaseDecision(row);
  assert.equal(view.lane, 'explain');
  assert.equal(view.exactReturnExplanation, true);
  assert.equal(view.evidenceConfidence, 'high');
  assert.match(view.instruction, /المرتجع/);
  assert.equal(view.fastAccept, false);
});

test('surfaces consolidation note as evidence but not as proof', () => {
  const row = baseRow({
    financial: { comparable: true, match: false, difference: 200 },
    app: { id: 'a1', total_value: 800, returned_value: 0, invoice_date: '2026-10-11', notes: 'تم تجميع الفواتير حسب الفاتورة الورقية' },
    bconnect: { invoice_value: 1000, return_value: 0, date: '2026-10-11' },
  });
  const view = buildBConnectPurchaseDecision(row);
  assert.equal(view.lane, 'explain');
  assert.equal(view.evidence?.code, 'consolidation_note');
  assert.equal(view.evidenceConfidence, 'medium');
  assert.equal(view.fastAccept, false);
});

test('keeps duplicate invoices in investigate lane', () => {
  const row = baseRow({ status: 'problem', identity: 'duplicate_app' });
  assert.equal(buildBConnectPurchaseDecision(row).lane, 'investigate');
});

test('routes missing invoice to register lane', () => {
  const row = baseRow({ status: 'problem', identity: 'missing', app: null, checks: {}, financial: { difference: null } });
  const view = buildBConnectPurchaseDecision(row);
  assert.equal(view.lane, 'register');
  assert.equal(view.nextAction, 'register');
});

test('counts decision lanes for manager summary', () => {
  const rows = [
    baseRow({ checks: { system_invoice_number: 'match', branch: 'match', supplier: 'mismatch', invoice_date: 'match' } }),
    baseRow({ financial: { comparable: true, match: false, difference: 10 } }),
    baseRow({ status: 'problem', identity: 'missing', app: null, checks: {}, financial: { difference: null } }),
  ];
  const counts = countBConnectDecisionLanes(rows);
  assert.deepEqual({ approve: counts.approve, explain: counts.explain, register: counts.register }, { approve: 1, explain: 1, register: 1 });
});
