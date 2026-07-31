const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxZnNha3J4YXp6bmtxbmpsZ3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5OTkzODMsImV4cCI6MjEwMDU3NTM4M30.ar5PScL6jPRMaWm8wItAL_ux3A2ewuSUa7Ha8le8Br0';

function token() {
  try { return JSON.parse(localStorage.getItem('dawaa_staff_session') || 'null')?.session_token || ''; }
  catch { return ''; }
}

function errorMessage(data, status) {
  if (typeof data === 'string' && data.trim()) return data;
  if (data && typeof data === 'object') {
    for (const key of ['error', 'message', 'details', 'hint']) {
      if (typeof data[key] === 'string' && data[key].trim()) return data[key];
    }
    try {
      const text = JSON.stringify(data);
      if (text && text !== '{}') return text;
    } catch {
      // ignore serialization errors
    }
  }
  return `فشل الطلب (${status})`;
}

async function rpc(action, payload = {}) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_center`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, p_action: action, p_payload: payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(errorMessage(data, response.status));
  return data.data;
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function validProductName(value) {
  const name = String(value || '').trim();
  if (!name) return false;
  if (/^0+$/.test(name.replace(/\s/g, ''))) return false;
  return !/^\d{10,}$/.test(name.replace(/\s/g, ''));
}

function preparePurchaseCandidates(payload = {}) {
  const coverageDays = Math.max(1, number(payload.coverage_days) || 21);
  const safetyDays = Math.max(0, number(payload.safety_days) || 0);
  const planningDays = coverageDays + safetyDays;
  const rows = Array.isArray(payload.rows) ? payload.rows : [];

  const candidates = rows
    .filter((row) => validProductName(row?.product_name))
    .map((row) => {
      const currentStock = Math.max(0, number(row.current_stock));
      const pendingIncoming = Math.max(0, number(row.pending_incoming));
      const sales30 = Math.max(0, number(row.sales_30));
      const sales90 = Math.max(0, number(row.sales_90));
      const averageDaily = Math.max(
        0,
        number(row.avg_daily_usage),
        sales30 > 0 ? sales30 / 30 : 0,
        sales90 > 0 ? sales90 / 90 : 0,
      );
      const targetStock = Math.ceil(averageDaily * planningDays);
      const suggestedQuantity = Math.max(0, targetStock - currentStock - pendingIncoming);

      return {
        ...row,
        current_stock: currentStock,
        pending_incoming: pendingIncoming,
        avg_daily_usage: averageDaily,
        suggested_quantity: suggestedQuantity,
      };
    })
    .filter((row) => row.suggested_quantity > 0);

  if (!candidates.length) {
    throw new Error('لا توجد أصناف تحتاج شراء وفق الرصيد والمبيعات وأيام التغطية الحالية.');
  }

  return {
    ...payload,
    source_rows_count: rows.length,
    filtered_rows_count: candidates.length,
    rows: candidates,
  };
}

export const smartPurchaseApi = {
  listImports: () => rpc('list_imports'),
  getImport: (id) => rpc('get_import', { id }),
  importRows: (payload) => rpc('import', preparePurchaseCandidates(payload)),
  createOrder: (payload) => rpc('create_order', payload),
  listOrders: () => rpc('list_orders'),
  getOrder: (id) => rpc('get_order', { id }),
};
