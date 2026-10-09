import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// This guard catches a JSX build-safe typo that rejects every valid date.
test('B-Connect save date check uses digit classes, not literal backslashes', () => {
  const source = readFileSync(new URL('../src/pages/PurchaseInvoices.jsx', import.meta.url), 'utf8');
  assert.ok(source.includes(String.raw`/^\d{4}-\d{2}-\d{2}$/.test(finalDate)`));
  assert.ok(!source.includes(String.raw`/^\\d{4}-\\d{2}-\\d{2}$/.test(finalDate)`));
});
