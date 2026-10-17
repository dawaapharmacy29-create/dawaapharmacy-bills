function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function unique(values = []) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function validTimestamp(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function collectSideLines(incident, side) {
  const key = side === 'sale' ? 'sale_lines' : 'purchase_lines';
  return (incident?.cases || []).flatMap((item) => item?.[key] || []);
}

function formatClock(date) {
  return new Intl.DateTimeFormat('ar-EG', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function invoicePrefix(invoices = []) {
  if (invoices.length === 1) return `فاتورة ${invoices[0]} · `;
  if (invoices.length > 1) return `فواتير ${invoices.join('، ')} · `;
  return '';
}

function lineActor(line, side) {
  if (side === 'sale') return cleanText(line?.sale_actor || line?.invoice_header_user || line?.user);
  return cleanText(line?.user);
}

function lineTimestamp(line) {
  return validTimestamp(line?.timestamp_ms);
}

export function formatArabicOperationDate(timestamp) {
  const ms = validTimestamp(timestamp);
  if (ms == null) return null;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  const dayDate = new Intl.DateTimeFormat('ar-EG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
  return `${dayDate} · ${formatClock(date)}`;
}

export function buildInvoiceEvidence(lines = [], side = 'sale') {
  const byInvoice = new Map();
  lines.forEach((line) => {
    const invoice = cleanText(line?.invoice) || 'بدون رقم';
    const current = byInvoice.get(invoice) || [];
    current.push(line);
    byInvoice.set(invoice, current);
  });

  return [...byInvoice.entries()].map(([invoice, invoiceLines]) => {
    const actors = unique(invoiceLines.map((line) => lineActor(line, side)));
    const timestamps = [...new Set(invoiceLines.map(lineTimestamp).filter((value) => value != null))].sort((a, b) => a - b);
    const actor = actors.length === 1 ? actors[0] : actors.length > 1 ? `أكثر من مستخدم: ${actors.join('، ')}` : 'غير متاح في الملف';
    const timestamp = timestamps[0] ?? null;
    return {
      invoice,
      actor,
      actors,
      timestamp,
      dateLabel: timestamp != null ? formatArabicOperationDate(timestamp) : 'التاريخ غير متاح في الملف',
      sourceFiles: unique(invoiceLines.map((line) => line?.source_file)),
      actorSource: side === 'sale'
        ? (invoiceLines.some((line) => cleanText(line?.invoice_header_user || line?.sale_actor)) ? 'sales_invoice_header' : 'sale_line')
        : 'purchase_invoice_header',
    };
  }).sort((a, b) => (a.timestamp ?? Number.MAX_SAFE_INTEGER) - (b.timestamp ?? Number.MAX_SAFE_INTEGER));
}

export function buildSideOperationMetadata(incident, side) {
  const lines = collectSideLines(incident, side);
  if (!lines.length) {
    return {
      available: false,
      users: [],
      userLabel: 'غير متاح في الملف',
      timestamps: [],
      timeLabel: 'غير متاح في الملف',
      invoices: [],
      invoiceLabel: 'غير متاح في الملف',
      invoiceEvidence: [],
    };
  }

  const users = unique(lines.map((line) => lineActor(line, side)));
  const timestamps = [...new Set(lines.map(lineTimestamp).filter((value) => value != null))].sort((a, b) => a - b);
  const invoices = unique(lines.map((line) => line?.invoice));
  const prefix = invoicePrefix(invoices);
  const invoiceEvidence = buildInvoiceEvidence(lines, side);

  let userLabel = 'غير متاح في الملف';
  if (users.length === 1) userLabel = users[0];
  else if (users.length > 1) userLabel = `أكثر من مستخدم: ${users.join('، ')}`;

  let timeLabel = 'غير متاح في الملف';
  if (timestamps.length === 1) timeLabel = `${prefix}${formatArabicOperationDate(timestamps[0]) || timeLabel}`;
  else if (timestamps.length > 1) {
    const first = new Date(timestamps[0]);
    const last = new Date(timestamps[timestamps.length - 1]);
    const sameDay = first.getFullYear() === last.getFullYear()
      && first.getMonth() === last.getMonth()
      && first.getDate() === last.getDate();
    if (sameDay) {
      const dayDate = new Intl.DateTimeFormat('ar-EG', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      }).format(first);
      timeLabel = `${prefix}${dayDate} · ${formatClock(first)}–${formatClock(last)}`;
    } else {
      timeLabel = `${prefix}${formatArabicOperationDate(timestamps[0])} → ${formatArabicOperationDate(timestamps[timestamps.length - 1])}`;
    }
  } else if (invoices.length) {
    timeLabel = invoices.length === 1 ? `فاتورة ${invoices[0]} · الوقت غير متاح في الملف` : `فواتير ${invoices.join('، ')} · الوقت غير متاح في الملف`;
  }

  return {
    available: true,
    users,
    userLabel,
    timestamps,
    timeLabel,
    invoices,
    invoiceLabel: invoices.length === 1 ? `فاتورة ${invoices[0]}` : invoices.length > 1 ? `فواتير ${invoices.join('، ')}` : 'غير متاح في الملف',
    invoiceEvidence,
  };
}

export function buildOperationTimeline(incident) {
  const sale = buildSideOperationMetadata(incident, 'sale');
  const purchase = buildSideOperationMetadata(incident, 'purchase');
  const saleTime = sale.timestamps[0];
  const purchaseTime = purchase.timestamps[0];
  let gapMinutes = null;
  let gapLabel = null;

  if (Number.isFinite(saleTime) && Number.isFinite(purchaseTime)) {
    gapMinutes = Math.abs(purchaseTime - saleTime) / 60000;
    if (gapMinutes < 1) gapLabel = 'أقل من دقيقة بين الطرفين';
    else if (gapMinutes < 60) gapLabel = `${Math.round(gapMinutes)} دقيقة بين الطرفين`;
    else {
      const hours = Math.floor(gapMinutes / 60);
      const minutes = Math.round(gapMinutes % 60);
      gapLabel = minutes ? `${hours} س ${minutes} د بين الطرفين` : `${hours} ساعة بين الطرفين`;
    }
  }

  return { sale, purchase, gapMinutes, gapLabel };
}
