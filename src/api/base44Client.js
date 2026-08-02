import { getCanonicalWorkflowStatus } from '@/lib/invoiceWorkflowStatus';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const LEGACY_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxZnNha3J4YXp6bmtxbmpsZ3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5OTkzODMsImV4cCI6MjEwMDU3NTM4M30.ar5PScL6jPRMaWm8wItAL_ux3A2ewuSUa7Ha8le8Br0';
const ENV_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_KEY = ENV_KEY?.startsWith('eyJ') ? ENV_KEY : LEGACY_ANON_KEY;
const SESSION_KEY = 'dawaa_staff_session';
const REQUEST_TIMEOUT_MS = 20000;

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
}
function getSessionToken() { return readSession()?.session_token || ''; }

export function errorText(value, fallback = 'حدث خطأ غير متوقع') {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (value instanceof Error && value.message) return errorText(value.message, fallback);
  if (typeof value === 'object') {
    for (const key of ['message', 'error_description', 'details', 'hint', 'error']) {
      if (value[key] && value[key] !== value) return errorText(value[key], fallback);
    }
    try { const text = JSON.stringify(value); return text === '{}' ? fallback : text; }
    catch { return fallback; }
  }
  return String(value);
}

async function executeRequest(payload) {
  const token = getSessionToken();
  if (!token) throw new Error('invalid_session');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/app-data`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'x-staff-session': token,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) {
      const message = errorText(body?.error || body?.message || body, `فشل طلب البيانات (${response.status})`);
      if (response.status === 401 || message === 'invalid_session') window.dispatchEvent(new CustomEvent('dawaa-session-expired'));
      throw new Error(message);
    }
    return body.data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('انتهت مهلة الاتصال بالخادم. أعد المحاولة.');
    throw new Error(errorText(error));
  } finally {
    window.clearTimeout(timeout);
  }
}

async function callDataApi(payload) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('إعدادات Supabase غير مكتملة.');
  try { return await executeRequest(payload); }
  catch (error) {
    const retryable = !['invalid_session', 'Authentication required', 'forbidden'].includes(error?.message);
    if (!retryable) throw error;
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    return executeRequest(payload);
  }
}

async function callSecureRpc(functionName, params = {}) {
  const token = getSessionToken();
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
      body: JSON.stringify({ p_session_token: token, ...params }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    const message = errorText(result?.error || result?.message || result?.details || result, `تعذر تنفيذ الاستعلام (${response.status})`);
    if (!response.ok || result?.ok === false) {
      if (result?.error === 'invalid_session') window.dispatchEvent(new CustomEvent('dawaa-session-expired'));
      throw new Error(message);
    }
    return result.data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('انتهت مهلة الاتصال بالخادم. أعد المحاولة.');
    throw new Error(errorText(error));
  } finally {
    window.clearTimeout(timeout);
  }
}

function sortRowsClient(rows, sort) {
  const desc = String(sort).startsWith('-');
  const key = desc ? String(sort).slice(1) : String(sort);
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const av = a?.[key] ?? '';
    const bv = b?.[key] ?? '';
    if (av === bv) return 0;
    return av > bv ? (desc ? -1 : 1) : (desc ? 1 : -1);
  });
}

async function listPurchaseInvoices(sort, limit = 10000, offset = 0, filters = {}) {
  const pageSize = Math.min(Math.max(Number(limit || 1000), 1), 500);
  const startPage = Math.floor(Number(offset || 0) / pageSize) + 1;
  const rows = [];
  let page = startPage;
  while (rows.length < Number(limit || 10000)) {
    const result = await callSecureRpc('app_paged_purchase_invoices', {
      p_branch: filters.branch || 'all',
      p_date_from: filters.date_from || null,
      p_date_to: filters.date_to || null,
      p_search: filters.search || null,
      p_payment_type: filters.payment_type || null,
      p_purchase_category: filters.purchase_category || null,
      p_workflow_status: filters.workflow_status || null,
      p_sort_field: String(sort || '-created_at').replace(/^-/, ''),
      p_sort_direction: String(sort || '').startsWith('-') ? 'desc' : 'asc',
      p_page: page,
      p_page_size: pageSize,
    });
    const batch = Array.isArray(result?.rows) ? result.rows : [];
    rows.push(...batch);
    if (!batch.length || page >= Number(result?.total_pages || 1)) break;
    page += 1;
  }
  const sliced = rows.slice(0, Number(limit || rows.length)).map((row) => ({ ...row, workflow_status: getCanonicalWorkflowStatus(row) }));
  return Object.keys(filters).length
    ? sliced.filter((row) => Object.entries(filters).every(([key, value]) => ['date_from', 'date_to', 'search'].includes(key) || (Array.isArray(value) ? value.includes(row[key]) : row[key] === value)))
    : sliced;
}

async function listShiftDeliveries(sort = '-shift_date', limit = 5000, offset = 0, filters = {}) {
  const rows = await callSecureRpc('app_shift_deliveries_list', {
    p_date_from: filters.date_from || null,
    p_date_to: filters.date_to || null,
    p_branch: filters.branch || 'all',
    p_limit: Math.min(Math.max(Number(limit || 1000), 1), 5000),
    p_offset: Math.max(Number(offset || 0), 0),
  });
  const filtered = (Array.isArray(rows) ? rows : []).filter((row) => Object.entries(filters).every(([key, value]) => ['date_from', 'date_to'].includes(key) || (Array.isArray(value) ? value.includes(row[key]) : row[key] === value)));
  return sort ? sortRowsClient(filtered, sort) : filtered;
}

const SPECIAL_ENTITIES = new Set(['CustomerOrder', 'Expense']);
async function callSpecialEntity(entity, action, id = null, data = {}) {
  return callSecureRpc('app_special_entity_action', { p_entity: entity, p_action: action, p_id: id, p_data: data });
}

async function listTargetGoals(sort, limit, offset, filters = {}) {
  const monthlyGoals = await callSpecialEntity('TargetGoal', 'list');
  let dailyLimits = [];
  try {
    dailyLimits = await callDataApi({ action: 'list', entity: 'DailyPurchaseLimit', sort: '-updated_at', limit: 5000, offset: 0 });
  } catch (error) {
    console.warn('تعذر تحميل إعداد الحد اليومي، وسيستمر عرض التارجت الشهري.', error);
  }
  const rows = [
    ...(Array.isArray(monthlyGoals) ? monthlyGoals : []),
    ...(Array.isArray(dailyLimits) ? dailyLimits.map((row) => ({ ...row, goal_type: 'daily_purchase_limit' })) : []),
  ];
  const filtered = rows.filter((row) => Object.entries(filters).every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
  const sorted = sort ? sortRowsClient(filtered, sort) : filtered;
  const start = Number(offset || 0);
  return sorted.slice(start, limit ? start + Number(limit) : undefined);
}

function targetGoalClient() {
  return {
    list: (sort, limit, offset) => listTargetGoals(sort, limit, offset),
    filter: (filters = {}, sort, limit, offset) => listTargetGoals(sort, limit, offset, filters),
    get: async (id) => (await listTargetGoals('-updated_at', 5000, 0)).find((row) => row.id === id) || null,
    create: (data) => data?.goal_type === 'daily_purchase_limit'
      ? callDataApi({ action: 'create', entity: 'DailyPurchaseLimit', data: { ...data, goal_type: 'daily_purchase_limit' } })
      : callSpecialEntity('TargetGoal', 'create', null, data),
    update: (id, data) => data?.goal_type === 'daily_purchase_limit'
      ? callDataApi({ action: 'update', entity: 'DailyPurchaseLimit', id, data: { ...data, goal_type: 'daily_purchase_limit' } })
      : callSpecialEntity('TargetGoal', 'update', id, data),
    delete: async (id) => {
      const row = (await listTargetGoals('-updated_at', 5000, 0)).find((item) => item.id === id);
      return row?.goal_type === 'daily_purchase_limit'
        ? callDataApi({ action: 'delete', entity: 'DailyPurchaseLimit', id })
        : callSpecialEntity('TargetGoal', 'delete', id, {});
    },
    bulkCreate: async (items) => Promise.all(items.map((item) => item?.goal_type === 'daily_purchase_limit'
      ? callDataApi({ action: 'create', entity: 'DailyPurchaseLimit', data: item })
      : callSpecialEntity('TargetGoal', 'create', null, item))),
    bulkUpdate: async (items) => Promise.all(items.map((item) => {
      const payload = item.data || item;
      return payload?.goal_type === 'daily_purchase_limit'
        ? callDataApi({ action: 'update', entity: 'DailyPurchaseLimit', id: String(item.id), data: payload })
        : callSpecialEntity('TargetGoal', 'update', String(item.id), payload);
    })),
    subscribe: () => () => {},
  };
}

function standardClient(entity) {
  return {
    list: (sort, limit, offset) => callDataApi({ action: 'list', entity, sort, limit, offset }),
    filter: (filters = {}, sort, limit, offset) => callDataApi({ action: 'filter', entity, filters, sort, limit, offset }),
    get: (id) => callDataApi({ action: 'get', entity, id }),
    create: (data) => callDataApi({ action: 'create', entity, data }),
    update: (id, data) => callDataApi({ action: 'update', entity, id, data }),
    delete: (id) => callDataApi({ action: 'delete', entity, id }),
    bulkCreate: (items) => callDataApi({ action: 'bulkCreate', entity, items }),
    bulkUpdate: (items) => callDataApi({ action: 'bulkUpdate', entity, items }),
    subscribe: () => () => {},
  };
}

function entityClient(entity) {
  if (entity === 'PurchaseInvoice') return {
    list: (sort, limit, offset) => listPurchaseInvoices(sort, limit, offset),
    filter: (filters = {}, sort, limit, offset) => listPurchaseInvoices(sort, limit, offset, filters),
    get: async (id) => (await listPurchaseInvoices('-created_at', 5000, 0)).find((row) => row.id === id) || null,
    create: (data) => callDataApi({ action: 'create', entity, data }),
    update: (id, data) => callDataApi({ action: 'update', entity, id, data }),
    delete: (id) => callDataApi({ action: 'delete', entity, id }),
    bulkCreate: (items) => callDataApi({ action: 'bulkCreate', entity, items }),
    bulkUpdate: (items) => callDataApi({ action: 'bulkUpdate', entity, items }),
    subscribe: () => () => {},
  };
  if (entity === 'ShiftDelivery') return {
    list: (sort, limit, offset) => listShiftDeliveries(sort, limit, offset),
    filter: (filters = {}, sort, limit, offset) => listShiftDeliveries(sort, limit, offset, filters),
    get: async (id) => (await listShiftDeliveries('-shift_date', 5000, 0)).find((row) => row.id === id) || null,
    create: (data) => callDataApi({ action: 'create', entity, data }),
    update: (id, data) => callDataApi({ action: 'update', entity, id, data }),
    delete: (id) => callDataApi({ action: 'delete', entity, id }),
    bulkCreate: (items) => callDataApi({ action: 'bulkCreate', entity, items }),
    bulkUpdate: (items) => callDataApi({ action: 'bulkUpdate', entity, items }),
    subscribe: () => () => {},
  };
  if (entity === 'TargetGoal') return targetGoalClient();
  if (SPECIAL_ENTITIES.has(entity)) return {
    list: async (sort, limit, offset) => {
      const rows = await callSpecialEntity(entity, 'list');
      const sorted = sort ? sortRowsClient(rows, sort) : (Array.isArray(rows) ? rows : []);
      const start = Number(offset || 0);
      return sorted.slice(start, limit ? start + Number(limit) : undefined);
    },
    filter: async (filters = {}, sort, limit, offset) => {
      const rows = await callSpecialEntity(entity, 'list');
      const filtered = (Array.isArray(rows) ? rows : []).filter((row) => Object.entries(filters).every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
      const sorted = sort ? sortRowsClient(filtered, sort) : filtered;
      const start = Number(offset || 0);
      return sorted.slice(start, limit ? start + Number(limit) : undefined);
    },
    get: async (id) => (await callSpecialEntity(entity, 'list')).find((row) => row.id === id) || null,
    create: (data) => callSpecialEntity(entity, 'create', null, data),
    update: (id, data) => callSpecialEntity(entity, 'update', id, data),
    delete: (id) => callSpecialEntity(entity, 'delete', id, {}),
    bulkCreate: async (items) => Promise.all(items.map((item) => callSpecialEntity(entity, 'create', null, item))),
    bulkUpdate: async (items) => Promise.all(items.map((item) => callSpecialEntity(entity, 'update', String(item.id), item.data || item))),
    subscribe: () => () => {},
  };
  return standardClient(entity);
}

const entities = new Proxy({}, { get: (_target, entity) => entityClient(String(entity)) });
function currentAccount() { return readSession()?.account || null; }

export const staffAccountsApi = {
  list: () => callDataApi({ action: 'adminAccounts', admin_action: 'list' }),
  create: (payload) => callDataApi({ action: 'adminAccounts', admin_action: 'create', payload }),
  update: (payload) => callDataApi({ action: 'adminAccounts', admin_action: 'update', payload }),
  setStatus: (id, status) => callDataApi({ action: 'adminAccounts', admin_action: 'set_status', payload: { id, status } }),
  resetPin: (id, pin) => callDataApi({ action: 'adminAccounts', admin_action: 'reset_pin', payload: { id, pin } }),
};

export const invoiceWorkflowApi = {
  submit: (invoiceId, note = '') => callDataApi({ action: 'invoiceWorkflow', invoice_id: invoiceId, workflow_action: 'submit', note }),
  review: (invoiceId, note = '') => callDataApi({ action: 'invoiceWorkflow', invoice_id: invoiceId, workflow_action: 'review', note }),
  approve: (invoiceId, note = '') => callDataApi({ action: 'invoiceWorkflow', invoice_id: invoiceId, workflow_action: 'approve', note }),
  returnForCorrection: (invoiceId, note) => callDataApi({ action: 'invoiceWorkflow', invoice_id: invoiceId, workflow_action: 'return', note }),
  reopen: (invoiceId, note = '') => callDataApi({ action: 'invoiceWorkflow', invoice_id: invoiceId, workflow_action: 'reopen', note }),
};

export const performanceApi = {
  dashboard: (params = {}) => callSecureRpc('app_dashboard_summary', {
    p_branch: params.branch || 'all',
    p_date_from: params.date_from || null,
    p_date_to: params.date_to || null,
    p_month: params.month || null,
  }),
  invoices: (params = {}) => callSecureRpc('app_paged_purchase_invoices', {
    p_branch: params.branch || 'all',
    p_date_from: params.date_from || null,
    p_date_to: params.date_to || null,
    p_search: params.search || null,
    p_payment_type: params.payment_type === 'all' ? null : params.payment_type || null,
    p_purchase_category: params.purchase_category === 'all' ? null : params.purchase_category || null,
    p_workflow_status: params.workflow_status === 'all' ? null : params.workflow_status || null,
    p_sort_field: params.sort_by || 'invoice_date',
    p_sort_direction: params.sort_direction || 'desc',
    p_page: params.page || 1,
    p_page_size: params.page_size || 50,
  }),
};

export const base44ReviewApi = {
  pendingList: (params = {}) => callSecureRpc('app_base44_pending_reviews_list', { p_status: params.status || 'pending', p_limit: params.limit || 200 }),
  mark: (reviewId, decision, notes = '') => callSecureRpc('app_base44_review_mark', { p_review_id: reviewId, p_decision: decision, p_notes: notes || null }),
};

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
    logout: () => localStorage.removeItem(SESSION_KEY),
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
  functions: { invoke: async (name, payload) => ({ data: { ok: true, migrated: true, function: name, payload } }) },
  asServiceRole: { entities },
};

export default base44;
