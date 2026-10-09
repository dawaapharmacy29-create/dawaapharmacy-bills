import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBConnectReviewRow as classify } from '../src/lib/bconnectReviewDecisionPolicy.js';
test('missing invoice is not treated as a safe update', () => assert.equal(classify({status:'problem',identity:'missing'}).selectable,false));
test('duplicate and incomplete evidence cannot be approved', () => {
 for (const identity of ['duplicate_app','duplicate_bconnect','unverified','unauthorized_or_incomplete','candidate','conflict']) assert.equal(classify({status:'problem',identity}).selectable,false);
});
test('verified difference can be proposed for human review', () => {
 const r=classify({status:'review',identity:'confirmed',app:{id:'invoice-1'},bconnect:{serial:'123'},evidence:{app:{},bconnect:{}},checks:{system_invoice_number:'match',branch:'match',supplier:'match',invoice_date:'match'},financial:{difference:4.203}});
 assert.equal(r.selectable,true);assert.deepEqual(r.differences,['قيمة الفاتورة']);
});
test('unexplained review without a concrete difference is blocked', () => assert.equal(classify({status:'review',identity:'confirmed',checks:{supplier:'unknown'},financial:{difference:null}}).selectable,false));

test('problem verdict cannot be overridden by confirmed identity and monetary difference', () => {
 const row = {status:'problem',identity:'confirmed',checks:{supplier:'match',invoice_date:'match'},financial:{difference:100}};
 assert.equal(classify(row).selectable,false);
});
test('unrecognized status cannot enter decision queue', () => {
 assert.equal(classify({status:'pending',identity:'confirmed',financial:{difference:5}}).selectable,false);
});

test('confirmed identity alone cannot authorize a proposal without record evidence', () => {
 const row={status:'review',identity:'confirmed',checks:{system_invoice_number:'match',branch:'match'},financial:{difference:5}};
 assert.equal(classify(row).selectable,false);
 assert.equal(classify({...row,app:{id:'invoice-1'},bconnect:{serial:'123'},evidence:{app:{},bconnect:{}}}).selectable,true);
 assert.equal(classify({...row,app:{id:'invoice-1'},bconnect:{serial:'123'},evidence:{app:{},bconnect:{}},checks:{system_invoice_number:'match',branch:'mismatch'}}).selectable,false);
});
