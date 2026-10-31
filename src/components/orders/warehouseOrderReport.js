const excludedStatuses = new Set(['تم الإلغاء', 'تم التوصيل', 'تم توفير بديل']);

export function buildWarehouseOrderReport(orders, { from = '', to = '', branch = 'all' } = {}) {
  const seen = new Set();
  const detail = [];
  const missingQuantity = [];
  const aggregate = new Map();
  for (const order of orders || []) {
    const date = String(order.needed_by_date || order.request_date || order.created_at || '').slice(0, 10);
    if ((from && date < from) || (to && date > to)) continue;
    if (branch !== 'all' && order.branch !== branch) continue;
    if (excludedStatuses.has(order.status) || order.alternative_accepted === true) continue;
    const id = String(order.id || `${order.order_group_id}:${order.line_no}`);
    if (seen.has(id)) continue;
    seen.add(id);
    const quantity = Number(order.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      missingQuantity.push(order);
      continue;
    }
    const supplied = Number(order.fulfilled_quantity || 0);
    if (!Number.isFinite(supplied) || supplied < 0 || supplied > quantity) {
      missingQuantity.push(order);
      continue;
    }
    const remaining = quantity - supplied;
    if (remaining === 0) continue;
    const name = String(order.product_name || '').trim();
    const unit = String(order.unit || '').trim();
    if (!name || !unit) { missingQuantity.push(order); continue; }
    const code = String(order.product_code || '').trim();
    const key = `${code || name.toLocaleLowerCase('en-US')}|${unit}`;
    const current = aggregate.get(key) || { 'اسم الصنف': name, 'كود الصنف': code, 'الوحدة': unit, 'الكمية المطلوبة': 0, 'عدد الطلبات': 0, 'أقرب موعد': date };
    current['الكمية المطلوبة'] += remaining;
    current['عدد الطلبات'] += 1;
    if (date && (!current['أقرب موعد'] || date < current['أقرب موعد'])) current['أقرب موعد'] = date;
    aggregate.set(key, current);
    detail.push({ 'رقم الطلبية': order.order_number || '', 'الفرع': order.branch || '', 'موعد احتياج العميل': date,
      'اسم الدكتور': order.recorded_by || '', 'اسم الصنف': name, 'كود الصنف': code,
      'الكمية المتبقية': remaining, 'الوحدة': unit, 'الأولوية': order.priority || '', 'الحالة': order.status || '' });
  }
  const summary = [...aggregate.values()].sort((a, b) => b['الكمية المطلوبة'] - a['الكمية المطلوبة']);
  return { summary, detail, missingQuantity };
}
