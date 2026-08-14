const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxZnNha3J4YXp6bmtxbmpsZ3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5OTkzODMsImV4cCI6MjEwMDU3NTM4M30.ar5PScL6jPRMaWm8wItAL_ux3A2ewuSUa7Ha8le8Br0';

function token() {
  try { return JSON.parse(localStorage.getItem('dawaa_staff_session') || 'null')?.session_token || ''; }
  catch { return ''; }
}

async function standaloneRpc(functionName, body) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, ...body }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.message || data?.error || `فشل الطلب (${response.status})`);
  return Object.prototype.hasOwnProperty.call(data || {}, 'data') ? data.data : data;
}

async function rpc(action, payload = {}) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_unified`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, p_action: action, p_payload: payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const messages = {
      order_not_found: 'الطلبية غير موجودة.',
      item_not_found: 'الصنف غير موجود داخل الطلبية.',
      items_without_supplier: 'يوجد أصناف معتمدة بدون مورد.',
      empty_order: 'لا توجد قيمة صالحة لاعتماد الطلبية.',
      forbidden: 'لا توجد صلاحية لتنفيذ الإجراء.',
      invalid_quantity: 'الكمية المدخلة غير صحيحة.',
    };
    const raw = data?.error || data?.message || `فشل الطلب (${response.status})`;
    throw new Error(messages[raw] || String(raw));
  }
  return data.data;
}

export const smartPurchaseUnifiedApi = {
  dashboard: () => rpc('dashboard'),
  getOrder: (id) => rpc('get_order', { id }),
  updateItem: (payload) => rpc('update_item', payload),
  updateItems: (orderId, items) => rpc('update_items', { order_id: orderId, items }),
  updateOrderTitle: (orderId, title) => standaloneRpc('smart_purchase_update_order_title', { p_order_id: orderId, p_title: title }),
  cycleBudgetGuard: (branch = 'all') => standaloneRpc('smart_purchase_cycle_budget_guard', { p_branch: branch }),
  inventoryCommandCenter: (branch = 'all') => standaloneRpc('smart_purchase_inventory_command_center_v3', { p_branch: branch }),
  smartClearanceEngine: (branch = 'all') => standaloneRpc('smart_purchase_clearance_engine_v1', { p_branch: branch }),
  importInventoryIntelligence: ({ branch, rows }) => standaloneRpc('smart_purchase_inventory_intelligence_import', { p_branch: branch, p_rows: rows }),
  setCycleBudget: ({ branch, cycleBudget, reservePercent = 20, reserveDays = 8, warningPercent = 85 }) => standaloneRpc('smart_purchase_set_cycle_budget', {
    p_branch: branch,
    p_cycle_budget: Number(cycleBudget || 0),
    p_reserve_percent: Number(reservePercent || 20),
    p_reserve_days: Number(reserveDays || 8),
    p_warning_percent: Number(warningPercent || 85),
  }),
  approveOrder: async (orderId) => {
    try { return await standaloneRpc('smart_purchase_approve_without_supplier', { p_order_id: orderId }); }
    catch (error) {
      if (/Could not find the function|schema cache|404/i.test(String(error?.message || ''))) return rpc('approve_order', { order_id: orderId });
      throw error;
    }
  },
  approveAndReserve: (payload) => rpc('approve_order', { order_id: payload.order_id }),
  returnToReview: (orderId, newStatus = 'مسودة') => rpc('release_reservation', { order_id: orderId, new_status: newStatus }),
  releaseReservation: (orderId, newStatus = 'مسودة') => rpc('release_reservation', { order_id: orderId, new_status: newStatus }),
  markSent: (orderId) => rpc('mark_sent', { order_id: orderId }),
};
