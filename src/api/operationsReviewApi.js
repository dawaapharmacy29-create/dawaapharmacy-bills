const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function sessionToken() {
  try { return JSON.parse(localStorage.getItem('dawaa_staff_session') || 'null')?.session_token || ''; }
  catch { return ''; }
}

async function rpc(name, action, payload = {}) {
  const token = sessionToken();
  if (!token) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: token, p_action: action, p_payload: payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const messages = {
      forbidden: 'الحساب الحالي لا يملك صلاحية تنفيذ الإجراء.',
      invalid_branch: 'اختر فرعًا صحيحًا.',
      invalid_status: 'الحالة المختارة غير صحيحة.',
      invalid_source_type: 'نوع الطلب غير معروف.',
      actual_balance_required: 'اكتب الرصيد الفعلي.',
      treasury_not_found: 'الخزنة غير موجودة.',
      reason_required: 'اكتب سببًا واضحًا.',
    };
    throw new Error(messages[data?.error] || data?.error || `فشل الطلب (${response.status})`);
  }
  return data.data;
}

export const purchaseOperationsApi = {
  dashboard: () => rpc('purchase_operations_review', 'dashboard'),
  fixBranch: (id, branch) => rpc('purchase_operations_review', 'fix_branch', { id, branch }),
  updateStatus: (id, sourceType, status) => rpc('purchase_operations_review', 'update_status', { id, source_type: sourceType, status }),
};

export const treasuryOperationsApi = {
  alerts: () => rpc('treasury_daily_close_action', 'alerts'),
  closeDay: (payload) => rpc('treasury_daily_close_action', 'close', payload),
  reopenDay: (payload) => rpc('treasury_daily_close_action', 'reopen', payload),
};