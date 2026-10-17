const EPSILON = 0.0001;
const MAX_SUBSET_CANDIDATES = 14;

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function unique(values = []) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function nearlyEqual(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= EPSILON;
}

function exactCode(item) {
  const codes = unique([...(item?.sale_codes || []), ...(item?.purchase_codes || [])]);
  return codes.length === 1 ? codes[0] : null;
}

function lineTimes(item) {
  return [...(item?.sale_lines || []), ...(item?.purchase_lines || [])]
    .map((line) => Number(line?.timestamp_ms))
    .filter(Number.isFinite);
}

function caseStart(item) {
  const times = lineTimes(item);
  return times.length ? Math.min(...times) : null;
}

function caseEnd(item) {
  const times = lineTimes(item);
  return times.length ? Math.max(...times) : null;
}

function minuteGap(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(a - b) / 60000;
}

function calendarDayNumber(timestamp) {
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

function laterSameOrNextDay(anchorEnd, candidateStart) {
  if (!Number.isFinite(anchorEnd) || !Number.isFinite(candidateStart) || candidateStart < anchorEnd) return false;
  const anchorDay = calendarDayNumber(anchorEnd);
  const candidateDay = calendarDayNumber(candidateStart);
  if (anchorDay == null || candidateDay == null) return false;
  const dayGap = candidateDay - anchorDay;
  return dayGap === 0 || dayGap === 1;
}

function sameJourneyIdentity(a, b) {
  const codeA = exactCode(a);
  const codeB = exactCode(b);
  return Boolean(codeA && codeB && codeA === codeB && a?.from === b?.from && a?.to === b?.to);
}

function unitFamily(value) {
  const unit = text(value).toLowerCase();
  if (!unit) return null;
  if (/علب|box|pack/.test(unit)) return 'box';
  if (/شريط|strip/.test(unit)) return 'strip';
  if (/سرنج|syringe/.test(unit)) return 'syringe';
  if (/امبول|ampoule|amp\b/.test(unit)) return 'ampoule';
  if (/فيال|vial/.test(unit)) return 'vial';
  if (/كيس|sachet/.test(unit)) return 'sachet';
  if (/قطعه|piece|pcs?/.test(unit)) return 'piece';
  return null;
}

function possibleExplicitUnitConversion(anchor) {
  const sale = Number(anchor?.sale_qty || 0);
  const purchase = Number(anchor?.purchase_qty || 0);
  if (sale <= EPSILON || purchase <= EPSILON || !exactCode(anchor)) return false;
  const saleFamily = unitFamily(anchor?.sale_units?.[0]);
  const purchaseFamily = unitFamily(anchor?.purchase_units?.[0]);
  if (!saleFamily || !purchaseFamily || saleFamily === purchaseFamily) return false;
  if (saleFamily !== 'box' && purchaseFamily !== 'box') return false;
  const ratio = Math.max(sale, purchase) / Math.min(sale, purchase);
  const rounded = Math.round(ratio);
  return rounded >= 2 && rounded <= 12 && Math.abs(ratio - rounded) <= Math.max(0.06, rounded * 0.03);
}

function trustedCanonicalSide(item, side) {
  const quantity = item?.[`${side}_quantity`];
  if (!quantity || quantity.canonical_unit !== 'box') return false;
  if (!['high', 'confirmed'].includes(quantity.conversion_confidence)) return false;
  return Number.isFinite(Number(quantity.canonical_qty));
}

function trustedCanonicalComparable(item) {
  return Boolean(
    item?.canonical_quantity_comparable
    && trustedCanonicalSide(item, 'sale')
    && trustedCanonicalSide(item, 'purchase')
    && !item?.packaging_conflict,
  );
}

function settlementQty(item, side, basis = 'raw') {
  const raw = Number(side === 'purchase' ? item?.purchase_qty : item?.sale_qty) || 0;
  if (raw <= EPSILON) return 0;
  if (basis !== 'canonical_box') return raw;
  if (!trustedCanonicalSide(item, side)) return NaN;
  return Number(item?.[`${side}_quantity`]?.canonical_qty);
}

function neededResidual(anchor) {
  const basis = trustedCanonicalComparable(anchor) ? 'canonical_box' : 'raw';
  const sale = settlementQty(anchor, 'sale', basis);
  const purchase = settlementQty(anchor, 'purchase', basis);
  if (!Number.isFinite(sale) || !Number.isFinite(purchase)) return null;
  const diff = sale - purchase;
  if (Math.abs(diff) <= EPSILON) return null;
  return diff > 0
    ? { side: 'purchase', qty: diff, basis }
    : { side: 'sale', qty: Math.abs(diff), basis };
}

function isPureMissingSide(item, side) {
  if (side === 'purchase') {
    return Number(item?.sale_qty || 0) <= EPSILON
      && Number(item?.purchase_qty || 0) > EPSILON
      && item?.type === 'purchase_without_sale';
  }
  return Number(item?.purchase_qty || 0) <= EPSILON
    && Number(item?.sale_qty || 0) > EPSILON
    && item?.type === 'sale_without_purchase';
}

function candidateQty(item, side, basis = 'raw') {
  return settlementQty(item, side, basis);
}

function mergeLines(items, field) {
  return items.flatMap((item) => item?.[field] || []);
}

function mergedTimeGap(saleLines, purchaseLines) {
  const saleTimes = saleLines.map((line) => Number(line?.timestamp_ms)).filter(Number.isFinite);
  const purchaseTimes = purchaseLines.map((line) => Number(line?.timestamp_ms)).filter(Number.isFinite);
  if (!saleTimes.length || !purchaseTimes.length) return null;
  return Math.abs(Math.min(...saleTimes) - Math.min(...purchaseTimes)) / 60000;
}

function candidateEvidence(anchorEnd, candidate, side, basis = 'raw') {
  const timestamp = caseStart(candidate.item);
  const qty = candidateQty(candidate.item, side, basis);
  return {
    case_id: candidate.item?.id || null,
    invoice_numbers: unique([...(candidate.item?.sale_invoices || []), ...(candidate.item?.purchase_invoices || [])]),
    qty: Number(Number(qty || 0).toFixed(3)),
    quantity_basis: basis,
    users: unique([...(candidate.item?.sale_users || []), ...(candidate.item?.purchase_users || [])]),
    timestamp_ms: timestamp,
    gap_minutes: Number((minuteGap(anchorEnd, timestamp) || 0).toFixed(1)),
    next_day: calendarDayNumber(timestamp) > calendarDayNumber(anchorEnd),
  };
}

function exactSubsets(candidates, side, target, basis = 'raw') {
  if (!candidates.length || candidates.length > MAX_SUBSET_CANDIDATES) return [];
  const solutions = [];

  function walk(index, total, chosen) {
    if (solutions.length >= 2) return;
    if (nearlyEqual(total, target)) {
      solutions.push([...chosen]);
      return;
    }
    if (index >= candidates.length || total > target + EPSILON) return;

    for (let i = index; i < candidates.length; i += 1) {
      const qty = candidateQty(candidates[i].item, side, basis);
      if (!Number.isFinite(qty) || qty <= EPSILON || total + qty > target + EPSILON) continue;
      chosen.push(candidates[i]);
      walk(i + 1, total + qty, chosen);
      chosen.pop();
      if (solutions.length >= 2) return;
    }
  }

  walk(0, 0, []);
  return solutions;
}

function buildCompletedCase(items, { needed, settlementItems, anchorEnd }) {
  const anchor = items.find((item) => item.type === 'quantity_mismatch') || items[0];
  const saleLines = mergeLines(items, 'sale_lines');
  const purchaseLines = mergeLines(items, 'purchase_lines');
  const saleQty = items.reduce((sum, item) => sum + Number(item?.sale_qty || 0), 0);
  const purchaseQty = items.reduce((sum, item) => sum + Number(item?.purchase_qty || 0), 0);
  const settledSaleQty = items.reduce((sum, item) => sum + settlementQty(item, 'sale', needed.basis), 0);
  const settledPurchaseQty = items.reduce((sum, item) => sum + settlementQty(item, 'purchase', needed.basis), 0);
  const saleInvoices = unique(items.flatMap((item) => item?.sale_invoices || []));
  const purchaseInvoices = unique(items.flatMap((item) => item?.purchase_invoices || []));
  const gap = mergedTimeGap(saleLines, purchaseLines);
  const settlementNextDay = settlementItems.some((entry) => calendarDayNumber(caseStart(entry.item)) > calendarDayNumber(anchorEnd));
  const settlementCount = settlementItems.length;
  const basisLabel = needed.basis === 'canonical_box' ? 'بعد توحيد الوحدة إلى علبة' : 'على الكمية المسجلة';
  const reasons = unique([
    ...items.map((item) => item?.match_reason),
    `اكتملت الكمية من ${settlementCount} حركة لاحقة لنفس الكود ${settlementNextDay ? 'في نفس اليوم أو اليوم التالي' : 'في نفس اليوم'} ${basisLabel}`,
  ]);
  return {
    ...anchor,
    id: [anchor?.from || 'unknown', anchor?.to || 'unknown', exactCode(anchor) || 'unknown', saleInvoices.join('+') || 'no-sale', purchaseInvoices.join('+') || 'no-purchase', 'completed'].join('::'),
    type: 'matched',
    severity: 0,
    sale_qty: saleQty,
    purchase_qty: purchaseQty,
    sale_invoices: saleInvoices,
    purchase_invoices: purchaseInvoices,
    sale_users: unique(items.flatMap((item) => item?.sale_users || [])),
    purchase_users: unique(items.flatMap((item) => item?.purchase_users || [])),
    sale_lines: saleLines,
    purchase_lines: purchaseLines,
    match_confidence: 'high',
    confidence_score: settlementNextDay ? 92 : 94,
    match_reason: reasons.join(' · '),
    time_gap_minutes: gap == null ? null : Number(gap.toFixed(1)),
    episode_balanced: true,
    residual_journey_completed: true,
    residual_completion_policy: needed.basis === 'canonical_box'
      ? 'exact-code + trusted-canonical-box + exact-cumulative-residual + same-direction + later-same-or-next-day + unique-settlement'
      : 'exact-code + exact-cumulative-residual + same-direction + later-same-or-next-day + unique-settlement',
    residual_quantity_basis: needed.basis,
    residual_component_case_ids: items.map((item) => item?.id).filter(Boolean),
    residual_settlement_count: settlementCount,
    residual_settlement_side: needed.side,
    residual_settlement_qty: Number(needed.qty.toFixed(3)),
    residual_settlement_next_day: settlementNextDay,
    residual_settlement_candidates: settlementItems.map((candidate) => candidateEvidence(anchorEnd, candidate, needed.side, needed.basis)),
    ...(needed.basis === 'canonical_box' ? {
      canonical_quantity_comparable: true,
      canonical_sale_qty: Number(settledSaleQty.toFixed(4)),
      canonical_purchase_qty: Number(settledPurchaseQty.toFixed(4)),
    } : {}),
    next_action: 'لا يوجد إجراء مطلوب؛ اكتملت الكمية بعد فهم رحلة التحويل الموزعة على أكثر من تسجيل.',
  };
}

function partialProgressEvidence(anchor, needed, candidates, anchorEnd) {
  const progressQty = candidates.reduce((sum, candidate) => sum + candidateQty(candidate.item, needed.side, needed.basis), 0);
  if (progressQty <= EPSILON || progressQty >= needed.qty - EPSILON) return null;
  return {
    residual_progress_status: 'partial',
    residual_needed_side: needed.side,
    residual_needed_qty: Number(needed.qty.toFixed(3)),
    residual_progress_side: needed.side,
    residual_progress_qty: Number(progressQty.toFixed(3)),
    residual_remaining_qty: Number((needed.qty - progressQty).toFixed(3)),
    residual_quantity_basis: needed.basis,
    residual_progress_candidate_count: candidates.length,
    residual_progress_candidates: candidates.map((candidate) => candidateEvidence(anchorEnd, candidate, needed.side, needed.basis)),
    residual_review_reason: `ظهر لاحقًا ${Number(progressQty.toFixed(3))} من أصل فرق ${Number(needed.qty.toFixed(3))} لنفس الكود؛ المتبقي ${Number((needed.qty - progressQty).toFixed(3))} يحتاج مراجعة.`,
    next_action: `راجع فقط المتبقي ${Number((needed.qty - progressQty).toFixed(3))} بعد احتساب الحركات اللاحقة لنفس الكود.`,
  };
}

export function completeResidualBalancedJourneys(cases = []) {
  const consumed = new Set();
  const completed = [];
  const reviewEvidence = new Map();

  cases.forEach((anchor, anchorIndex) => {
    if (consumed.has(anchorIndex) || anchor?.type !== 'quantity_mismatch') return;
    const needed = neededResidual(anchor);
    if (!needed) return;
    if (needed.basis === 'raw' && possibleExplicitUnitConversion(anchor)) {
      reviewEvidence.set(anchorIndex, {
        residual_review_reason: 'الوحدات تشير لاحتمال تحويل عبوة واضح؛ تم منع إغلاق فرق الكمية بالحركات اللاحقة حتى اعتماد علاقة العبوة أولًا.',
        residual_unit_conversion_guard: true,
      });
      return;
    }
    const anchorEnd = caseEnd(anchor);
    if (!Number.isFinite(anchorEnd)) return;

    const candidates = cases
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => {
        if (index === anchorIndex || consumed.has(index)) return false;
        if (!sameJourneyIdentity(anchor, item) || !isPureMissingSide(item, needed.side)) return false;
        const qty = candidateQty(item, needed.side, needed.basis);
        return Number.isFinite(qty)
          && qty > EPSILON
          && qty <= needed.qty + EPSILON
          && Number.isFinite(caseStart(item))
          && laterSameOrNextDay(anchorEnd, caseStart(item));
      })
      .sort((a, b) => caseStart(a.item) - caseStart(b.item));

    if (!candidates.length) return;

    if (candidates.length > MAX_SUBSET_CANDIDATES) {
      reviewEvidence.set(anchorIndex, {
        residual_needed_side: needed.side,
        residual_needed_qty: Number(needed.qty.toFixed(3)),
        residual_quantity_basis: needed.basis,
        residual_candidate_count: candidates.length,
        residual_candidates: candidates.map((candidate) => candidateEvidence(anchorEnd, candidate, needed.side, needed.basis)),
        residual_review_reason: 'يوجد عدد كبير من الحركات اللاحقة لنفس الكود؛ تم ترك الحالة للمراجعة بدل اختيار تسوية تلقائية.',
      });
      return;
    }

    const solutions = exactSubsets(candidates, needed.side, needed.qty, needed.basis);
    if (solutions.length > 1) {
      reviewEvidence.set(anchorIndex, {
        residual_needed_side: needed.side,
        residual_needed_qty: Number(needed.qty.toFixed(3)),
        residual_quantity_basis: needed.basis,
        residual_candidate_count: candidates.length,
        residual_candidates: candidates.map((candidate) => candidateEvidence(anchorEnd, candidate, needed.side, needed.basis)),
        residual_exact_solution_count: solutions.length,
        residual_review_reason: 'يوجد أكثر من مجموعة حركات لاحقة يمكنها إكمال نفس الفرق؛ لم يتم اختيار أي مجموعة تلقائيًا.',
      });
      return;
    }

    if (solutions.length === 1) {
      const settlementItems = solutions[0];
      const merged = buildCompletedCase([anchor, ...settlementItems.map((entry) => entry.item)], { needed, settlementItems, anchorEnd });
      const mergedSale = needed.basis === 'canonical_box' ? merged.canonical_sale_qty : merged.sale_qty;
      const mergedPurchase = needed.basis === 'canonical_box' ? merged.canonical_purchase_qty : merged.purchase_qty;
      if (!nearlyEqual(mergedSale, mergedPurchase)) return;
      consumed.add(anchorIndex);
      settlementItems.forEach((entry) => consumed.add(entry.index));
      completed.push(merged);
      return;
    }

    const totalCandidateQty = candidates.reduce((sum, candidate) => sum + candidateQty(candidate.item, needed.side, needed.basis), 0);
    if (totalCandidateQty < needed.qty - EPSILON) {
      const progress = partialProgressEvidence(anchor, needed, candidates, anchorEnd);
      if (progress) reviewEvidence.set(anchorIndex, progress);
      return;
    }

    reviewEvidence.set(anchorIndex, {
      residual_needed_side: needed.side,
      residual_needed_qty: Number(needed.qty.toFixed(3)),
      residual_quantity_basis: needed.basis,
      residual_candidate_count: candidates.length,
      residual_candidates: candidates.map((candidate) => candidateEvidence(anchorEnd, candidate, needed.side, needed.basis)),
      residual_review_reason: 'توجد حركات لاحقة لنفس الكود، لكن تجميعها لا يعطي تسوية وحيدة مساوية للفرق؛ تحتاج مراجعة بشرية.',
    });
  });

  return [
    ...cases
      .map((item, index) => reviewEvidence.has(index) ? { ...item, ...reviewEvidence.get(index) } : item)
      .filter((_, index) => !consumed.has(index)),
    ...completed,
  ].sort((a, b) => Number(b?.severity || 0) - Number(a?.severity || 0)
    || Number(b?.confidence_score || 0) - Number(a?.confidence_score || 0)
    || String(a?.product_name || '').localeCompare(String(b?.product_name || ''), 'ar'));
}
