import { describe, expect, it } from 'vitest';
import { calculateTripDistance, haversineMeters, simplifyPath, type GpsFix } from '../geo';

/** Straight track heading north from Kyiv: `stepM` metres every `stepS` seconds. */
function track(n: number, stepM = 100, stepS = 10, start = { lat: 50.45, lng: 30.52 }, t0 = 1_700_000_000_000): GpsFix[] {
  const dLat = stepM / 111_195;
  return Array.from({ length: n }, (_, i) => ({
    lat: start.lat + dLat * i,
    lng: start.lng,
    timestamp: t0 + i * stepS * 1000,
    accuracy: 5,
  }));
}

describe('haversineMeters', () => {
  it('measures ~111 km per degree of latitude', () => {
    expect(haversineMeters({ lat: 50, lng: 30 }, { lat: 51, lng: 30 })).toBeCloseTo(111_195, -2);
  });
  it('is zero for the same point', () => {
    expect(haversineMeters({ lat: 50, lng: 30 }, { lat: 50, lng: 30 })).toBe(0);
  });
});

describe('calculateTripDistance', () => {
  it('sums a clean track', () => {
    const r = calculateTripDistance(track(11)); // 10 segments × 100 m
    expect(r.distanceKm).toBeCloseTo(1, 2);
    expect(r.acceptedPoints).toHaveLength(11);
  });

  it('returns 0 km for an empty, single-point or stationary track', () => {
    expect(calculateTripDistance([]).distanceKm).toBe(0);
    expect(calculateTripDistance(track(1)).distanceKm).toBe(0);
    const parked = track(30, 0); // car not moving
    expect(calculateTripDistance(parked).distanceKm).toBe(0);
  });

  it('ignores stationary jitter of a few metres', () => {
    const jitter = track(60, 0).map((p, i) => ({ ...p, lat: p.lat + (i % 2 ? 0.00004 : -0.00004) })); // ±4.5 m
    expect(calculateTripDistance(jitter).distanceKm).toBe(0);
  });

  it('rejects a GPS jump with impossible speed', () => {
    const pts = track(11);
    pts[5] = { ...pts[5]!, lat: pts[5]!.lat + 0.5 }; // +55 km in 10 s
    const r = calculateTripDistance(pts);
    expect(r.rejected.jumps).toBe(1);
    expect(r.distanceKm).toBeCloseTo(1, 1);
  });

  it('re-anchors when the first fix was the outlier (no phantom distance)', () => {
    const pts = track(10);
    const bad: GpsFix = { ...pts[0]!, lat: pts[0]!.lat - 1, timestamp: pts[0]!.timestamp - 10_000 };
    const r = calculateTripDistance([bad, ...pts]);
    // 3 rejections, then re-anchor; distance only from the consistent cluster
    expect(r.distanceKm).toBeLessThan(1);
    expect(r.distanceKm).toBeGreaterThan(0.5);
  });

  it('drops inaccurate, invalid, duplicate and out-of-order fixes', () => {
    const pts = track(5);
    const r = calculateTripDistance([
      pts[0]!,
      { ...pts[1]!, accuracy: 500 },
      { lat: NaN, lng: 30, timestamp: pts[1]!.timestamp },
      { lat: 0, lng: 0, timestamp: pts[1]!.timestamp },
      pts[2]!,
      pts[2]!, // duplicate
      pts[1]!, // out of order
      pts[3]!,
      pts[4]!,
    ]);
    expect(r.rejected.inaccurate).toBe(1);
    expect(r.rejected.invalid).toBe(2);
    expect(r.rejected.outOfOrder).toBe(2);
    expect(r.distanceKm).toBeCloseTo(0.4, 2);
  });

  it('bridges missing points (signal loss) with a straight line and reports the gap', () => {
    const pts = track(21);
    const withGap = [...pts.slice(0, 5), ...pts.slice(15).map((p) => ({ ...p, timestamp: p.timestamp + 10 * 60_000 }))];
    const r = calculateTripDistance(withGap);
    expect(r.gaps).toBe(1);
    expect(r.distanceKm).toBeCloseTo(2, 1);
  });

  it('derives max speed from positions when the device reports none (1 Hz fixes)', () => {
    const r = calculateTripDistance(track(31, 40, 1)); // 40 m/s
    expect(r.maxSpeedKmh).toBeCloseTo(144, 0);
  });

  it('prefers device-reported speed when available', () => {
    const pts = track(11).map((p, i) => ({ ...p, speed: i === 5 ? 25 : 10 }));
    expect(calculateTripDistance(pts).maxSpeedKmh).toBe(90);
  });

  it('never returns a negative distance', () => {
    expect(calculateTripDistance(track(3).reverse()).distanceKm).toBeGreaterThanOrEqual(0);
  });
});

describe('simplifyPath', () => {
  it('collapses a straight line to its endpoints', () => {
    const pts = track(50);
    expect(simplifyPath(pts)).toHaveLength(2);
  });
  it('keeps corners', () => {
    const a = track(10);
    const last = a[a.length - 1]!;
    const b = Array.from({ length: 10 }, (_, i) => ({ ...last, lng: last.lng + 0.0014 * (i + 1) }));
    expect(simplifyPath([...a, ...b]).length).toBe(3);
  });
});
