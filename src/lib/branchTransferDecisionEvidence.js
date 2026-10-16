function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function unique(values = []) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nearlyEqual(a, b, tolerance = 0.0001) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= tolerance;
}

function expiries(lines = []) {
  return unique(lines.map((line) => line?.raw?.expiration_raw ?? line?.expiration_raw ?? line?.raw?.expiration ?? line?.raw?.expiry));
}

function invoiceCount(item, side) {
  return unique(side === 'sale' ? item?.sale_invoices : item?.purchase_invoices).length;
}

function lineCount(item, side) {
  return Array.isArray(side === 'sale' ? item?.sale_lines : item?.purchase_lines)
    ? (side === 'sale' ? item.sale_lines.length : item.purchase_lines.length)
    : 0;
}

function identityEvidence(item) {
  const saleCodes = unique(item?.sale_codes || []);
  const purchaseCodes = unique(item?.purchase_codes || []);
  const exactCodes = saleCodes.filter((code) => purchaseCodes.includes(code));
  if (item?.type === 'code_mismatch' || item?.identity_diagnosis) {
    return {
      status: 'conflict', score: 0,
      label: 'هوية الصنف متعارضة',
      detail: saleCodes.length && purchaseCodes.length
        ? `كود البيع ${saleCodes.join('، ')} مقابل كود الشراء ${purchaseCodes.join('، ')}`
        : 'الاسم وحده لا يكفي لاعتماد نفس الصنف.',
    };
  }
  if (exactCodes.length) return { status: 'strong', score: 100, label: 'هوية الصنف مؤكدة', detail: `نفس الكود: ${exactCodes.join('، ')}` };
  if (text(item?.sale_product_name) && text(item?.purchase_product_name)) {
    return { status: 'review', score: 70, label: 'هوية الصنف مرجحة', detail: 'المطابقة تعتمد على الاسم/التوقيع وليس كودًا مشتركًا.' };
  }
  return { status: 'missing', score: 25, label: 'هوية غير مكتملة', detail: 'أحد الطرفين غير موجود أو بيانات الهوية ناقصة.' };
}

function quantityEvidence(item) {
  const sale = finite(item?.sale_qty) ?? 0;
  const purchase = finite(item?.purchase_qty) ?? 0;
  const saleLines = lineCount(item, 'sale');
  const purchaseLines = lineCount(item, 'purchase');
  const saleExpiries = expiries(item?.sale_lines || []);
  const purchaseExpiries = expiries(item?.purchase_lines || []);
  if (nearlyEqual(sale, purchase) && sale > 0 && purchase > 0) {
    const consolidation = saleLines > 1 || purchaseLines > 1;
    const expiryNote = saleExpiries.length > 1 || purchaseExpiries.length > 1
      ? ' مع صلاحيات/باتشات متعددة محفوظة كأدلة منفصلة.' : '';
    return {
      status: 'balanced', score: 100,
      label: 'الكمية متوازنة',
      detail: consolidation ? `إجمالي البيع ${sale} = إجمالي الشراء ${purchase} بعد تجميع السطور.${expiryNote}` : `بيع ${sale} = شراء ${purchase}.`,
      consolidated: consolidation,
      sale_line_count: saleLines,
      purchase_line_count: purchaseLines,
      sale_expiries: saleExpiries,
      purchase_expiries: purchaseExpiries,
    };
  }
  const diff = Math.abs(sale - purchase);
  return {
    status: 'mismatch', score: 20,
    label: 'فرق كمية يحتاج مراجعة',
    detail: `بيع ${sale} مقابل شراء ${purchase} — الفرق ${Number(diff.toFixed(3))}.`,
    consolidated: saleLines > 1 || purchaseLines > 1,
    sale_line_count: saleLines,
    purchase_line_count: purchaseLines,
    sale_expiries: saleExpiries,
    purchase_expiries: purchaseExpiries,
  };
}

function timeEvidence(item) {
  const gap = finite(item?.time_gap_minutes);
  if (gap == null) return { status: 'unknown', score: 45, label: 'الزمن غير مكتمل', detail: 'وقت أحد الطرفين غير متاح.' };
  if (gap <= 30) return { status: 'strong', score: 100, label: 'الترابط الزمني قوي جدًا', detail: `${Math.round(gap)} دقيقة بين الطرفين.` };
  if (gap <= 120) return { status: 'strong', score: 90, label: 'الترابط الزمني قوي', detail: `${Math.round(gap)} دقيقة بين الطرفين.` };
  if (gap <= 480) return { status: 'medium', score: 72, label: 'الترابط الزمني مقبول', detail: `${Math.round(gap)} دقيقة بين الطرفين.` };
  return { status: 'weak', score: 45, label: 'الفارق الزمني كبير', detail: `${Math.round(gap)} دقيقة بين الطرفين ويحتاج قرائن إضافية.` };
}

function actorEvidence(item) {
  const sellers = unique(item?.sale_users || []);
  const buyers = unique(item?.purchase_users || []);
  if (sellers.length && buyers.length) {
    return { status: 'complete', score: 100, label: 'الأطراف معروفة', detail: `البائع: ${sellers.join('، ')} · المشتري: ${buyers.join('، ')}`, sellers, buyers };
  }
  if (sellers.length || buyers.length) {
    return { status: 'partial', score: 70, label: 'هوية المستخدم جزئية', detail: sellers.length ? `البائع معروف: ${sellers.join('، ')} · المشتري غير متاح` : `المشتري معروف: ${buyers.join('، ')} · البائع غير متاح`, sellers, buyers };
  }
  return { status: 'missing', score: 30, label: 'المستخدم غير متاح', detail: 'لا يوجد اسم مستخدم موثوق في الأدلة الحالية.', sellers, buyers };
}

function journeyEvidence(item) {
  const saleInvoices = invoiceCount(item, 'sale');
  const purchaseInvoices = invoiceCount(item, 'purchase');
  const balancedEpisode = Boolean(item?.episode_balanced);
  if (balancedEpisode || saleInvoices > 1 || purchaseInvoices > 1) {
    const shape = saleInvoices === 1 && purchaseInvoices > 1 ? 'بيع واحد → عدة مشتريات'
      : saleInvoices > 1 && purchaseInvoices === 1 ? 'عدة مبيعات → شراء واحد'
        : `${saleInvoices || 0} بيع ↔ ${purchaseInvoices || 0} شراء`;
    return { status: 'episode', score: balancedEpisode ? 98 : 82, label: 'رحلة مركبة مفهومة', detail: `${shape}${balancedEpisode ? ' ومتوازنة كدفعة واحدة.' : '.'}`, sale_invoices: saleInvoices, purchase_invoices: purchaseInvoices };
  }
  return { status: 'simple', score: 95, label: 'رحلة مباشرة', detail: 'مطابقة فاتورة/حركة مباشرة.', sale_invoices: saleInvoices, purchase_invoices: purchaseInvoices };
}

export function buildDecisionEvidence(item = {}) {
  const identity = identityEvidence(item);
  const quantity = quantityEvidence(item);
  const time = timeEvidence(item);
  const actor = actorEvidence(item);
  const journey = journeyEvidence(item);

  let decision = 'review';
  if (identity.status === 'conflict') decision = 'identity_review';
  else if (item?.type === 'matched' && quantity.status === 'balanced') decision = 'matched';
  else if (item?.type === 'unit_conversion_review') decision = 'unit_review';
  else if (quantity.status === 'mismatch') decision = 'quantity_review';
  else if (!item?.sale_lines?.length || !item?.purchase_lines?.length) decision = 'missing_side';

  const weighted = Math.round(
    identity.score * 0.38
    + quantity.score * 0.30
    + time.score * 0.17
    + journey.score * 0.10
    + actor.score * 0.05,
  );
  const decisionScore = decision === 'identity_review' ? Math.min(weighted, 45)
    : decision === 'matched' ? Math.max(weighted, 92)
      : weighted;

  const explanation = decision === 'matched'
    ? quantity.consolidated ? 'مطابق بعد فهم الفاتورة وتجميع سطور نفس الصنف قبل المقارنة.' : 'مطابق؛ الهوية والكمية والرحلة متوافقة.'
    : decision === 'identity_review' ? 'لا يتم دمج الصنف تلقائيًا لأن هوية الكود متعارضة.'
      : decision === 'quantity_review' ? 'ظل فرق الكمية موجودًا بعد تجميع سطور الفاتورة، لذلك يحتاج مراجعة فعلية.'
        : decision === 'missing_side' ? 'أحد طرفي الرحلة غير موجود في الأدلة الحالية.'
          : decision === 'unit_review' ? 'الفرق قد يكون تحويل عبوة/وحدة ويحتاج تأكيد العلاقة.'
            : 'الحالة تحتاج مراجعة الأدلة قبل اعتماد قرار.';

  return {
    decision,
    decision_score: Math.max(0, Math.min(100, decisionScore)),
    explanation,
    identity,
    quantity,
    time,
    actor,
    journey,
  };
}
