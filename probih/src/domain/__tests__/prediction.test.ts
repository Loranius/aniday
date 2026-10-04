import { describe, expect, it } from 'vitest';
import { calculateAverageMonthlyMileage, estimateServiceDate } from '../prediction';

const now = new Date('2026-10-04T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe('calculateAverageMonthlyMileage', () => {
  it('returns null without enough history', () => {
    expect(calculateAverageMonthlyMileage([], [], now)).toBeNull();
    expect(calculateAverageMonthlyMileage([{ id: 'a', ended_at: daysAgo(3), distance_km: 50, is_valid: true }], [], now)).toBeNull();
  });

  it('averages ~850 km/month from 90 days of trips', () => {
    const trips = Array.from({ length: 90 }, (_, i) => ({ id: `t${i}`, ended_at: daysAgo(i + 0.5), distance_km: 850 / 30.4375, is_valid: true }));
    const avg = calculateAverageMonthlyMileage(trips, [], now)!;
    expect(avg).toBeGreaterThan(830);
    expect(avg).toBeLessThan(870);
  });

  it('ignores invalid trips and includes manual distance', () => {
    const avg = calculateAverageMonthlyMileage(
      [
        { id: 'a', ended_at: daysAgo(30), distance_km: 500, is_valid: true },
        { id: 'b', ended_at: daysAgo(10), distance_km: 9999, is_valid: false },
      ],
      [{ kind: 'manual_distance', value_km: 100, recorded_at: daysAgo(5) }],
      now,
    );
    expect(avg).toBeCloseTo(609, -1);
  });
});

describe('estimateServiceDate', () => {
  it('3 400 km left at 850 km/month ≈ 4 months', () => {
    const r = estimateServiceDate({ kmRemaining: 3400, avgMonthlyKm: 850, dueDate: null, today: now })!;
    expect(r.basis).toBe('mileage');
    expect(r.monthsRemaining).toBe(4);
    expect(r.date).toBe('2027-02-03');
  });

  it('calendar due date wins when earlier', () => {
    const r = estimateServiceDate({ kmRemaining: 3400, avgMonthlyKm: 850, dueDate: '2026-12-01', today: now })!;
    expect(r.basis).toBe('time');
    expect(r.date).toBe('2026-12-01');
  });

  it('overdue items are estimated for today', () => {
    const r = estimateServiceDate({ kmRemaining: -200, avgMonthlyKm: 850, dueDate: null, today: now })!;
    expect(r.monthsRemaining).toBe(0);
    expect(r.date).toBe('2026-10-04');
  });

  it('null without data', () => {
    expect(estimateServiceDate({ kmRemaining: 3400, avgMonthlyKm: null, dueDate: null, today: now })).toBeNull();
  });
});
