import { base44 } from '@/api/base44Client';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const LEGACY_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxZnNha3J4YXp6bmtxbmpsZ3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5OTkzODMsImV4cCI6MjEwMDU3NTM4M30.ar5PScL6jPRMaWm8wItAL_ux3A2ewuSUa7Ha8le8Br0';
const ENV_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const KEY = ENV_KEY?.startsWith('eyJ') ? ENV_KEY : LEGACY_ANON_KEY;

function sessionToken() {
  try { return JSON.parse(localStorage.getItem('dawaa_staff_session') || 'null')?.session_token || ''; }
  catch { return ''; }
}
function errorText(value, fallback) {
  if (typeof value === 'string') return value;
  if (value?.message) return String(value.message);
  if (value?.details) return String(value.details);
  try { return JSON.stringify(value); } catch { return fallback; }
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
  if (!response.ok || data?.ok === false) throw new Error(errorText(data?.error || data?.message || data, `فشل الطلب (${response.status})`));
  return data.data;
}
async function rpc(name, action, payload = {}) { return postRpc(name, { p_action: action, p_payload: payload }); }
async function auditFeed(module, limit = 50) { return postRpc('operations_audit_feed', { p_module: module, p_limit: limit }); }

async function fallbackDashboard() {
  const [pharmacy, replenishment] = await Promise.allSettled([
    base44.entities.PharmacyOrder.list('-created_date', 3000, 0),
    base44.entities.ReplenishmentOrder.list('-created_date', 3000, 0),
  ]);
  const orders = [
    ...(pharmacy.status === 'fulfilled' ? pharmacy.value : []).map((x) => ({ ...x, source_type: 'pharmacy_order' })),
    ...(replenishment.status === 'fulfilled' ? replenishment.value : []).map((x) => ({ ...x, source_type: 'replenishment_order' })),
  ].map((x) => ({
    ...x,
    id: String(x.id),
    product_name: x.product_name || x.item_name || x.name || 'صنف غير محدد',
    requested_quantity: Number(x.requested_quantity || x.quantity || 1),
    status: x.status || 'draft',
    branch: x.branch || x.branch_name || '',
    updated_at: x.updated_at || x.created_at || x.created_date,
    request_date: x.request_date || x.order_date || x.created_date,
  }));
  const issues = orders.filter((x) => !x.branch || !x.product_name || x.product_name === 'صنف غير محدد').map((x) => ({
    id: `issue-${x.id}`, record_id: x.id, issue_code: !x.branch ? 'missing_branch' : 'missing_product', issue_message: !x.branch ? 'الفرع غير محدد' : 'اسم الصنف غير مكتمل',
  }));
  const now = Date.now();
  const sla = orders.map((x) => {
    const hours = Math.max(0, (now - new Date(x.updated_at || 0).getTime()) / 3600000);
    return { ...x, hours_in_status: hours, sla_level: hours > 24 ? 'late' : 'normal' };
  });
  return {
    issues,
    unified_orders: orders,
    three_way_issues: [],
    sla_orders: sla,
    supplier_offers: [],
    summary: {
      open_issues: issues.length,
      draft_orders: orders.filter((x) => ['draft','مسودة','pending'].includes(String(x.status).toLowerCase())).length,
      ordered_orders: orders.filter((x) => ['ordered','تم الطلب'].includes(String(x.status).toLowerCase())).length,
      shortage_orders: orders.filter((x) => ['shortage','نواقص'].includes(String(x.status).toLowerCase())).length,
      three_way_issues: 0,
      sla_over_24h: sla.filter((x) => x.sla_level !== 'normal').length,
    },
  };
}
async function withFallback(work, fallback) {
  try { return await work(); }
  catch (error) {
    if (/400|404|Could not find|schema cache|function/i.test(error.message)) return fallback();
    throw error;
  }
}

export const purchaseOperationsApi = {
  dashboard: () => withFallback(() => rpc('purchase_operations_review', 'dashboard'), fallbackDashboard),
  fixBranch: (id, branch) => rpc('purchase_operations_review', 'fix_branch', { id, branch }),
  updateStatus: (id, sourceType, status, reason = '') => postRpc('purchase_workflow_action', { p_source_type: sourceType, p_record_id: id, p_new_status: status, p_reason: reason }),
  decideVariance: (receiptItemId, decision, reason) => postRpc('purchase_variance_action', { p_receipt_item_id: receiptItemId, p_decision: decision, p_reason: reason }),
  auditFeed: (limit = 50) => withFallback(() => auditFeed('purchases', limit), async () => []),
};

export const treasuryOperationsApi = {
  alerts: () => rpc('treasury_daily_close_action', 'alerts'),
  closures: () => rpc('treasury_daily_close_action', 'closures'),
  closeDay: (payload) => rpc('treasury_daily_close_action', 'close', payload),
  reopenDay: (payload) => rpc('treasury_daily_close_action', 'reopen', payload),
  auditFeed: (limit = 50) => withFallback(() => auditFeed('treasury', limit), async () => []),
};