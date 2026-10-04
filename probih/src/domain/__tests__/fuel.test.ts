import { describe, expect, it } from 'vitest';
import { calculateCostPerKm, calculateFuelConsumption, calculateFuelCostSummary, entryCost } from '../fuel';

let n = 0;
const fill = (odometer: number, liters: number, full_tank = true, total_cost: number | null = liters * 58, date = '2026-09-01') => ({
  id: `f${n++}`, date, odometer, liters, full_tank, total_cost, price_per_liter: null,
});

describe('calculateFuelConsumption', () => {
  it('full-to-full: 40.5 L over 500 km = 8.1 L/100 km', () => {
    const r = calculateFuelConsumption([fill(184_000, 30), fill(184_500, 40.5)]);
    expect(r.litersPer100Km).toBe(8.1);
    expect(r.segments).toBe(1);
  });

  it('includes partial fills between full tanks', () => {
    const r = calculateFuelConsumption([fill(1000, 40), fill(1200, 10, false), fill(1500, 30)]);
    expect(r.liters).toBe(40);
    expect(r.litersPer100Km).toBe(8);
  });

  it('ignores partial fills before the first full tank and order of input', () => {
    const r = calculateFuelConsumption([fill(1500, 30), fill(900, 20, false), fill(1000, 40)]);
    expect(r.litersPer100Km).toBe(6);
  });

  it('returns null with missing data (one fill / no full tanks / empty)', () => {
    expect(calculateFuelConsumption([]).litersPer100Km).toBeNull();
    expect(calculateFuelConsumption([fill(1000, 40)]).litersPer100Km).toBeNull();
    expect(calculateFuelConsumption([fill(1000, 40, false), fill(1500, 40, false)]).litersPer100Km).toBeNull();
  });

  it('skips segments with a non-increasing odometer', () => {
    expect(calculateFuelConsumption([fill(1000, 40), fill(1000, 40)]).litersPer100Km).toBeNull();
  });
});

describe('cost', () => {
  it('entryCost falls back to liters × price', () => {
    expect(entryCost({ liters: 40, total_cost: null, price_per_liter: 57.5 })).toBe(2300);
    expect(entryCost({ liters: 40, total_cost: null, price_per_liter: null })).toBeNull();
  });

  it('cost per km over measured segments', () => {
    const r = calculateCostPerKm([fill(1000, 40, true, 2000), fill(1500, 40, true, 2365)])!;
    expect(r.perKm).toBe(4.73);
    expect(r.per100Km).toBe(473);
  });

  it('cost per km is null when a fill in the segment has no price', () => {
    expect(calculateCostPerKm([fill(1000, 40), fill(1500, 40, true, null)])).toBeNull();
  });

  it('month-to-date and yearly sums', () => {
    const s = calculateFuelCostSummary(
      [fill(1, 10, true, 500, '2026-10-02'), fill(2, 10, true, 700, '2026-09-15'), fill(3, 10, true, 900, '2025-01-01')],
      '2026-10-04',
    );
    expect(s.monthToDate).toBe(500);
    expect(s.last365).toBe(1200);
    expect(s.monthlyAverage).toBe(1218); // <30 days of history is spread over a 30-day minimum
  });
});
