const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function purchaseProductKey(row = {}) {
  const code = String(row.product_code || '').trim().replace(/\.0+$/, '');
  if (code) return `code:${code}`;
  return `name:${String(row.product_name || '').trim().toLowerCase().replace(/[\s_\-]+/g, ' ')}`;
}

export function mergePlanWithHistory(planRows = [], historyRows = []) {
  const history = new Map((historyRows || []).map((row) => [purchaseProductKey(row), row]));
  return (planRows || []).map((row) => {
    const hist = history.get(purchaseProductKey(row)) || {};
    const historicalCost = number(hist.historical_effective_unit_cost);
    const historicalLastCost = number(hist.historical_last_unit_cost || hist.last_purchase_price);
    const existingCost = number(row.unit_cost);
    const planningCost = historicalCost > 0
      ? historicalCost
      : historicalLastCost > 0
        ? historicalLastCost
        : existingCost;
    const source = historicalCost > 0
      ? 'historical_average'
      : historicalLastCost > 0
        ? 'historical_last'
        : existingCost > 0
          ? 'planner_reference'
          : 'missing';

    const buyQty = number(row.buy_quantity);
    return {
      ...row,
      historical_supplier: hist.historical_supplier || row.historical_supplier || '',
      historical_effective_unit_cost: historicalCost,
      historical_last_unit_cost: historicalLastCost,
      historical_last_purchase_date: hist.historical_last_purchase_date || row.historical_last_purchase_date || null,
      planning_reference_unit_cost: planningCost,
      planning_cost_source: source,
      planning_reference_total: buyQty * planningCost,
    };
  });
}

function currentCandidateForSupplier(item, supplierName) {
  const target = String(supplierName || '').trim().toLowerCase();
  if (!target) return null;
  const candidates = [item?.recommended, ...(item?.alternatives || [])].filter(Boolean);
  return candidates.find((candidate) => String(candidate.supplier_name || '').trim().toLowerCase() === target) || null;
}

export function buildSupplierFinancialRows({ decision = null, historyRows = [], branch = '' } = {}) {
  const history = new Map((historyRows || []).map((row) => [purchaseProductKey(row), row]));
  const items = Array.isArray(decision?.items) ? decision.items : [];

  return items.map((item) => {
    const hist = history.get(purchaseProductKey(item)) || {};
    const recommended = item?.recommended || {};
    const quantity = number(item.needed_qty);
    const currentEffectiveCost = number(recommended.effective_unit_cost || recommended.net_unit_cost);
    const historicalCost = number(hist.historical_effective_unit_cost);
    const historicalLastCost = number(hist.historical_last_unit_cost || hist.last_purchase_price);
    const fallbackCost = number(hist.planning_reference_unit_cost || hist.unit_cost);
    const hasCurrentOffer = Boolean(recommended.supplier_name) && currentEffectiveCost > 0;

    const supplierName = hasCurrentOffer
      ? recommended.supplier_name
      : hist.historical_supplier || '';

    const unitCost = hasCurrentOffer
      ? currentEffectiveCost
      : historicalCost > 0
        ? historicalCost
        : historicalLastCost > 0
          ? historicalLastCost
          : fallbackCost;

    const cashCost = hasCurrentOffer
      ? number(recommended.cash_cost) || quantity * number(recommended.net_unit_cost || currentEffectiveCost)
      : quantity * unitCost;

    const source = hasCurrentOffer
      ? 'current_offer'
      : historicalCost > 0
        ? 'historical_average'
        : historicalLastCost > 0
          ? 'historical_last'
          : fallbackCost > 0
            ? 'planner_reference'
            : 'missing';

    const listPrice = number(recommended.list_price || hist.public_price || hist.list_price || hist.reference_price);
    const referenceValue = listPrice > 0 ? quantity * listPrice : 0;
    const effectiveSavingPercent = referenceValue > 0 && cashCost >= 0 && cashCost <= referenceValue
      ? ((referenceValue - cashCost) / referenceValue) * 100
      : null;

    return {
      branch,
      item_id: item.item_id,
      product_code: item.product_code,
      product_name: item.product_name,
      quantity,
      supplier_name: supplierName,
      cost_source: source,
      price_verified: hasCurrentOffer,
      unit_cost: unitCost,
      cash_cost: cashCost,
      list_price: listPrice,
      discount_percent: recommended.discount_percent != null ? number(recommended.discount_percent) : null,
      extra_discount_percent: recommended.extra_discount_percent != null ? number(recommended.extra_discount_percent) : null,
      bonus_units: number(recommended.earned_bonus_units),
      received_units: number(recommended.received_units) || quantity,
      effective_saving_percent: effectiveSavingPercent,
      historical_supplier: hist.historical_supplier || '',
      historical_effective_unit_cost: historicalCost,
      historical_last_purchase_date: hist.historical_last_purchase_date || null,
      current_offer: hasCurrentOffer,
      alternatives: item.alternatives || [],
      recommended,
    };
  });
}

export function buildSupplierGroups(rows = []) {
  const groups = new Map();

  for (const row of rows || []) {
    const supplier = String(row.supplier_name || '').trim() || 'غير محدد';
    if (!groups.has(supplier)) {
      groups.set(supplier, {
        supplier_name: supplier,
        items: [],
        items_count: 0,
        units: 0,
        estimated_cash_total: 0,
        current_offer_items: 0,
        historical_reference_items: 0,
        missing_cost_items: 0,
        reference_value: 0,
      });
    }
    const group = groups.get(supplier);
    group.items.push(row);
    group.items_count += 1;
    group.units += number(row.quantity);
    group.estimated_cash_total += number(row.cash_cost);
    if (row.cost_source === 'current_offer') group.current_offer_items += 1;
    else if (row.cost_source === 'historical_average' || row.cost_source === 'historical_last') group.historical_reference_items += 1;
    if (number(row.unit_cost) <= 0) group.missing_cost_items += 1;
    if (number(row.list_price) > 0) group.reference_value += number(row.list_price) * number(row.quantity);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      estimated_cash_total: Math.round(group.estimated_cash_total * 100) / 100,
      weighted_saving_percent: group.reference_value > 0
        ? Math.max(0, ((group.reference_value - group.estimated_cash_total) / group.reference_value) * 100)
        : null,
    }))
    .sort((a, b) => b.estimated_cash_total - a.estimated_cash_total || b.items_count - a.items_count);
}

export function buildSingleSupplierScenarios({ decision = null, historyRows = [], branch = '' } = {}) {
  const items = Array.isArray(decision?.items) ? decision.items : [];
  const history = new Map((historyRows || []).map((row) => [purchaseProductKey(row), row]));
  const suppliers = new Set();

  for (const item of items) {
    if (item?.recommended?.supplier_name) suppliers.add(item.recommended.supplier_name);
    for (const alternative of item?.alternatives || []) {
      if (alternative?.supplier_name) suppliers.add(alternative.supplier_name);
    }
    const hist = history.get(purchaseProductKey(item));
    if (hist?.historical_supplier) suppliers.add(hist.historical_supplier);
  }

  const scenarios = [...suppliers].map((supplierName) => {
    const rows = items.map((item) => {
      const quantity = number(item.needed_qty);
      const hist = history.get(purchaseProductKey(item)) || {};
      const current = currentCandidateForSupplier(item, supplierName);
      const historicalMatch = String(hist.historical_supplier || '').trim().toLowerCase() === String(supplierName).trim().toLowerCase();
      const currentCost = number(current?.effective_unit_cost || current?.net_unit_cost);
      const historicalCost = historicalMatch ? number(hist.historical_effective_unit_cost || hist.last_purchase_price) : 0;
      const unitCost = currentCost > 0 ? currentCost : historicalCost;
      const cashCost = current
        ? number(current.cash_cost) || quantity * number(current.net_unit_cost || currentCost)
        : quantity * unitCost;

      return {
        branch,
        product_code: item.product_code,
        product_name: item.product_name,
        quantity,
        supplier_name: supplierName,
        coverage: currentCost > 0 ? 'current_offer' : historicalCost > 0 ? 'historical_reference' : 'missing',
        unit_cost: unitCost,
        cash_cost: cashCost,
        bonus_units: number(current?.earned_bonus_units),
      };
    });

    const currentOfferItems = rows.filter((row) => row.coverage === 'current_offer').length;
    const historicalReferenceItems = rows.filter((row) => row.coverage === 'historical_reference').length;
    const missingItems = rows.filter((row) => row.coverage === 'missing').length;
    const estimatedTotal = rows.reduce((sum, row) => sum + number(row.cash_cost), 0);

    return {
      supplier_name: supplierName,
      branch,
      items_count: rows.length,
      current_offer_items: currentOfferItems,
      historical_reference_items: historicalReferenceItems,
      missing_items: missingItems,
      current_coverage_percent: rows.length ? (currentOfferItems / rows.length) * 100 : 0,
      reference_coverage_percent: rows.length ? ((currentOfferItems + historicalReferenceItems) / rows.length) * 100 : 0,
      estimated_total: Math.round(estimatedTotal * 100) / 100,
      rows,
    };
  });

  return scenarios.sort((a, b) =>
    b.current_offer_items - a.current_offer_items
    || a.missing_items - b.missing_items
    || a.estimated_total - b.estimated_total
  );
}
