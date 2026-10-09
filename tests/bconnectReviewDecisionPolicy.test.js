import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBConnectReviewRow as classify } from '../src/lib/bconnectReviewDecisionPolicy.js';
test('missing invoice is not treated as a safe update', () => assert.equal(classify({status:'problem',identity:'missing'}).selectable,false));
test('duplicate and incomplete evidence cannot be approved', () => {
 for (const identity of ['duplicate_app','duplicate_bconnect','unverified','unauthorized_or_incomplete','candidate','conflict']) assert.equal(classify({status:'problem',identity}).selectable,false);
});
test('verified difference can be proposed for human review', () => {
 const r=classify({status:'review',identity:'confirmed',checks:{supplier:'match',invoice_date:'match'},financial:{difference:4.203}});
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
