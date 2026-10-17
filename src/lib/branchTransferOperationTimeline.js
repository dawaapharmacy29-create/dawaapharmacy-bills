import { humanTransferUnit } from './branchTransferPackagingIntelligence.js';

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

function lineActorSource(line, side) {
  if (side === 'sale') return cleanText(line?.sale_actor_source || (line?.invoice_header_user ? 'sales_invoice_header' : line?.user ? 'sale_line' : ''));
  return cleanText(line?.user ? 'purchase_invoice_header' : '');
}

function lineActorConfidence(line, side) {
  if (side === 'sale') return cleanText(line?.sale_actor_confidence || (line?.invoice_header_user ? 'invoice_header' : line?.user ? 'line_only' : 'none'));
  return line?.user ? 'invoice_header' : 'none';
}

function lineTimestamp(line) {
  return validTimestamp(line?.timestamp_ms);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value) {
  return Number(Number(value || 0).toFixed(6));
}

function purchaseLinesAreUnitlessBconnect(lines = []) {
  if (!lines.length) return false;
  const hasExplicitUnit = lines.some((line) => cleanText(line?.unit));
  if (hasExplicitUnit) return false;
  return lines.every((line) => cleanText(line?.raw?.source_format || line?.source_format) === 'bconnect_purchase_report');
}

function invoiceQuantityLabel(qty, units = [], side = 'sale', invoiceLines = []) {
  if (Number(qty) === 0) return 'لا توجد حركة';
  if (units.length === 1) return `${qty} ${humanTransferUnit(units[0])}`;
  if (units.length > 1) return `${qty} وحدات مختلطة (${units.map(humanTransferUnit).join(' + ')})`;
  if (side === 'purchase' && purchaseLinesAreUnitlessBconnect(invoiceLines)) return `${qty} وحدة · العبوة غير محددة`;
  return `${qty} وحدة`;
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
    const actorSources = unique(invoiceLines.map((line) => lineActorSource(line, side)));
    const actorConfidences = unique(invoiceLines.map((line) => lineActorConfidence(line, side)));
    const timestamps = [...new Set(invoiceLines.map(lineTimestamp).filter((value) => value != null))].sort((a, b) => a - b);
    const sourceFiles = unique(invoiceLines.flatMap((line) => [line?.source_file, line?.invoice_header_source]));
    const units = unique(invoiceLines.map((line) => line?.unit));
    const qty = rounded(invoiceLines.reduce((sum, line) => sum + number(line?.qty), 0));
    const qtyLabel = invoiceQuantityLabel(qty, units, side, invoiceLines);
    const actor = actors.length === 1 ? actors[0] : actors.length > 1 ? `أكثر من مستخدم: ${actors.join('، ')}` : 'غير متاح في الملف';
    const timestamp = timestamps[0] ?? null;
    const actorConflict = actors.length > 1;
    const timeConflict = timestamps.length > 1 && (timestamps[timestamps.length - 1] - timestamps[0]) > 2 * 60 * 1000;
    const actorSource = actorSources.length === 1 ? actorSources[0] : actorSources.length > 1 ? 'mixed' : '';
    const actorConfidence = actorConfidences.includes('verified_invoice_time')
      ? 'verified_invoice_time'
      : actorConfidences.includes('invoice_header') ? 'invoice_header'
        : actorConfidences.includes('line_only') ? 'line_only' : 'none';
    const dateLabel = timestamp != null ? formatArabicOperationDate(timestamp) : 'التاريخ غير متاح في الملف';

    return {
      invoice,
      actor,
      actors,
      actorConflict,
      actorSource,
      actorConfidence,
      timestamp,
      timestamps,
      timeConflict,
      dateLabel,
      qty,
      qtyLabel,
      units,
      lineCount: invoiceLines.length,
      sourceFiles,
      summaryLabel: `فاتورة ${invoice} · ${actor} · ${dateLabel} · ${qtyLabel}`,
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
      primaryEvidence: null,
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
    primaryEvidence: invoiceEvidence.length === 1 ? invoiceEvidence[0] : null,
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
