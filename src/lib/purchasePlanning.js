const toNumber = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function normalizeProductKey(row = {}) {
  const code = String(row.product_code || '').trim();
  if (code) return `code:${code}`;
  return `name:${String(row.product_name || '').trim().toLowerCase().replace(/[\s_\-]+/g, ' ')}`;
}

export function isValidProductName(value) {
  const name = String(value || '').trim();
  if (name.length < 2) return false;
  const compact = name.replace(/\s/g, '');
  if (/^0+$/.test(compact)) return false;
  return !/^\d{10,}$/.test(compact);
}

export function estimateDailyUsage(row = {}) {
  const explicit = Math.max(0, toNumber(row.avg_daily_usage));
  const sales30 = Math.max(0, toNumber(row.sales_30));
  const sales60 = Math.max(0, toNumber(row.sales_60));
  const sales90 = Math.max(0, toNumber(row.sales_90));
  const recentDaily = sales30 > 0 ? sales30 / 30 : 0;
  const mediumDaily = sales60 > 0 ? sales60 / 60 : 0;
  const longDaily = sales90 > 0 ? sales90 / 90 : 0;

  if (explicit > 0) return explicit;
  if (recentDaily > 0 && mediumDaily > 0 && longDaily > 0) {
    return (recentDaily * 0.5) + (mediumDaily * 0.3) + (longDaily * 0.2);
  }
  if (recentDaily > 0 && longDaily > 0) return (recentDaily * 0.6) + (longDaily * 0.4);
  if (recentDaily > 0 && mediumDaily > 0) return (recentDaily * 0.65) + (mediumDaily * 0.35);
  return recentDaily || mediumDaily || longDaily || 0;
}

export function calculatePurchaseNeed(row = {}, coverageDays = 7) {
  const targetDays = Math.max(1, toNumber(coverageDays) || 7);
  const currentStock = Math.max(0, toNumber(row.current_stock));
  const pendingIncoming = Math.max(0, toNumber(row.pending_incoming));
  const availableStock = currentStock + pendingIncoming;
  const averageDaily = estimateDailyUsage(row);
  const targetStock = Math.max(0, Math.ceil(averageDaily * targetDays));
  const suggestedQuantity = Math.max(0, targetStock - availableStock);
  const projectedStock = availableStock + suggestedQuantity;
  const projectedCoverageDays = averageDaily > 0 ? projectedStock / averageDaily : 0;

  return {
    ...row,
    current_stock: currentStock,
    pending_incoming: pendingIncoming,
    avg_daily_usage: averageDaily,
    target_coverage_days: targetDays,
    target_stock: targetStock,
    available_stock: availableStock,
    suggested_quantity: suggestedQuantity,
    projected_stock: projectedStock,
    projected_coverage_days: projectedCoverageDays,
    calculation_method: 'unified_final_coverage_v3',
  };
}

export function mergePurchaseRows(rows = []) {
  const merged = new Map();
  rows.filter((row) => isValidProductName(row?.product_name)).forEach((row) => {
    const key = normalizeProductKey(row);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...row });
      return;
    }
    merged.set(key, {
      ...current,
      product_code: current.product_code || row.product_code,
      product_name: current.product_name || row.product_name,
      current_stock: Math.max(toNumber(current.current_stock), toNumber(row.current_stock)),
      pending_incoming: Math.max(toNumber(current.pending_incoming), toNumber(row.pending_incoming)),
      sales_30: Math.max(toNumber(current.sales_30), toNumber(row.sales_30)),
      sales_60: Math.max(toNumber(current.sales_60), toNumber(row.sales_60)),
      sales_90: Math.max(toNumber(current.sales_90), toNumber(row.sales_90)),
      avg_daily_usage: Math.max(toNumber(current.avg_daily_usage), toNumber(row.avg_daily_usage)),
      last_purchase_price: toNumber(current.last_purchase_price) || toNumber(row.last_purchase_price),
      preferred_supplier: current.preferred_supplier || row.preferred_supplier,
    });
  });
  return [...merged.values()];
}

export function buildPurchaseCandidates(rows = [], options = {}) {
  const coverageDays = Math.max(1, toNumber(options.coverage_days) || 7);
  return mergePurchaseRows(rows)
    .map((row) => calculatePurchaseNeed(row, coverageDays))
    .filter((row) => row.avg_daily_usage > 0 && row.suggested_quantity > 0);
}

function itemPriority(item) {
  const customerRequests = Math.max(0, toNumber(item.customer_requests_count));
  const priorityScore = Math.max(0, toNumber(item.priority_score));
  const usage = Math.max(0, estimateDailyUsage(item));
  const stockoutPressure = Math.max(0, toNumber(item.target_stock) - toNumber(item.available_stock));
  return (customerRequests * 1000) + (priorityScore * 20) + (usage * 15) + stockoutPressure;
}

export function buildBudgetPlan(rows = [], budgetValue = 0, options = {}) {
  const budget = Math.max(0, toNumber(budgetValue));
  const minimumCriticalDays = Math.max(1, toNumber(options.minimum_critical_days) || 3);
  const source = rows
    .map((item) => {
      const price = Math.max(0, toNumber(item.expected_unit_cost || item.last_purchase_price));
      const desired = Math.max(0, Math.floor(toNumber(item.requested_quantity || item.suggested_quantity || item.approved_quantity)));
      return { ...item, price, desired, score: itemPriority(item) };
    })
    .filter((item) => item.price > 0 && item.desired > 0)
    .sort((a, b) => b.score - a.score || a.price - b.price);

  let remaining = budget;
  const quantities = new Map(source.map((item) => [item.id || normalizeProductKey(item), 0]));

  // المرحلة الأولى: طلبات العملاء والعاجل تحصل على حد أدنى فقط، دون تجاوز الاحتياج الحقيقي.
  source.forEach((item) => {
    const critical = toNumber(item.customer_requests_count) > 0 || toNumber(item.priority_score) >= 50 || String(item.priority_label || '').includes('عاجل');
    if (!critical) return;
    const usage = estimateDailyUsage(item);
    const minimumByDays = usage > 0 ? Math.ceil(usage * minimumCriticalDays) : 1;
    const minimum = Math.min(item.desired, Math.max(1, minimumByDays));
    const affordable = Math.floor(remaining / item.price);
    const qty = Math.min(minimum, affordable);
    quantities.set(item.id || normalizeProductKey(item), qty);
    remaining -= qty * item.price;
  });

  // المرحلة الثانية: توزيع وحدة بوحدة يحقق عدالة أكبر ويمنع استهلاك الميزانية في صنف واحد.
  let progressed = true;
  while (progressed && remaining > 0) {
    progressed = false;
    for (const item of source) {
      const key = item.id || normalizeProductKey(item);
      const current = quantities.get(key) || 0;
      if (current >= item.desired || item.price > remaining) continue;
      quantities.set(key, current + 1);
      remaining -= item.price;
      progressed = true;
    }
  }

  const plannedRows = rows.map((item) => {
    const key = item.id || normalizeProductKey(item);
    const approvedQuantity = quantities.get(key) || 0;
    const price = Math.max(0, toNumber(item.expected_unit_cost || item.last_purchase_price));
    return {
      ...item,
      approved_quantity: approvedQuantity,
      budget_line_total: approvedQuantity * price,
    };
  });

  const total = plannedRows.reduce((sum, item) => sum + toNumber(item.budget_line_total), 0);
  const activeRows = plannedRows.filter((item) => toNumber(item.approved_quantity) > 0);
  const zeroedRows = plannedRows.filter((item) => toNumber(item.approved_quantity) === 0 && toNumber(item.requested_quantity || item.suggested_quantity) > 0);

  return {
    rows: plannedRows,
    budget,
    total,
    remaining: Math.max(0, budget - total),
    active_items: activeRows.length,
    total_quantity: activeRows.reduce((sum, item) => sum + toNumber(item.approved_quantity), 0),
    reduced_items: plannedRows.filter((item) => toNumber(item.approved_quantity) < toNumber(item.requested_quantity || item.suggested_quantity)).length,
    zeroed_items: zeroedRows.length,
    missing_price_items: rows.filter((item) => toNumber(item.expected_unit_cost || item.last_purchase_price) <= 0).length,
  };
}
