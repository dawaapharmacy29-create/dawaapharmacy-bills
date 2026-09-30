const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const LEGACY_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxZnNha3J4YXp6bmtxbmpsZ3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5OTkzODMsImV4cCI6MjEwMDU3NTM4M30.ar5PScL6jPRMaWm8wItAL_ux3A2ewuSUa7Ha8le8Br0';
const ENV_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const KEY = ENV_KEY?.startsWith('eyJ') ? ENV_KEY : LEGACY_ANON_KEY;

function token() {
  try { return JSON.parse(localStorage.getItem('dawaa_staff_session') || 'null')?.session_token || ''; }
  catch { return ''; }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('انتهت مهلة الاتصال بالخادم. لم يتم تكرار العملية تلقائيًا لحماية البيانات؛ راجع حالة الصفحة ثم أعد المحاولة.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function rpc(action, payload = {}) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_branch_policy_guarded_v2`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, p_action: action, p_payload: payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const messages = {
      invalid_session: 'انتهت الجلسة. سجل الدخول مرة أخرى.',
      forbidden: 'لا توجد صلاحية لتعديل سياسة الفرع.',
      branch_required: 'حدد الفرع أولًا.',
      forbidden_branch: 'لا توجد صلاحية لتعديل سياسة هذا الفرع.',
      order_min_exceeds_max: 'الحد الأدنى للطلبية لا يمكن أن يكون أكبر من الحد الأقصى.',
    };
    const code = data?.error || data?.message;
    throw new Error(messages[code] || String(code || `فشل الطلب (${response.status})`));
  }
  return data.data;
}

export const smartPurchaseBranchPolicyApi = {
  get: (branch) => rpc('get', { branch }),
  save: ({ branch, minimumOrderValue = 0, maximumOrderValue = 0, defaultCoverageDays = 7 }) => rpc('upsert', {
    branch,
    minimum_order_value: Number(minimumOrderValue || 0),
    maximum_order_value: Number(maximumOrderValue || 0),
    default_coverage_days: Number(defaultCoverageDays || 7),
  }),
};
