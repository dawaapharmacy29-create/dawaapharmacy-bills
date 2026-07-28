import { base44 } from '@/api/base44Client';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const LEGACY_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6InpxZnNha3J4YXp6bmtxbmpsZ3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5OTkzODMsImV4cCI6MjEwMDU3NTM4M30.ar5PScL6jPRMaWm8wItAL_ux3A2ewuSUa7Ha8le8Br0';
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
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_order_management`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, p_action: action, p_payload: payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(errorText(data?.error || data?.message || data, `فشل الطلب (${response.status})`));
  return data.data;
}

async function fallbackOrders() {
  const [pharmacy, replenishment] = await Promise.allSettled([
    base44.entities.PharmacyOrder.list('-created_date', 2000, 0),
    base44.entities.ReplenishmentOrder.list('-created_date', 2000, 0),
  ]);
  const rows = [
    ...(pharmacy.status === 'fulfilled' ? pharmacy.value : []).map((x) => ({ ...x, source_type: 'pharmacy_order' })),
    ...(replenishment.status === 'fulfilled' ? replenishment.value : []).map((x) => ({ ...x, source_type: 'replenishment_order' })),
  ];
  return rows.map((x) => ({
    ...x,
    id: String(x.id),
    order_number: x.order_number || x.request_number || x.id,
    branch: x.branch || x.branch_name || 'غير محدد',
    status: x.status || 'مسودة',
    approved_total: Number(x.approved_total || x.total_value || 0),
  }));
}

async function withFallback(action, payload, fallback) {
  try { return await rpc(action, payload); }
  catch (error) {
    if ([400, 404].some((code) => String(error.message).includes(String(code))) || /Could not find|schema cache|function/i.test(error.message)) return fallback();
    throw error;
  }
}

export const smartPurchaseOrderManagementApi = {
  listOrders: () => withFallback('list_orders', {}, fallbackOrders),
  getOrder: (id) => withFallback('get_order', { id }, async () => {
    const order = (await fallbackOrders()).find((x) => String(x.id) === String(id));
    if (!order) throw new Error('الطلب غير موجود.');
    return { order, items: [{
      id: order.id,
      product_code: order.product_code || order.item_code || '',
      product_name: order.product_name || order.item_name || order.name || 'صنف غير محدد',
      requested_quantity: Number(order.requested_quantity || order.quantity || 1),
      approved_quantity: Number(order.approved_quantity || order.quantity || 1),
      supplier_name: order.supplier_name || order.ordered_supplier || '',
      expected_unit_cost: Number(order.expected_unit_cost || order.unit_cost || 0),
      expected_discount: Number(order.expected_discount || 0),
      supplier_reason: '', notes: order.notes || '',
    }] };
  }),
  listOffers: (filters = {}) => rpc('list_offers', filters),
  importOffers: (payload) => rpc('import_offers', payload),
  updateItem: () => Promise.reject(new Error('تعديل الطلبية القديمة غير متاح من هذه الصفحة حاليًا. استخدم صفحة الطلب الأصلية.')),
  optimizeSuppliers: () => Promise.reject(new Error('التحسين التلقائي يحتاج طلبية منشأة من مركز الطلبية الذكي.')),
  approveOrder: () => Promise.reject(new Error('الاعتماد من هذه الصفحة متاح فقط للطلبيات الذكية الجديدة.')),
};