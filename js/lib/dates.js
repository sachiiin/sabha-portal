// Date helpers. All dates are handled as YYYY-MM-DD strings when they
// touch the database, to avoid timezone drift — a `date` column has no
// time component, so converting through a JS Date at UTC midnight can
// shift the day for anyone west of Greenwich.

export function toISO(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Parses YYYY-MM-DD as a LOCAL date, not UTC.
export function fromISO(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today() {
  return toISO(new Date());
}

export function formatShort(iso) {
  return fromISO(iso).toLocaleDateString('en-CA', {
    day: 'numeric',
    month: 'short'
  });
}

export function formatLong(iso) {
  return fromISO(iso).toLocaleDateString('en-CA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function dayOfWeek(iso) {
  return fromISO(iso).getDay(); // 0 = Sunday, 4 = Thursday
}

export function initials(name) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}
