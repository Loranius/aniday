import type { FuelEntry } from './types';

type FuelLike = Pick<FuelEntry, 'id' | 'date' | 'odometer' | 'liters' | 'total_cost' | 'price_per_liter' | 'full_tank'>;

/** Cost of an entry: explicit total, or liters × price. null when unknown. */
export function entryCost(e: Pick<FuelEntry, 'liters' | 'total_cost' | 'price_per_liter'>): number | null {
  if (e.total_cost != null && e.total_cost >= 0) return e.total_cost;
  if (e.price_per_liter != null && e.price_per_liter >= 0 && e.liters > 0) {
    return Math.round(e.price_per_liter * e.liters * 100) / 100;
  }
  return null;
}

export interface ConsumptionResult {
  /** L/100 km over all complete full-to-full segments; null without at least two full fills. */
  litersPer100Km: number | null;
  /** Distance covered by the measured segments. */
  distanceKm: number;
  liters: number;
  /** Fuel cost over the measured segments (only when every fill in them has a cost). */
  cost: number | null;
  segments: number;
}

/**
 * Full-to-full method: consumption between two full tanks = liters of every fill after the
 * first full tank up to and including the next full tank, divided by the odometer difference.
 * Partial fills before the first full tank are ignored; non-increasing odometers break the segment.
 */
export function calculateFuelConsumption(entries: readonly FuelLike[]): ConsumptionResult {
  const sorted = [...entries]
    .filter((e) => e.liters > 0 && Number.isFinite(e.odometer))
    .sort((a, b) => a.odometer - b.odometer || a.date.localeCompare(b.date));

  let distance = 0;
  let liters = 0;
  let cost = 0;
  let costKnown = true;
  let segments = 0;

  let anchor: FuelLike | null = null;
  let pendingLiters = 0;
  let pendingCost = 0;
  let pendingCostKnown = true;

  for (const e of sorted) {
    if (!anchor) {
      if (e.full_tank) anchor = e;
      continue;
    }
    pendingLiters += e.liters;
    const c = entryCost(e);
    if (c == null) pendingCostKnown = false;
    else pendingCost += c;

    if (e.full_tank) {
      const d = e.odometer - anchor.odometer;
      if (d > 0) {
        distance += d;
        liters += pendingLiters;
        cost += pendingCost;
        costKnown &&= pendingCostKnown;
        segments++;
      }
      anchor = e;
      pendingLiters = 0;
      pendingCost = 0;
      pendingCostKnown = true;
    }
  }

  return {
    litersPer100Km: distance > 0 ? Math.round((liters / distance) * 1000) / 10 : null,
    distanceKm: distance,
    liters: Math.round(liters * 100) / 100,
    cost: segments > 0 && costKnown ? Math.round(cost * 100) / 100 : null,
    segments,
  };
}

export interface CostPerKm {
  perKm: number;
  per100Km: number;
}

/** Fuel cost per km over the measured full-to-full segments. */
export function calculateCostPerKm(entries: readonly FuelLike[]): CostPerKm | null {
  const r = calculateFuelConsumption(entries);
  if (r.cost == null || r.distanceKm <= 0) return null;
  const perKm = r.cost / r.distanceKm;
  return { perKm: Math.round(perKm * 100) / 100, per100Km: Math.round(perKm * 100 * 10) / 10 };
}

/** Sum of known costs for entries with date in [from, to] (inclusive, 'YYYY-MM-DD'). */
export function sumFuelCost(entries: readonly FuelLike[], from: string, to: string): number {
  let sum = 0;
  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    sum += entryCost(e) ?? 0;
  }
  return Math.round(sum * 100) / 100;
}

/** Average monthly and total yearly fuel cost over the last 365 days. */
export function calculateFuelCostSummary(
  entries: readonly FuelLike[],
  today: string,
): { monthToDate: number; last365: number; monthlyAverage: number | null } {
  const monthStart = `${today.slice(0, 7)}-01`;
  const yearAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 364 * 86_400_000).toISOString().slice(0, 10);
  const inYear = entries.filter((e) => e.date >= yearAgo && e.date <= today);
  const last365 = sumFuelCost(inYear, yearAgo, today);
  let monthlyAverage: number | null = null;
  if (inYear.length >= 2) {
    const first = inYear.reduce((m, e) => (e.date < m ? e.date : m), today);
    const spanDays = Math.max(30, (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
    monthlyAverage = Math.round((last365 / spanDays) * 30.4375);
  }
  return { monthToDate: sumFuelCost(entries, monthStart, today), last365, monthlyAverage };
}
