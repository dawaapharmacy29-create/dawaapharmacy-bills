const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const REQUEST_TIMEOUT_MS = 20000;

function token() {
  try { return JSON.parse(localStorage.getItem('dawaa_staff_session') || 'null')?.session_token || ''; }
  catch { return ''; }
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
    transfer_not_found: 'التحويل غير موجود.',
    transfer_not_ready: 'التحويل ليس في المرحلة المناسبة.',
    posted_transfer_cannot_cancel: 'لا يمكن إلغاء تحويل تم ترحيله نهائيًا.',
    treasury_day_closed: 'اليوم مقفل لهذه الخزنة. أعد فتحه أولًا.',
    shift_not_found: 'الشيفت غير موجود.',
    invalid_session: 'انتهت الجلسة. سجل الدخول مرة أخرى.',
    already_posted: 'تم اعتماد هذا الشيفت وترحيله من قبل.',
    unsupported_action: 'الإجراء المطلوب غير مدعوم.',
  };
  if (messages[code]) return messages[code];
  if (typeof data?.message === 'string') return data.message;
  if (typeof data?.details === 'string') return data.details;
  return `فشل الطلب (${status})`;
}

async function executeRpc(functionName, body) {
  if (!SUPABASE_URL || !KEY) throw new Error('إعدادات Supabase الخاصة بالخزنة غير مكتملة في بيئة التشغيل.');
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_session_token: sessionToken, ...body }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      if (response.status === 401 || data?.error === 'invalid_session') window.dispatchEvent(new CustomEvent('dawaa-session-expired'));
      throw new Error(readableError(data, response.status));
    }
    return data.data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('انتهت مهلة الاتصال بالخزنة. أعد المحاولة.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function postRpc(functionName, body) {
  try {
    return await executeRpc(functionName, body);
  } catch (error) {
    const nonRetryable = ['انتهت الجلسة. سجل الدخول مرة أخرى.', 'هذه الحركة متاحة للمدير العام فقط.', 'الحساب الحالي لا يملك صلاحية تنفيذ هذا الإجراء.'];
    if (nonRetryable.includes(error?.message)) throw error;
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    return executeRpc(functionName, body);
  }
}

async function rpc(functionName, action, payload = {}) {
  return postRpc(functionName, { p_action: action, p_payload: payload });
}

async function shiftAction(id, action, reason = null) {
  return postRpc('treasury_shift_action', { p_shift_id: id, p_action: action, p_reason: reason });
}

async function transferAction(id, action, targetAccountType = null, reason = null) {
  return postRpc('treasury_transfer_action', {
    p_transfer_id: id,
    p_action: action,
    p_target_account_type: targetAccountType,
    p_reason: reason,
  });
}

export const treasuryApi = {
  dashboard: () => rpc('treasury_center', 'dashboard'),
  pendingShifts: ({ branch = 'all', shiftType = 'all', limit = 1000, offset = 0 } = {}) => postRpc('treasury_shift_review_list', {
    p_branch: branch,
    p_shift_type: shiftType,
    p_limit: limit,
    p_offset: offset,
  }),
  shiftSalesSourceStatus: () => postRpc('treasury_sales_source_status', {}),
  shiftSalesIntelligence: ({ branch = 'all', shiftType = 'all', days = 14 } = {}) => postRpc('treasury_shift_sales_intelligence_v1', {
    p_branch: branch,
    p_shift_type: shiftType,
    p_days: days,
  }),
  syncShifts: () => rpc('treasury_center', 'sync_shifts'),
  manualTransaction: (payload) => rpc('treasury_center', 'manual_transaction', payload),
  createTransfer: (payload) => rpc('treasury_center', 'create_transfer', payload),
  handoverTransfer: (id) => transferAction(id, 'handover'),
  receiveTransfer: (id) => transferAction(id, 'receive'),
  postTransfer: (id, targetAccountType = 'accounts_custody') => transferAction(id, 'post', targetAccountType),
  cancelTransfer: (id, reason) => transferAction(id, 'cancel', null, reason),
  controlsDashboard: () => rpc('treasury_controls', 'dashboard'),
  approveShift: (id) => shiftAction(id, 'approve'),
  returnShift: (id, reason) => shiftAction(id, 'return', reason),
  reconcileOpening: (payload) => rpc('treasury_controls', 'reconcile_opening', payload),
  alerts: () => rpc('treasury_daily_close_action', 'alerts'),
  closures: () => rpc('treasury_daily_close_action', 'closures'),
  closeDay: (payload) => rpc('treasury_daily_close_action', 'close', payload),
  reopenDay: (payload) => rpc('treasury_daily_close_action', 'reopen', payload),
  resolveAlert: (alertType, referenceId, status = 'resolved', note = '') => postRpc('treasury_alert_action', {
    p_alert_type: alertType, p_reference_id: referenceId, p_status: status, p_note: note,
  }),
};
