import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const form = readFileSync(new URL('../src/components/invoices/InvoiceFormDialog.jsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/pages/PurchaseInvoices.jsx', import.meta.url), 'utf8');

test('B-Connect review handoff explicitly activates read-only form', () => {
  assert.ok(page.includes('reviewOnly={Boolean(activeHandoff)}'));
  assert.ok(form.includes('reviewOnly = false'));
  assert.ok(form.includes('disabled={isLoading || reviewOnly}'));
  assert.ok(form.includes('if (reviewOnly) return;'));
});

test('B-Connect read-only state cannot reach legacy mutations', () => {
  const start = page.indexOf('const handleSubmit = async (formData) => {');
  const end = page.indexOf('// Bulk actions', start);
  assert.ok(start !== -1 && end > start);
  const submit = page.slice(start, end);
  assert.ok(submit.includes('if (!activeHandoff)'));
  assert.ok(submit.includes('setHandoffWriteWarning('));
  assert.ok(!submit.includes('mutateAsync('));
  assert.ok(!submit.includes('PurchaseInvoice.create('));
  assert.ok(!submit.includes('PurchaseInvoice.update('));
});
