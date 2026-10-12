import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTransferRows } from '../src/lib/branchTransferShadowParser.js';

test('parses flat sales export used by daily B-Connect sales files', () => {
  const rows = [
    ['فواتير المبيعات من 10/10/2026 إلى 12/10/2026'],
    ['فاتورة','نوع','كود','عميل','عددأصناف','صافى الفاتورة','خصم نسبة','خصم قيمة','مصاريف','م','ك.صنف','صنف','صلاحية','كمية','وحدة','مرتجع','سعر بيع','خصم صنف','خصم صنف%','تاريخ'],
    [76989,'آجل',10,'دواء الشامي',1,200,0,0,0,1,75840,'لورد امواس 10 قطع','.',10,'علبة',0,200,0,0,'2026-10-10 11:00'],
  ];
  const parsed = parseTransferRows(rows, { branch: 'دواء فرع ابو العزم', counterparty: 'دواء فرع الشامي' });
  assert.equal(parsed.valid, true);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].invoice, '76989');
  assert.equal(parsed.items[0].code, '75840');
  assert.equal(parsed.items[0].qty, 10);
  assert.equal(parsed.items[0].unit, 'علبة');
  assert.equal(parsed.items[0].branch, 'دواء فرع ابو العزم');
  assert.equal(parsed.items[0].counterparty, 'دواء فرع الشامي');
});

test('parses nested B-Connect purchase report rows and inherits invoice user/date', () => {
  const header = Array(39).fill(null);
  header[0] = 'ملاحظات';
  header[1] = 'مستخدم';
  header[13] = 'د علياء سامي';
  header[20] = 'دواء ابو العزم';
  header[22] = '2026-10-10 11:00';
  header[23] = 11142;
  const detail = Array(39).fill(null);
  detail[11] = 10;
  detail[14] = 'لورد امواس 10 قطع';
  detail[15] = '75840';
  detail[17] = 136.1;
  detail[18] = 200;
  const total = Array(39).fill(null);
  total[6] = 'الإجمالى';
  const parsed = parseTransferRows([header, detail, total], { branch: 'دواء فرع الشامي', counterparty: 'دواء فرع ابو العزم' });
  assert.equal(parsed.valid, true);
  assert.equal(parsed.meta.source_format, 'bconnect_purchase_report');
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].invoice, '11142');
  assert.equal(parsed.items[0].user, 'د علياء سامي');
  assert.equal(parsed.items[0].product_name, 'لورد امواس 10 قطع');
  assert.equal(parsed.items[0].code, '75840');
  assert.equal(parsed.items[0].qty, 10);
  assert.equal(parsed.items[0].branch, 'دواء فرع الشامي');
});
