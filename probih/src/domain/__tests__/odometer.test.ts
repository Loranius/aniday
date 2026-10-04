import { describe, expect, it } from 'vitest';
import { calculateOdometerBreakdown, calculateTotalOdometer, summarizeTripsForDay } from '../odometer';

const trip = (id: string, km: number, ended: string, is_valid = true) => ({ id, distance_km: km, ended_at: ended, is_valid });

describe('calculateTotalOdometer', () => {
  it('is the initial odometer without trips', () => {
    expect(calculateTotalOdometer({ initialOdometer: 184_000, trips: [], entries: [] })).toBe(184_000);
  });

  it('adds valid trips', () => {
    const total = calculateTotalOdometer({
      initialOdometer: 184_000,
      trips: [trip('a', 21.3, '2026-10-01T08:00:00Z'), trip('b', 4.7, '2026-10-01T12:00:00Z')],
      entries: [],
    });
    expect(total).toBe(184_026);
  });

  it('counts a duplicated trip (re-synced) only once', () => {
    const t = trip('same', 10, '2026-10-01T08:00:00Z');
    expect(calculateTotalOdometer({ initialOdometer: 1000, trips: [t, t, { ...t }], entries: [] })).toBe(1010);
  });

  it('excludes invalid trips and ignores negative/NaN distances', () => {
    const total = calculateTotalOdometer({
      initialOdometer: 1000,
      trips: [trip('a', 5, '2026-10-01T08:00:00Z', false), trip('b', -50, '2026-10-01T09:00:00Z'), trip('c', NaN, '2026-10-01T10:00:00Z'), trip('d', 0, '2026-10-01T11:00:00Z')],
      entries: [],
    });
    expect(total).toBe(1000);
  });

  it('a manual reading becomes the new baseline; only later trips are added', () => {
    const b = calculateOdometerBreakdown({
      initialOdometer: 184_000,
      trips: [trip('before', 100, '2026-09-01T08:00:00Z'), trip('after', 12.5, '2026-09-20T08:00:00Z')],
      entries: [{ id: 'r1', kind: 'reading', value_km: 184_500, recorded_at: '2026-09-10T00:00:00Z' }],
    });
    expect(b.baseline).toBe(184_500);
    expect(b.total).toBe(184_512.5);
  });

  it('allows correcting the odometer downwards (latest reading wins)', () => {
    const total = calculateTotalOdometer({
      initialOdometer: 184_000,
      trips: [],
      entries: [
        { id: 'r1', kind: 'reading', value_km: 190_000, recorded_at: '2026-09-10T00:00:00Z' },
        { id: 'r2', kind: 'reading', value_km: 185_000, recorded_at: '2026-09-11T00:00:00Z' },
      ],
    });
    expect(total).toBe(185_000);
  });

  it('adds manual distance recorded after the baseline', () => {
    const total = calculateTotalOdometer({
      initialOdometer: 184_000,
      trips: [],
      entries: [
        { id: 'm0', kind: 'manual_distance', value_km: 300, recorded_at: '2026-09-01T00:00:00Z' },
        { id: 'r1', kind: 'reading', value_km: 184_500, recorded_at: '2026-09-10T00:00:00Z' },
        { id: 'm1', kind: 'manual_distance', value_km: 42, recorded_at: '2026-09-12T00:00:00Z' },
        { id: 'm1', kind: 'manual_distance', value_km: 42, recorded_at: '2026-09-12T00:00:00Z' },
      ],
    });
    expect(total).toBe(184_542);
  });
});

describe('summarizeTripsForDay', () => {
  it('counts only valid trips that ended on the given local day', () => {
    const day = new Date(2026, 9, 1, 12);
    const iso = (h: number) => new Date(2026, 9, 1, h).toISOString();
    const r = summarizeTripsForDay(
      [trip('a', 21.3, iso(9)), trip('b', 4.7, iso(18)), trip('c', 50, iso(19), false), trip('d', 7, new Date(2026, 9, 2, 1).toISOString())],
      day,
    );
    expect(r).toEqual({ km: 26, count: 2 });
  });
});
