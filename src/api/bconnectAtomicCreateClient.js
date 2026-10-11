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

function messageOf(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message || fallback;
  if (typeof value === 'object') return value.error || value.message || value.details || fallback;
  return String(value);
}

export async function bconnectAtomicCreate({ operationId, invoice }) {
  const token = sessionToken();
  if (!token) throw new Error('invalid_session');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/bconnect_atomic_create_v1`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_session_token: token, p_operation_id: operationId, p_invoice: invoice }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok === false) {
      const message = messageOf(result, `تعذر تسجيل الفاتورة (${response.status})`);
      if (result?.error === 'invalid_session') window.dispatchEvent(new CustomEvent('dawaa-session-expired'));
      throw new Error(message);
    }
    return result?.data ?? result;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('انتهت مهلة الاتصال بالخادم. أعد المحاولة.');
    throw error instanceof Error ? error : new Error(messageOf(error, 'تعذر تسجيل الفاتورة.'));
  } finally {
    window.clearTimeout(timeout);
  }
}
