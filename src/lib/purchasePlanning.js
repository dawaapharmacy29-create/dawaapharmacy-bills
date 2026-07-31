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
    calculation_method: 'unified_final_coverage_v4',
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

function isCritical(item) {
  return toNumber(item.customer_requests_count) > 0
    || toNumber(item.priority_score) >= 50
    || String(item.priority_label || '').includes('عاجل');
}

function importanceWeight(item) {
  if (toNumber(item.customer_requests_count) > 0) return 1.35;
  if (isCritical(item)) return 1.22;
  const usage = estimateDailyUsage(item);
  const desired = Math.max(1, toNumber(item.requested_quantity || item.suggested_quantity || item.approved_quantity));
  const stockPressure = Math.max(0, desired - toNumber(item.available_stock));
  if (usage >= 1 || stockPressure >= desired * 0.75) return 1.08;
  return 0.94;
}

function itemPriority(item) {
  const customerRequests = Math.max(0, toNumber(item.customer_requests_count));
  const priorityScore = Math.max(0, toNumber(item.priority_score));
  const usage = Math.max(0, estimateDailyUsage(item));
  const desired = Math.max(1, toNumber(item.desired));
  const shortage = Math.max(0, desired - toNumber(item.current_planned));
  return (customerRequests * 1000) + (priorityScore * 20) + (usage * 15) + ((shortage / desired) * 100);
}

export function buildBudgetPlan(rows = [], budgetValue = 0, options = {}) {
  const budget = Math.max(0, toNumber(budgetValue));
  const source = rows
    .map((item) => {
      const price = Math.max(0, toNumber(item.expected_unit_cost || item.last_purchase_price));
      const desired = Math.max(0, Math.floor(toNumber(item.requested_quantity || item.suggested_quantity || item.approved_quantity)));
      return { ...item, price, desired, weight: importanceWeight(item) };
    })
    .filter((item) => item.price > 0 && item.desired > 0);

  const fullTargetTotal = source.reduce((sum, item) => sum + (item.desired * item.price), 0);
  const quantities = new Map(source.map((item) => [item.id || normalizeProductKey(item), 0]));

  if (budget > 0 && fullTargetTotal > 0) {
    if (budget >= fullTargetTotal) {
      source.forEach((item) => quantities.set(item.id || normalizeProductKey(item), item.desired));
    } else {
      const weightedTotal = source.reduce((sum, item) => sum + (item.desired * item.price * item.weight), 0);

      // توزيع نسبي على كامل الطلبية: كل صنف يأخذ نسبة من احتياجه بدل استهلاك الميزانية من أعلى القائمة.
      source.forEach((item) => {
        const key = item.id || normalizeProductKey(item);
        const allocatedValue = weightedTotal > 0
          ? budget * ((item.desired * item.price * item.weight) / weightedTotal)
          : 0;
        const proportionalQty = Math.min(item.desired, Math.floor(allocatedValue / item.price));
        quantities.set(key, proportionalQty);
      });

      let spent = source.reduce((sum, item) => {
        const key = item.id || normalizeProductKey(item);
        return sum + ((quantities.get(key) || 0) * item.price);
      }, 0);
      let remaining = Math.max(0, budget - spent);

      // نحاول الاحتفاظ بوحدة واحدة على الأقل من أكبر عدد ممكن من الأصناف المهمة.
      const missingBaseline = [...source]
        .filter((item) => (quantities.get(item.id || normalizeProductKey(item)) || 0) === 0)
        .sort((a, b) => Number(isCritical(b)) - Number(isCritical(a)) || b.weight - a.weight || a.price - b.price);
      for (const item of missingBaseline) {
        if (item.price > remaining) continue;
        quantities.set(item.id || normalizeProductKey(item), 1);
        remaining -= item.price;
      }

      // توزيع الباقي على أكبر فجوة نسبية عن الكمية الأصلية، مع ترجيح الأهمية.
      let progressed = true;
      while (progressed && remaining > 0) {
        progressed = false;
        const candidates = source
          .map((item) => {
            const key = item.id || normalizeProductKey(item);
            const current = quantities.get(key) || 0;
            const gapRatio = Math.max(0, item.desired - current) / Math.max(1, item.desired);
            return { ...item, key, current, gapRatio, refillScore: gapRatio * item.weight * 100 + itemPriority({ ...item, current_planned: current }) };
          })
          .filter((item) => item.current < item.desired && item.price <= remaining)
          .sort((a, b) => b.refillScore - a.refillScore || a.price - b.price);

        for (const item of candidates) {
          if (item.price > remaining) continue;
          quantities.set(item.key, (quantities.get(item.key) || 0) + 1);
          remaining -= item.price;
          progressed = true;
        }
      }
    }
  }

  const plannedRows = rows.map((item) => {
    const key = item.id || normalizeProductKey(item);
    const approvedQuantity = quantities.get(key) || 0;
    const price = Math.max(0, toNumber(item.expected_unit_cost || item.last_purchase_price));
    const desired = Math.max(0, toNumber(item.requested_quantity || item.suggested_quantity || item.approved_quantity));
    return {
      ...item,
      approved_quantity: approvedQuantity,
      budget_line_total: approvedQuantity * price,
      original_desired_quantity: desired,
      budget_reduction_percent: desired > 0 ? Number((((desired - approvedQuantity) / desired) * 100).toFixed(1)) : 0,
      budget_distribution_method: 'proportional_restructure_v2',
    };
  });

  const total = plannedRows.reduce((sum, item) => sum + toNumber(item.budget_line_total), 0);
  const activeRows = plannedRows.filter((item) => toNumber(item.approved_quantity) > 0);
  const zeroedRows = plannedRows.filter((item) => toNumber(item.approved_quantity) === 0 && toNumber(item.requested_quantity || item.suggested_quantity) > 0);
  const reducedRows = plannedRows.filter((item) => toNumber(item.approved_quantity) < toNumber(item.requested_quantity || item.suggested_quantity));

  return {
    rows: plannedRows,
    budget,
    full_target_total: fullTargetTotal,
    budget_ratio: fullTargetTotal > 0 ? budget / fullTargetTotal : 0,
    total,
    remaining: Math.max(0, budget - total),
    active_items: activeRows.length,
    retained_items_percent: source.length > 0 ? Number(((activeRows.length / source.length) * 100).toFixed(1)) : 0,
    total_quantity: activeRows.reduce((sum, item) => sum + toNumber(item.approved_quantity), 0),
    reduced_items: reducedRows.length,
    zeroed_items: zeroedRows.length,
    missing_price_items: rows.filter((item) => toNumber(item.expected_unit_cost || item.last_purchase_price) <= 0).length,
    distribution_method: 'proportional_restructure_v2',
  };
}
