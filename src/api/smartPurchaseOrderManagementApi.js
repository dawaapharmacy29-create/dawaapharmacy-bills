import { base44 } from '@/api/base44Client';
import { smartPurchaseUnifiedApi } from '@/api/smartPurchaseUnifiedApi';

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

async function legacyRpc(action, payload = {}) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_order_management`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, p_action: action, p_payload: payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const messages = {
      order_not_found: 'الطلبية غير موجودة.',
      no_supplier_offers: 'لا توجد عروض موردين مسجلة تسمح بالمقارنة التلقائية.',
      items_without_supplier: 'يوجد أصناف بدون مورد.',
      forbidden: 'لا توجد صلاحية لتنفيذ الإجراء.',
    };
    throw new Error(messages[data?.error] || errorText(data?.error || data?.message || data, `فشل الطلب (${response.status})`));
  }
  return data.data;
}

async function atomicUpdateItem(payload = {}) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_apply_budget_plan`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_session_token: sessionToken,
      p_order_id: payload.order_id,
      p_items: [{
        id: payload.id,
        ...(payload.approved_quantity !== undefined ? { approved_quantity: Number(payload.approved_quantity || 0) } : {}),
        ...(payload.expected_discount !== undefined ? { expected_discount: Number(payload.expected_discount || 0) } : {}),
        ...(payload.expected_unit_cost !== undefined ? { expected_unit_cost: Number(payload.expected_unit_cost || 0) } : {}),
        ...(payload.supplier_name !== undefined ? { supplier_name: String(payload.supplier_name || '') } : {}),
      }],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const code = data?.error || data?.message;
    const messages = {
      invalid_session: 'الجلسة غير صالحة. سجل الدخول مرة أخرى.',
      items_table_not_found: 'تعذر تحديد جدول أصناف الطلبية في قاعدة البيانات.',
      apply_failed: data?.message || 'تعذر تثبيت تعديل الصنف.',
    };
    if (response.status === 404 || /Could not find the function|schema cache/i.test(String(code || ''))) {
      throw new Error('تحديث أصناف الطلبية غير مفعّل في قاعدة البيانات بعد.');
    }
    throw new Error(messages[code] || errorText(code || data, `فشل تحديث الصنف (${response.status})`));
  }
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

async function unifiedOrders() {
  const dashboard = await smartPurchaseUnifiedApi.dashboard();
  return dashboard?.orders || [];
}

export const smartPurchaseOrderManagementApi = {
  listOrders: async () => {
    try { return await unifiedOrders(); }
    catch (error) {
      if (/Could not find|schema cache|function|404/i.test(String(error?.message || ''))) return fallbackOrders();
      throw error;
    }
  },
  getOrder: async (id) => {
    try { return await smartPurchaseUnifiedApi.getOrder(id); }
    catch (error) {
      if (!/Could not find|schema cache|function|404/i.test(String(error?.message || ''))) throw error;
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
    }
  },
  listOffers: (filters = {}) => legacyRpc('list_offers', filters),
  importOffers: (payload) => legacyRpc('import_offers', payload),
  updateItem: atomicUpdateItem,
  optimizeSuppliers: async (orderId) => {
    try {
      return await legacyRpc('optimize_suppliers', { order_id: orderId });
    } catch (error) {
      const message = String(error?.message || '');
      if (/session_token does not exist|no_supplier_offers/i.test(message)) {
        return {
          skipped: true,
          reason: 'supplier_stage_not_ready',
          message: 'مرحلة مقارنة الموردين مؤجلة حاليًا؛ تم الاحتفاظ بالطلبية كما هي.',
        };
      }
      throw error;
    }
  },
  approveOrder: (orderId) => smartPurchaseUnifiedApi.approveOrder(orderId),
};
