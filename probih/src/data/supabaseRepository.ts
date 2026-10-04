import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { VehicleBundle } from '@/domain/overview';
import type { LineStringGeometry, SavedPlace, Trip, TripPoint, Vehicle, VehicleLocation } from '@/domain/types';
import type { ApplyResult, SyncOp, SyncTransport } from './syncQueue';

/** Trip columns for lists (route geometry is loaded on demand). */
const TRIP_LIST_COLUMNS =
  'id,vehicle_id,started_at,ended_at,start_lat,start_lng,end_lat,end_lng,distance_km,duration_seconds,average_speed,max_speed,start_place_id,end_place_id,notes,is_valid,invalid_reason,source,created_at';

const PAGE = 1000;
const POINT_CHUNK = 500;

/** PostgREST caps responses (1000 rows by default), so long histories are paged. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) return all;
  }
}

export class SupabaseRepository {
  constructor(private db: SupabaseClient) {}

  async listVehicles(): Promise<Vehicle[]> {
    const { data, error } = await this.db.from('vehicles').select('*').order('created_at');
    if (error) throw error;
    return data as Vehicle[];
  }

  async listPlaces(): Promise<SavedPlace[]> {
    const { data, error } = await this.db.from('saved_places').select('*').order('created_at');
    if (error) throw error;
    return data as SavedPlace[];
  }

  async loadBundle(vehicle: Vehicle, places: SavedPlace[]): Promise<VehicleBundle> {
    const id = vehicle.id;
    const [trips, odometerEntries, maintenanceItems, maintenanceEvents, fuelEntries] = await Promise.all([
      fetchAll<Omit<Trip, 'route_geometry'>>((a, b) =>
        this.db.from('trips').select(TRIP_LIST_COLUMNS).eq('vehicle_id', id).order('started_at', { ascending: false }).range(a, b).returns<Omit<Trip, 'route_geometry'>[]>(),
      ),
      fetchAll((a, b) => this.db.from('odometer_entries').select('*').eq('vehicle_id', id).order('recorded_at').range(a, b)),
      fetchAll((a, b) => this.db.from('maintenance_items').select('*').eq('vehicle_id', id).order('created_at').range(a, b)),
      fetchAll((a, b) =>
        this.db.from('maintenance_events').select('*').eq('vehicle_id', id).order('date', { ascending: false }).range(a, b),
      ),
      fetchAll((a, b) => this.db.from('fuel_entries').select('*').eq('vehicle_id', id).order('date', { ascending: false }).range(a, b)),
    ]);
    return {
      vehicle,
      trips: trips.map((t) => ({ ...t, route_geometry: null })),
      odometerEntries,
      maintenanceItems,
      maintenanceEvents,
      fuelEntries,
      places,
    } as VehicleBundle;
  }

  async getTripGeometry(tripId: string): Promise<LineStringGeometry | null> {
    const { data, error } = await this.db.from('trips').select('route_geometry').eq('id', tripId).maybeSingle();
    if (error) throw error;
    return (data?.route_geometry as LineStringGeometry | null) ?? null;
  }

  async getTripGeometries(tripIds: string[]): Promise<Record<string, LineStringGeometry | null>> {
    if (tripIds.length === 0) return {};
    const { data, error } = await this.db.from('trips').select('id,route_geometry').in('id', tripIds);
    if (error) throw error;
    return Object.fromEntries((data ?? []).map((r) => [r.id as string, r.route_geometry as LineStringGeometry | null]));
  }

  async publishLocation(loc: Omit<VehicleLocation, 'id'>): Promise<void> {
    const { error } = await this.db.from('vehicle_locations').insert(loc);
    if (error) throw error;
  }

  async latestLocation(vehicleId: string): Promise<VehicleLocation | null> {
    const { data, error } = await this.db
      .from('vehicle_locations')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data as VehicleLocation | null;
  }

  /** Live location from any source (phone today; OBD / GPS tracker later). */
  subscribeLocations(vehicleId: string, onLocation: (l: VehicleLocation) => void): () => void {
    const channel = this.db
      .channel(`vehicle-locations-${vehicleId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'vehicle_locations', filter: `vehicle_id=eq.${vehicleId}` },
        (payload) => onLocation(payload.new as VehicleLocation),
      )
      .subscribe();
    return () => {
      void this.db.removeChannel(channel);
    };
  }
}

/** Duplicate key = the row is already on the server (idempotent replay). */
const isDuplicate = (e: PostgrestError) => e.code === '23505';

function classify(error: PostgrestError | null, status: number): ApplyResult {
  if (!error) return { ok: true };
  if (isDuplicate(error)) return { ok: true };
  // status 0 / missing = network failure; 401 = expired token (refreshed on next attempt).
  const retryable = !status || status >= 500 || status === 401 || status === 408 || status === 429;
  return { ok: false, retryable, error: `${error.code ?? status}: ${error.message}` };
}

export class SupabaseSyncTransport implements SyncTransport {
  constructor(private db: SupabaseClient) {}

  async apply(op: SyncOp): Promise<ApplyResult> {
    switch (op.kind) {
      case 'insert': {
        const rows = op.rows.map(stripDerived(op.table));
        const r = await this.db.from(op.table).upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
        return classify(r.error, r.status);
      }
      case 'update': {
        const r = await this.db.from(op.table).update(stripDerived(op.table)(op.patch)).eq('id', op.rowId);
        return classify(r.error, r.status);
      }
      case 'delete': {
        const r = await this.db.from(op.table).delete().eq('id', op.rowId);
        return classify(r.error, r.status);
      }
      case 'trip': {
        const r = await this.db.from('trips').upsert(op.trip, { onConflict: 'id', ignoreDuplicates: true });
        const res = classify(r.error, r.status);
        if (!res.ok) return res;
        for (let i = 0; i < op.points.length; i += POINT_CHUNK) {
          const chunk: TripPoint[] = op.points.slice(i, i + POINT_CHUNK);
          const p = await this.db.from('trip_points').upsert(chunk, { onConflict: 'trip_id,seq', ignoreDuplicates: true });
          const pr = classify(p.error, p.status);
          if (!pr.ok) return pr;
        }
        return { ok: true };
      }
    }
  }
}

/** Server-derived columns are never sent (the database recomputes them anyway). */
function stripDerived(table: string) {
  return <T extends Record<string, unknown>>(row: T): T => {
    const copy: Record<string, unknown> = { ...row };
    delete copy.created_at;
    delete copy.updated_at;
    if (table === 'vehicles') delete copy.current_odometer;
    if (table === 'maintenance_items') {
      delete copy.last_service_odometer;
      delete copy.last_service_date;
    }
    return copy as T;
  };
}
