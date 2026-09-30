// Sabha schedule rules.
//
// Sunday sabha: every week.
// Thursday sabha: every second week, counted from an anchor date stored
// in the settings table. The anchor is a Thursday that DID have sabha.
// Change the anchor and the whole biweekly calendar shifts with it —
// which is what you want if the mandal ever reschedules.

import { fromISO, toISO, addDays, dayOfWeek } from './dates.js';

const SUNDAY = 0;
const THURSDAY = 4;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export function isSundaySabha(iso) {
  return dayOfWeek(iso) === SUNDAY;
}

export function isThursdaySabha(iso, anchorISO) {
  if (dayOfWeek(iso) !== THURSDAY) return false;
  const weeks = Math.round((fromISO(iso) - fromISO(anchorISO)) / MS_PER_WEEK);
  return weeks % 2 === 0;
}

export function isSabhaDay(iso, anchorISO) {
  return isSundaySabha(iso) || isThursdaySabha(iso, anchorISO);
}

export function sabhaType(iso) {
  const d = dayOfWeek(iso);
  if (d === SUNDAY) return 'sunday';
  if (d === THURSDAY) return 'thursday';
  return 'extra';
}

// Weekday name, for labelling moved sabhas.
export function weekdayName(iso) {
  return fromISO(iso).toLocaleDateString('en-CA', { weekday: 'long' });
}

// The scheduled sabha nearest to a given date, within a week either way.
// Used to guess which series a moved sabha belongs to.
export function nearestScheduled(iso, anchorISO) {
  for (let offset = 1; offset <= 6; offset++) {
    for (const dir of [-1, 1]) {
      const cursor = addDays(iso, offset * dir);
      if (isSabhaDay(cursor, anchorISO)) {
        return { date: cursor, type: sabhaType(cursor), days: offset * dir };
      }
    }
  }
  return null;
}

// The next sabha on or after the given date.
export function nextSabha(fromISODate, anchorISO) {
  let cursor = fromISODate;
  for (let i = 0; i < 14; i++) {
    if (isSabhaDay(cursor, anchorISO)) return cursor;
    cursor = addDays(cursor, 1);
  }
  return null;
}

// The most recent sabha on or before the given date.
export function previousSabha(fromISODate, anchorISO) {
  let cursor = fromISODate;
  for (let i = 0; i < 14; i++) {
    if (isSabhaDay(cursor, anchorISO)) return cursor;
    cursor = addDays(cursor, -1);
  }
  return null;
}

// Every scheduled sabha date in a range, oldest first.
// Used to spot sabhas that were never recorded.
export function sabhaDatesBetween(startISO, endISO, anchorISO) {
  const out = [];
  let cursor = startISO;
  let guard = 0;
  while (cursor <= endISO && guard++ < 1000) {
    if (isSabhaDay(cursor, anchorISO)) out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

// Attendance thresholds used for colour coding across the app.
export function band(pct) {
  if (pct >= 85) return 'good';
  if (pct >= 65) return 'watch';
  return 'low';
}