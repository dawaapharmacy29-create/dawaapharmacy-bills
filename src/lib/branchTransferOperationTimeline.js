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
    };
  }

  const users = unique(lines.map((line) => line?.user));
  const timestamps = [...new Set(lines.map((line) => validTimestamp(line?.timestamp_ms)).filter((value) => value != null))].sort((a, b) => a - b);
  const invoices = unique(lines.map((line) => line?.invoice));
  const prefix = invoicePrefix(invoices);

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
