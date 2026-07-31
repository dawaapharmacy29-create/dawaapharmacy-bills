import { buildPurchaseCandidates } from '@/lib/purchasePlanning';

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

function preparePurchaseCandidates(payload = {}) {
  const coverageDays = Math.max(1, Number(payload.coverage_days || 7));
  const safetyDays = Math.max(0, Number(payload.safety_days || 0));
  const sourceRows = Array.isArray(payload.rows) ? payload.rows : [];
  let candidates = buildPurchaseCandidates(sourceRows, { coverage_days: coverageDays });

  if (payload.enforce_budget) {
    const budgetByKey = new Map(sourceRows.map((row) => [
      String(row.product_code || row.product_name || '').trim().toLowerCase(),
      Math.max(0, Math.floor(Number(row.budget_quantity || 0))),
    ]));
    candidates = candidates.map((row) => {
      const key = String(row.product_code || row.product_name || '').trim().toLowerCase();
      const budgetQuantity = budgetByKey.get(key);
      const suggestedQuantity = Number.isFinite(budgetQuantity)
        ? Math.min(row.suggested_quantity, budgetQuantity)
        : row.suggested_quantity;
      return {
        ...row,
        suggested_quantity: suggestedQuantity,
        approved_quantity: suggestedQuantity,
        budget_quantity: suggestedQuantity,
        budget_limit: Number(payload.budget_limit || 0),
      };
    }).filter((row) => row.suggested_quantity > 0);
  }

  if (!candidates.length) {
    throw new Error('لا توجد أصناف تحتاج شراء للوصول إلى أيام التغطية أو داخل الميزانية المحددة.');
  }

  return {
    ...payload,
    coverage_days: coverageDays,
    safety_days: safetyDays,
    calculation_method: payload.enforce_budget ? 'unified_budget_coverage_v3' : 'unified_final_coverage_v3',
    source_rows_count: sourceRows.length,
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
