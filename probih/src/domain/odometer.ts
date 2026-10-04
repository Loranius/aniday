import type { OdometerEntry, Trip } from './types';

type TripLike = Pick<Trip, 'id' | 'ended_at' | 'distance_km' | 'is_valid'>;
type EntryLike = Pick<OdometerEntry, 'id' | 'kind' | 'value_km' | 'recorded_at'>;

export interface OdometerInput {
  initialOdometer: number;
  trips: readonly TripLike[];
  entries: readonly EntryLike[];
}

export interface OdometerBreakdown {
  total: number;
  /** Value the calculation starts from (initial odometer or the latest reading). */
  baseline: number;
  baselineAt: string | null;
  tripsKm: number;
  manualKm: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const positive = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Derived odometer:
 *   baseline (latest 'reading' entry, or initial_odometer)
 *   + Σ valid trips that ended after the baseline
 *   + Σ manual_distance entries recorded after the baseline.
 *
 * Trips are de-duplicated by id, so a trip delivered twice by sync is counted once.
 * Negative or non-finite distances are ignored. Mirrors `public.calculate_vehicle_odometer` in SQL.
 */
export function calculateOdometerBreakdown(input: OdometerInput): OdometerBreakdown {
  const readings = input.entries
    .filter((e) => e.kind === 'reading' && Number.isFinite(e.value_km) && e.value_km >= 0)
    .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
  const latest = readings[readings.length - 1];
  const baseline = latest ? latest.value_km : positive(input.initialOdometer);
  const baselineTs = latest ? Date.parse(latest.recorded_at) : -Infinity;

  const seen = new Set<string>();
  let tripsKm = 0;
  for (const t of input.trips) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    if (!t.is_valid) continue;
    if (Date.parse(t.ended_at) <= baselineTs) continue;
    tripsKm += positive(t.distance_km);
  }

  const seenEntries = new Set<string>();
  let manualKm = 0;
  for (const e of input.entries) {
    if (e.kind !== 'manual_distance' || seenEntries.has(e.id)) continue;
    seenEntries.add(e.id);
    if (Date.parse(e.recorded_at) <= baselineTs) continue;
    manualKm += positive(e.value_km);
  }

  return {
    total: round1(baseline + tripsKm + manualKm),
    baseline,
    baselineAt: latest?.recorded_at ?? null,
    tripsKm: round1(tripsKm),
    manualKm: round1(manualKm),
  };
}

export function calculateTotalOdometer(input: OdometerInput): number {
  return calculateOdometerBreakdown(input).total;
}

/** Sum of valid trip distance per local calendar day, for "today" widgets. */
export function summarizeTripsForDay(trips: readonly TripLike[], day: Date): { km: number; count: number } {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const end = start + 24 * 3600 * 1000;
  let km = 0;
  let count = 0;
  for (const t of trips) {
    const ts = Date.parse(t.ended_at);
    if (!t.is_valid || ts < start || ts >= end) continue;
    km += positive(t.distance_km);
    count++;
  }
  return { km: round1(km), count };
}
