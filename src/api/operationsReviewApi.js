const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function sessionToken() {
  try { return JSON.parse(localStorage.getItem('dawaa_staff_session') || 'null')?.session_token || ''; }
  catch { return ''; }
}

async function postRpc(name, body) {
  const token = sessionToken();
  if (!token) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: token, ...body }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const messages = {
      forbidden: 'الحساب الحالي لا يملك صلاحية تنفيذ الإجراء.',
      invalid_branch: 'اختر فرعًا صحيحًا.',
      invalid_status: 'الحالة المختارة غير صحيحة.',
      invalid_source_type: 'نوع الطلب غير معروف.',
      invalid_status_transition: 'لا يمكن الانتقال مباشرة إلى هذه الحالة. اتبع دورة الطلب بالترتيب.',
      unresolved_purchase_variance: 'لا يمكن إغلاق الطلب قبل معالجة فروق الاستلام والفاتورة.',
      order_not_found: 'الطلب غير موجود.',
      reason_required: 'اكتب سببًا واضحًا.',
      invalid_decision: 'قرار فرق المطابقة غير صحيح.',
    };
    throw new Error(messages[data?.error] || data?.error || `فشل الطلب (${response.status})`);
  }
  return data.data;
}

async function rpc(name, action, payload = {}) {
  return postRpc(name, { p_action: action, p_payload: payload });
}

export const purchaseOperationsApi = {
  dashboard: () => rpc('purchase_operations_review', 'dashboard'),
  fixBranch: (id, branch) => rpc('purchase_operations_review', 'fix_branch', { id, branch }),
  updateStatus: (id, sourceType, status, reason = '') => postRpc('purchase_workflow_action', {
    p_source_type: sourceType,
    p_record_id: id,
    p_new_status: status,
    p_reason: reason,
  }),
  decideVariance: (receiptItemId, decision, reason) => postRpc('purchase_variance_action', {
    p_receipt_item_id: receiptItemId,
    p_decision: decision,
    p_reason: reason,
  }),
};

export const treasuryOperationsApi = {
  alerts: () => rpc('treasury_daily_close_action', 'alerts'),
  closures: () => rpc('treasury_daily_close_action', 'closures'),
  closeDay: (payload) => rpc('treasury_daily_close_action', 'close', payload),
  reopenDay: (payload) => rpc('treasury_daily_close_action', 'reopen', payload),
};