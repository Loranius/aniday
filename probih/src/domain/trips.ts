import { calculateTripDistance, haversineMeters, simplifyPath, type GpsFix, type GpsFilterOptions } from './geo';
import type { LineStringGeometry, SavedPlace, Trip } from './types';

/** Trips shorter than this are treated as noise (parking manoeuvres, GPS drift). */
export const MIN_TRIP_KM = 0.05;

export interface TripSummary {
  distance_km: number;
  duration_seconds: number;
  average_speed: number | null;
  max_speed: number | null;
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  route_geometry: LineStringGeometry | null;
  acceptedPoints: GpsFix[];
  gaps: number;
}

export function summarizeTrip(
  fixes: readonly GpsFix[],
  startedAt: number,
  endedAt: number,
  filter?: Partial<GpsFilterOptions>,
): TripSummary {
  const r = calculateTripDistance(fixes, filter);
  const duration = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  const first = r.acceptedPoints[0];
  const last = r.acceptedPoints[r.acceptedPoints.length - 1];
  const simplified = simplifyPath(r.acceptedPoints);
  return {
    distance_km: r.distanceKm,
    duration_seconds: duration,
    average_speed: duration > 0 && r.distanceKm > 0 ? Math.round((r.distanceKm / (duration / 3600)) * 10) / 10 : null,
    max_speed: r.maxSpeedKmh,
    start_lat: first?.lat ?? null,
    start_lng: first?.lng ?? null,
    end_lat: last?.lat ?? null,
    end_lng: last?.lng ?? null,
    route_geometry:
      simplified.length >= 2
        ? { type: 'LineString', coordinates: simplified.map((p) => [round6(p.lng), round6(p.lat)]) }
        : null,
    acceptedPoints: r.acceptedPoints,
    gaps: r.gaps,
  };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Nearest saved place whose radius contains the point. */
export function matchPlace(
  lat: number | null,
  lng: number | null,
  places: readonly Pick<SavedPlace, 'id' | 'latitude' | 'longitude' | 'radius_m'>[],
): string | null {
  if (lat == null || lng == null) return null;
  let best: { id: string; d: number } | null = null;
  for (const p of places) {
    const d = haversineMeters({ lat, lng }, { lat: p.latitude, lng: p.longitude });
    if (d <= p.radius_m && (!best || d < best.d)) best = { id: p.id, d };
  }
  return best?.id ?? null;
}

export interface FrequentRoute {
  startPlaceId: string;
  endPlaceId: string;
  count: number;
  avgDistanceKm: number;
  avgDurationSeconds: number;
}

export function findFrequentRoutes(
  trips: readonly Pick<Trip, 'start_place_id' | 'end_place_id' | 'distance_km' | 'duration_seconds' | 'is_valid'>[],
  minCount = 2,
  limit = 5,
): FrequentRoute[] {
  const groups = new Map<string, { s: string; e: string; n: number; km: number; sec: number }>();
  for (const t of trips) {
    if (!t.is_valid || !t.start_place_id || !t.end_place_id || t.start_place_id === t.end_place_id) continue;
    const key = `${t.start_place_id}>${t.end_place_id}`;
    const g = groups.get(key) ?? { s: t.start_place_id, e: t.end_place_id, n: 0, km: 0, sec: 0 };
    g.n++;
    g.km += t.distance_km;
    g.sec += t.duration_seconds;
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.n >= minCount)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((g) => ({
      startPlaceId: g.s,
      endPlaceId: g.e,
      count: g.n,
      avgDistanceKm: Math.round((g.km / g.n) * 10) / 10,
      avgDurationSeconds: Math.round(g.sec / g.n),
    }));
}
