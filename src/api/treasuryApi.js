const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxZnNha3J4YXp6bmtxbmpsZ3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5OTkzODMsImV4cCI6MjEwMDU3NTM4M30.ar5PScL6jPRMaWm8wItAL_ux3A2ewuSUa7Ha8le8Br0';

function token() {
  try {
    return JSON.parse(localStorage.getItem('dawaa_staff_session') || 'null')?.session_token || '';
  } catch {
    return '';
  }
}

function readableError(data, status) {
  const code = typeof data?.error === 'string' ? data.error : '';
  const messages = {
    general_manager_only: 'هذه الحركة متاحة للمدير العام فقط.',
    forbidden: 'الحساب الحالي لا يملك صلاحية تنفيذ هذا الإجراء.',
    reason_required: 'اكتب سببًا واضحًا قبل الحفظ.',
    actual_balance_required: 'اكتب الرصيد الفعلي قبل الإقفال.',
    invalid_amount: 'القيمة يجب أن تكون أكبر من صفر.',
    treasury_not_found: 'الخزنة المحددة غير موجودة.',
    transfer_not_ready: 'التحويل ليس في المرحلة المناسبة.',
    shift_not_found: 'الشيفت غير موجود.',
    invalid_session: 'انتهت الجلسة. سجل الدخول مرة أخرى.',
    already_posted: 'تم اعتماد هذا الشيفت وترحيله من قبل.',
    unsupported_action: 'الإجراء المطلوب غير مدعوم.',
  };
  if (messages[code]) return messages[code];
  if (typeof data?.message === 'string') return data.message;
  if (typeof data?.details === 'string') return data.details;
  if (data?.error && typeof data.error === 'object') {
    try { return JSON.stringify(data.error); } catch { /* ignore */ }
  }
  return `فشل الطلب (${status})`;
}

async function postRpc(functionName, body) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, ...body }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(readableError(data, response.status));
  return data.data;
}

async function rpc(functionName, action, payload = {}) {
  return postRpc(functionName, { p_action: action, p_payload: payload });
}

async function shiftAction(id, action, reason = null) {
  return postRpc('treasury_shift_action', {
    p_shift_id: id,
    p_action: action,
    p_reason: reason,
  });
}

export const treasuryApi = {
  dashboard: () => rpc('treasury_center', 'dashboard'),
  syncShifts: () => rpc('treasury_center', 'sync_shifts'),
  manualTransaction: (payload) => rpc('treasury_center', 'manual_transaction', payload),
  createTransfer: (payload) => rpc('treasury_center', 'create_transfer', payload),
  handoverTransfer: (id) => rpc('treasury_center', 'handover_transfer', { id }),
  postTransfer: (id, targetAccountType = 'cash') => rpc('treasury_center', 'post_transfer', { id, target_account_type: targetAccountType, destination_account_type: targetAccountType }),
  controlsDashboard: () => rpc('treasury_controls', 'dashboard'),
  approveShift: (id) => shiftAction(id, 'approve'),
  returnShift: (id, reason) => shiftAction(id, 'return', reason),
  reconcileOpening: (payload) => rpc('treasury_controls', 'reconcile_opening', payload),
  alerts: () => rpc('treasury_daily_close_action', 'alerts'),
  closeDay: (payload) => rpc('treasury_daily_close_action', 'close', payload),
  reopenDay: (payload) => rpc('treasury_daily_close_action', 'reopen', payload),
};