const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxZnNha3J4YXp6bmtxbmpsZ3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5OTkzODMsImV4cCI6MjEwMDU3NTM4M30.ar5PScL6jPRMaWm8wItAL_ux3A2ewuSUa7Ha8le8Br0';

function token() {
  try {
    return JSON.parse(localStorage.getItem('dawaa_staff_session') || 'null')?.session_token || '';
  } catch {
    return '';
  }
}

async function rpc(functionName, action, payload = {}) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, p_action: action, p_payload: payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const messages = {
      general_manager_only: 'هذه الحركة متاحة للمدير العام فقط.',
      forbidden: 'الحساب الحالي لا يملك صلاحية تنفيذ هذا الإجراء.',
      reason_required: 'اكتب سببًا واضحًا قبل الحفظ.',
      invalid_amount: 'القيمة يجب أن تكون أكبر من صفر.',
      treasury_not_found: 'الخزنة المحددة غير موجودة.',
      transfer_not_ready: 'التحويل ليس في المرحلة المناسبة.',
      shift_not_found: 'الشيفت غير موجود.',
    };
    throw new Error(messages[data?.error] || data?.error || `فشل الطلب (${response.status})`);
  }
  return data.data;
}

export const treasuryApi = {
  dashboard: () => rpc('treasury_center', 'dashboard'),
  syncShifts: () => rpc('treasury_center', 'sync_shifts'),
  manualTransaction: (payload) => rpc('treasury_center', 'manual_transaction', payload),
  createTransfer: (payload) => rpc('treasury_center', 'create_transfer', payload),
  handoverTransfer: (id) => rpc('treasury_center', 'handover_transfer', { id }),
  postTransfer: (id, targetAccountType = 'cash') => rpc('treasury_center', 'post_transfer', { id, target_account_type: targetAccountType, destination_account_type: targetAccountType }),
  controlsDashboard: () => rpc('treasury_controls', 'dashboard'),
  approveShift: (id) => rpc('treasury_controls', 'approve_shift', { id }),
  returnShift: (id, reason) => rpc('treasury_controls', 'return_shift', { id, reason }),
  reconcileOpening: (payload) => rpc('treasury_controls', 'reconcile_opening', payload),
};
