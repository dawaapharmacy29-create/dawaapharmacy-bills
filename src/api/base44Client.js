const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const LEGACY_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxZnNha3J4YXp6bmtxbmpsZ3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5OTkzODMsImV4cCI6MjEwMDU3NTM4M30.ar5PScL6jPRMaWm8wItAL_ux3A2ewuSUa7Ha8le8Br0';
const ENV_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_KEY = ENV_KEY?.startsWith('eyJ') ? ENV_KEY : LEGACY_ANON_KEY;
const SESSION_KEY = 'dawaa_staff_session';

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

function getSessionToken() {
  return readSession()?.session_token || '';
}

async function callDataApi(payload) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase configuration is missing');
  const token = getSessionToken();
  if (!token) throw new Error('invalid_session');

  const response = await fetch(`${SUPABASE_URL}/functions/v1/app-data`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'x-staff-session': token,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    if (response.status === 401 || body?.error === 'invalid_session') {
      localStorage.removeItem(SESSION_KEY);
      window.dispatchEvent(new CustomEvent('dawaa-session-expired'));
    }
    throw new Error(body?.error || body?.message || `Data request failed (${response.status})`);
  }
  return body.data;
}

function entityClient(entity) {
  return {
    list: (sort, limit, offset) => callDataApi({ action: 'list', entity, sort, limit, offset }),
    filter: (filters = {}, sort, limit, offset) => callDataApi({ action: 'filter', entity, filters, sort, limit, offset }),
    get: (id) => callDataApi({ action: 'get', entity, id }),
    create: (data) => callDataApi({ action: 'create', entity, data }),
    update: (id, data) => callDataApi({ action: 'update', entity, id, data }),
    delete: (id) => callDataApi({ action: 'delete', entity, id }),
    bulkCreate: (items) => callDataApi({ action: 'bulkCreate', entity, items }),
    bulkUpdate: (items) => callDataApi({ action: 'bulkUpdate', entity, items }),
  };
}

const entities = new Proxy({}, {
  get: (_target, entity) => entityClient(String(entity)),
});

function currentAccount() {
  return readSession()?.account || null;
}

export const base44 = {
  entities,
  auth: {
    me: async () => {
      const account = currentAccount();
      if (!account) throw new Error('Authentication required');
      return {
        ...account,
        full_name: account.display_name,
        name: account.display_name,
        email: '',
        branches: Array.isArray(account.branch_ids) ? account.branch_ids : [],
        branch: Array.isArray(account.branch_ids) ? account.branch_ids[0] || '' : '',
        original_role: account.role,
        role: account.role === 'general_manager' ? 'admin' : account.role,
      };
    },
    logout: () => {
      localStorage.removeItem(SESSION_KEY);
    },
    redirectToLogin: () => window.location.assign('/'),
  },
  integrations: {
    Core: {
      UploadFile: async ({ file }) => {
        if (!file) throw new Error('File is required');
        const file_url = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error || new Error('Unable to read file'));
          reader.readAsDataURL(file);
        });
        return { file_url };
      },
    },
  },
  functions: {
    invoke: async (name, payload) => {
      console.warn(`Legacy function ${name} is not required after Supabase migration`, payload);
      return { data: { ok: true, migrated: true, function: name } };
    },
  },
  asServiceRole: { entities },
};
