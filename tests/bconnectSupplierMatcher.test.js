import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSupplierName, rankSupplierSuggestions, supplierMatchScore } from '../src/lib/bconnectSupplierMatcher.js';

test('normalizes common Arabic supplier-name differences', () => {
  assert.equal(
    normalizeSupplierName('مخزن المدينة المنورة للإكسسوار', { stripGenericPrefix: true }),
    normalizeSupplierName('المدينة المنوره للاكسسوار', { stripGenericPrefix: true }),
  );
});

test('ranks warehouse-prefixed app supplier as a very strong suggestion', () => {
  const suppliers = [
    { id: '1', name: 'مخزن المدينة المنوره للاكسسوار' },
    { id: '2', name: 'المدينة للأدوية' },
    { id: '3', name: 'مخزن شكري' },
  ];
  const ranked = rankSupplierSuggestions('المدينة المنوره للاكسسوار', suppliers);
  assert.equal(ranked[0]?.id, '1');
  assert.ok(ranked[0]?.matchScore >= 0.95);
});

test('does not suggest unrelated suppliers', () => {
  assert.ok(supplierMatchScore('المدينة المنوره للاكسسوار', 'اتحاد الصيادلة') < 0.72);
});
