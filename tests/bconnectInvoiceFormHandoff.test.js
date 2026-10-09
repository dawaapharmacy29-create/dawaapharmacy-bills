import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBConnectFormHandoff } from '../src/lib/bconnectInvoiceFormHandoff.js';

const bconnect = {serial:'19522',branch:'فرع شكري',supplier:'شركة س',invoice_value:155,return_value:5,date:'15/09/2026'};
test('missing invoice opens create mode with source-backed fields and no invented supplier identity', () => {
 const result=buildBConnectFormHandoff({number:'19522',identity:'missing',bconnect});
 assert.equal(result.mode,'create');
 assert.equal(result.proposed.system_invoice_number,'19522');
 assert.equal(result.proposed.branch,'دواء شكري');
 assert.equal(result.proposed.total_value,155);
 assert.equal(result.proposed.returned_value,5);
 assert.equal(result.proposed.invoice_date,'2026-09-15');
 assert.equal(result.proposed.supplier_id,undefined);
 assert.equal(result.proposed.entered_by,undefined);
});
test('confirmed invoice opens edit mode preserving existing fields and record identity', () => {
 const app={id:'app-1',system_invoice_number:'19522',branch:'دواء شكري',total_value:100,supplier_id:'supplier-1',supplier_name:'شركة س',entered_by:'موظف التطبيق'};
 const result=buildBConnectFormHandoff({number:'19522',identity:'confirmed',app,bconnect});
 assert.equal(result.mode,'edit');
 assert.equal(result.recordId,'app-1');
 assert.equal(result.expectedTotal,100);
 assert.equal(result.proposed.total_value,155);
 assert.equal(result.proposed.entered_by,'موظف التطبيق');
 assert.equal(result.proposed.supplier_id,'supplier-1');
});
test('duplicates and unverified rows never offer a form handoff', () => {
 for (const identity of ['duplicate_app','duplicate_bconnect','unverified','unauthorized_or_incomplete','conflict','candidate']) {
   assert.equal(buildBConnectFormHandoff({number:'19522',identity,bconnect}),null);
 }
});
test('missing or unrecognized branch cannot be silently assigned', () => {
 assert.equal(buildBConnectFormHandoff({number:'19522',identity:'missing',bconnect:{...bconnect,branch:'مخزن غير معروف'}}),null);
});

test('rejects handoff if source number differs from reviewed number', () => {
 assert.equal(buildBConnectFormHandoff({number:'999',identity:'missing',bconnect}),null);
});
test('rejects editing when the app branch or number conflicts with B-Connect', () => {
 const app={id:'app-1',system_invoice_number:'19522',branch:'دواء الشامي',total_value:100};
 assert.equal(buildBConnectFormHandoff({number:'19522',identity:'confirmed',app,bconnect}),null);
 assert.equal(buildBConnectFormHandoff({number:'19522',identity:'confirmed',app:{...app,branch:'دواء شكري',system_invoice_number:'999'},bconnect}),null);
});

test('missing invoice with absent or impossible financial values cannot open prefilled create form', () => {
 for (const value of [null, undefined, '', 'not-a-number', -5]) {
   assert.equal(buildBConnectFormHandoff({number:'19522',identity:'missing',bconnect:{...bconnect,invoice_value:value}}),null);
 }
 assert.equal(buildBConnectFormHandoff({number:'19522',identity:'missing',bconnect:{...bconnect,return_value:200}}),null);
});


test('rejects impossible calendar dates rather than silently pre-filling them', () => {
 for (const date of ['31/02/2026', '2026-13-01', '29/02/2025', '2026-00-10']) {
   assert.equal(buildBConnectFormHandoff({number:'19522',identity:'missing',bconnect:{...bconnect,date}}),null);
 }
 assert.equal(buildBConnectFormHandoff({number:'19522',identity:'missing',bconnect:{...bconnect,date:'29/02/2024'}}).proposed.invoice_date,'2024-02-29');
});

test('confirmed invoice rejects impossible source amounts before editing', () => {
 const app={id:'app-1',system_invoice_number:'19522',branch:'دواء شكري',total_value:100};
 for (const changes of [{invoice_value:-1},{return_value:-1},{invoice_value:10,return_value:11}]) {
   assert.equal(buildBConnectFormHandoff({number:'19522',identity:'confirmed',app,bconnect:{...bconnect,...changes}}),null);
 }
});

test('partial edit amounts are validated against values retained from the app', () => {
 const app={id:'app-1',system_invoice_number:'19522',branch:'دواء شكري',total_value:100,returned_value:90};
 assert.equal(buildBConnectFormHandoff({number:'19522',identity:'confirmed',app,bconnect:{...bconnect,invoice_value:50,return_value:null}}),null);
 assert.equal(buildBConnectFormHandoff({number:'19522',identity:'confirmed',app,bconnect:{...bconnect,invoice_value:null,return_value:110}}),null);
 const safe=buildBConnectFormHandoff({number:'19522',identity:'confirmed',app,bconnect:{...bconnect,invoice_value:120,return_value:null}});
 assert.equal(safe.proposed.total_value,120);
 assert.equal(safe.proposed.returned_value,90);
});
