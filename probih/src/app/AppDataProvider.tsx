import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { App as CapApp } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { supabase } from '@/data/supabaseClient';
import { SupabaseRepository, SupabaseSyncTransport } from '@/data/supabaseRepository';
import { applyPendingOps, SyncQueue, type NewSyncOp, type SyncOp, type SyncState, type TableRows } from '@/data/syncQueue';
import { preferencesStore, readJson, writeJson } from '@/data/storage';
import { newId } from '@/data/ids';
import { buildVehicleOverview, type VehicleBundle } from '@/domain/overview';
import { generateDemoData } from '@/domain/demo';
import { DEFAULT_MAINTENANCE_TEMPLATES } from '@/domain/maintenance';
import { matchPlace } from '@/domain/trips';
import type {
  FuelEntry,
  MaintenanceEvent,
  MaintenanceItem,
  OdometerEntry,
  SavedPlace,
  Trip,
  Vehicle,
} from '@/domain/types';
import { locationProvider, setLiveLocationSink, tripRecorder } from '@/tracking/instance';
import type { FinishedTrip, RecorderState } from '@/tracking/tripRecorder';
import { AppDataContext, type AppActions, type AppDataValue } from './appDataContext';

/** Everything in one snapshot: vehicles + saved places + rows of the active vehicle. */
type Snapshot = TableRows;
const EMPTY_SYNC: SyncState = { pending: [], failed: [], syncing: false, lastSyncedAt: null, lastError: null };
const ACTIVE_VEHICLE_KEY = 'ui:active-vehicle';

const rows = <T,>(s: Snapshot, t: keyof Snapshot) => (s[t] ?? []) as unknown as T[];
const now = () => new Date().toISOString();

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [activeVehicleId, setActiveVehicleIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncState>(EMPTY_SYNC);
  const [online, setOnline] = useState(true);
  const [recorderState, setRecorderState] = useState<RecorderState>(tripRecorder.getState());
  const [clock, setClock] = useState(() => new Date());

  const userId = session?.user.id ?? null;
  const repo = useMemo(() => (supabase && userId ? new SupabaseRepository(supabase) : null), [userId]);
  const queue = useMemo(
    () => (supabase && userId ? new SyncQueue(preferencesStore, new SupabaseSyncTransport(supabase), userId) : null),
    [userId],
  );
  const cacheKey = userId ? `cache:snapshot:v1:${userId}` : null;
  const activeRef = useRef(activeVehicleId);
  activeRef.current = activeVehicleId;

  // ---- auth -----------------------------------------------------------------
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // ---- recorder -------------------------------------------------------------
  useEffect(() => {
    void tripRecorder.restore();
    const unsubscribe = tripRecorder.subscribe(setRecorderState);
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    setLiveLocationSink(
      repo
        ? (fix, vehicleId) => {
            // Best effort: live position is ephemeral, the trip itself goes through the queue.
            repo
              .publishLocation({
                vehicle_id: vehicleId,
                timestamp: new Date(fix.timestamp).toISOString(),
                latitude: fix.lat,
                longitude: fix.lng,
                speed: fix.speed != null && fix.speed >= 0 ? fix.speed : null,
                heading: fix.heading ?? null,
                accuracy: fix.accuracy ?? null,
                source: 'phone',
              })
              .catch(() => undefined);
          }
        : null,
    );
  }, [repo]);

  // ---- sync queue -----------------------------------------------------------
  useEffect(() => {
    if (!queue) {
      setSync(EMPTY_SYNC);
      return;
    }
    const unsubscribe = queue.subscribe(setSync);
    return () => {
      unsubscribe();
    };
  }, [queue]);

  // ---- loading --------------------------------------------------------------
  const refresh = useCallback(async () => {
    if (!repo || !cacheKey) return;
    setLoading(true);
    try {
      const [vehicles, places] = await Promise.all([repo.listVehicles(), repo.listPlaces()]);
      const stored = activeRef.current ?? (await preferencesStore.get(ACTIVE_VEHICLE_KEY));
      const pendingVehicles = (queue?.getState().pending ?? []).flatMap((op) =>
        op.kind === 'insert' && op.table === 'vehicles' ? (op.rows as unknown as Vehicle[]) : [],
      );
      const all = [...vehicles, ...pendingVehicles.filter((p) => !vehicles.some((v) => v.id === p.id))];
      const active = all.find((v) => v.id === stored) ?? all.find((v) => !v.is_demo) ?? all[0] ?? null;
      let next: Snapshot = { vehicles: vehicles as never, saved_places: places as never };
      if (active && vehicles.some((v) => v.id === active.id)) {
        const b = await repo.loadBundle(active, places);
        next = {
          ...next,
          trips: b.trips as never,
          odometer_entries: b.odometerEntries as never,
          maintenance_items: b.maintenanceItems as never,
          maintenance_events: b.maintenanceEvents as never,
          fuel_entries: b.fuelEntries as never,
        };
      }
      setSnapshot(next);
      setActiveVehicleIdState(active?.id ?? null);
      setLoadError(null);
      await writeJson(preferencesStore, cacheKey, { snapshot: next, activeVehicleId: active?.id ?? null });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [repo, cacheKey, queue]);

  // Offline start: show the cached snapshot immediately, then refresh from the server.
  useEffect(() => {
    if (!cacheKey) {
      setSnapshot({});
      setActiveVehicleIdState(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const cached = await readJson<{ snapshot: Snapshot; activeVehicleId: string | null }>(preferencesStore, cacheKey);
      if (cached && !cancelled) {
        setSnapshot(cached.snapshot);
        setActiveVehicleIdState(cached.activeVehicleId);
      }
      await queue?.ready();
      if (!cancelled) await refresh();
      void queue?.flush();
    })();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, queue, refresh]);

  // After the queue drains, pull server-derived values.
  const lastSynced = sync.lastSyncedAt;
  useEffect(() => {
    if (lastSynced) void refresh();
  }, [lastSynced, refresh]);

  // ---- connectivity & lifecycle --------------------------------------------
  useEffect(() => {
    const handles: Promise<{ remove: () => Promise<void> }>[] = [];
    void Network.getStatus().then((s) => setOnline(s.connected));
    handles.push(
      Network.addListener('networkStatusChange', (s) => {
        setOnline(s.connected);
        if (s.connected) void queue?.flush();
      }),
    );
    handles.push(
      CapApp.addListener('resume', () => {
        setClock(new Date());
        void queue?.flush();
      }),
    );
    handles.push(CapApp.addListener('pause', () => void tripRecorder.persist(true)));
    const retry = setInterval(() => {
      if ((queue?.getState().pending.length ?? 0) > 0) void queue?.flush();
      setClock(new Date());
    }, 60_000);
    return () => {
      clearInterval(retry);
      handles.forEach((h) => void h.then((x) => x.remove()));
    };
  }, [queue]);

  // ---- derived view -----------------------------------------------------------
  const merged = useMemo(() => applyPendingOps(snapshot, sync.pending), [snapshot, sync.pending]);
  const vehicles = useMemo(() => rows<Vehicle>(merged, 'vehicles'), [merged]);
  const activeVehicle = vehicles.find((v) => v.id === activeVehicleId) ?? null;

  const bundle: VehicleBundle | null = useMemo(() => {
    if (!activeVehicle) return null;
    const own = <T extends { vehicle_id: string }>(t: keyof Snapshot) => rows<T>(merged, t).filter((r) => r.vehicle_id === activeVehicle.id);
    return {
      vehicle: activeVehicle,
      trips: own<Trip>('trips').sort((a, b) => b.started_at.localeCompare(a.started_at)),
      odometerEntries: own<OdometerEntry>('odometer_entries'),
      maintenanceItems: own<MaintenanceItem>('maintenance_items'),
      maintenanceEvents: own<MaintenanceEvent>('maintenance_events').sort((a, b) => b.date.localeCompare(a.date)),
      fuelEntries: own<FuelEntry>('fuel_entries').sort((a, b) => b.date.localeCompare(a.date) || b.odometer - a.odometer),
      places: rows<SavedPlace>(merged, 'saved_places'),
    };
  }, [merged, activeVehicle]);

  const overview = useMemo(() => (bundle ? buildVehicleOverview(bundle, clock) : null), [bundle, clock]);

  // ---- actions ------------------------------------------------------------------
  const write = useCallback(
    async (op: NewSyncOp) => {
      if (!queue) throw new Error('Не виконано вхід');
      const full = { ...op, id: 'local', createdAt: now() } as SyncOp;
      setSnapshot((s) => applyPendingOps(s, [full]));
      await queue.enqueue(op);
    },
    [queue],
  );

  const actions: AppActions = useMemo(() => {
    const requireVehicle = () => {
      if (!activeVehicle) throw new Error('Спершу додайте автомобіль');
      return activeVehicle;
    };
    return {
      async createVehicle(input) {
        if (!userId) throw new Error('Не виконано вхід');
        const t = now();
        const vehicle: Vehicle = { ...input, id: newId(), user_id: userId, current_odometer: input.initial_odometer, is_demo: false, created_at: t, updated_at: t };
        await write({ kind: 'insert', table: 'vehicles', rows: [vehicle as never] });
        // Starter maintenance list with editable generic intervals (no service history yet).
        const items: MaintenanceItem[] = DEFAULT_MAINTENANCE_TEMPLATES.map((tpl) => ({
          ...tpl,
          id: newId(),
          vehicle_id: vehicle.id,
          last_service_odometer: null,
          last_service_date: null,
          notes: null,
          enabled: true,
          created_at: t,
          updated_at: t,
        }));
        await write({ kind: 'insert', table: 'maintenance_items', rows: items as never });
        setActiveVehicleIdState(vehicle.id);
        await preferencesStore.set(ACTIVE_VEHICLE_KEY, vehicle.id);
        return vehicle;
      },
      async updateVehicle(patch) {
        const v = requireVehicle();
        await write({ kind: 'update', table: 'vehicles', rowId: v.id, patch });
      },
      async setActiveVehicle(id) {
        setActiveVehicleIdState(id);
        activeRef.current = id;
        await preferencesStore.set(ACTIVE_VEHICLE_KEY, id);
        await refresh();
      },
      async addOdometerEntry(kind, valueKm, note) {
        const v = requireVehicle();
        const e: OdometerEntry = { id: newId(), vehicle_id: v.id, kind, value_km: valueKm, recorded_at: now(), note: note || null, created_at: now() };
        await write({ kind: 'insert', table: 'odometer_entries', rows: [e as never] });
      },
      async deleteOdometerEntry(id) {
        await write({ kind: 'delete', table: 'odometer_entries', rowId: id });
      },
      async startTrip() {
        const v = requireVehicle();
        await tripRecorder.start(v.id);
      },
      async saveTrip(finished: FinishedTrip) {
        const places = rows<SavedPlace>(merged, 'saved_places');
        const trip: Trip = {
          ...finished.trip,
          start_place_id: matchPlace(finished.trip.start_lat, finished.trip.start_lng, places),
          end_place_id: matchPlace(finished.trip.end_lat, finished.trip.end_lng, places),
        };
        await write({ kind: 'trip', trip, points: finished.points });
        await tripRecorder.reset();
        return trip;
      },
      async discardTrip() {
        await tripRecorder.reset();
      },
      async updateTrip(id, patch) {
        await write({ kind: 'update', table: 'trips', rowId: id, patch });
      },
      async saveMaintenanceItem(item) {
        const v = requireVehicle();
        const exists = rows<MaintenanceItem>(merged, 'maintenance_items').some((i) => i.id === item.id);
        if (exists) {
          const { id, ...patch } = item;
          await write({ kind: 'update', table: 'maintenance_items', rowId: id, patch });
        } else {
          const full: MaintenanceItem = {
            vehicle_id: v.id,
            last_service_odometer: null,
            last_service_date: null,
            created_at: now(),
            updated_at: now(),
            ...item,
          };
          await write({ kind: 'insert', table: 'maintenance_items', rows: [full as never] });
        }
      },
      async deleteMaintenanceItem(id) {
        await write({ kind: 'delete', table: 'maintenance_items', rowId: id });
      },
      async addMaintenanceEvent(ev) {
        const v = requireVehicle();
        const full: MaintenanceEvent = { ...ev, id: newId(), vehicle_id: v.id, created_at: now() };
        await write({ kind: 'insert', table: 'maintenance_events', rows: [full as never] });
      },
      async deleteMaintenanceEvent(id) {
        await write({ kind: 'delete', table: 'maintenance_events', rowId: id });
      },
      async addFuelEntry(entry) {
        const v = requireVehicle();
        const full: FuelEntry = { ...entry, id: newId(), vehicle_id: v.id, created_at: now() };
        await write({ kind: 'insert', table: 'fuel_entries', rows: [full as never] });
      },
      async deleteFuelEntry(id) {
        await write({ kind: 'delete', table: 'fuel_entries', rowId: id });
      },
      async addPlace(place) {
        if (!userId) throw new Error('Не виконано вхід');
        const full: SavedPlace = { ...place, id: newId(), user_id: userId, is_demo: false, created_at: now() };
        await write({ kind: 'insert', table: 'saved_places', rows: [full as never] });
      },
      async deletePlace(id) {
        await write({ kind: 'delete', table: 'saved_places', rowId: id });
      },
      async loadDemo() {
        if (!userId) throw new Error('Не виконано вхід');
        if (rows<Vehicle>(merged, 'vehicles').some((v) => v.is_demo)) return;
        const d = generateDemoData(userId, new Date(), newId);
        await write({ kind: 'insert', table: 'vehicles', rows: [d.vehicle as never] });
        await write({ kind: 'insert', table: 'saved_places', rows: d.places as never });
        await write({ kind: 'insert', table: 'maintenance_items', rows: d.maintenanceItems as never });
        await write({ kind: 'insert', table: 'maintenance_events', rows: d.maintenanceEvents as never });
        await write({ kind: 'insert', table: 'trips', rows: d.trips as never });
        await write({ kind: 'insert', table: 'fuel_entries', rows: d.fuelEntries as never });
        setActiveVehicleIdState(d.vehicle.id);
        await preferencesStore.set(ACTIVE_VEHICLE_KEY, d.vehicle.id);
      },
      async removeDemo() {
        // Deleting the demo vehicle cascades to all of its rows on the server.
        for (const v of rows<Vehicle>(merged, 'vehicles').filter((x) => x.is_demo)) {
          await write({ kind: 'delete', table: 'vehicles', rowId: v.id });
        }
        for (const p of rows<SavedPlace>(merged, 'saved_places').filter((x) => x.is_demo)) {
          await write({ kind: 'delete', table: 'saved_places', rowId: p.id });
        }
        const real = rows<Vehicle>(merged, 'vehicles').find((v) => !v.is_demo);
        setActiveVehicleIdState(real?.id ?? null);
        await queue?.flush();
        await refresh();
      },
      async signOut() {
        await tripRecorder.reset();
        await supabase?.auth.signOut();
      },
    };
  }, [activeVehicle, merged, userId, write, refresh, queue]);

  const value: AppDataValue = {
    configured: Boolean(supabase),
    authReady,
    session,
    online,
    sync,
    queue,
    repo,
    loading,
    loadError,
    refresh,
    vehicles,
    activeVehicle,
    bundle,
    overview,
    now: clock,
    recorder: recorderState,
    tripRecorder,
    locationProvider,
    actions,
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}
