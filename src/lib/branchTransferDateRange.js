import { incidentPrimaryTimestamp } from './branchTransferIncidentDay.js';

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function endOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();
}

function parseLocalDate(value, end = false) {
  if (!value) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
  const timestamp = date.getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function calendarPeriodRange(period = 'all', { now = Date.now(), from = '', to = '' } = {}) {
  if (!period || period === 'all') return { start: null, end: null, valid: true };
  const reference = new Date(now);
  if (Number.isNaN(reference.getTime())) return { start: null, end: null, valid: false };

  if (period === 'today') return { start: startOfDay(reference), end: endOfDay(reference), valid: true };
  if (period === 'yesterday') {
    const yesterday = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() - 1);
    return { start: startOfDay(yesterday), end: endOfDay(yesterday), valid: true };
  }
  if (period === 'last7' || period === 'last14') {
    const days = period === 'last7' ? 7 : 14;
    const start = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() - (days - 1));
    return { start: startOfDay(start), end: endOfDay(reference), valid: true };
  }
  if (period === 'custom') {
    const start = parseLocalDate(from, false);
    const end = parseLocalDate(to, true);
    if (start == null || end == null || start > end) return { start, end, valid: false };
    return { start, end, valid: true };
  }
  return { start: null, end: null, valid: true };
}

export function incidentMatchesCalendarPeriod(incident, period = 'all', options = {}) {
  const range = calendarPeriodRange(period, options);
  if (!range.valid) return false;
  if (range.start == null || range.end == null) return true;
  const timestamp = incidentPrimaryTimestamp(incident);
  if (timestamp == null) return false;
  return timestamp >= range.start && timestamp <= range.end;
}

export function calendarPeriodLabel(period = 'all', { from = '', to = '' } = {}) {
  if (period === 'today') return 'اليوم';
  if (period === 'yesterday') return 'أمس';
  if (period === 'last7') return 'آخر 7 أيام';
  if (period === 'last14') return 'آخر 14 يوم';
  if (period === 'custom') return from && to ? `${from} ← ${to}` : 'فترة مخصصة';
  return 'كل الفترة';
}
