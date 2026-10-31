// Server-side proxy for the management-owned, read-only catalog endpoint.
// The management function independently validates purchasing staff sessions.
// No database admin credential is shared across projects.
const REFERENCE_URL = 'https://jkjqeqkshllustwlzzbf.supabase.co/functions/v1/purchases-reference-lookup';

// PostgREST supports * as the ILIKE wildcard. Keep operators out of user input.
export function searchPattern(input) {
  const cleaned = input.trim().replace(/[%,.()\\]/g, ' ').replace(/\s+/g, ' ');
  if (!cleaned.replace(/[*\s]/g, '')) return null;
  return cleaned.includes('*') ? cleaned : `*${cleaned}*`;
}

const json = (res, code, payload) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(payload);
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });

  const token = String(req.body?.session_token || '');
  const mode = String(req.body?.mode || '');
  const query = String(req.body?.query || '').trim();
  if (!token || token.length > 500 || !['customer', 'product'].includes(mode) || query.length > 120) {
    return json(res, 400, { ok: false, error: 'invalid_request' });
  }
  const pattern = searchPattern(query);
  if (!pattern || query.replace(/\*/g, '').trim().length < 2) {
    return json(res, 400, { ok: false, error: 'query_too_short' });
  }

  try {
    const response = await fetch(REFERENCE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_token: token, mode, query }),
      signal: AbortSignal.timeout(9000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) return json(res, [400, 401, 403, 429].includes(response.status) ? response.status : 502, { ok: false, error: payload.error || 'management_lookup_unavailable' });
    return json(res, 200, { ok: true, data: payload.data });
  } catch {
    return json(res, 502, { ok: false, error: 'reference_lookup_unavailable' });
  }
}
