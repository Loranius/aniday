/**
 * Domain entities. Field names mirror the PostgreSQL columns (snake_case) so rows
 * from Supabase can be used directly without a mapping layer.
 * Timestamps are ISO-8601 strings; dates (no time) are 'YYYY-MM-DD'.
 */

export type UUID = string;
export type ISODateTime = string;
export type ISODate = string;

export type FuelType = 'petrol' | 'diesel' | 'lpg' | 'cng' | 'hybrid' | 'electric';
export type Transmission = 'manual' | 'automatic' | 'cvt' | 'robot';

export interface Vehicle {
  id: UUID;
  user_id: UUID;
  vin: string | null;
  license_plate: string | null;
  make: string;
  model: string;
  year: number | null;
  engine: string | null;
  transmission: Transmission | null;
  fuel_type: FuelType;
  /** Odometer reading at the moment tracking started. Baseline for the derived odometer. */
  initial_odometer: number;
  /** Cached derived value, maintained by the database. Never written by the client. */
  current_odometer: number;
  is_demo: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/**
 * Audit trail for odometer changes that do not come from GPS trips.
 * - reading: absolute value seen on the dashboard at `recorded_at` (correction).
 * - manual_distance: km driven without tracking, added on top.
 */
export type OdometerEntryKind = 'reading' | 'manual_distance';

export interface OdometerEntry {
  id: UUID;
  vehicle_id: UUID;
  kind: OdometerEntryKind;
  value_km: number;
  recorded_at: ISODateTime;
  note: string | null;
  created_at: ISODateTime;
}

export type TripSource = 'phone' | 'obd' | 'gps_tracker' | 'manual';

/** GeoJSON LineString, coordinates are [lng, lat]. */
export interface LineStringGeometry {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface Trip {
  id: UUID;
  vehicle_id: UUID;
  started_at: ISODateTime;
  ended_at: ISODateTime;
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  distance_km: number;
  duration_seconds: number;
  /** km/h */
  average_speed: number | null;
  /** km/h */
  max_speed: number | null;
  route_geometry: LineStringGeometry | null;
  start_place_id: UUID | null;
  end_place_id: UUID | null;
  notes: string | null;
  /** Invalid trips stay in history but are excluded from the odometer. */
  is_valid: boolean;
  invalid_reason: string | null;
  source: TripSource;
  created_at: ISODateTime;
}

export interface TripPoint {
  trip_id: UUID;
  seq: number;
  recorded_at: ISODateTime;
  latitude: number;
  longitude: number;
  /** m/s */
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
}

export type LocationSource = 'phone' | 'obd' | 'gps_tracker' | 'manual';

export interface VehicleLocation {
  id: UUID;
  vehicle_id: UUID;
  timestamp: ISODateTime;
  latitude: number;
  longitude: number;
  /** m/s */
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  source: LocationSource;
}

export interface SavedPlace {
  id: UUID;
  user_id: UUID;
  name: string;
  icon: string;
  latitude: number;
  longitude: number;
  address: string | null;
  /** Radius (m) used to match trip start/end to this place. */
  radius_m: number;
  is_demo: boolean;
  created_at: ISODateTime;
}

export type MaintenanceCategory =
  | 'engine'
  | 'filters'
  | 'fluids'
  | 'brakes'
  | 'ignition'
  | 'electrical'
  | 'tires'
  | 'other';

export interface MaintenanceItem {
  id: UUID;
  vehicle_id: UUID;
  name: string;
  icon: string;
  category: MaintenanceCategory;
  interval_km: number | null;
  interval_days: number | null;
  /** Derived from the latest MaintenanceEvent (or set as a baseline when the item is created). */
  last_service_odometer: number | null;
  last_service_date: ISODate | null;
  notes: string | null;
  enabled: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface MaintenanceEvent {
  id: UUID;
  vehicle_id: UUID;
  maintenance_item_id: UUID;
  date: ISODate;
  odometer: number;
  cost: number | null;
  provider: string | null;
  notes: string | null;
  created_at: ISODateTime;
}

export interface FuelEntry {
  id: UUID;
  vehicle_id: UUID;
  date: ISODate;
  odometer: number;
  liters: number;
  price_per_liter: number | null;
  total_cost: number | null;
  fuel_type: FuelType;
  station: string | null;
  full_tank: boolean;
  notes: string | null;
  created_at: ISODateTime;
}

export interface Profile {
  id: UUID;
  display_name: string | null;
  created_at: ISODateTime;
}

/** Maintenance status ladder. `unknown` = no baseline (never serviced / not entered). */
export type MaintenanceStatus = 'ok' | 'soon' | 'due' | 'overdue' | 'unknown';
