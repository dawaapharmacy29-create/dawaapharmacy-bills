/**
 * B-Connect Excel dates are local wall-clock values from the export.
 * Display the clock as written; never reinterpret it using browser timezone.
 * Blank or date-only values MUST NOT produce a fabricated midnight time.
 */
export function describeBConnectInvoiceTimestamp(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { date: 'غير مسجل', time: 'غير مسجل في الملف', dateISO: null, time24: null, hasTime: false };

  // parseExcelDate returns ISO or YYYY-MM-DD HH:mm:ss. Some flat reports
  // supply DD/MM/YYYY HH:mm; respect those positions.
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  const dmy = !iso && raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  const match = iso || dmy;
  if (!match) return { date: raw, time: 'غير مسجل في الملف', dateISO: null, time24: null, hasTime: false };

  const year = Number(iso ? match[1] : match[3]);
  const month = Number(match[2]);
  const day = Number(iso ? match[3] : match[1]);
  const hour = match[4] === undefined ? null : Number(match[4]);
  const minute = match[5] === undefined ? null : Number(match[5]);
  const second = match[6] === undefined ? null : Number(match[6]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 && date.getUTCDate() === day &&
    (hour === null || (hour <= 23 && minute <= 59 && (second === null || second <= 59)));
  if (!valid) return { date: raw, time: 'غير مسجل في الملف', dateISO: null, time24: null, hasTime: false };

  const isoDate = String(year).padStart(4, '0') + '-' +
    String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  const dateLabel = new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(date);
  if (hour === null) return { date: dateLabel, time: 'غير مسجل في الملف', dateISO: isoDate, time24: null, hasTime: false };

  const clockDate = new Date(Date.UTC(2020, 0, 1, hour, minute, second || 0));
  const timeLabel = new Intl.DateTimeFormat('ar-EG', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC',
  }).format(clockDate);
  const time24 = String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  return { date: dateLabel, time: timeLabel, dateISO: isoDate, time24, hasTime: true };
}
