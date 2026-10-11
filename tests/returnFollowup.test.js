import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReturnFollowupCandidates,
  hasReturnFollowupSignal,
  normalizeReturnText,
  returnMatchesInvoice,
} from '../src/lib/returnFollowup.js';

test('detects invoices with a positive returned value', () => {
  assert.equal(hasReturnFollowupSignal({ returned_value: 200, notes: '' }), true);
});

test('detects return-related Arabic notes such as supplier notice and bad expiry', () => {
  assert.equal(hasReturnFollowupSignal({ returned_value: 0, notes: 'إشعار من المورد: الصنف تاريخه غير مناسب وسيتم عمل مرتجع' }), true);
});

test('does not flag an unrelated ordinary note', () => {
  assert.equal(hasReturnFollowupSignal({ returned_value: 0, notes: 'تم تجميع فاتورتين في فاتورة واحدة' }), false);
});

test('normalizes Arabic spelling differences used in notes', () => {
  assert.equal(normalizeReturnText('إشعار  مُرتجع'), 'اشعار مرتجع');
});

test('matches return records to the same invoice and branch', () => {
  const invoice = { system_invoice_number: '19794', branch: 'دواء شكري' };
  assert.equal(returnMatchesInvoice({ invoice_number: '19794', branch_name: 'دواء شكري' }, invoice), true);
  assert.equal(returnMatchesInvoice({ invoice_number: '19794', branch_name: 'دواء الشامي' }, invoice), false);
});

test('removes an invoice from follow-up after a matching return is marked Returned', () => {
  const invoices = [{ id: 'i1', system_invoice_number: '10', branch: 'دواء شكري', returned_value: 200, total_value: 1000 }];
  const pending = buildReturnFollowupCandidates(invoices, []);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].net, 800);

  const completed = buildReturnFollowupCandidates(invoices, [{ invoice_number: '10', branch_name: 'دواء شكري', status: 'Returned' }]);
  assert.equal(completed.length, 0);
});
