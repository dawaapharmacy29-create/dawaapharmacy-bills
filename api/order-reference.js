// Read-only bridge from the purchasing app to the management catalog.
// This is a server-side Vercel Function: never put admin credentials in VITE_* variables.
const PURCHASES_URL = process.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const PURCHASES_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.PURCHASES_SUPABASE_PUBLISHABLE_KEY;
const MANAGEMENT_URL = process.env.MANAGEMENT_SUPABASE_URL || 'https://jkjqeqkshllustwlzzbf.supabase.co';
const MANAGEMENT_SECRET = process.env.MANAGEMENT_SUPABASE_SECRET_KEY;

const json = (res, code, payload) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(payload);
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });
  if (!PURCHASES_KEY || !MANAGEMENT_SECRET) return json(res, 503, { ok: false, error: 'reference_service_unconfigured' });

  const token = String(req.body?.session_token || '');
  const mode = String(req.body?.mode || '');
  const query = String(req.body?.query || '').trim();
  if (!token || token.length > 500 || !['customer', 'product'].includes(mode) || query.length > 120) {
    return json(res, 400, { ok: false, error: 'invalid_request' });
  }
  if ((mode === 'customer' && !query) || (mode === 'product' && query.length < 2)) {
    return json(res, 400, { ok: false, error: 'query_too_short' });
  }

  try {
    // The purchasing database is authoritative for staff sessions. This RPC
    // checks token hash, expiry, revocation, and the account's active status.
    const sessionResponse = await fetch(`${PURCHASES_URL}/rest/v1/rpc/validate_staff_session`, {
      method: 'POST',
      headers: { apikey: PURCHASES_KEY, Authorization: `Bearer ${PURCHASES_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_session_token: token }),
      signal: AbortSignal.timeout(5000),
    });
    if (!sessionResponse.ok) return json(res, 502, { ok: false, error: 'session_check_unavailable' });
    const session = await sessionResponse.json();
    if (!session?.ok || !session.account?.id) return json(res, 401, { ok: false, error: 'invalid_session' });

    const url = new URL(mode === 'customer' ? '/rest/v1/customers' : '/rest/v1/products', MANAGEMENT_URL);
    if (mode === 'customer') {
      url.searchParams.set('select', 'customer_code,code,name,phone');
      url.searchParams.set('or', `(customer_code.eq.${query.replace(/[^\w-]/g, '')},code.eq.${query.replace(/[^\w-]/g, '')})`);
      url.searchParams.set('limit', '2');
    } else {
      url.searchParams.set('select', 'product_code,name');
      url.searchParams.set('name', `ilike.*${query.replace(/[,*()]/g, ' ').trim()}*`);
      url.searchParams.set('limit', '10');
    }
    const response = await fetch(url, {
      headers: { apikey: MANAGEMENT_SECRET, Authorization: `Bearer ${MANAGEMENT_SECRET}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return json(res, 502, { ok: false, error: 'management_lookup_unavailable' });
    const results = await response.json();
    if (!Array.isArray(results)) return json(res, 502, { ok: false, error: 'invalid_management_response' });

    if (mode === 'customer') {
      if (results.length > 1) return json(res, 409, { ok: false, error: 'ambiguous_customer_code' });
      const c = results[0];
      return json(res, 200, { ok: true, data: c ? { customer_code: c.customer_code || c.code, customer_name: c.name, phone: c.phone || '' } : null });
    }
    return json(res, 200, { ok: true, data: results.map(p => ({ product_code: p.product_code, product_name: p.name })) });
  } catch {
    return json(res, 502, { ok: false, error: 'reference_lookup_unavailable' });
  }
}
