import { describe, expect, it } from 'vitest';
import { TripRecorder } from '../tripRecorder';
import { TrackingError, type LocationProvider } from '../locationProvider';
import { memoryStore } from '@/data/storage';
import type { GpsFix } from '@/domain/geo';

class FakeProvider implements LocationProvider {
  source = 'phone' as const;
  supportsBackground = true;
  onFix: ((f: GpsFix) => void) | null = null;
  onError: ((e: TrackingError) => void) | null = null;
  stopped = false;
  failWith: TrackingError | null = null;
  async watch(onFix: (f: GpsFix) => void, onError: (e: TrackingError) => void) {
    if (this.failWith) throw this.failWith;
    this.onFix = onFix;
    this.onError = onError;
    return async () => {
      this.stopped = true;
    };
  }
  async getCurrent(): Promise<GpsFix> {
    throw new Error('not used');
  }
}

const t0 = 1_780_000_000_000;
const fix = (i: number, extra: Partial<GpsFix> = {}): GpsFix => ({ lat: 50.45 + (i * 100) / 111_195, lng: 30.52, timestamp: t0 + i * 10_000, accuracy: 8, ...extra });

describe('TripRecorder', () => {
  it('records a trip and produces a Trip + points', async () => {
    const provider = new FakeProvider();
    let now = t0;
    const rec = new TripRecorder({ provider, store: memoryStore(), now: () => now });
    await rec.start('veh');
    for (let i = 0; i <= 20; i++) {
      now = t0 + i * 10_000;
      provider.onFix!(fix(i));
    }
    expect(rec.getState().liveDistanceKm).toBeCloseTo(2, 1);
    const done = (await rec.finish())!;
    expect(provider.stopped).toBe(true);
    expect(done.trip.vehicle_id).toBe('veh');
    expect(done.trip.distance_km).toBeCloseTo(2, 1);
    expect(done.trip.duration_seconds).toBe(200);
    expect(done.points).toHaveLength(21);
    expect(done.trip.route_geometry?.type).toBe('LineString');
  });

  it('down-samples fixes that arrive too often', async () => {
    const provider = new FakeProvider();
    const rec = new TripRecorder({ provider, store: memoryStore(), now: () => t0 });
    await rec.start('veh');
    for (let i = 0; i < 10; i++) provider.onFix!({ lat: 50.45 + i * 0.00001, lng: 30.52, timestamp: t0 + i * 500, accuracy: 5 });
    expect(rec.getState().trip!.fixes.length).toBe(1);
  });

  it('ignores very inaccurate fixes and reports weak signal', async () => {
    const provider = new FakeProvider();
    const rec = new TripRecorder({ provider, store: memoryStore(), now: () => t0 });
    await rec.start('veh');
    provider.onFix!(fix(0, { accuracy: 300 }));
    expect(rec.getState().trip!.fixes).toHaveLength(0);
    expect(rec.getState().signal).toBe('weak');
  });

  it('survives an app restart: the in-progress trip is restored as interrupted', async () => {
    const store = memoryStore();
    const provider = new FakeProvider();
    let now = t0;
    const rec = new TripRecorder({ provider, store, now: () => now });
    await rec.start('veh');
    for (let i = 0; i <= 5; i++) {
      now = t0 + i * 20_000; // > persist interval
      provider.onFix!(fix(i));
    }
    await rec.persist(true);

    const after = new TripRecorder({ provider: new FakeProvider(), store, now: () => now });
    await after.restore();
    expect(after.getState().status).toBe('interrupted');
    expect(after.getState().trip!.fixes.length).toBe(6);
    await after.resume();
    expect(after.getState().status).toBe('recording');
  });

  it('permission denied before any fix → back to idle with an error', async () => {
    const provider = new FakeProvider();
    provider.failWith = new TrackingError('permission_denied', 'denied');
    const rec = new TripRecorder({ provider, store: memoryStore() });
    await rec.start('veh');
    expect(rec.getState().status).toBe('idle');
    expect(rec.getState().error?.code).toBe('permission_denied');
  });

  it('transient GPS loss keeps recording and recovers on the next fix', async () => {
    const provider = new FakeProvider();
    const rec = new TripRecorder({ provider, store: memoryStore(), now: () => t0 });
    await rec.start('veh');
    provider.onFix!(fix(0));
    provider.onError!(new TrackingError('unavailable', 'tunnel'));
    await new Promise((r) => setTimeout(r, 0));
    expect(rec.getState().status).toBe('recording');
    expect(rec.getState().signal).toBe('lost');
    expect(provider.stopped).toBe(false);
    provider.onFix!(fix(1));
    expect(rec.getState().signal).toBe('good');
    expect(rec.getState().error).toBeNull();
  });

  it('permission revoked mid-trip stops tracking but keeps the recorded part', async () => {
    const provider = new FakeProvider();
    const rec = new TripRecorder({ provider, store: memoryStore(), now: () => t0 });
    await rec.start('veh');
    provider.onFix!(fix(0));
    provider.onFix!(fix(1));
    provider.onError!(new TrackingError('permission_denied', 'revoked'));
    await new Promise((r) => setTimeout(r, 0));
    expect(rec.getState().status).toBe('interrupted');
    expect(provider.stopped).toBe(true);
    expect(rec.getState().trip!.fixes).toHaveLength(2);
  });

  it('throttles live location publishing', async () => {
    const provider = new FakeProvider();
    let now = t0;
    const published: number[] = [];
    const rec = new TripRecorder({ provider, store: memoryStore(), now: () => now, onLiveLocation: (f) => published.push(f.timestamp), liveIntervalMs: 30_000 });
    await rec.start('veh');
    for (let i = 0; i < 10; i++) {
      now = t0 + i * 10_000;
      provider.onFix!(fix(i));
    }
    expect(published.length).toBe(4); // t=0,30,60,90 s
  });
});
