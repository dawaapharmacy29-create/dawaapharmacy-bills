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

async function directRpc(functionName, body = {}) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, ...body }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const messages = {
      invalid_session: 'الجلسة غير صالحة. سجل الدخول مرة أخرى.',
      forbidden: 'لا توجد صلاحية لتنفيذ الإجراء.',
      forbidden_branch: 'لا توجد صلاحية على فرع الطلبية.',
      order_not_found: 'الطلبية غير موجودة.',
      invalid_budget: 'أدخل قيمة ميزانية صحيحة أكبر من صفر.',
      budget_below_protected_minimum: 'الميزانية أقل من الحد الأدنى الآمن للأصناف المحمية بطلبات العملاء.',
      order_min_exceeds_max: 'الحد الأدنى للطلبية لا يمكن أن يكون أكبر من الحد الأقصى.',
      order_policy_locked: 'لا يمكن تعديل حدود الطلبية بعد الاعتماد أو الإرسال.',
      order_items_locked: 'لا يمكن تعديل بنود الطلبية بعد الاعتماد أو الإرسال.',
      item_limits_violation: 'الكمية الجديدة تخالف الحد الأدنى أو الأقصى للصنف.',
      package_multiple_violation: 'الكمية لازم تكون مضاعف صحيح لعبوة/باك الصنف.',
      order_max_exceeded: 'التعديل يرفع الطلبية فوق الحد الأقصى المحدد.',
      order_below_minimum: 'قيمة الطلبية أقل من الحد الأدنى المحدد.',
      order_above_maximum: 'قيمة الطلبية أعلى من الحد الأقصى المحدد.',
      items_without_supplier: 'يوجد أصناف معتمدة بدون مورد.',
      items_without_cost: 'يوجد أصناف بكميات معتمدة بدون تكلفة شراء. راجع التكلفة قبل الاعتماد.',
      supplier_plan_invalid_offer: 'بعض عروض الموردين لم تعد صالحة أو لا تطابق الصنف.',
      supplier_plan_quantity_violation: 'اختيار المورد المقترح يخالف حد الصنف أو MOQ أو الكمية المتاحة.',
    };
    const code = data?.error || data?.message;
    const extra = data?.data?.minimum_possible_total ? ` الحد الأدنى الآمن: ${Number(data.data.minimum_possible_total).toLocaleString('ar-EG')} ج.` : '';
    throw new Error((messages[code] || errorText(code || data, `فشل الطلب (${response.status})`)) + extra);
  }
  return data.data;
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
  if (!payload.order_id || !payload.id) throw new Error('بيانات الصنف أو الطلبية غير مكتملة.');
  const patch = { id: payload.id };
  for (const key of [
    'approved_quantity',
    'expected_unit_cost',
    'expected_discount',
    'supplier_name',
    'minimum_order_quantity',
    'maximum_order_quantity',
    'package_multiple',
  ]) {
    if (payload[key] !== undefined) patch[key] = payload[key];
  }
  return directRpc('smart_purchase_apply_item_plan_package_guarded_v2', {
    p_order_id: payload.order_id,
    p_items: [patch],
  });
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
  return rows.map((x) => ({ ...x, id: String(x.id), order_number: x.order_number || x.request_number || x.id, branch: x.branch || x.branch_name || 'غير محدد', status: x.status || 'مسودة', approved_total: Number(x.approved_total || x.total_value || 0) }));
}

async function unifiedOrders() { const dashboard = await smartPurchaseUnifiedApi.dashboard(); return dashboard?.orders || []; }

export const smartPurchaseOrderManagementApi = {
  listOrders: async () => { try { return await unifiedOrders(); } catch (error) { if (/Could not find|schema cache|function|404/i.test(String(error?.message || ''))) return fallbackOrders(); throw error; } },
  getOrder: async (id) => {
    try { return await smartPurchaseUnifiedApi.getOrder(id); }
    catch (error) {
      if (!/Could not find|schema cache|function|404/i.test(String(error?.message || ''))) throw error;
      const order = (await fallbackOrders()).find((x) => String(x.id) === String(id));
      if (!order) throw new Error('الطلب غير موجود.');
      return { order, items: [{ id: order.id, product_code: order.product_code || order.item_code || '', product_name: order.product_name || order.item_name || order.name || 'صنف غير محدد', requested_quantity: Number(order.requested_quantity || order.quantity || 1), approved_quantity: Number(order.approved_quantity || order.quantity || 1), supplier_name: order.supplier_name || order.ordered_supplier || '', expected_unit_cost: Number(order.expected_unit_cost || order.unit_cost || 0), expected_discount: Number(order.expected_discount || 0), supplier_reason: '', notes: order.notes || '' }] };
    }
  },
  listOffers: (filters = {}) => legacyRpc('list_offers', filters),
  importOffers: (payload) => smartPurchaseUnifiedApi.importSupplierOffers({
    fileName: payload.file_name,
    rows: payload.rows || [],
  }),
  updateItem: atomicUpdateItem,
  assignSupplier: (orderId, itemId, supplierName) => directRpc('smart_purchase_assign_supplier_v2', {
    p_order_id: orderId,
    p_item_id: itemId,
    p_supplier_name: supplierName,
  }),
  applyItemPlan: (orderId, items) => directRpc('smart_purchase_apply_item_plan_package_guarded_v2', { p_order_id: orderId, p_items: items }),
  applyQuantityPlan: (orderId, items) => directRpc('smart_purchase_apply_item_plan_package_guarded_v2', { p_order_id: orderId, p_items: items }),
  setOrderPolicy: (orderId, minimumOrderValue, maximumOrderValue) => directRpc('smart_purchase_set_order_policy_guarded_v2', {
    p_order_id: orderId,
    p_minimum_order_value: Number(minimumOrderValue || 0),
    p_maximum_order_value: Number(maximumOrderValue || 0),
  }),
  applySupplierPlan: (orderId, items) => directRpc('smart_purchase_apply_supplier_plan_guarded_v2', {
    p_order_id: orderId,
    p_items: items,
  }),
  optimizeSuppliers: async (orderId) => {
    try { return await legacyRpc('optimize_suppliers', { order_id: orderId }); }
    catch (error) {
      const message = String(error?.message || '');
      if (/session_token does not exist|no_supplier_offers/i.test(message)) return { skipped: true, reason: 'supplier_stage_not_ready', message: 'مرحلة مقارنة الموردين مؤجلة حاليًا؛ تم الاحتفاظ بالطلبية كما هي.' };
      throw error;
    }
  },
  previewBudget: (orderId, targetBudget) => directRpc('smart_purchase_optimize_budget_v2', { p_order_id: orderId, p_target_budget: Number(targetBudget || 0), p_apply: false }),
  applyBudget: (orderId, targetBudget) => directRpc('smart_purchase_optimize_budget_v2', { p_order_id: orderId, p_target_budget: Number(targetBudget || 0), p_apply: true }),
  approveOrder: (orderId) => directRpc('smart_purchase_approve_order_package_guarded_v2', { p_order_id: orderId }),
};
