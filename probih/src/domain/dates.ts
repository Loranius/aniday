import type { ISODate } from './types';

const DAY_MS = 86_400_000;
export const AVG_DAYS_PER_MONTH = 30.4375;

/** Parses 'YYYY-MM-DD' (or the date part of an ISO timestamp) as UTC midnight. */
export function parseISODate(d: ISODate): number {
  return Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((parseISODate(to) - parseISODate(from)) / DAY_MS);
}

export function addDays(d: ISODate, days: number): ISODate {
  return new Date(parseISODate(d) + Math.round(days) * DAY_MS).toISOString().slice(0, 10);
}

/** Local calendar date of a JS Date as 'YYYY-MM-DD'. */
export function toISODate(date: Date): ISODate {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
