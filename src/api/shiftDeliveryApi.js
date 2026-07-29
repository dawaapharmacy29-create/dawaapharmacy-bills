const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SESSION_KEY = 'dawaa_staff_session';

function sessionToken() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')?.session_token || ''; }
  catch { return ''; }
}

function normalizeError(payload, status) {
  const code = payload?.error || payload?.message || payload?.details;
  if (code === 'invalid_session') return 'انتهت الجلسة. سجل الدخول مرة أخرى.';
  if (code === 'forbidden') return 'لا تملك صلاحية عرض تسليمات هذا الفرع.';
  return typeof code === 'string' ? code : `تعذر تحميل تسليمات الشيفت (${status})`;
}

async function list({ dateFrom = null, dateTo = null, branch = 'all', limit = 5000, offset = 0 } = {}) {
  const token = sessionToken();
  if (!token) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('إعدادات Supabase غير مكتملة على Vercel.');

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/app_shift_deliveries_list`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_session_token: token,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_branch: branch,
      p_limit: limit,
      p_offset: offset,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    if (payload?.error === 'invalid_session') window.dispatchEvent(new CustomEvent('dawaa-session-expired'));
    throw new Error(normalizeError(payload, response.status));
  }
  return Array.isArray(payload?.data) ? payload.data : [];
}

export const shiftDeliveryApi = { list };
export default shiftDeliveryApi;
