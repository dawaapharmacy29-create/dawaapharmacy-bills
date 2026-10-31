import test from 'node:test';
import assert from 'node:assert/strict';

const { default: handler, searchPattern } = await import('../api/order-reference.js');

test('Arabic and English wildcards preserve their positions safely', () => {
  assert.equal(searchPattern('م*حم*'), 'م*حم*');
  assert.equal(searchPattern('محم*'), 'محم*');
  assert.equal(searchPattern('الف*ر*ن'), 'الف*ر*ن');
  assert.equal(searchPattern('Panadol'), '*Panadol*');
  assert.equal(searchPattern('*,(%)'), null);
});

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test('rejects missing session before any database access', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('unexpected request'); };
  try {
    const res = response();
    await handler({ method: 'POST', body: { mode: 'product', query: 'panadol' } }, res);
    assert.equal(res.statusCode, 400);
  } finally { globalThis.fetch = oldFetch; }
});

test('invalid employee session cannot search management data', async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: false, status: 401, json: async () => ({ ok: false, error: 'invalid_session' }) }; };
  try {
    const res = response();
    await handler({ method: 'POST', body: { session_token: 'wrong', mode: 'product', query: 'panadol' } }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = oldFetch; }
});

test('authenticated product suggestions return only name and code', async () => {
  const oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => ({ ok: true, data: [{ product_name: 'Panadol', product_code: '123' }] }) };
  };
  try {
    const res = response();
    await handler({ method: 'POST', body: { session_token: 'valid', mode: 'product', query: 'Pan' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload.data, [{ product_name: 'Panadol', product_code: '123' }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.Authorization, undefined);
    assert.match(calls[0].url, /purchases-reference-lookup$/);
  } finally { globalThis.fetch = oldFetch; }
});

test('customer lookup offers multiple matching customers without choosing silently', async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, status: 200, json: async () => ({ ok: true, data: [{ customer_code: '111', customer_name: 'محمد أحمد', phone: '01012345678' }, { customer_code: '222', customer_name: 'محمد علي' }] }) };
  };
  try {
    const res = response();
    await handler({ method: 'POST', body: { session_token: 'valid', mode: 'customer', query: 'م*حم*' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.data.length, 2);
    assert.equal(res.payload.data[0].customer_name, 'محمد أحمد');
  } finally { globalThis.fetch = oldFetch; }
});
