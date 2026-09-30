import { buildPurchaseCandidates } from '../lib/purchasePlanning.js';

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const KEY = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxZnNha3J4YXp6bmtxbmpsZ3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5OTkzODMsImV4cCI6MjEwMDU3NTM4M30.ar5PScL6jPRMaWm8wItAL_ux3A2ewuSUa7Ha8le8Br0';

function token() {
  try { return JSON.parse(localStorage.getItem('dawaa_staff_session') || 'null')?.session_token || ''; }
  catch { return ''; }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('انتهت مهلة الاتصال بالخادم. لم يتم تكرار العملية تلقائيًا لحماية البيانات؛ راجع حالة الصفحة ثم أعد المحاولة.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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

async function directRpc(functionName, body = {}) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, ...body }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const messages = {
      invalid_session: 'انتهت الجلسة. سجل الدخول مرة أخرى.',
      forbidden: 'لا توجد صلاحية لتنفيذ الإجراء.',
      forbidden_branch: 'لا توجد صلاحية على هذا الفرع.',
      import_not_found: 'ملف التحليل غير موجود.',
      import_branch_mismatch: 'فرع ملف التحليل لا يطابق فرع الطلبية.',
      open_order_exists: 'يوجد طلبية مفتوحة بالفعل لهذا الفرع.',
      invalid_create_payload: 'بيانات إنشاء الطلبية غير مكتملة.',
      empty_plan: 'خطة الطلبية فارغة.',
      invalid_item_name: 'يوجد صنف بدون اسم صالح.',
      item_min_exceeds_max: 'يوجد صنف الحد الأدنى له أكبر من الحد الأقصى.',
      item_limits_violation: 'إحدى الكميات تخالف الحد الأدنى أو الأقصى للصنف.',
      order_min_exceeds_max: 'الحد الأدنى للطلبية أكبر من الحد الأقصى.',
      order_below_minimum: 'قيمة الطلبية أقل من الحد الأدنى المحدد.',
      order_above_maximum: 'قيمة الطلبية أعلى من الحد الأقصى المحدد.',
    };
    const code = data?.error || data?.message;
    throw new Error(messages[code] || errorMessage(data, response.status));
  }
  return data.data;
}

async function rpc(action, payload = {}) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_center_guarded_v3`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, p_action: action, p_payload: payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const messages = {
      forbidden_branch: 'لا توجد صلاحية على هذا الفرع.',
      import_not_found: 'ملف التحليل غير موجود.',
      import_branch_mismatch: 'فرع ملف التحليل لا يطابق فرع الطلبية.',
      open_order_exists: 'يوجد طلبية مفتوحة بالفعل لهذا الفرع.',
      invalid_create_payload: 'بيانات إنشاء الطلبية غير مكتملة.',
    };
    const code = data?.error || data?.message;
    throw new Error(messages[code] || errorMessage(data, response.status));
  }
  return data.data;
}

export function preparePurchaseCandidates(payload = {}) {
  const coverageDays = Math.max(1, Number(payload.coverage_days || 7));
  const safetyDays = Math.max(0, Number(payload.safety_days || 0));
  const sourceRows = Array.isArray(payload.rows) ? payload.rows : [];

  if (payload.preserve_plan === true) {
    const candidates = sourceRows.map((row) => {
      const quantity = Math.max(0, Number(row.approved_quantity ?? row.requested_quantity ?? row.suggested_quantity ?? row.budget_quantity ?? 0));
      return {
        ...row,
        suggested_quantity: quantity,
        requested_quantity: quantity,
        approved_quantity: quantity,
      };
    }).filter((row) => row.product_name && row.approved_quantity > 0);

    if (!candidates.length) {
      throw new Error('خطة V10 لا تحتوي على أصناف صالحة للإنشاء.');
    }

    return {
      ...payload,
      coverage_days: coverageDays,
      safety_days: safetyDays,
      preserve_plan: true,
      calculation_method: 'v10_preserved_plan',
      source_rows_count: sourceRows.length,
      filtered_rows_count: candidates.length,
      rows: candidates,
    };
  }

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
  createOrderFromPlan: ({ importId, branch, title, budget = 0, minimumOrderValue = 0, maximumOrderValue = 0, items = [] }) => directRpc('smart_purchase_create_order_from_plan_v2', {
    p_import_id: importId,
    p_branch: branch,
    p_title: title,
    p_budget: Number(budget || 0),
    p_minimum_order_value: Number(minimumOrderValue || 0),
    p_maximum_order_value: Number(maximumOrderValue || 0),
    p_items: items,
  }),
  listOrders: () => rpc('list_orders'),
  getOrder: (id) => rpc('get_order', { id }),
};
