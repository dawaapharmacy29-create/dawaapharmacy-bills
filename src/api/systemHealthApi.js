const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const ENV_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6InpxZnNha3J4YXp6bmtxbmpsZ3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5OTkzODMsImV4cCI6MjEwMDU3NTM4M30.ar5PScL6jPRMaWm8wItAL_ux3A2ewuSUa7Ha8le8Br0';
const SUPABASE_KEY = ENV_KEY?.startsWith('eyJ') ? ENV_KEY : FALLBACK_ANON_KEY;
const SESSION_KEY = 'dawaa_staff_session';

function sessionToken() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')?.session_token || ''; }
  catch { return ''; }
}

function readableError(value) {
  if (!value) return 'تعذر تحميل فحص المزامنة.';
  if (typeof value === 'string') return value;
  return value.message || value.details || value.hint || value.error || 'تعذر تحميل فحص المزامنة.';
}

async function sync() {
  const token = sessionToken();
  if (!token) throw new Error('invalid_session');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/app_system_sync_health`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_session_token: token }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok === false) throw new Error(readableError(result));
    return result.data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('انتهت مهلة فحص المزامنة.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export const systemHealthApi = { sync };
export default systemHealthApi;
