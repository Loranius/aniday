import { calculateTripDistance, type GpsFix } from '@/domain/geo';
import { summarizeTrip, type TripSummary } from '@/domain/trips';
import type { Trip, TripPoint } from '@/domain/types';
import { newId } from '@/data/ids';
import { readJson, writeJson, type KeyValueStore } from '@/data/storage';
import { TrackingError, type LocationProvider } from './locationProvider';

/**
 * Battery-conscious sampling: the OS delivers a fix after `distanceFilterM` of movement;
 * we store at most one fix per `minIntervalMs` unless the car moved `minMoveM` (corners).
 */
export const SAMPLING = {
  distanceFilterM: 10,
  minIntervalMs: 5_000,
  minMoveM: 30,
  /** Fixes worse than this are not stored at all. */
  discardAccuracyM: 100,
  goodAccuracyM: 20,
  /** No fix for this long = signal lost (tunnel, parking garage). */
  lostAfterMs: 30_000,
  persistEveryMs: 15_000,
};

export type SignalQuality = 'searching' | 'good' | 'weak' | 'lost';

export interface ActiveTrip {
  id: string;
  vehicleId: string;
  startedAt: number;
  fixes: GpsFix[];
}

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'interrupted';

export interface RecorderState {
  status: RecorderStatus;
  trip: ActiveTrip | null;
  liveDistanceKm: number;
  signal: SignalQuality;
  lastFix: GpsFix | null;
  error: TrackingError | null;
  backgroundSupported: boolean;
}

export interface FinishedTrip {
  trip: Trip;
  points: TripPoint[];
  summary: TripSummary;
}

const STORE_KEY = 'tracking:active-trip:v1';

export interface TripRecorderDeps {
  provider: LocationProvider;
  store: KeyValueStore;
  now?: () => number;
  /** Throttled live position (e.g. published to vehicle_locations for realtime). */
  onLiveLocation?: (fix: GpsFix, vehicleId: string) => void;
  liveIntervalMs?: number;
}

export class TripRecorder {
  private state: RecorderState;
  private stopWatch: (() => Promise<void>) | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private lastPersist = 0;
  private lastLive = 0;
  private listeners = new Set<(s: RecorderState) => void>();
  private now: () => number;

  constructor(private deps: TripRecorderDeps) {
    this.now = deps.now ?? Date.now;
    this.state = {
      status: 'idle',
      trip: null,
      liveDistanceKm: 0,
      signal: 'searching',
      lastFix: null,
      error: null,
      backgroundSupported: deps.provider.supportsBackground,
    };
  }

  getState() {
    return this.state;
  }

  subscribe(fn: (s: RecorderState) => void) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<RecorderState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }

  /** After an app restart: a trip that was being recorded is restored as "interrupted". */
  async restore(): Promise<void> {
    if (this.state.status !== 'idle') return;
    const saved = await readJson<ActiveTrip>(this.deps.store, STORE_KEY);
    if (!saved) return;
    this.set({
      status: 'interrupted',
      trip: saved,
      liveDistanceKm: calculateTripDistance(saved.fixes).distanceKm,
      lastFix: saved.fixes[saved.fixes.length - 1] ?? null,
    });
  }

  async start(vehicleId: string): Promise<void> {
    if (this.state.status === 'recording' || this.state.status === 'starting') return;
    const trip: ActiveTrip = { id: newId(), vehicleId, startedAt: this.now(), fixes: [] };
    this.set({ status: 'starting', trip, liveDistanceKm: 0, signal: 'searching', lastFix: null, error: null });
    await this.persist(true);
    await this.startWatching();
  }

  /** Continue an interrupted trip (the gap is bridged by the distance filter). */
  async resume(): Promise<void> {
    if (this.state.status !== 'interrupted' || !this.state.trip) return;
    this.set({ status: 'starting', error: null, signal: 'searching' });
    await this.startWatching();
  }

  private async startWatching() {
    try {
      this.stopWatch = await this.deps.provider.watch(
        (fix) => this.onFix(fix),
        (err) => void this.onError(err),
        {
          backgroundTitle: 'Пробіг: запис поїздки',
          backgroundMessage: 'Записуємо маршрут і кілометраж',
          distanceFilterM: SAMPLING.distanceFilterM,
        },
      );
      this.set({ status: 'recording' });
      this.watchdog = setInterval(() => this.checkSignal(), 5_000);
    } catch (e) {
      const err = e instanceof TrackingError ? e : new TrackingError('unknown', e instanceof Error ? e.message : String(e));
      await this.onError(err);
    }
  }

  private async onError(err: TrackingError) {
    if (err.code !== 'permission_denied') {
      // Transient (tunnel, GPS momentarily off, timeout): keep the watcher alive, the next fix clears it.
      this.set({ signal: 'lost', error: err });
      return;
    }
    // Permission revoked: stop the watcher but keep what was recorded.
    await this.stopWatching();
    const hasData = (this.state.trip?.fixes.length ?? 0) > 0;
    if (!hasData) await this.deps.store.remove(STORE_KEY);
    this.set({ status: hasData ? 'interrupted' : 'idle', trip: hasData ? this.state.trip : null, error: err });
  }

  /** Exposed for tests; called by the provider. */
  onFix(fix: GpsFix) {
    const trip = this.state.trip;
    if (!trip || (this.state.status !== 'recording' && this.state.status !== 'starting')) return;
    const signal: SignalQuality =
      fix.accuracy == null || fix.accuracy <= SAMPLING.goodAccuracyM ? 'good' : 'weak';
    if (fix.accuracy != null && fix.accuracy > SAMPLING.discardAccuracyM) {
      this.set({ signal: 'weak', lastFix: fix });
      return;
    }
    const prev = trip.fixes[trip.fixes.length - 1];
    let keep = !prev;
    if (prev) {
      const dt = fix.timestamp - prev.timestamp;
      if (dt <= 0) return;
      const moved = calculateTripDistance([prev, fix], { minMoveM: 0 }).distanceKm * 1000;
      keep = dt >= SAMPLING.minIntervalMs || moved >= SAMPLING.minMoveM;
    }
    let liveDistanceKm = this.state.liveDistanceKm;
    let nextTrip = trip;
    if (keep) {
      nextTrip = { ...trip, fixes: [...trip.fixes, fix] };
      liveDistanceKm = calculateTripDistance(nextTrip.fixes).distanceKm;
    }
    this.set({ trip: nextTrip, liveDistanceKm, signal, lastFix: fix, error: null, status: 'recording' });
    void this.persist(false);
    const t = this.now();
    if (this.deps.onLiveLocation && t - this.lastLive >= (this.deps.liveIntervalMs ?? 30_000)) {
      this.lastLive = t;
      this.deps.onLiveLocation(fix, trip.vehicleId);
    }
  }

  private checkSignal() {
    const last = this.state.lastFix;
    if (this.state.status !== 'recording') return;
    if (!last || this.now() - last.timestamp > SAMPLING.lostAfterMs) {
      if (this.state.signal !== 'lost' && (last || this.now() - (this.state.trip?.startedAt ?? 0) > SAMPLING.lostAfterMs)) {
        this.set({ signal: 'lost' });
      }
    }
  }

  /** Saves the in-progress trip so an app kill / crash does not lose it. */
  async persist(force: boolean) {
    const t = this.now();
    if (!force && t - this.lastPersist < SAMPLING.persistEveryMs) return;
    this.lastPersist = t;
    if (this.state.trip) await writeJson(this.deps.store, STORE_KEY, this.state.trip);
  }

  private async stopWatching() {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    const stop = this.stopWatch;
    this.stopWatch = null;
    if (stop) {
      try {
        await stop();
      } catch {
        /* watcher already gone */
      }
    }
  }

  /** Stops tracking and returns the finished trip (not yet saved). */
  async finish(): Promise<FinishedTrip | null> {
    const trip = this.state.trip;
    await this.stopWatching();
    if (!trip) return null;
    await this.persist(true);
    // Stays restorable until reset() — if saving fails the trip is not lost.
    this.set({ status: 'interrupted' });
    const lastTs = trip.fixes[trip.fixes.length - 1]?.timestamp;
    const endedAt = Math.max(trip.startedAt, lastTs ?? this.now());
    const summary = summarizeTrip(trip.fixes, trip.startedAt, endedAt);
    const result: FinishedTrip = {
      trip: {
        id: trip.id,
        vehicle_id: trip.vehicleId,
        started_at: new Date(trip.startedAt).toISOString(),
        ended_at: new Date(endedAt).toISOString(),
        start_lat: summary.start_lat,
        start_lng: summary.start_lng,
        end_lat: summary.end_lat,
        end_lng: summary.end_lng,
        distance_km: summary.distance_km,
        duration_seconds: summary.duration_seconds,
        average_speed: summary.average_speed,
        max_speed: summary.max_speed,
        route_geometry: summary.route_geometry,
        start_place_id: null,
        end_place_id: null,
        notes: summary.gaps > 0 ? 'Були перерви GPS-сигналу' : null,
        is_valid: true,
        invalid_reason: null,
        source: this.deps.provider.source,
        created_at: new Date(this.now()).toISOString(),
      },
      points: trip.fixes.map((f, seq) => ({
        trip_id: trip.id,
        seq,
        recorded_at: new Date(f.timestamp).toISOString(),
        latitude: f.lat,
        longitude: f.lng,
        speed: f.speed != null && f.speed >= 0 ? f.speed : null,
        heading: f.heading ?? null,
        accuracy: f.accuracy ?? null,
      })),
      summary,
    };
    return result;
  }

  /** Clears the active trip after it was saved (or discarded). */
  async reset(): Promise<void> {
    await this.stopWatching();
    await this.deps.store.remove(STORE_KEY);
    this.set({ status: 'idle', trip: null, liveDistanceKm: 0, signal: 'searching', lastFix: null, error: null });
  }
}
