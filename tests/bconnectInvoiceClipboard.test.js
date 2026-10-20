import test from 'node:test';
import assert from 'node:assert/strict';
import { copyBConnectInvoiceNumber } from '../src/lib/bconnectInvoiceClipboard.js';

test('copies only the invoice serial and preserves leading zeros', async () => {
  const copied = [];
  const clipboard = { writeText: async (value) => { copied.push(value); } };
  assert.equal(await copyBConnectInvoiceNumber('0011101', clipboard), true);
  assert.deepEqual(copied, ['0011101']);
});

test('never copies invoice labels or related supplier information', async () => {
  let copied = '';
  const row = { number: 11155, supplier: 'صيدليات', supplier_invoice_number: 'supplier-402' };
  assert.equal(await copyBConnectInvoiceNumber(row.number, {
    writeText: async (value) => { copied = value; },
  }), true);
  assert.equal(copied, '11155');
});

test('uses selection fallback if clipboard permissions are denied', async () => {
  let value = '';
  const result = await copyBConnectInvoiceNumber('11102', {
    writeText: async () => { throw new Error('NotAllowedError'); },
  }, (text) => { value = text; return true; });
  assert.equal(result, true);
  assert.equal(value, '11102');
});

test('reports failure if browser denies both clipboard and fallback', async () => {
  assert.equal(await copyBConnectInvoiceNumber('11102', {
    writeText: async () => { throw new Error('denied'); },
  }, () => false), false);
});

test('empty or invalid invoice number never enters clipboard', async () => {
  let attempts = 0;
  const clipboard = { writeText: async () => { attempts += 1; } };
  for (const value of [null, undefined, '', '    ']) {
    assert.equal(await copyBConnectInvoiceNumber(value, clipboard), false);
  }
  assert.equal(attempts, 0);
});

test('success never invokes legacy fallback', async () => {
  let fallbackCalls = 0;
  const result = await copyBConnectInvoiceNumber(17981,
    { writeText: async () => undefined },
    () => { fallbackCalls += 1; return true; });
  assert.equal(result, true);
  assert.equal(fallbackCalls, 0);
});
