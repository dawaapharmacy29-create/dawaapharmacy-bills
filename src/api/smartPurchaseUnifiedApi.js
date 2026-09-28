const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zqfsakrxazznkqnjlgzv.supabase.co';
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxZnNha3J4YXp6bmtxbmpsZ3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5OTkzODMsImV4cCI6MjEwMDU3NTM4M30.ar5PScL6jPRMaWm8wItAL_ux3A2ewuSUa7Ha8le8Br0';

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
      throw new Error('انتهت مهلة الاتصال بالخادم. لم يتم تكرار العملية تلقائيًا لحماية البيانات؛ أعد المحاولة بعد التأكد من حالة الصفحة.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function standaloneRpc(functionName, body) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: sessionToken, ...body }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const messages = {
      invalid_session: 'انتهت الجلسة. سجل الدخول مرة أخرى.',
      forbidden: 'لا توجد صلاحية لتنفيذ الإجراء.',
      order_not_found: 'الطلبية غير موجودة.',
      items_without_supplier: 'يوجد أصناف معتمدة بدون مورد.',
      order_not_ready_to_send: 'الطلبية لازم تكون معتمدة قبل تسجيل إرسالها للمورد.',
      forbidden_branch: 'لا توجد صلاحية على هذا الفرع.',
      open_order_exists: 'يوجد طلبية مفتوحة بالفعل لهذا الفرع.',
      order_title_locked: 'لا يمكن تعديل اسم الطلبية بعد الاعتماد أو بدء التنفيذ.',
      invalid_title: 'اسم الطلبية يجب أن يكون من حرفين إلى 120 حرفًا.',
      cancel_reason_required: 'اكتب سبب واضح لإلغاء الطلبية.',
      order_not_cancelable: 'الطلبية في مرحلة لا تسمح بالإلغاء.',
      order_execution_started: 'لا يمكن إلغاء الطلبية بعد بدء الإرسال أو الاستلام.',
      supplier_not_in_order: 'المورد غير موجود ضمن البنود المعتمدة في الطلبية.',
      supplier_items_not_send_ready: 'بنود المورد غير جاهزة للإرسال: راجع الأسعار والتحقق منها أولًا.',
      no_active_purchase_policy: 'لا توجد سياسة مخزون ذكية مفعلة لهذا الفرع؛ التحليل متوقف للحماية.',
      analysis_integrity_guard_failed: 'تم إيقاف التحليل لأن بيانات Min / Reorder / Max أو الأسعار الحالية غير متسقة. راجع سلامة بيانات المشتريات قبل إنشاء أي طلبية.',
      stage_count_mismatch: 'تم إيقاف حفظ الرصيد لأن عدد الصفوف المستلمة لا يطابق الملف الأصلي. الرصيد السابق لم يتغير.',
      stock_sync_mismatch: 'تم إيقاف التحليل لأن الفرعين ليسا على نفس نسخة ملف الرصيد. أعد رفع ملف الرصيد الموحد للفرعين.',
      plan_hash_mismatch: 'تم إيقاف إنشاء المسودتين لأن الخطة تغيرت بعد المراجعة. أعد التحليل ثم راجع الخطة الجديدة.',
      invalid_dual_plan_identity: 'بيانات تعريف الخطة غير مكتملة؛ أعد التحليل قبل إنشاء المسودتين.',
      dual_create_failed: 'تعذر إنشاء المسودتين معًا؛ لم يتم اعتماد إنشاء جزئي.',
      stale_plan_data: 'تم إيقاف إنشاء المسودتين لأن بيانات الرصيد أو الحركة أو الوضع المالي ليست حديثة بما يكفي. حدّث البيانات ثم أعد التحليل.',

    };
    const code = data?.error || data?.message;
    throw new Error(messages[code] || String(code || `فشل الطلب (${response.status})`));
  }
  return Object.prototype.hasOwnProperty.call(data || {}, 'data') ? data.data : data;
}

async function unifiedV2Rpc(action, payload = {}) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_unified_v2`, {
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
      order_not_returnable: 'الطلبية ليست في حالة تسمح بإعادتها للمراجعة.',
      order_already_dispatched: 'لا يمكن إعادة الطلبية للمراجعة بعد إرسال أي جزء منها لمورد.',
    };
    const code = data?.error || data?.message;
    throw new Error(messages[code] || String(code || `فشل الطلب (${response.status})`));
  }
  return data.data;
}

async function rpc(action, payload = {}) {
  const sessionToken = token();
  if (!sessionToken) throw new Error('انتهت الجلسة. سجل الدخول مرة أخرى.');
  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/smart_purchase_unified`, {
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
  dashboard: () => standaloneRpc('smart_purchase_dashboard_fast_v1', {}),
  getOrder: (id) => unifiedV2Rpc('get_order', { id }),
  updateItem: (payload) => rpc('update_item', payload),
  updateItems: (orderId, items) => rpc('update_items', { order_id: orderId, items }),
  updateOrderTitle: (orderId, title) => standaloneRpc('smart_purchase_update_order_title_v2', { p_order_id: orderId, p_title: title }),
  cycleBudgetGuard: (branch = 'all') => standaloneRpc('smart_purchase_cycle_budget_guard', { p_branch: branch }),
  decisionDailyChange: (branch = 'all') => standaloneRpc('smart_purchase_decision_daily_change_v1', { p_branch: branch }),
  inventoryCommandCenter: (branch = 'all') => standaloneRpc('smart_purchase_inventory_command_center_v3', { p_branch: branch }),
  saveCurrentSnapshot: (branch, rows = []) => standaloneRpc('smart_purchase_save_current_snapshot_v1', {
    p_branch: branch,
    p_rows: rows,
  }),
  saveDualBranchStockMasterClean: async ({ rows = [], chunkSize = 1800 }) => {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('لا توجد صفوف رصيد صالحة للحفظ.');
    const syncId = `dual-stock-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let staged = 0;
    for (let offset = 0; offset < rows.length; offset += chunkSize) {
      const chunk = rows.slice(offset, offset + chunkSize);
      const result = await standaloneRpc('smart_purchase_stage_dual_stock_master_v1', {
        p_stock_sync_id: syncId,
        p_rows: chunk,
      });
      staged += Number(result?.staged_rows || chunk.length);
    }
    const finalized = await standaloneRpc('smart_purchase_finalize_dual_stock_master_v1', {
      p_stock_sync_id: syncId,
      p_expected_rows: rows.length,
    });
    return {
      stock_sync_id: syncId,
      staged_rows: staged,
      shamy_saved: Number(finalized?.shamy_saved || 0),
      shokry_saved: Number(finalized?.shokry_saved || 0),
      shamy_stale_disabled: Number(finalized?.shamy_stale_disabled || 0),
      shokry_stale_disabled: Number(finalized?.shokry_stale_disabled || 0),
      dual_atomic_finalize: finalized?.dual_atomic_finalize === true,
      row_count_verified: finalized?.row_count_verified === true,
      total_saved: Number(finalized?.shamy_saved || 0) + Number(finalized?.shokry_saved || 0),
    };
  },
  saveDualBranchStockMaster: async ({ shamy = [], shokry = [], chunkSize = 1000 }) => {
    const syncId = `stock-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const saveBranch = async (branch, rows) => {
      let staged = 0;
      for (let offset = 0; offset < rows.length; offset += chunkSize) {
        const chunk = rows.slice(offset, offset + chunkSize);
        const result = await standaloneRpc('smart_purchase_stage_stock_snapshot_v1', {
          p_branch: branch,
          p_stock_sync_id: syncId,
          p_rows: chunk,
        });
        staged += Number(result?.staged_rows || chunk.length);
      }
      const finalized = await standaloneRpc('smart_purchase_finalize_stock_sync_checked_v1', {
        p_branch: branch,
        p_stock_sync_id: syncId,
        p_expected_rows: rows.length,
      });
      return {
        saved: Number(finalized?.applied_rows || staged),
        stale_rows_disabled: Number(finalized?.stale_rows_disabled || 0),
        atomic_finalize: finalized?.atomic_finalize === true,
      };
    };
    const [shamyResult, shokryResult] = await Promise.all([
      saveBranch('دواء الشامي', shamy),
      saveBranch('دواء شكري', shokry),
    ]);
    return {
      stock_sync_id: syncId,
      shamy_saved: shamyResult.saved,
      shokry_saved: shokryResult.saved,
      shamy_stale_disabled: shamyResult.stale_rows_disabled,
      shokry_stale_disabled: shokryResult.stale_rows_disabled,
      shamy_atomic_finalize: shamyResult.atomic_finalize,
      shokry_atomic_finalize: shokryResult.atomic_finalize,
      total_saved: shamyResult.saved + shokryResult.saved,
    };
  },
  dualBranchInstantPlan: ({ shokryBudget = null, shamyBudget = null } = {}) => standaloneRpc('smart_purchase_dual_branch_instant_plan_v1', {
    p_shokry_budget: Number(shokryBudget) > 0 ? Number(shokryBudget) : null,
    p_shamy_budget: Number(shamyBudget) > 0 ? Number(shamyBudget) : null,
  }),
  createDualDrafts: ({ stockSyncId, planHash }) => standaloneRpc('smart_purchase_create_dual_drafts_v1', {
    p_stock_sync_id: stockSyncId,
    p_plan_hash: planHash,
  }),
  demandTransferPreview: async (branch, financialMode = 'medium', rows = [], budget = 0) => {
    if (Array.isArray(rows) && rows.length > 0) {
      await standaloneRpc('smart_purchase_save_current_snapshot_v1', {
        p_branch: branch,
        p_rows: rows,
      });
    }
    return standaloneRpc('smart_purchase_demand_transfer_preview_v10', {
      p_branch: branch,
      p_financial_mode: financialMode,
      p_budget: Number(budget) > 0 ? Number(budget) : null,
    });
  },
  historyStatus: (branch) => standaloneRpc('smart_purchase_history_status_v1', { p_branch: branch }),
  importHistory: ({ branch, kind, fileName, rows, reset = false }) => standaloneRpc('smart_purchase_history_import_v1', {
    p_branch: branch,
    p_kind: kind,
    p_source_file_name: fileName || 'history-import',
    p_rows: rows || [],
    p_reset: Boolean(reset),
  }),
  smartClearanceEngine: (branch = 'all') => standaloneRpc('smart_purchase_clearance_engine_v1', { p_branch: branch }),
  safeDraftPreview: ({ branch, targetBudget = null, financialMode = 'medium' }) => standaloneRpc('smart_purchase_safe_draft_preview_v4', {
    p_branch: branch,
    p_target_budget: targetBudget == null || targetBudget === '' ? null : Number(targetBudget),
    p_financial_mode: financialMode,
  }),
  createSafeDraft: ({ branch, targetBudget = null, financialMode = 'medium' }) => standaloneRpc('smart_purchase_safe_draft_create_v4', {
    p_branch: branch,
    p_target_budget: targetBudget == null || targetBudget === '' ? null : Number(targetBudget),
    p_financial_mode: financialMode,
  }),
  supplierDecision: (orderId) => standaloneRpc('smart_purchase_supplier_decision_guarded_v2', { p_order_id: orderId }),
  supplierAllocationPlan: (orderId) => standaloneRpc('smart_purchase_supplier_allocation_plan_guarded_v2', { p_order_id: orderId }),
  supplierOfferHealth: () => standaloneRpc('smart_purchase_supplier_offer_health_v1', {}),
  supplierPerformance: (branch = 'all') => standaloneRpc('smart_purchase_supplier_performance_v2', { p_branch: branch }),
  importSupplierOffers: ({ fileName, rows }) => standaloneRpc('smart_purchase_import_supplier_offers_v1', {
    p_source_file_name: fileName || 'manual-import',
    p_rows: rows || [],
  }),
  captureClearancePlan: (branch = 'all') => standaloneRpc('smart_purchase_clearance_capture_plan_v1', { p_branch: branch }),
  clearanceOutcomes: (branch = 'all') => standaloneRpc('smart_purchase_clearance_outcomes_v1', { p_branch: branch }),
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
  returnToReview: (orderId) => unifiedV2Rpc('return_to_review', { order_id: orderId }),
  releaseReservation: (orderId) => unifiedV2Rpc('return_to_review', { order_id: orderId }),
  cancelOrder: (orderId, reason) => standaloneRpc('smart_purchase_cancel_order_v2', {
    p_order_id: orderId,
    p_reason: reason,
  }),
  supplierDispatches: (orderId) => standaloneRpc('smart_purchase_supplier_dispatch_guarded_v3', {
    p_action: 'list',
    p_payload: { order_id: orderId },
  }),
  markSupplierSent: (orderId, supplierName) => standaloneRpc('smart_purchase_supplier_dispatch_guarded_v3', {
    p_action: 'mark_supplier_sent',
    p_payload: { order_id: orderId, supplier_name: supplierName },
  }),
};
