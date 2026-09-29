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

function currentOfferCandidates(item) {
  return [item?.recommended, ...(item?.alternatives || [])]
    .filter(Boolean)
    .filter((candidate) =>
      Boolean(candidate.offer_id)
      && Boolean(candidate.supplier_name)
      && number(candidate.effective_unit_cost || candidate.net_unit_cost) > 0
    );
}

function bestFinancialCurrentOffer(item, { preserveQuantity = false } = {}) {
  const neededQty = number(item?.needed_qty);
  const candidates = currentOfferCandidates(item)
    .filter((candidate) => candidate.quantity_fully_available !== false)
    .filter((candidate) => !preserveQuantity || Math.abs(number(candidate.purchase_qty || neededQty) - neededQty) <= 0.0001)
    .sort((a, b) =>
      number(a.effective_unit_cost || a.net_unit_cost) - number(b.effective_unit_cost || b.net_unit_cost)
      || number(a.cash_cost) - number(b.cash_cost)
      || String(a.supplier_name || '').localeCompare(String(b.supplier_name || ''), 'ar')
    );
  return candidates[0] || null;
}

function currentCandidateForSupplier(item, supplierName) {
  const target = String(supplierName || '').trim().toLowerCase();
  if (!target) return null;
  const candidates = currentOfferCandidates(item);
  return candidates.find((candidate) => String(candidate.supplier_name || '').trim().toLowerCase() === target) || null;
}

export function buildSupplierFinancialRows({ decision = null, historyRows = [], orderItems = [], branch = '' } = {}) {
  const history = new Map((historyRows || []).map((row) => [purchaseProductKey(row), row]));
  const orderItemMap = new Map((orderItems || []).map((row) => [purchaseProductKey(row), row]));
  const items = Array.isArray(decision?.items) ? decision.items : [];

  return items.map((item) => {
    const hist = history.get(purchaseProductKey(item)) || {};
    const orderItem = orderItemMap.get(purchaseProductKey(item)) || {};
    const recommended = item?.recommended || {};
    const financialOffer = bestFinancialCurrentOffer(item, { preserveQuantity: true }) || {};
    const quantity = number(item.needed_qty);
    const currentCashUnitCost = number(financialOffer.net_unit_cost || financialOffer.effective_unit_cost);
    const currentEffectiveCost = number(financialOffer.effective_unit_cost || financialOffer.net_unit_cost);
    const historicalCost = number(hist.historical_effective_unit_cost);
    const historicalLastCost = number(hist.historical_last_unit_cost || hist.last_purchase_price);
    const draftCost = number(orderItem.expected_unit_cost);
    const fallbackCost = draftCost > 0 ? draftCost : number(hist.planning_reference_unit_cost || hist.unit_cost);
    const hasCurrentOffer = Boolean(financialOffer.supplier_name) && currentCashUnitCost > 0;
    const currentOfferApplied =
      hasCurrentOffer
      && String(orderItem.supplier_offer_id || '') === String(financialOffer.offer_id || '')
      && orderItem.cost_source === 'supplier_offer';

    const supplierName = hasCurrentOffer
      ? financialOffer.supplier_name
      : hist.historical_supplier || '';

    const unitCost = hasCurrentOffer
      ? currentCashUnitCost
      : historicalCost > 0
        ? historicalCost
        : historicalLastCost > 0
          ? historicalLastCost
          : fallbackCost;

    const cashCost = hasCurrentOffer
      ? number(financialOffer.cash_cost) || quantity * currentCashUnitCost
      : quantity * unitCost;

    const source = hasCurrentOffer
      ? 'current_offer'
      : historicalCost > 0
        ? 'historical_average'
        : historicalLastCost > 0
          ? 'historical_last'
          : draftCost > 0
            ? 'draft_saved_cost'
            : fallbackCost > 0
              ? 'planner_reference'
              : 'missing';

    const listPrice = number(
      financialOffer.list_price
      || orderItem.public_price
      || orderItem.reference_unit_price
      || orderItem.list_price
      || hist.public_price
      || hist.list_price
      || hist.reference_price
    );
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
      cash_unit_cost: unitCost,
      effective_unit_cost: hasCurrentOffer ? currentEffectiveCost : historicalCost > 0 ? historicalCost : unitCost,
      cash_cost: cashCost,
      list_price: listPrice,
      discount_percent: financialOffer.discount_percent != null
        ? number(financialOffer.discount_percent)
        : orderItem.expected_discount != null
          ? number(orderItem.expected_discount)
          : null,
      extra_discount_percent: financialOffer.extra_discount_percent != null ? number(financialOffer.extra_discount_percent) : null,
      bonus_units: number(financialOffer.earned_bonus_units),
      received_units: number(financialOffer.received_units) || quantity,
      effective_saving_percent: effectiveSavingPercent,
      historical_supplier: hist.historical_supplier || '',
      historical_effective_unit_cost: historicalCost,
      historical_last_purchase_date: hist.historical_last_purchase_date || null,
      current_offer: hasCurrentOffer,
      current_offer_applied: currentOfferApplied,
      alternatives: item.alternatives || [],
      recommended,
      best_financial_offer: financialOffer,
      operational_recommended_supplier: recommended.supplier_name || '',
      operational_recommendation_reason: recommended.reason || '',
      financial_supplier_reason: hasCurrentOffer
        ? 'أقل تكلفة فعالة بين العروض الحالية المتاحة'
        : hist.historical_supplier
          ? 'أفضل مورد تاريخيًا حسب متوسط التكلفة الفعلية المتاح'
          : 'لا يوجد مورد مالي موثوق بعد',
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
      const currentAvailable = Boolean(current) && current.quantity_fully_available !== false;
      const currentPreservesQuantity = Boolean(current)
        && Math.abs(number(current.purchase_qty || quantity) - quantity) <= 0.0001;
      const currentSafe = currentAvailable && currentPreservesQuantity;
      const currentCashUnitCost = currentSafe ? number(current?.net_unit_cost || current?.effective_unit_cost) : 0;
      const currentEffectiveCost = currentSafe ? number(current?.effective_unit_cost || current?.net_unit_cost) : 0;
      const historicalCost = historicalMatch ? number(hist.historical_effective_unit_cost || hist.last_purchase_price) : 0;
      const unitCost = currentCashUnitCost > 0 ? currentCashUnitCost : historicalCost;
      const cashCost = currentSafe
        ? number(current.cash_cost) || quantity * currentCashUnitCost
        : quantity * unitCost;
      const constraint = current && !currentSafe
        ? !currentAvailable
          ? 'insufficient_availability'
          : !currentPreservesQuantity
            ? 'offer_changes_v10_quantity'
            : 'current_offer_not_safe'
        : '';

      return {
        branch,
        product_code: item.product_code,
        product_name: item.product_name,
        quantity,
        supplier_name: supplierName,
        coverage: currentSafe && currentCashUnitCost > 0
          ? 'current_offer'
          : historicalCost > 0
            ? 'historical_reference'
            : 'missing',
        constraint,
        unit_cost: unitCost,
        cash_unit_cost: unitCost,
        effective_unit_cost: currentSafe && currentEffectiveCost > 0 ? currentEffectiveCost : historicalCost || unitCost,
        cash_cost: cashCost,
        bonus_units: currentSafe ? number(current?.earned_bonus_units) : 0,
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


export function combineSingleSupplierScenarioSets(scenarioSets = []) {
  const suppliers = new Map();

  for (const scenario of (scenarioSets || []).flat()) {
    const name = String(scenario?.supplier_name || '').trim();
    if (!name) continue;
    if (!suppliers.has(name)) {
      suppliers.set(name, {
        supplier_name: name,
        items_count: 0,
        current_offer_items: 0,
        historical_reference_items: 0,
        missing_items: 0,
        estimated_total: 0,
        rows: [],
      });
    }
    const target = suppliers.get(name);
    target.items_count += number(scenario.items_count);
    target.current_offer_items += number(scenario.current_offer_items);
    target.historical_reference_items += number(scenario.historical_reference_items);
    target.missing_items += number(scenario.missing_items);
    target.estimated_total += number(scenario.estimated_total);
    target.rows.push(...(scenario.rows || []));
  }

  return [...suppliers.values()]
    .map((scenario) => ({
      ...scenario,
      estimated_total: Math.round(scenario.estimated_total * 100) / 100,
      current_coverage_percent: scenario.items_count
        ? (scenario.current_offer_items / scenario.items_count) * 100
        : 0,
      reference_coverage_percent: scenario.items_count
        ? ((scenario.current_offer_items + scenario.historical_reference_items) / scenario.items_count) * 100
        : 0,
    }))
    .sort((a, b) =>
      b.current_offer_items - a.current_offer_items
      || a.missing_items - b.missing_items
      || a.estimated_total - b.estimated_total
    );
}


export function buildSafeCurrentOfferPlan(decision = null, orderItems = []) {
  const items = Array.isArray(decision?.items) ? decision.items : [];
  const orderItemMap = new Map((orderItems || []).map((row) => [String(row.id || ''), row]));
  const applied = [];
  const skipped = [];

  for (const item of items) {
    const neededQty = number(item?.needed_qty);
    if (neededQty <= 0) continue;

    const allOffers = currentOfferCandidates(item);
    const availableOffers = allOffers.filter((candidate) => candidate.quantity_fully_available !== false);
    const quantityPreservingOffers = availableOffers.filter((candidate) =>
      Math.abs(number(candidate.purchase_qty || neededQty) - neededQty) <= 0.0001
    );
    const offer = [...quantityPreservingOffers].sort((a, b) =>
      number(a.effective_unit_cost || a.net_unit_cost) - number(b.effective_unit_cost || b.net_unit_cost)
      || number(a.cash_cost) - number(b.cash_cost)
    )[0] || null;

    const orderItem = orderItemMap.get(String(item.item_id || '')) || {};
    const alreadyApplied =
      Boolean(offer?.offer_id)
      && String(orderItem.supplier_offer_id || '') === String(offer.offer_id || '')
      && orderItem.cost_source === 'supplier_offer';

    if (offer?.offer_id && !alreadyApplied) {
      applied.push({
        item_id: item.item_id,
        offer_id: offer.offer_id,
      });
      continue;
    }

    let reason = 'not_safe_to_apply';
    if (alreadyApplied) reason = 'already_applied';
    else if (allOffers.length === 0) reason = 'no_current_offer';
    else if (availableOffers.length === 0) reason = 'insufficient_availability';
    else if (quantityPreservingOffers.length === 0) reason = 'offer_changes_v10_quantity';

    skipped.push({
      item_id: item.item_id,
      product_code: item.product_code,
      product_name: item.product_name,
      reason,
    });
  }

  const alreadyAppliedItems = skipped.filter((row) => row.reason === 'already_applied').length;
  const reviewItems = skipped.length - alreadyAppliedItems;

  return {
    items: applied,
    skipped,
    safe_items: applied.length,
    already_applied_items: alreadyAppliedItems,
    review_items: reviewItems,
    skipped_items: skipped.length,
    total_items: items.filter((item) => number(item?.needed_qty) > 0).length,
  };
}
