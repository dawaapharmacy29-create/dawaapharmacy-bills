import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBConnectDecisionGroups, buildBConnectPurchaseDecision, countBConnectDecisionLanes } from '../src/lib/bconnectPurchaseDecisionView.js';

function baseRow(overrides = {}) {
  return {
    number: '19794',
    status: 'review',
    identity: 'confirmed',
    checks: { system_invoice_number: 'match', branch: 'match', supplier: 'match', invoice_date: 'match' },
    financial: { comparable: true, match: true, difference: 0 },
    app: { id: 'a1', branch: 'دواء شكري', supplier_name: 'مورد التطبيق', total_value: 300, returned_value: 0, invoice_date: '2026-10-11', notes: '' },
    bconnect: { branch: 'دواء شكري', supplier: 'مورد بي كونكت', invoice_value: 300, return_value: 0, date: '2026-10-11' },
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
  assert.equal(view.confidence.code, 'very_high');
  assert.equal(view.bulkEligible, true);
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
  assert.equal(view.bulkEligible, false);
});

test('routes unexplained money difference to explain lane', () => {
  const row = baseRow({ financial: { comparable: true, match: false, difference: 246 }, app: { id: 'a1', branch: 'دواء شكري', supplier_name: 'مورد التطبيق', total_value: 300, returned_value: 0, invoice_date: '2026-10-11', notes: '' }, bconnect: { branch: 'دواء شكري', supplier: 'مورد بي كونكت', invoice_value: 546, return_value: 0, date: '2026-10-11' } });
  const view = buildBConnectPurchaseDecision(row);
  assert.equal(view.lane, 'explain');
  assert.equal(view.absoluteFinancialDifference, 246);
  assert.equal(view.hasNote, false);
  assert.equal(view.evidence, null);
  assert.equal(view.bulkEligible, false);
});

test('marks an exact return delta as high-confidence evidence without auto-accepting it', () => {
  const row = baseRow({
    financial: { comparable: true, match: false, difference: 200 },
    app: { id: 'a1', branch: 'دواء شكري', supplier_name: 'مورد التطبيق', total_value: 800, returned_value: 200, invoice_date: '2026-10-11', notes: '' },
    bconnect: { branch: 'دواء شكري', supplier: 'مورد بي كونكت', invoice_value: 1000, return_value: 0, date: '2026-10-11' },
  });
  const view = buildBConnectPurchaseDecision(row);
  assert.equal(view.lane, 'explain');
  assert.equal(view.exactReturnExplanation, true);
  assert.equal(view.evidenceConfidence, 'high');
  assert.match(view.instruction, /المرتجع/);
  assert.equal(view.fastAccept, false);
  assert.equal(view.confidence.code, 'high_explanation');
});

test('surfaces consolidation note as evidence but not as proof', () => {
  const row = baseRow({
    financial: { comparable: true, match: false, difference: 200 },
    app: { id: 'a1', branch: 'دواء شكري', supplier_name: 'مورد التطبيق', total_value: 800, returned_value: 0, invoice_date: '2026-10-11', notes: 'تم تجميع الفواتير حسب الفاتورة الورقية' },
    bconnect: { branch: 'دواء شكري', supplier: 'مورد بي كونكت', invoice_value: 1000, return_value: 0, date: '2026-10-11' },
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

test('date-only fast approval loses bulk eligibility when date delta is too large', () => {
  const row = baseRow({
    checks: { system_invoice_number: 'match', branch: 'match', supplier: 'match', invoice_date: 'mismatch' },
    app: { id: 'a1', branch: 'دواء شكري', supplier_name: 'مورد بي كونكت', total_value: 300, returned_value: 0, invoice_date: '2026-10-01', notes: '' },
    bconnect: { branch: 'دواء شكري', supplier: 'مورد بي كونكت', invoice_value: 300, return_value: 0, date: '2026-10-11' },
  });
  const view = buildBConnectPurchaseDecision(row);
  assert.equal(view.fastAccept, true);
  assert.equal(view.bulkEligible, false);
});

test('groups only identical safe decision fingerprints', () => {
  const a = baseRow({ number: '1', app: { id: 'a1', branch: 'دواء شكري', supplier_name: 'مخزن المدينة', total_value: 300, returned_value: 0, invoice_date: '2026-10-11', notes: '' }, bconnect: { branch: 'دواء شكري', supplier: 'المدينة', invoice_value: 300, return_value: 0, date: '2026-10-11' }, checks: { system_invoice_number: 'match', branch: 'match', supplier: 'mismatch', invoice_date: 'match' } });
  const b = baseRow({ number: '2', app: { id: 'a2', branch: 'دواء شكري', supplier_name: 'مخزن المدينة', total_value: 500, returned_value: 0, invoice_date: '2026-10-12', notes: '' }, bconnect: { branch: 'دواء شكري', supplier: 'المدينة', invoice_value: 500, return_value: 0, date: '2026-10-12' }, checks: { system_invoice_number: 'match', branch: 'match', supplier: 'mismatch', invoice_date: 'match' } });
  const c = baseRow({ number: '3', app: { id: 'a3', branch: 'دواء الشامي', supplier_name: 'مخزن المدينة', total_value: 700, returned_value: 0, invoice_date: '2026-10-12', notes: '' }, bconnect: { branch: 'دواء الشامي', supplier: 'المدينة', invoice_value: 700, return_value: 0, date: '2026-10-12' }, checks: { system_invoice_number: 'match', branch: 'match', supplier: 'mismatch', invoice_date: 'match' } });
  const groups = buildBConnectDecisionGroups([a, b, c]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows.length, 2);
  assert.equal(groups[0].branch, 'دواء شكري');
});

test('does not group fast-accept rows carrying notes or returns', () => {
  const a = baseRow({ number: '1', checks: { system_invoice_number: 'match', branch: 'match', supplier: 'mismatch', invoice_date: 'match' }, app: { id: 'a1', branch: 'دواء شكري', supplier_name: 'مخزن المدينة', total_value: 300, returned_value: 0, invoice_date: '2026-10-11', notes: 'ملاحظة خاصة' } });
  const b = baseRow({ number: '2', checks: { system_invoice_number: 'match', branch: 'match', supplier: 'mismatch', invoice_date: 'match' }, app: { id: 'a2', branch: 'دواء شكري', supplier_name: 'مخزن المدينة', total_value: 500, returned_value: 0, invoice_date: '2026-10-11', notes: '' } });
  assert.equal(buildBConnectDecisionGroups([a, b]).length, 0);
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


test("a small confirmed amount drift is green and has no bulk approval action", () => {
  const row = baseRow({
    status: "clean",
    financial: { comparable: true, match: false, within_tolerance: true, tolerance_amount: 5, difference: 5 },
    bconnect: { branch: "دواء شكري", supplier: "مورد التطبيق", invoice_value: 305, return_value: 0, date: "2026-10-11" },
  });
  const view = buildBConnectPurchaseDecision(row);
  assert.equal(view.lane, "clean");
  assert.equal(view.label, "فرق مقبول");
  assert.equal(view.toleranceAccepted, true);
  assert.equal(view.financialDifference, 5);
  assert.equal(view.fastAccept, false);
  assert.equal(view.bulkEligible, false);
});

test("a tolerated value never auto-approves a different supplier or date", () => {
  const row = baseRow({
    financial: { comparable: true, match: false, within_tolerance: true, tolerance_amount: 5, difference: -4.203 },
    checks: { system_invoice_number: "match", branch: "match", supplier: "mismatch", invoice_date: "match" },
  });
  const view = buildBConnectPurchaseDecision(row);
  assert.equal(view.lane, "correct");
  assert.equal(view.toleranceAccepted, true);
  assert.equal(view.fastAccept, false);
  assert.equal(view.bulkEligible, false);
  assert.match(view.instruction, /مقبول/);
});

test("small differences involving a return, note or ambiguous identity remain investigated", () => {
  const financial = { comparable: true, match: false, within_tolerance: true, tolerance_amount: 5, difference: 3 };
  const returned = buildBConnectPurchaseDecision(baseRow({
    financial,
    app: { id: "a1", branch: "دواء شكري", returned_value: 3, notes: "" },
  }));
  assert.equal(returned.lane, "explain");
  assert.equal(returned.toleranceAccepted, false);

  const noted = buildBConnectPurchaseDecision(baseRow({
    financial,
    app: { id: "a1", branch: "دواء شكري", returned_value: 0, notes: "تم تجميع فاتورتين" },
  }));
  assert.equal(noted.lane, "explain");
  assert.equal(noted.fastAccept, false);

  const unverified = buildBConnectPurchaseDecision(baseRow({
    financial,
    identity: "unverified",
    status: "problem",
  }));
  assert.equal(unverified.lane, "investigate");
  assert.equal(unverified.toleranceAccepted, false);
});

test("5.01 EGP remains a financial explanation and never enters safe bulk", () => {
  const row = baseRow({
    financial: { comparable: true, match: false, within_tolerance: false, tolerance_amount: 5, difference: 5.01 },
  });
  const view = buildBConnectPurchaseDecision(row);
  assert.equal(view.lane, "explain");
  assert.equal(view.toleranceAccepted, false);
  assert.equal(view.bulkEligible, false);
});
