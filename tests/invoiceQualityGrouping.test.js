import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInvoiceQualityGroups,
  filterInvoiceQualityGroups,
  paginateInvoiceQualityGroups,
  invoiceQualitySupplierKey,
  isInvoiceQualityDuplicate,
} from '../src/lib/invoiceQualityGrouping.js';

const program = (id, number, branch = 'دواء الشامي', supplier = 'مخزن المدينة') => ({
  id, system_invoice_number: number, branch,
  supplier_name: supplier, supplier_invoice_number: null,
  issues: ['duplicate_program'],
  invoice_date: '2026-10-20',
});

const supplier = (id, number, supplierReference, branch = 'دواء الشامي', supplierName = 'مخزن الحياة') => ({
  id, system_invoice_number: number, branch, supplier_name: supplierName,
  supplier_invoice_number: supplierReference,
  issues: ['duplicate'],
});

test('same branch + program number appear adjacent regardless of source sequence or created date', () => {
  const rows = [
    program('a', '10279', 'دواء الشامي', 'مخزن المدينة'),
    program('c', '11205', 'دواء شكري'),
    program('b', '10279.0', 'فرع الشامي', 'دواء شكري'),
    program('d', '11205', 'دواء شكري'),
  ];
  const groups = buildInvoiceQualityGroups(rows, 'program');
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.rows.map((r) => r.id)), [['a', 'b'], ['c', 'd']]);
  assert.equal(groups[0].programNumber, '10279');
  assert.equal(groups[0].branch, 'دواء الشامي');
  assert.equal(groups[1].programNumber, '11205');
});

test('same number in different branches is NOT a common group', () => {
  const groups = buildInvoiceQualityGroups([
    program('a', '20251', 'دواء الشامي'),
    program('b', '20251', 'دواء شكري'),
  ], 'program');
  assert.equal(groups.length, 2);
  assert.ok(groups.every((g) => g.size === 1 && !g.isDuplicate));
});

test('supplier invoice filter groups matching supplier + branch + supplier reference even with different program numbers', () => {
  const groups = buildInvoiceQualityGroups([
    supplier('a', '19719', '54591'),
    supplier('b', '19720', '54591'),
    supplier('c', '19721', '54591', 'دواء شكري'),
  ], 'supplier');
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].rows.map((r) => r.id), ['a', 'b']);
  assert.equal(groups[0].kind, 'supplier');
  assert.equal(groups[0].supplierNumber, '54591');
});

test('connected program + supplier collisions remain one review group without cloning any record', () => {
  const rows = [
    { ...supplier('a', '19719', '54591'), issues: ['duplicate', 'duplicate_program'] },
    { ...supplier('b', '19720', '54591'), issues: ['duplicate'] },
    { ...program('c', '19719'), supplier_name: 'مخزن المدينة', issues: ['duplicate_program'] },
  ];
  const groups = buildInvoiceQualityGroups(rows, 'all');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, 'linked');
  assert.equal(groups[0].size, 3);
  assert.deepEqual(new Set(groups[0].rows.map((r) => r.id)), new Set(['a', 'b', 'c']));
});

test('search for a single member keeps the other invoices next to it', () => {
  const groups = buildInvoiceQualityGroups([
    program('a', '18058', 'دواء شكري', 'مخزن الحياة'),
    program('b', '18058', 'دواء شكري', 'مورد آخر'),
    program('c', '11205', 'دواء الشامي', 'مخزن المدينة'),
    program('d', '11205', 'دواء الشامي', 'مخزن المدينة'),
  ], 'program');
  const matched = filterInvoiceQualityGroups(groups, 'مورد آخر');
  assert.equal(matched.length, 1);
  assert.deepEqual(matched[0].rows.map((r) => r.id), ['a', 'b']);
});

test('pagination never splits one collision group across pages', () => {
  const groupRows = [
    ...Array.from({ length: 249 }, (_, i) => ({ id: 'unique-' + i, system_invoice_number: String(i), branch: 'دواء الشامي', issues: ['zero_total'] })),
    program('a', '88000'), program('b', '88000'),
  ];
  // Groups of distinct invoices are singletons; whole two-row collision
  // must go on a single page even when the previous page is at the limit.
  const groups = buildInvoiceQualityGroups(groupRows, 'program');
  const pages = paginateInvoiceQualityGroups(groups, 250);
  assert.equal(pages.length, 2);
  const colliding = pages.flat().filter((g) => g.size > 1);
  assert.equal(colliding.length, 1);
  assert.equal(colliding[0].size, 2);
  assert.deepEqual([...pages.flatMap((p) => p.flatMap((g) => g.rows.map((r) => r.id)))].length, 251);
});

test('group bigger than a page remains intact on a single overflowing page', () => {
  const groups = buildInvoiceQualityGroups(
    Array.from({ length: 255 }, (_, i) => program('id' + i, '45678')),
    'program'
  );
  const pages = paginateInvoiceQualityGroups(groups, 250);
  assert.equal(pages.length, 1);
  assert.equal(pages[0][0].size, 255);
});

test('missing supplier number does not manufacture a supplier collision', () => {
  assert.equal(invoiceQualitySupplierKey({ branch: 'دواء شكري', supplier_name: 'مورد', supplier_invoice_number: null }), null);
  assert.equal(invoiceQualitySupplierKey({ branch: 'دواء شكري', supplier_name: 'مورد', supplier_invoice_number: undefined }), null);
  const groups = buildInvoiceQualityGroups([
    { ...supplier('x', '9001', null), issues: ['duplicate'] },
    { ...supplier('y', '9002', null), issues: ['duplicate'] },
  ], 'supplier');
  assert.equal(groups.length, 2);
});

test('single nonduplicate issue row never gets labeled as a duplicate group', () => {
  const rows = [{ id: 'a', system_invoice_number: 'TESTDUP-11205', branch: 'دواء الشامي', issues: ['zero_total'] }];
  const groups = buildInvoiceQualityGroups(rows, 'all');
  assert.equal(isInvoiceQualityDuplicate(rows[0]), false);
  assert.equal(groups[0].kind, 'single');
  assert.equal(groups[0].isDuplicate, false);
});

test('empty results have one empty page and no made-up review group', () => {
  assert.deepEqual(buildInvoiceQualityGroups([], 'all'), []);
  assert.deepEqual(paginateInvoiceQualityGroups([], 250), [[]]);
});
