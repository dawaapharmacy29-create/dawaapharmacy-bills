const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const LEGACY_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxZnNha3J4YXp6bmtxbmpsZ3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5OTkzODMsImV4cCI6MjEwMDU3NTM4M30.ar5PScL6jPRMaWm8wItAL_ux3A2ewuSUa7Ha8le8Br0';
const ENV_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_KEY = ENV_KEY?.startsWith('eyJ') ? ENV_KEY : LEGACY_ANON_KEY;
const SESSION_KEY = 'dawaa_staff_session';
const REQUEST_TIMEOUT_MS = 20000;

function sessionToken() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')?.session_token || ''; }
  catch { return ''; }
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function dateOnly(value) { return String(value || '').slice(0, 10); }
function moneyKey(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(3) : '';
}

export function bconnectAcceptanceFingerprint(row) {
  if (!row?.app?.id || !row?.number) return '';
  const source = row.bconnect || {};
  const app = row.app || {};
  const branch = String(source.branch || app.branch || '').trim();
  return [
    'v1', branch, String(row.number), String(app.id),
    normalizeText(source.supplier), dateOnly(source.date),
    normalizeText(app.supplier_name), dateOnly(app.invoice_date),
    moneyKey(source.invoice_value), moneyKey(app.total_value),
  ].join('|');
}

async function rpc(functionName, body) {
  const token = sessionToken();
  if (!token) throw new Error('invalid_session');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_session_token: token, ...body }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok === false) {
      const message = result?.error || result?.message || result?.details || `تعذر تنفيذ الطلب (${response.status})`;
      if (message === 'invalid_session') window.dispatchEvent(new CustomEvent('dawaa-session-expired'));
      throw new Error(String(message));
    }
    return result?.data ?? result;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('انتهت مهلة الاتصال بالخادم. أعد المحاولة.');
    throw error instanceof Error ? error : new Error('تعذر تنفيذ طلب الاعتماد.');
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function saveBconnectAcceptance(row) {
  const fingerprint = bconnectAcceptanceFingerprint(row);
  if (!fingerprint) throw new Error('invalid_acceptance');
  const source = row.bconnect || {};
  const app = row.app || {};
  return rpc('bconnect_review_accept_v1', {
    p_fingerprint: fingerprint,
    p_invoice_id: String(app.id),
    p_branch: String(source.branch || app.branch || ''),
    p_invoice_number: String(row.number || ''),
    p_bconnect_supplier: source.supplier == null ? null : String(source.supplier),
    p_bconnect_date: dateOnly(source.date) || null,
    p_app_supplier: app.supplier_name == null ? null : String(app.supplier_name),
    p_app_date: dateOnly(app.invoice_date) || null,
    p_total_value: Number(app.total_value),
  });
}

export async function loadBconnectAcceptances(rows) {
  const fingerprints = rows.map(bconnectAcceptanceFingerprint).filter(Boolean);
  if (!fingerprints.length) return new Set();
  const result = await rpc('bconnect_review_acceptance_lookup_v1', { p_fingerprints: fingerprints });
  const values = Array.isArray(result) ? result : [];
  return new Set(values.map((item) => String(item?.fingerprint || '')).filter(Boolean));
}
