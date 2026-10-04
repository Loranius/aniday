import { describe, expect, it } from 'vitest';
import { findFrequentRoutes, matchPlace, summarizeTrip } from '../trips';

describe('summarizeTrip', () => {
  it('computes distance, duration, average speed and geometry', () => {
    const t0 = 1_700_000_000_000;
    const fixes = Array.from({ length: 61 }, (_, i) => ({ lat: 50.45 + (i * 100) / 111_195, lng: 30.52, timestamp: t0 + i * 6000, accuracy: 5 }));
    const s = summarizeTrip(fixes, t0, t0 + 6 * 60_000);
    expect(s.distance_km).toBeCloseTo(6, 1);
    expect(s.duration_seconds).toBe(360);
    expect(s.average_speed).toBeCloseTo(60, 0);
    expect(s.route_geometry?.coordinates).toHaveLength(2);
  });

  it('zero-length trip has no geometry and no speed', () => {
    const s = summarizeTrip([], 0, 60_000);
    expect(s.distance_km).toBe(0);
    expect(s.average_speed).toBeNull();
    expect(s.route_geometry).toBeNull();
  });
});

describe('matchPlace', () => {
  const places = [
    { id: 'home', latitude: 50.45, longitude: 30.52, radius_m: 150 },
    { id: 'work', latitude: 50.46, longitude: 30.52, radius_m: 150 },
  ];
  it('matches the nearest place within its radius', () => {
    expect(matchPlace(50.4505, 30.5201, places)).toBe('home');
    expect(matchPlace(50.455, 30.52, places)).toBeNull();
    expect(matchPlace(null, null, places)).toBeNull();
  });
});

describe('findFrequentRoutes', () => {
  it('groups by start→end place', () => {
    const t = (s: string | null, e: string | null, km = 20) => ({ start_place_id: s, end_place_id: e, distance_km: km, duration_seconds: 1800, is_valid: true });
    const r = findFrequentRoutes([t('h', 'w', 21), t('h', 'w', 22), t('h', 'g'), t(null, 'w'), t('w', 'h')]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ startPlaceId: 'h', endPlaceId: 'w', count: 2, avgDistanceKm: 21.5 });
  });
});
