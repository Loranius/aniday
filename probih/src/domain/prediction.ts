import { AVG_DAYS_PER_MONTH, addDays, daysBetween, toISODate } from './dates';
import type { ISODate, OdometerEntry, Trip } from './types';

export interface MonthlyMileageOptions {
  /** Look-back window in days. */
  windowDays: number;
  /** Below this much history the average is considered unreliable → null. */
  minHistoryDays: number;
}

const DEFAULTS: MonthlyMileageOptions = { windowDays: 90, minHistoryDays: 14 };

/**
 * Average km per month from valid trips (+ manually added distance) in the look-back window.
 * The span is measured from the first record in the window to `now`, so a fresh user with
 * 3 weeks of data is not divided by 90 days. Returns null when there is not enough history.
 */
export function calculateAverageMonthlyMileage(
  trips: readonly Pick<Trip, 'id' | 'ended_at' | 'distance_km' | 'is_valid'>[],
  entries: readonly Pick<OdometerEntry, 'kind' | 'value_km' | 'recorded_at'>[],
  now: Date,
  options: Partial<MonthlyMileageOptions> = {},
): number | null {
  const opt = { ...DEFAULTS, ...options };
  const nowMs = now.getTime();
  const windowStart = nowMs - opt.windowDays * 86_400_000;
  let earliest = Infinity;
  let km = 0;
  const seen = new Set<string>();
  for (const t of trips) {
    const ts = Date.parse(t.ended_at);
    if (seen.has(t.id) || !t.is_valid || ts < windowStart || ts > nowMs) continue;
    seen.add(t.id);
    if (t.distance_km > 0) km += t.distance_km;
    earliest = Math.min(earliest, Date.parse(t.ended_at));
  }
  for (const e of entries) {
    const ts = Date.parse(e.recorded_at);
    if (e.kind !== 'manual_distance' || ts < windowStart || ts > nowMs) continue;
    if (e.value_km > 0) km += e.value_km;
    earliest = Math.min(earliest, ts);
  }
  if (!Number.isFinite(earliest)) return null;
  const spanDays = (nowMs - earliest) / 86_400_000;
  if (spanDays < opt.minHistoryDays) return null;
  return Math.round((km / spanDays) * AVG_DAYS_PER_MONTH);
}

export interface ServiceDateEstimate {
  /** Estimated date (a forecast, not a guarantee). */
  date: ISODate;
  monthsRemaining: number;
  basis: 'mileage' | 'time';
}

/**
 * Forecast of the next service date: the earlier of
 *  - mileage: today + kmRemaining / avgMonthlyKm months
 *  - time: the calendar due date.
 * Returns null when neither can be computed.
 */
export function estimateServiceDate(params: {
  kmRemaining: number | null;
  avgMonthlyKm: number | null;
  dueDate: ISODate | null;
  today: Date;
}): ServiceDateEstimate | null {
  const todayIso = toISODate(params.today);
  let best: ServiceDateEstimate | null = null;

  if (params.kmRemaining != null && params.avgMonthlyKm != null && params.avgMonthlyKm > 0) {
    const months = Math.max(0, params.kmRemaining) / params.avgMonthlyKm;
    best = {
      date: addDays(todayIso, months * AVG_DAYS_PER_MONTH),
      monthsRemaining: Math.round(months * 10) / 10,
      basis: 'mileage',
    };
  }
  if (params.dueDate) {
    const days = Math.max(0, daysBetween(todayIso, params.dueDate));
    const candidate: ServiceDateEstimate = {
      date: days === 0 ? todayIso : params.dueDate,
      monthsRemaining: Math.round((days / AVG_DAYS_PER_MONTH) * 10) / 10,
      basis: 'time',
    };
    if (!best || candidate.date < best.date) best = candidate;
  }
  return best;
}
