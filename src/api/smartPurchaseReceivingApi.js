import { smartPurchaseUnifiedApi } from '@/api/smartPurchaseUnifiedApi';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxZnNha3J4YXp6bmtxbmpsZ3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5OTkzODMsImV4cCI6MjEwMDU3NTM4M30.ar5PScL6jPRMaWm8wItAL_ux3A2ewuSUa7Ha8le8Br0';

const ACTIVE_RECEIVING_STATUSES = new Set(['معتمدة', 'تم الإرسال للمورد', 'approved', 'sent', 'partially_received', 'وصلت جزئيًا', 'received', 'وصلت بالكامل']);
const CLOSED_RECEIVING_STATUSES = new Set(['مغلقة', 'closed', 'completed', 'مكتمل']);

function receivingStateFromStatus(status) {
  const normalized = String(status || '').trim();
  if (CLOSED_RECEIVING_STATUSES.has(normalized)) return 'closed';
  if (ACTIVE_RECEIVING_STATUSES.has(normalized)) return 'active';
  return 'blocked';
}

function token() {
  try { return JSON.parse(localStorage.getItem('dawaa_staff_session') || 'null')?.session_token || ''; }
  catch { return ''; }
}

async function standaloneReceivingRpc(functionName, body = {}) {
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
      invalid_session: 'انتهت الجلسة. سجل الدخول مرة أخرى.',
      forbidden: 'لا توجد صلاحية لتنفيذ الإجراء.',
      forbidden_branch: 'لا توجد صلاحية على فرع الطلبية.',
      order_not_found: 'الطلبية غير موجودة.',
      item_not_found: 'الصنف غير موجود داخل الطلبية.',
      receiving_items_unresolved: 'ما زال يوجد أصناف لم يتم اتخاذ قرار نهائي بشأنها.',
      receiving_followup_open: 'يوجد أصناف عليها متابعة مفتوحة ولا يمكن إغلاق الطلبية.',
      order_not_closable: 'الطلبية ليست في مرحلة تسمح بالإغلاق.',
      invalid_resolution: 'قرار الاستلام غير صالح.',
      receiving_not_started: 'لا يمكن اتخاذ قرار نهائي قبل تسجيل استلام فعلي على الطلبية.',
      financial_receipts_unresolved: 'يوجد فواتير مورد لم يتم حسم فروقها المالية بعد.',
      financial_followup_open: 'يوجد متابعة مالية مفتوحة تمنع إغلاق الطلبية.',
      invalid_financial_resolution: 'قرار المطابقة المالية غير صالح.',
      receipt_not_found: 'فاتورة الاستلام غير موجودة.',
    };
    const code = data?.error || data?.message;
    throw new Error(messages[code] || String(code || `فشل الطلب (${response.status})`));
  }
  return data.data;
}

async function receivingRpc(action, payload = {}) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_receiving_read_v3`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, p_action: action, p_payload: payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const messages = {
      invalid_session: 'انتهت الجلسة. سجل الدخول مرة أخرى.',
      forbidden: 'لا توجد صلاحية لتنفيذ الإجراء.',
      forbidden_branch: 'لا توجد صلاحية على فرع الطلبية.',
      order_not_found: 'الطلبية غير موجودة.',
    };
    const code = data?.error || data?.message;
    throw new Error(messages[code] || String(code || `فشل الطلب (${response.status})`));
  }
  return data.data;
}

async function importReceipt(payload) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_import_receipt_v5`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, p_payload: payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const messages = {
      duplicate_receipt_file: 'ملف الاستلام ده مسجل بالفعل لنفس الطلبية والمورد.',
      duplicate_supplier_invoice: 'رقم فاتورة المورد ده مسجل بالفعل لنفس الطلبية.',
      supplier_required: 'حدد المورد قبل تسجيل الاستلام.',
      receipt_value_above_limit: 'قيمة الاستلام تتجاوز الحد المالي المسموح للطلبية.',
      receipt_value_above_supplier_limit: 'قيمة فاتورة المورد تتجاوز قيمة الأصناف المتبقية له داخل الطلبية.',
      cross_supplier_receipt_rows: 'الملف يحتوي على صنف مسند لمورد آخر داخل نفس الطلبية.',
      supplier_has_no_remaining_items: 'لا توجد كميات متبقية لهذا المورد تسمح بتسجيل استلام جديد.',
      invalid_rows: 'بيانات الاستلام غير صالحة.',
      forbidden_branch: 'لا توجد صلاحية على فرع الطلبية.',
      order_not_found: 'الطلبية غير موجودة.',
      receipt_order_not_ready: 'لا يمكن تسجيل استلام على طلبية غير جاهزة للاستلام.',
      supplier_not_dispatched: 'سجل إرسال الطلبية لهذا المورد أولًا قبل تسجيل الاستلام.',
      supplier_has_no_allocation: 'لا توجد كمية مخصصة لهذا المورد في الطلبية الحالية.',
      receipt_rows_not_allocated: 'الملف يحتوي على صنف غير مخصص لهذا المورد في الطلبية الحالية.',
      receipt_quantity_above_allocation: 'الكمية المستلمة تتجاوز الكمية المخصصة لهذا المورد.',
    };
    const code = data?.error || data?.message;
    throw new Error(messages[code] || String(code || `فشل تسجيل الاستلام (${response.status})`));
  }
  return data.data;
}

async function saveSupplierResponse(payload) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_save_supplier_response_v1`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, p_payload: payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const messages = {
      invalid_session: 'انتهت الجلسة. سجل الدخول مرة أخرى.',
      forbidden: 'لا توجد صلاحية لتنفيذ الإجراء.',
      forbidden_branch: 'لا توجد صلاحية على فرع الطلبية.',
      order_not_found: 'الطلبية غير موجودة.',
      supplier_required: 'اكتب اسم المورد قبل حفظ الرد.',
      supplier_response_order_not_ready: 'الطلبية ليست في مرحلة تسمح بتسجيل رد مورد.',
      invalid_supplier_response: 'بيانات رد المورد غير صالحة.',
      invalid_supplier_response_item: 'رد المورد يحتوي على صنف غير موجود في الطلبية.',
      supplier_allocation_above_order: 'الكمية التي أكدها المورد تتجاوز المتبقي الحقيقي للصنف.',
      supplier_allocation_below_received: 'لا يمكن تقليل تخصيص المورد عن كمية تم استلامها منه فعليًا.',
    };
    const code = data?.error || data?.message;
    throw new Error(messages[code] || String(code || `فشل حفظ رد المورد (${response.status})`));
  }
  return data.data;
}

async function saveSnapshot(payload) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_save_workflow_snapshot_guarded_v2`, {
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
    return (rows || []).filter((order) => ACTIVE_RECEIVING_STATUSES.has(String(order.status || '').trim()));
  },
  getScopedOrderStates: async (ids = []) => {
    const uniqueIds = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
    const details = await Promise.all(uniqueIds.map((id) => receivingRpc('get_order', { id })));
    return details.map((detail) => {
      const order = detail?.order || {};
      const status = String(order.status || '').trim();
      return {
        id: String(order.id || ''),
        status,
        state: receivingStateFromStatus(status),
        order,
      };
    });
  },
  getOrder: (id) => receivingRpc('get_order', { id }),
  importReceipt,
  saveSupplierResponse,
  saveWorkflowSnapshot: saveSnapshot,
  resolveItem: (orderId, itemId, resolutionStatus, note = '') => {
    const sessionToken = token();
    if (!sessionToken) return Promise.reject(new Error('انتهت الجلسة. سجل الدخول مرة أخرى.'));
    return fetch(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_resolve_receiving_item_v1`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_session_token: sessionToken, p_order_id: orderId, p_item_id: itemId, p_resolution_status: resolutionStatus, p_note: note }),
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(String(data?.error || data?.message || 'فشل حفظ قرار الاستلام.'));
      return data.data;
    });
  },
  financialReadiness: (orderId) => standaloneReceivingRpc('smart_purchase_financial_close_readiness_v1', { p_order_id: orderId }),
  resolveReceiptFinancial: (receiptId, resolutionStatus, note = '') => standaloneReceivingRpc('smart_purchase_resolve_receipt_financial_v1', {
    p_receipt_id: receiptId,
    p_resolution_status: resolutionStatus,
    p_note: note,
  }),
  closeReadiness: (orderId) => standaloneReceivingRpc('smart_purchase_receiving_close_readiness_v1', { p_order_id: orderId }),
  closeOrder: (orderId) => standaloneReceivingRpc('smart_purchase_close_order_v1', { p_order_id: orderId }),
};
