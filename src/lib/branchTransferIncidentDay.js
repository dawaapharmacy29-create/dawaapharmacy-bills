function validTimestamp(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function incidentTimestamps(incident) {
  return (incident?.cases || []).flatMap((item) => [
    ...(item?.sale_lines || []),
    ...(item?.purchase_lines || []),
  ]).map((line) => validTimestamp(line?.timestamp_ms)).filter((value) => value != null);
}

export function incidentPrimaryTimestamp(incident) {
  const timestamps = incidentTimestamps(incident);
  return timestamps.length ? Math.min(...timestamps) : null;
}

export function incidentDayKey(incident) {
  const timestamp = incidentPrimaryTimestamp(incident);
  if (timestamp == null) return 'unknown';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'unknown';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatIncidentDayLabel(dayKey) {
  if (!dayKey || dayKey === 'unknown') return 'تاريخ غير متاح';
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return 'تاريخ غير متاح';
  return new Intl.DateTimeFormat('ar-EG', {
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
  }).format(date);
}

export function incidentMatchesDay(incident, dayKey = 'all') {
  if (!dayKey || dayKey === 'all') return true;
  return incidentDayKey(incident) === dayKey;
}

export function incidentDayOptions(incidents = []) {
  const counts = new Map();
  incidents.forEach((incident) => {
    const key = incidentDayKey(incident);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count, label: formatIncidentDayLabel(key) }))
    .sort((a, b) => {
      if (a.key === 'unknown') return 1;
      if (b.key === 'unknown') return -1;
      return b.key.localeCompare(a.key);
    });
}

export function compareIncidentsByDay(a, b, priorityFn = () => 0) {
  const aKey = incidentDayKey(a);
  const bKey = incidentDayKey(b);
  if (aKey !== bKey) {
    if (aKey === 'unknown') return 1;
    if (bKey === 'unknown') return -1;
    return bKey.localeCompare(aKey);
  }
  return Number(priorityFn(b) || 0) - Number(priorityFn(a) || 0);
}
