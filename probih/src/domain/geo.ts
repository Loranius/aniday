/** Geometry + GPS filtering. Pure functions only. */

export interface LatLng {
  lat: number;
  lng: number;
}

/** A raw position fix as delivered by any location source. */
export interface GpsFix extends LatLng {
  /** Unix epoch, milliseconds. */
  timestamp: number;
  /** Horizontal accuracy radius, metres. */
  accuracy?: number | null;
  /** Device-reported speed, m/s. */
  speed?: number | null;
  heading?: number | null;
}

export interface GpsFilterOptions {
  /** Fixes less accurate than this are ignored for distance. */
  maxAccuracyM: number;
  /** Implied speed above this between two fixes = GPS jump. 70 m/s ≈ 252 km/h. */
  maxSpeedMps: number;
  /** Minimum movement before the anchor advances (suppresses stationary jitter). */
  minMoveM: number;
  /** A gap longer than this is reported (distance is still bridged with a straight line). */
  maxGapMs: number;
  /** After this many consecutive "jump" rejections the filter re-anchors without adding distance. */
  reanchorAfter: number;
}

export const DEFAULT_GPS_FILTER: GpsFilterOptions = {
  maxAccuracyM: 50,
  maxSpeedMps: 70,
  minMoveM: 10,
  maxGapMs: 5 * 60 * 1000,
  reanchorAfter: 3,
};

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidCoordinate(p: LatLng): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180 &&
    // (0,0) is what broken providers emit; nobody drives in the Gulf of Guinea.
    !(p.lat === 0 && p.lng === 0)
  );
}

export interface TripDistanceResult {
  distanceKm: number;
  /** Fixes that contributed to the route, in order. */
  acceptedPoints: GpsFix[];
  rejected: { invalid: number; inaccurate: number; outOfOrder: number; jumps: number };
  /** Number of gaps longer than maxGapMs that were bridged with a straight line. */
  gaps: number;
  /** Max speed, km/h (device-reported when available, otherwise derived). */
  maxSpeedKmh: number | null;
}

/**
 * Sums the distance of a GPS track while rejecting noise:
 * invalid coordinates, low-accuracy fixes, duplicated/out-of-order timestamps,
 * jumps with impossible implied speed and stationary jitter.
 * The result is never negative.
 */
export function calculateTripDistance(
  fixes: readonly GpsFix[],
  options: Partial<GpsFilterOptions> = {},
): TripDistanceResult {
  const opt = { ...DEFAULT_GPS_FILTER, ...options };
  const rejected = { invalid: 0, inaccurate: 0, outOfOrder: 0, jumps: 0 };
  const accepted: GpsFix[] = [];
  /** Cumulative path length at each accepted fix (for windowed speed). */
  const cum: number[] = [];
  let speedFrom = 0;
  let meters = 0;
  let gaps = 0;
  let consecutiveJumps = 0;
  let maxSpeedMps = 0;

  for (const fix of fixes) {
    if (!isValidCoordinate(fix) || !Number.isFinite(fix.timestamp)) {
      rejected.invalid++;
      continue;
    }
    if (fix.accuracy != null && fix.accuracy > opt.maxAccuracyM) {
      rejected.inaccurate++;
      continue;
    }
    const anchor = accepted[accepted.length - 1];
    if (!anchor) {
      accepted.push(fix);
      cum.push(meters);
      continue;
    }
    const dtMs = fix.timestamp - anchor.timestamp;
    if (dtMs <= 0) {
      rejected.outOfOrder++;
      continue;
    }
    const d = haversineMeters(anchor, fix);
    const impliedSpeed = d / (dtMs / 1000);
    if (impliedSpeed > opt.maxSpeedMps) {
      consecutiveJumps++;
      if (consecutiveJumps >= opt.reanchorAfter) {
        // The anchor itself was probably the bad fix: restart from here, add nothing.
        accepted.push(fix);
        cum.push(meters);
        speedFrom = accepted.length - 1;
        consecutiveJumps = 0;
      } else {
        rejected.jumps++;
      }
      continue;
    }
    consecutiveJumps = 0;
    const jitter = Math.max(opt.minMoveM, ((anchor.accuracy ?? 0) + (fix.accuracy ?? 0)) / 4);
    if (d < jitter) continue; // not moved enough yet; keep the anchor
    if (dtMs > opt.maxGapMs) gaps++;
    meters += d;
    if (fix.speed != null && fix.speed >= 0 && fix.speed <= opt.maxSpeedMps) {
      maxSpeedMps = Math.max(maxSpeedMps, fix.speed);
    }
    accepted.push(fix);
    cum.push(meters);
    // Derived speed over a window of ≥ 5 s smooths out per-fix noise.
    while (speedFrom < accepted.length - 2 && fix.timestamp - accepted[speedFrom + 1]!.timestamp >= 5000) speedFrom++;
    const windowMs = fix.timestamp - accepted[speedFrom]!.timestamp;
    if (windowMs >= 5000) {
      const windowSpeed = (meters - cum[speedFrom]!) / (windowMs / 1000);
      if (windowSpeed <= opt.maxSpeedMps) maxSpeedMps = Math.max(maxSpeedMps, windowSpeed);
    }
  }

  return {
    distanceKm: Math.max(0, Math.round(meters) / 1000),
    acceptedPoints: accepted,
    rejected,
    gaps,
    maxSpeedKmh: maxSpeedMps > 0 ? Math.round(maxSpeedMps * 3.6 * 10) / 10 : null,
  };
}

/** Douglas–Peucker simplification on an equirectangular projection (good enough for city scale). */
export function simplifyPath<T extends LatLng>(points: readonly T[], toleranceM = 8): T[] {
  if (points.length <= 2) return [...points];
  const first = points[0]!;
  const lat0 = toRad(first.lat);
  const project = (p: LatLng) => ({
    x: toRad(p.lng - first.lng) * Math.cos(lat0) * EARTH_RADIUS_M,
    y: toRad(p.lat - first.lat) * EARTH_RADIUS_M,
  });
  const xy = points.map(project);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const a = xy[s]!;
    const b = xy[e]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let maxDist = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const p = xy[i]!;
      let dist: number;
      if (len2 === 0) dist = Math.hypot(p.x - a.x, p.y - a.y);
      else {
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
        dist = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
      }
      if (dist > maxDist) {
        maxDist = dist;
        idx = i;
      }
    }
    if (idx !== -1 && maxDist > toleranceM) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}
