import { applyItemPurchaseLimits, resolveItemPurchaseLimits } from './purchasePolicyEngine.js';
import { explicitDiscountPercent, purchaseUnitCost } from './purchasePricing.js';

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

function hasPriorityException(row = {}) {
  return toNumber(row.customer_requests_count) > 0
    || toNumber(row.priority_score) >= 50
    || String(row.priority_label || '').includes('عاجل')
    || row.force_include === true;
}

export function calculatePurchaseNeed(row = {}, coverageDays = 7) {
  const savedTargetDays = Math.max(0, toNumber(row.target_coverage_days));
  const targetDays = savedTargetDays > 0 ? savedTargetDays : Math.max(1, toNumber(coverageDays) || 7);
  const currentStock = Math.max(0, toNumber(row.current_stock));
  const pendingIncoming = Math.max(0, toNumber(row.pending_incoming));
  const availableStock = currentStock + pendingIncoming;
  const averageDaily = estimateDailyUsage(row);
  const targetStock = Math.max(0, Math.ceil(Number((averageDaily * targetDays).toFixed(6))));
  const rawSuggestedQuantity = Math.max(0, targetStock - availableStock);
  const limitDecision = applyItemPurchaseLimits(rawSuggestedQuantity, row);
  const suggestedQuantity = limitDecision.blocked ? rawSuggestedQuantity : limitDecision.quantity;
  const projectedStock = availableStock + suggestedQuantity;
  const projectedCoverageDays = averageDaily > 0 ? projectedStock / averageDaily : 0;

  return {
    ...row,
    current_stock: currentStock,
    pending_incoming: pendingIncoming,
    avg_daily_usage: averageDaily,
    estimated_monthly_usage: averageDaily * 30,
    target_coverage_days: targetDays,
    target_stock: targetStock,
    available_stock: availableStock,
    raw_suggested_quantity: rawSuggestedQuantity,
    suggested_quantity: suggestedQuantity,
    item_minimum_quantity: limitDecision.minimum,
    item_maximum_quantity: limitDecision.maximum,
    purchase_limit_status: limitDecision.status,
    purchase_limit_adjusted: limitDecision.adjusted,
    purchase_limit_blocked: limitDecision.blocked,
    purchase_limit_reasons: limitDecision.reasons,
    projected_stock: projectedStock,
    projected_coverage_days: projectedCoverageDays,
    expected_discount: explicitDiscountPercent(row),
    coverage_policy_source: savedTargetDays > 0 ? 'saved_product_policy' : 'order_default',
    calculation_method: 'unified_final_coverage_v7_product_policy',
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
      customer_requests_count: Math.max(toNumber(current.customer_requests_count), toNumber(row.customer_requests_count)),
      priority_score: Math.max(toNumber(current.priority_score), toNumber(row.priority_score)),
      priority_label: current.priority_label || row.priority_label,
    });
  });
  return [...merged.values()];
}

export function buildPurchaseCandidates(rows = [], options = {}) {
  const coverageDays = Math.max(1, toNumber(options.coverage_days) || 7);
  const minimumMonthlySales = Math.max(0, toNumber(options.minimum_monthly_sales ?? 2));
  return mergePurchaseRows(rows)
    .map((row) => calculatePurchaseNeed(row, coverageDays))
    .filter((row) => row.avg_daily_usage > 0 && row.suggested_quantity > 0)
    .filter((row) => row.estimated_monthly_usage >= minimumMonthlySales || hasPriorityException(row))
    .map((row) => ({
      ...row,
      slow_mover_excluded_threshold: minimumMonthlySales,
      inclusion_reason: hasPriorityException(row)
        ? 'priority_exception'
        : row.estimated_monthly_usage >= minimumMonthlySales
          ? 'normal_usage'
          : 'excluded_slow_mover',
    }));
}

function isCritical(item) { return hasPriorityException(item); }

function packageStep(item) {
  const limits = resolveItemPurchaseLimits(item);
  return limits.has_package_multiple ? limits.package_multiple : 1;
}

function normalizeProtectedQuantity(value, item, desired) {
  const step = packageStep(item);
  const raw = Math.max(0, Math.ceil(toNumber(value)));
  if (!raw) return 0;
  return Math.min(desired, Math.ceil(raw / step) * step);
}

function protectedMinimum(item) {
  const desired=Math.max(0,Math.floor(toNumber(item.desired)));
  if(!desired) return 0;
  const configuredLimits=resolveItemPurchaseLimits(item);
  const configuredMinimum=configuredLimits.invalid_range ? 0 : normalizeProtectedQuantity(configuredLimits.minimum || 0,item,desired);
  const requests=Math.max(0,Math.ceil(toNumber(item.customer_requests_count)));
  if(requests>0) return normalizeProtectedQuantity(Math.max(configuredMinimum,1,requests),item,desired);
  if(isCritical(item)) return normalizeProtectedQuantity(Math.max(configuredMinimum,1),item,desired);
  const usage=Math.max(0,estimateDailyUsage(item));
  const available=Math.max(0,toNumber(item.available_stock));
  return normalizeProtectedQuantity(Math.max(configuredMinimum,Math.max(0,Math.ceil(usage*2)-available)),item,desired);
}

function marginalPriority(item,current) {
  const desired=Math.max(1,toNumber(item.desired));
  const requests=Math.max(0,toNumber(item.customer_requests_count));
  const score=Math.max(0,toNumber(item.priority_score));
  const usage=Math.max(0,estimateDailyUsage(item));
  const available=Math.max(0,toNumber(item.available_stock));
  const coverage=usage>0?(available+current)/usage:999;
  const shortage=Math.max(0,desired-current)/desired;
  return (requests>0?2200+requests*250:0)+(isCritical(item)?900:0)+(coverage<1?1500:coverage<2?900:coverage<3?450:0)+Math.min(500,usage*80)+shortage*350+score*15;
}

export function buildBudgetPlan(rows=[],budgetValue=0) {
  const budget=Math.max(0,toNumber(budgetValue));
  const source=rows.map((item)=>{const price=purchaseUnitCost(item);const desired=Math.max(0,Math.floor(toNumber(item.requested_quantity||item.suggested_quantity||item.approved_quantity)));return {...item,price,desired};}).filter((item)=>item.price>0&&item.desired>0);
  const fullTargetTotal=source.reduce((sum,item)=>sum+item.desired*item.price,0);
  const quantities=new Map(source.map((item)=>[item.id||normalizeProductKey(item),0]));
  let remaining=budget;
  if(budget>=fullTargetTotal&&fullTargetTotal>0){source.forEach((item)=>quantities.set(item.id||normalizeProductKey(item),item.desired));remaining=budget-fullTargetTotal;}
  else if(budget>0){
    const protectedQueue=source.map((item)=>({...item,protectedQty:protectedMinimum(item)})).filter((item)=>item.protectedQty>0).sort((a,b)=>marginalPriority(b,0)-marginalPriority(a,0)||a.price-b.price);
    let moved=true;
    while(moved&&remaining>0){moved=false;for(const item of protectedQueue){const key=item.id||normalizeProductKey(item);const current=quantities.get(key)||0;const step=packageStep(item);const stepCost=step*item.price;if(current>=item.protectedQty||current+step>item.protectedQty||stepCost>remaining) continue;quantities.set(key,current+step);remaining-=stepCost;moved=true;}}
    moved=true;
    while(moved&&remaining>0){moved=false;const candidates=source.map((item)=>{const key=item.id||normalizeProductKey(item);const current=quantities.get(key)||0;const step=packageStep(item);const stepCost=step*item.price;const priority=marginalPriority(item,current);return {...item,key,current,step,stepCost,priority,valueScore:priority/Math.max(1,Math.sqrt(stepCost))};}).filter((item)=>item.current<item.desired&&item.current+item.step<=item.desired&&item.stepCost<=remaining).sort((a,b)=>b.valueScore-a.valueScore||b.priority-a.priority||a.stepCost-b.stepCost);if(!candidates.length) break;const best=candidates[0];quantities.set(best.key,best.current+best.step);remaining-=best.stepCost;moved=true;}
  }
  const plannedRows=rows.map((item)=>{const key=item.id||normalizeProductKey(item);const approvedQuantity=quantities.get(key)||0;const price=purchaseUnitCost(item);const desired=Math.max(0,toNumber(item.requested_quantity||item.suggested_quantity||item.approved_quantity));const protectedQty=protectedMinimum({...item,desired});return {...item,approved_quantity:approvedQuantity,budget_line_total:approvedQuantity*price,original_desired_quantity:desired,protected_minimum_quantity:protectedQty,protected_minimum_met:approvedQuantity>=protectedQty,budget_reduction_percent:desired>0?Number((((desired-approvedQuantity)/desired)*100).toFixed(1)):0,budget_distribution_method:'protected_priority_marginal_value_v5'};});
  const total=plannedRows.reduce((sum,item)=>sum+toNumber(item.budget_line_total),0);const activeRows=plannedRows.filter((item)=>toNumber(item.approved_quantity)>0);const zeroedRows=plannedRows.filter((item)=>toNumber(item.approved_quantity)===0&&toNumber(item.requested_quantity||item.suggested_quantity)>0);const reducedRows=plannedRows.filter((item)=>toNumber(item.approved_quantity)<toNumber(item.requested_quantity||item.suggested_quantity));const unmet=plannedRows.filter((item)=>!item.protected_minimum_met&&toNumber(item.protected_minimum_quantity)>0);
  return {rows:plannedRows,budget,full_target_total:fullTargetTotal,budget_ratio:fullTargetTotal>0?budget/fullTargetTotal:0,total,remaining:Math.max(0,budget-total),utilization_percent:budget>0?Number(((total/budget)*100).toFixed(1)):0,active_items:activeRows.length,retained_items_percent:source.length?Number(((activeRows.length/source.length)*100).toFixed(1)):0,total_quantity:activeRows.reduce((sum,item)=>sum+toNumber(item.approved_quantity),0),reduced_items:reducedRows.length,zeroed_items:zeroedRows.length,protected_items_unmet:unmet.length,missing_price_items:rows.filter((item)=>toNumber(item.expected_unit_cost||item.last_purchase_price)<=0).length,distribution_method:'protected_priority_marginal_value_v5'};
}
