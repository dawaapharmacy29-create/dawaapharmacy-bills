import { smartPurchaseUnifiedApi } from '@/api/smartPurchaseUnifiedApi';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxZnNha3J4YXp6bmtxbmpsZ3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5OTkzODMsImV4cCI6MjEwMDU3NTM4M30.ar5PScL6jPRMaWm8wItAL_ux3A2ewuSUa7Ha8le8Br0';

function token() {
  try { return JSON.parse(localStorage.getItem('dawaa_staff_session') || 'null')?.session_token || ''; }
  catch { return ''; }
}

async function receivingRpc(action, payload = {}) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_receiving_center`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, p_action: action, p_payload: payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.message || data?.error || `فشل الطلب (${response.status})`);
  return data.data;
}

async function importReceipt(payload) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_import_receipt_v2`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, p_payload: payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const messages = {
      duplicate_receipt_file: 'ملف الاستلام ده مسجل بالفعل لنفس الطلبية والمورد.',
      receipt_value_above_limit: 'قيمة الاستلام تتجاوز الحد المالي المسموح للطلبية.',
      invalid_rows: 'بيانات الاستلام غير صالحة.',
      forbidden_branch: 'لا توجد صلاحية على فرع الطلبية.',
      order_not_found: 'الطلبية غير موجودة.',
      receipt_order_not_ready: 'لا يمكن تسجيل استلام على طلبية غير معتمدة أو غير مرسلة للمورد.',
    };
    const code = data?.error || data?.message;
    throw new Error(messages[code] || String(code || `فشل تسجيل الاستلام (${response.status})`));
  }
  return data.data;
}

async function saveSnapshot(payload) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_save_workflow_snapshot`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, p_payload: payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `فشل حفظ النتيجة (${response.status})`);
  }
  return data.data;
}

export const smartPurchaseReceivingApi = {
  listOrders: async () => {
    const rows = await receivingRpc('list_orders');
    const allowed = new Set(['معتمدة', 'تم الإرسال للمورد', 'approved', 'sent', 'partially_received']);
    return (rows || []).filter((order) => allowed.has(String(order.status || '').trim()));
  },
  getOrder: (id) => receivingRpc('get_order', { id }),
  importReceipt,
  saveWorkflowSnapshot: saveSnapshot,
};
