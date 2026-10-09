import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBConnectFormHandoff } from '../src/lib/bconnectInvoiceFormHandoff.js';

const base = {
  number: '19258', identity: 'missing',
  bconnect: { serial: '19258', branch: 'دواء شكري', invoice_value: 370, return_value: 0, date: '2026-10-01' },
};

test('B-Connect missing invoice never inherits the form default date', () => {
  for (const date of [null, undefined, '', ' ', '2026-02-30', '2026-10-01T12:00:00Z']) {
    assert.equal(buildBConnectFormHandoff({
      ...base, bconnect: { ...base.bconnect, date },
    }), null, String(date));
  }
});

test('B-Connect valid dated missing invoice can enter review-only handoff', () => {
  const result = buildBConnectFormHandoff(base);
  assert.equal(result.mode, 'create');
  assert.equal(result.proposed.invoice_date, '2026-10-01');
  assert.equal(result.proposed.system_invoice_number, '19258');
});
