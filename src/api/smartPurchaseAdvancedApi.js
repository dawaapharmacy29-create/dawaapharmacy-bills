import { base44 } from '@/api/base44Client';
import { smartPurchaseOrderManagementApi } from '@/api/smartPurchaseOrderManagementApi';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const LEGACY_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxZnNha3J4YXp6bmtxbmpsZ3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5OTkzODMsImV4cCI6MjEwMDU3NTM4M30.ar5PScL6jPRMaWm8wItAL_ux3A2ewuSUa7Ha8le8Br0';
const ENV_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const KEY = ENV_KEY?.startsWith('eyJ') ? ENV_KEY : LEGACY_ANON_KEY;

function token() {
  try { return JSON.parse(localStorage.getItem('dawaa_staff_session') || 'null')?.session_token || ''; }
  catch { return ''; }
}
function errorText(value, fallback) {
  if (typeof value === 'string') return value;
  if (value?.message) return String(value.message);
  if (value?.details) return String(value.details);
  try { return JSON.stringify(value); } catch { return fallback; }
}
async function rpc(action, payload = {}) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_advanced`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, p_action: action, p_payload: payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(errorText(data?.error || data?.message || data, `فشل الطلب (${response.status})`));
  return data.data;
}
async function withFallback(work, fallback) {
  try { return await work(); }
  catch (error) {
    if (/400|404|Could not find|schema cache|function/i.test(error.message)) return fallback();
    throw error;
  }
}
async function supplierPerformanceFallback() {
  const [suppliers, invoices] = await Promise.all([
    base44.entities.Supplier.list('name', 1000, 0).catch(() => []),
    base44.entities.PurchaseInvoice.list('-invoice_date', 5000, 0).catch(() => []),
  ]);
  return suppliers.map((supplier) => {
    const rows = invoices.filter((x) => x.supplier_id === supplier.id || x.supplier_name === supplier.name);
    const total = rows.reduce((sum, x) => sum + Number(x.total_value || 0), 0);
    return {
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      supply_rate: rows.length ? 100 : 0,
      price_variance: 0,
      items_count: rows.length,
      shortage_count: 0,
      problems_count: 0,
      total_purchases: total,
      rating: rows.length ? 5 : 0,
    };
  });
}
async function orderEvaluationFallback(orderId) {
  const selected = await smartPurchaseOrderManagementApi.getOrder(orderId);
  const items = selected?.items || [];
  const expected = items.reduce((sum, x) => sum + Number(x.approved_quantity || 0) * Number(x.expected_unit_cost || 0), 0);
  return {
    order: selected?.order || { id: orderId, budget: expected },
    items,
    supplier_scores: [],
    expected_total: expected,
    shortages: items.filter((x) => !x.supplier_name).length,
  };
}

export const smartPurchaseAdvancedApi = {
  supplierPerformance: () => withFallback(() => rpc('supplier_performance'), supplierPerformanceFallback),
  orderEvaluation: (orderId) => withFallback(() => rpc('order_evaluation', { order_id: orderId }), () => orderEvaluationFallback(orderId)),
  createCustomerFollowups: () => Promise.resolve({ created: 0 }),
  listFollowups: (orderId = '') => withFallback(() => rpc('list_followups', { order_id: orderId }), async () => []),
  updateFollowups: () => Promise.resolve({ updated: 0 }),
  budgetPreview: (orderId, budget) => withFallback(() => rpc('optimize_budget_preview', { order_id: orderId, budget }), async () => {
    const evaluation = await orderEvaluationFallback(orderId);
    const items = evaluation.items || [];
    const total = items.reduce((sum, x) => sum + Number(x.approved_quantity || 0) * Number(x.expected_unit_cost || 0), 0);
    const factor = total > 0 ? Math.min(1, Number(budget || 0) / total) : 0;
    return { budget: Number(budget || 0), expected_total: total, items: items.map((x) => ({ ...x, suggested_quantity: Math.max(0, Math.floor(Number(x.approved_quantity || 0) * factor)) })) };
  }),
  applyBudgetPlan: () => Promise.reject(new Error('تطبيق الخطة على البيانات القديمة غير متاح تلقائيًا حفاظًا على سلامة البيانات. استخدم المعاينة ثم عدّل الطلبية الأصلية.')),
};