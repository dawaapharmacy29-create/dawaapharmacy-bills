const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const LEGACY_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYXNlIiwicmVmIjoienFmc2Frcnhhenpua3FuamxnenYiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc4NDk5OTM4MywiZXhwIjoyMTAwNTc1MzgzfQ.ar5PScL6jPRMaWm8wItAL_ux3A2ewuSUa7Ha8le8Br0';
const ENV_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const KEY = ENV_KEY?.startsWith('eyJ') ? ENV_KEY : LEGACY_ANON_KEY;

function token() {
  try { return JSON.parse(localStorage.getItem('dawaa_staff_session') || 'null')?.session_token || ''; }
  catch { return ''; }
}

function errorText(data, status) {
  const messages = {
    invalid_session: 'انتهت الجلسة. سجل الدخول مرة أخرى.',
    forbidden: 'لا توجد صلاحية لتنفيذ الإجراء.',
    forbidden_branch: 'لا توجد صلاحية على هذا الفرع.',
    branch_required: 'حدد الفرع أولًا.',
    invalid_items: 'بيانات سياسات الأصناف غير صحيحة.',
    item_min_exceeds_max: 'الحد الأدنى للصنف أكبر من الحد الأقصى.',
  };
  const code = data?.error || data?.message;
  if (messages[code]) return messages[code];
  if (typeof code === 'string' && code.trim()) return code;
  return `فشل الطلب (${status})`;
}

async function rpc(action, payload = {}) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_product_policies_guarded_v2`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, p_action: action, p_payload: payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(errorText(data, response.status));
  return data.data;
}

export const smartPurchaseProductPolicyApi = {
  list: (branch) => rpc('list', { branch }),
  upsertMany: (branch, items) => rpc('upsert_many', { branch, items }),
};
