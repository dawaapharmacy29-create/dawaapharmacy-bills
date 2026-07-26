const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const SESSION_KEY = 'dawaa_staff_session';
const DEVICE_KEY = 'dawaa_device_id';

function assertConfig() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Supabase environment variables are missing');
  }
}

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

async function rpc(functionName, payload) {
  assertConfig();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || data?.hint || 'تعذر الاتصال بقاعدة البيانات');
  }
  return data;
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
  });

  if (!result?.ok) return result;

  const session = {
    session_token: result.session_token,
    expires_at: result.expires_at,
    account: result.account,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return result;
}

export async function validateStoredSession() {
  const session = readStoredSession();
  if (!session?.session_token) return { ok: false, error: 'missing_session' };

  try {
    const result = await rpc('validate_username_session', {
      p_session_token: session.session_token,
    });
    if (!result?.ok) {
      localStorage.removeItem(SESSION_KEY);
      return result;
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      ...session,
      expires_at: result.expires_at,
      account: result.account,
    }));
    return result;
  } catch (error) {
    return { ok: false, error: 'network_error', message: error.message };
  }
}

export async function logoutUsernameSession() {
  const session = readStoredSession();
  localStorage.removeItem(SESSION_KEY);
  if (!session?.session_token) return;
  try {
    await rpc('logout_username_session', {
      p_session_token: session.session_token,
    });
  } catch {
    // Local session is already removed. Server session will expire automatically.
  }
}

export function normalizeAccountForLegacyCode(account) {
  if (!account) return null;
  const roleMap = {
    general_manager: 'admin',
    admin: 'admin',
    branch_manager: 'manager',
    manager: 'manager',
    pharmacist: 'viewer',
    viewer: 'viewer',
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
