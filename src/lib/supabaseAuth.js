const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const LEGACY_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxZnNha3J4YXp6bmtxbmpsZ3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5OTkzODMsImV4cCI6MjEwMDU3NTM4M30.ar5PScL6jPRMaWm8wItAL_ux3A2ewuSUa7Ha8le8Br0';
const ENV_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_KEY = ENV_KEY?.startsWith('eyJ') ? ENV_KEY : LEGACY_ANON_KEY;

const SESSION_KEY = 'dawaa_staff_session';
const DEVICE_KEY = 'dawaa_device_id';
const AUTH_TIMEOUT_MS = 12000;

function assertConfig() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase environment variables are missing');
}

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

async function rpcOnce(functionName, payload) {
  assertConfig();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const details = data?.message || data?.hint || data?.error_description || `Supabase RPC failed (${response.status})`;
      const error = new Error(details);
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function rpc(functionName, payload, { retry = false } = {}) {
  try {
    return await rpcOnce(functionName, payload);
  } catch (error) {
    if (!retry || error?.status === 400 || error?.status === 401 || error?.status === 403) throw error;
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    return rpcOnce(functionName, payload);
  }
}

export function readStoredSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function getStoredAccount() {
  return readStoredSession()?.account || null;
}

export async function loginWithUsernamePin(username, pin) {
  const result = await rpc('login_with_username_pin', {
    p_username: username.trim(),
    p_pin: String(pin).trim(),
    p_device_id: getDeviceId(),
  }, { retry: true });

  if (!result?.ok) return result;
  const session = { session_token: result.session_token, expires_at: result.expires_at, account: result.account };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return result;
}

export async function validateStoredSession() {
  const session = readStoredSession();
  if (!session?.session_token) return { ok: false, error: 'missing_session' };

  try {
    const result = await rpc('validate_username_session', {
      p_session_token: session.session_token,
    }, { retry: true });

    if (!result?.ok) {
      if (['invalid_session', 'account_disabled', 'missing_session'].includes(result?.error)) {
        localStorage.removeItem(SESSION_KEY);
      }
      return result;
    }

    localStorage.setItem(SESSION_KEY, JSON.stringify({
      ...session,
      expires_at: result.expires_at,
      account: result.account,
    }));
    return result;
  } catch (error) {
    return {
      ok: false,
      error: 'network_error',
      message: error?.name === 'AbortError' ? 'انتهت مهلة التحقق من الجلسة.' : error.message,
      cached_account: session.account,
    };
  }
}

export async function logoutUsernameSession() {
  const session = readStoredSession();
  localStorage.removeItem(SESSION_KEY);
  if (!session?.session_token) return;
  try {
    await rpc('logout_username_session', { p_session_token: session.session_token });
  } catch {
    // The local session is already removed. The server session expires automatically.
  }
}

export function normalizeAccountForLegacyCode(account) {
  if (!account) return null;
  const roleMap = {
    general_manager: 'admin', admin: 'admin', branch_manager: 'manager', manager: 'manager',
    pharmacist: 'viewer', viewer: 'viewer',
  };
  const branches = Array.isArray(account.branch_ids) ? account.branch_ids : [];
  return {
    ...account,
    full_name: account.display_name,
    name: account.display_name,
    email: '',
    branch: branches[0] || '',
    branches,
    original_role: account.role,
    role: roleMap[account.role] || account.role || 'viewer',
  };
}
