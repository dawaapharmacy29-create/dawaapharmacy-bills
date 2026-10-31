import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWarehouseOrderReport } from '../src/components/orders/warehouseOrderReport.js';

test('groups the same code and unit, without counting duplicate rows twice', () => {
  const base = { product_name: 'كتافلام', product_code: 'P1', unit: 'علبة', status: 'طلب جديد', request_date: '2026-10-31' };
  const report = buildWarehouseOrderReport([
    { ...base, id: 'a', quantity: 2 },
    { ...base, id: 'a', quantity: 2 },
    { ...base, id: 'b', quantity: 3, fulfilled_quantity: 1 },
    { ...base, id: 'c', quantity: 5, unit: 'شريط' },
    { ...base, id: 'd', quantity: 8, status: 'تم الإلغاء' },
    { ...base, id: 'e', quantity: 7, alternative_accepted: true },
  ]);
  assert.equal(report.summary.length, 2);
  assert.equal(report.summary.find(x => x['الوحدة'] === 'علبة')['الكمية المطلوبة'], 4);
  assert.equal(report.summary.find(x => x['الوحدة'] === 'شريط')['الكمية المطلوبة'], 5);
  assert.equal(report.detail.length, 3);
});

test('does not pretend legacy orders with unknown quantity equal one box', () => {
  const report = buildWarehouseOrderReport([{ id:'legacy', product_name:'دواء', status:'طلب جديد', request_date:'2026-10-31' }]);
  assert.equal(report.summary.length, 0);
  assert.equal(report.missingQuantity.length, 1);
});

test('filters by required date and branch', () => {
  const rows = [
    {id:'a',product_name:'A',quantity:1,unit:'علبة',needed_by_date:'2026-11-01',branch:'دواء شكري'},
    {id:'b',product_name:'B',quantity:1,unit:'علبة',needed_by_date:'2026-11-02',branch:'دواء الشامي'},
  ];
  const r = buildWarehouseOrderReport(rows,{from:'2026-11-01',to:'2026-11-01',branch:'دواء شكري'});
  assert.equal(r.summary.length,1);
  assert.equal(r.summary[0]['اسم الصنف'],'A');
});
