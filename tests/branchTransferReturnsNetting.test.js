import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTransferRows } from '../src/lib/branchTransferShadowParser.js';
import { reconcileBranchTransfers } from '../src/lib/branchTransferControl.js';

function purchaseHeader({ invoice = 19275, user = 'د عمر', supplier = 'دواء الشامي', supplierCode = 475, date = '2026-10-01 15:56' } = {}) {
  const row = Array(39).fill(null);
  row[0] = 'ملاحظات';
  row[1] = 'مستخدم';
  row[13] = user;
  row[20] = supplier;
  row[21] = supplierCode;
  row[22] = date;
  row[23] = invoice;
  return row;
}

function purchaseDetail({ qty = 3, returned = 1, code = 21058, name = 'MIDODRINE TAB', expiry = 46753, returnUnitCost = 42.5 } = {}) {
  const row = Array(39).fill(null);
  row[8] = returnUnitCost;
  row[9] = returned;
  row[11] = qty;
  row[13] = expiry;
  row[14] = name;
  row[15] = code;
  row[17] = 127.5;
  row[18] = 150;
  return row;
}

function purchaseTotal() {
  const row = Array(39).fill(null);
  row[6] = 'الإجمالى';
  return row;
}

test('nets B-Connect purchase returned quantity before branch-transfer matching', () => {
  const parsed = parseTransferRows([
    purchaseHeader(),
    purchaseDetail(),
    purchaseTotal(),
  ], { branch: 'دواء فرع ابو العزم' });

  assert.equal(parsed.valid, true);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].invoice, '19275');
  assert.equal(parsed.items[0].gross_qty, 3);
  assert.equal(parsed.items[0].return_qty, 1);
  assert.equal(parsed.items[0].net_qty, 2);
  assert.equal(parsed.items[0].qty, 2);
  assert.equal(parsed.items[0].has_return, true);
  assert.equal(parsed.items[0].return_unit_cost, 42.5);
  assert.equal(parsed.meta.returned_line_count, 1);
  assert.equal(parsed.meta.returned_qty_total, 1);
});

test('nets flat sales export returned quantity instead of treating gross sale as physical movement', () => {
  const rows = [
    ['فاتورة','نوع','كود','عميل','عددأصناف','صافى الفاتورة','خصم نسبة','خصم قيمة','مصاريف','م','ك.صنف','صنف','صلاحية','كمية','وحدة','مرتجع','سعر بيع','خصم صنف','خصم صنف%','تاريخ'],
    [37740,'آجل',170,'فرع ابو العزم',1,100,0,0,0,1,21058,'MIDODRINE TAB','01/2028',3,'علبة',1,50,0,0,'2026-10-01 15:46'],
  ];
  const parsed = parseTransferRows(rows, { branch: 'دواء فرع الشامي' });
  assert.equal(parsed.items[0].gross_qty, 3);
  assert.equal(parsed.items[0].return_qty, 1);
  assert.equal(parsed.items[0].qty, 2);
  assert.equal(parsed.items[0].net_qty, 2);
});

test('realistic MIDODRINE journey becomes matched after purchase 3 minus return 1 equals sale 2', () => {
  const saleRows = [
    ['فاتورة','نوع','كود','عميل','عددأصناف','صافى الفاتورة','خصم نسبة','خصم قيمة','مصاريف','م','ك.صنف','صنف','صلاحية','كمية','وحدة','مرتجع','سعر بيع','خصم صنف','خصم صنف%','تاريخ'],
    [37740,'آجل',170,'فرع ابو العزم',1,100,0,0,0,1,21058,'MIDODRINE TAB','01/2028',2,'علبة',0,50,0,0,'2026-10-01 15:46'],
  ];
  const sales = parseTransferRows(saleRows, { branch: 'دواء فرع الشامي' }).items;
  const purchases = parseTransferRows([
    purchaseHeader({ date: '2026-10-01 15:56' }),
    purchaseDetail({ qty: 3, returned: 1 }),
    purchaseTotal(),
  ], { branch: 'دواء فرع ابو العزم' }).items;

  const cases = reconcileBranchTransfers(sales, purchases);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].type, 'matched');
  assert.equal(cases[0].sale_qty, 2);
  assert.equal(cases[0].purchase_qty, 2);
  assert.equal(cases[0].purchase_lines[0].raw.gross_qty, 3);
  assert.equal(cases[0].purchase_lines[0].raw.return_qty, 1);
});

test('fully returned purchase line remains auditable but contributes zero movement', () => {
  const parsed = parseTransferRows([
    purchaseHeader({ invoice: 17635 }),
    purchaseDetail({ qty: 2, returned: 2, code: 82907, name: 'methapharon amp' }),
    purchaseTotal(),
  ], { branch: 'دواء فرع ابو العزم' });
  assert.equal(parsed.items[0].gross_qty, 2);
  assert.equal(parsed.items[0].return_qty, 2);
  assert.equal(parsed.items[0].qty, 0);
  const cases = reconcileBranchTransfers([], parsed.items);
  assert.equal(cases.length, 0);
});
