import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTransferIncidents, summarizeTransferIncidents } from '../src/lib/branchTransferIncidentIntelligence.js';

function missingSale({ id, invoice, code, name, qty = 1, from = 'shamy', to = 'shokry' }) {
  return {
    id,
    type: 'sale_without_purchase',
    severity: 95,
    from,
    to,
    product_name: name,
    sale_qty: qty,
    purchase_qty: 0,
    sale_codes: [code],
    purchase_codes: [],
    sale_invoices: [String(invoice)],
    purchase_invoices: [],
    sale_lines: [{ id: `${id}-sale` }],
    purchase_lines: [],
    decision_intelligence: {
      issue_confidence: { score: 72 },
      summary: 'توجد علامة تستحق التحقيق.',
      recommended_check: 'راجع الشراء.',
    },
  };
}

function matched({ id, invoice, code, name, from = 'shamy', to = 'shokry' }) {
  return {
    id,
    type: 'matched',
    severity: 0,
    from,
    to,
    product_name: name,
    sale_codes: [code],
    purchase_codes: [code],
    sale_invoices: [String(invoice)],
    purchase_invoices: ['p1'],
    sale_lines: [{ id: `${id}-sale` }],
    purchase_lines: [{ id: `${id}-purchase` }],
  };
}

test('seven missing lines from the same sale invoice collapse into one high-confidence root-cause incident', () => {
  const cases = Array.from({ length: 7 }, (_, index) => missingSale({
    id: `m${index}`,
    invoice: 39355,
    code: `80${index}`,
    name: `product ${index}`,
  }));
  const incidents = buildTransferIncidents(cases);
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].kind, 'whole_sale_invoice_missing');
  assert.equal(incidents[0].line_issue_count, 7);
  assert.ok(incidents[0].root_cause_confidence >= 95);
  assert.match(incidents[0].summary, /39355/);
  assert.match(incidents[0].recommended_check, /مرة واحدة/);
});

test('one missing line from an otherwise matched invoice stays a partial invoice issue', () => {
  const cases = [
    missingSale({ id: 'missing', invoice: 77479, code: '19340', name: 'mepaco Khamera' }),
    matched({ id: 'matched', invoice: 77479, code: '67527', name: 'Decancit SR' }),
  ];
  const incidents = buildTransferIncidents(cases);
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].kind, 'partial_sale_invoice_missing');
  assert.equal(incidents[0].line_issue_count, 1);
});

test('unit conversion remains its own incident and is not treated as employee error', () => {
  const cases = [{
    id: 'unit-1',
    type: 'unit_conversion_review',
    severity: 45,
    from: 'shokry',
    to: 'shamy',
    product_name: 'bonosome 7 syringes',
    sale_codes: ['79767'],
    purchase_codes: ['79767'],
    sale_invoices: ['77456'],
    purchase_invoices: ['11303'],
    decision_intelligence: {
      issue_confidence: { score: 12 },
      summary: 'تحويل وحدة محتمل.',
      recommended_check: 'أكد علاقة الوحدة.',
    },
  }];
  const incidents = buildTransferIncidents(cases);
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].kind, 'unit_conversion');
  assert.equal(incidents[0].employee_error_confirmed, false);
});

test('summary reports decisions separately from raw line issues', () => {
  const cases = [
    ...Array.from({ length: 7 }, (_, index) => missingSale({ id: `a${index}`, invoice: 39355, code: `9${index}`, name: `p${index}` })),
    missingSale({ id: 'b', invoice: 39451, code: '56686', name: 'FASTCURE' }),
  ];
  const summary = summarizeTransferIncidents(buildTransferIncidents(cases));
  assert.equal(summary.total, 2);
  assert.equal(summary.line_issues, 8);
  assert.equal(summary.whole_invoice_missing, 1);
});
