import fs from 'node:fs';
const p='src/lib/purchasePlanning.js';
let s=fs.readFileSync(p,'utf8');
if(s.includes('protected_priority_marginal_value_v5')) process.exit(0);
const i=s.indexOf('function isCritical(item)');
if(i<0) throw new Error('anchor missing');
const prefix=s.slice(0,i);
const tail=`function isCritical(item) { return hasPriorityException(item); }

function protectedMinimum(item) {
  const desired=Math.max(0,Math.floor(toNumber(item.desired)));
  if(!desired) return 0;
  const requests=Math.max(0,Math.ceil(toNumber(item.customer_requests_count)));
  if(requests>0) return Math.min(desired,Math.max(1,requests));
  if(isCritical(item)) return 1;
  const usage=Math.max(0,estimateDailyUsage(item));
  const available=Math.max(0,toNumber(item.available_stock));
  return Math.min(desired,Math.max(0,Math.ceil(usage*2)-available));
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
  const source=rows.map((item)=>{const price=netPurchasePrice(item);const desired=Math.max(0,Math.floor(toNumber(item.requested_quantity||item.suggested_quantity||item.approved_quantity)));return {...item,price,desired};}).filter((item)=>item.price>0&&item.desired>0);
  const fullTargetTotal=source.reduce((sum,item)=>sum+item.desired*item.price,0);
  const quantities=new Map(source.map((item)=>[item.id||normalizeProductKey(item),0]));
  let remaining=budget;
  if(budget>=fullTargetTotal&&fullTargetTotal>0){source.forEach((item)=>quantities.set(item.id||normalizeProductKey(item),item.desired));remaining=budget-fullTargetTotal;}
  else if(budget>0){
    const protectedQueue=source.map((item)=>({...item,protectedQty:protectedMinimum(item)})).filter((item)=>item.protectedQty>0).sort((a,b)=>marginalPriority(b,0)-marginalPriority(a,0)||a.price-b.price);
    let moved=true;
    while(moved&&remaining>0){moved=false;for(const item of protectedQueue){const key=item.id||normalizeProductKey(item);const current=quantities.get(key)||0;if(current>=item.protectedQty||item.price>remaining) continue;quantities.set(key,current+1);remaining-=item.price;moved=true;}}
    moved=true;
    while(moved&&remaining>0){moved=false;const candidates=source.map((item)=>{const key=item.id||normalizeProductKey(item);const current=quantities.get(key)||0;const priority=marginalPriority(item,current);return {...item,key,current,priority,valueScore:priority/Math.max(1,Math.sqrt(item.price))};}).filter((item)=>item.current<item.desired&&item.price<=remaining).sort((a,b)=>b.valueScore-a.valueScore||b.priority-a.priority||a.price-b.price);if(!candidates.length) break;const best=candidates[0];quantities.set(best.key,best.current+1);remaining-=best.price;moved=true;}
  }
  const plannedRows=rows.map((item)=>{const key=item.id||normalizeProductKey(item);const approvedQuantity=quantities.get(key)||0;const price=netPurchasePrice(item);const desired=Math.max(0,toNumber(item.requested_quantity||item.suggested_quantity||item.approved_quantity));const protectedQty=protectedMinimum({...item,desired});return {...item,approved_quantity:approvedQuantity,budget_line_total:approvedQuantity*price,original_desired_quantity:desired,protected_minimum_quantity:protectedQty,protected_minimum_met:approvedQuantity>=protectedQty,budget_reduction_percent:desired>0?Number((((desired-approvedQuantity)/desired)*100).toFixed(1)):0,budget_distribution_method:'protected_priority_marginal_value_v5'};});
  const total=plannedRows.reduce((sum,item)=>sum+toNumber(item.budget_line_total),0);const activeRows=plannedRows.filter((item)=>toNumber(item.approved_quantity)>0);const zeroedRows=plannedRows.filter((item)=>toNumber(item.approved_quantity)===0&&toNumber(item.requested_quantity||item.suggested_quantity)>0);const reducedRows=plannedRows.filter((item)=>toNumber(item.approved_quantity)<toNumber(item.requested_quantity||item.suggested_quantity));const unmet=plannedRows.filter((item)=>!item.protected_minimum_met&&toNumber(item.protected_minimum_quantity)>0);
  return {rows:plannedRows,budget,full_target_total:fullTargetTotal,budget_ratio:fullTargetTotal>0?budget/fullTargetTotal:0,total,remaining:Math.max(0,budget-total),utilization_percent:budget>0?Number(((total/budget)*100).toFixed(1)):0,active_items:activeRows.length,retained_items_percent:source.length?Number(((activeRows.length/source.length)*100).toFixed(1)):0,total_quantity:activeRows.reduce((sum,item)=>sum+toNumber(item.approved_quantity),0),reduced_items:reducedRows.length,zeroed_items:zeroedRows.length,protected_items_unmet:unmet.length,missing_price_items:rows.filter((item)=>toNumber(item.expected_unit_cost||item.last_purchase_price)<=0).length,distribution_method:'protected_priority_marginal_value_v5'};
}
`;
fs.writeFileSync(p,prefix+tail);
console.log('Smart budget allocator v5 applied');
