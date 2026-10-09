import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBConnectFormHandoff } from '../src/lib/bconnectInvoiceFormHandoff.js';

const source = {
  number: '18021', identity: 'confirmed',
  bconnect: { serial: '18021', branch: 'دواء شكري', date: '2026-09-08', invoice_value: 220, return_value: 0 },
};

test('confirmed invoice without a stable app record cannot become create or edit', () => {
  for (const app of [undefined, null, {}, { id: '' }]) {
    assert.equal(buildBConnectFormHandoff({ ...source, app }), null);
  }
});

test('confirmed invoice with a matching app record stays an edit', () => {
  const result = buildBConnectFormHandoff({
    ...source,
    app: { id: 'existing-18021', system_invoice_number: '18021', branch: 'دواء شكري', total_value: 220, returned_value: 0, invoice_date: '2026-09-08' },
  });
  assert.equal(result?.mode, 'edit');
  assert.equal(result?.recordId, 'existing-18021');
});
