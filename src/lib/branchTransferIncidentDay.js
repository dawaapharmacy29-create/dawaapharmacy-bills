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

function presetKeys(value) {
  if (!String(value || '').startsWith('preset:')) return null;
  const [, , encoded = ''] = String(value).split(':');
  return new Set(encoded.split(',').filter(Boolean));
}

export function incidentMatchesDay(incident, dayKey = 'all') {
  if (!dayKey || dayKey === 'all') return true;
  const preset = presetKeys(dayKey);
  if (preset) return preset.has(incidentDayKey(incident));
  return incidentDayKey(incident) === dayKey;
}

function rawDayOptions(incidents = []) {
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

function presetOption(name, label, entries) {
  if (!entries.length) return null;
  const keys = entries.map((day) => day.key);
  return {
    key: `preset:${name}:${keys.join(',')}`,
    label,
    count: entries.reduce((sum, day) => sum + day.count, 0),
    preset: name,
    day_keys: keys,
  };
}

export function incidentDayOptions(incidents = [], { specificLimit = 90 } = {}) {
  const raw = rawDayOptions(incidents);
  const dated = raw.filter((day) => day.key !== 'unknown');
  const unknown = raw.find((day) => day.key === 'unknown');
  const latest = dated[0];
  const presets = [
    presetOption('latest', latest ? `أحدث يوم · ${latest.label}` : 'أحدث يوم', dated.slice(0, 1)),
    presetOption('last3', 'آخر 3 أيام فيها مراجعات', dated.slice(0, 3)),
    presetOption('last7', 'آخر 7 أيام فيها مراجعات', dated.slice(0, 7)),
  ].filter(Boolean);
  const specific = dated.slice(0, Math.max(0, specificLimit));
  return [...presets, ...specific, ...(unknown ? [unknown] : [])];
}

export function smartDayFilterKeys(dayOptions = [], filter = 'all') {
  if (!filter || filter === 'all') return null;
  const preset = presetKeys(filter);
  if (preset) return preset;
  const option = dayOptions.find((day) => day.key === filter);
  if (option?.day_keys?.length) return new Set(option.day_keys);
  return new Set([filter]);
}

export function incidentMatchesSmartDay(incident, filter = 'all', dayOptions = []) {
  const keys = smartDayFilterKeys(dayOptions, filter);
  if (!keys) return true;
  return keys.has(incidentDayKey(incident));
}

export function smartDayFilterCount(incidents = [], filter = 'all', dayOptions = []) {
  return incidents.filter((incident) => incidentMatchesSmartDay(incident, filter, dayOptions)).length;
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
