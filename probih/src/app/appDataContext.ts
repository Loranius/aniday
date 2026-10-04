import { createContext, useContext } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { SupabaseRepository } from '@/data/supabaseRepository';
import type { SyncQueue, SyncState } from '@/data/syncQueue';
import type { VehicleBundle, VehicleOverview } from '@/domain/overview';
import type {
  FuelEntry,
  MaintenanceEvent,
  MaintenanceItem,
  OdometerEntryKind,
  SavedPlace,
  Trip,
  Vehicle,
} from '@/domain/types';
import type { LocationProvider } from '@/tracking/locationProvider';
import type { FinishedTrip, RecorderState, TripRecorder } from '@/tracking/tripRecorder';

export type VehicleInput = Pick<
  Vehicle,
  'vin' | 'license_plate' | 'make' | 'model' | 'year' | 'engine' | 'transmission' | 'fuel_type' | 'initial_odometer'
>;
export type MaintenanceItemInput = Omit<
  MaintenanceItem,
  'vehicle_id' | 'last_service_odometer' | 'last_service_date' | 'created_at' | 'updated_at'
>;

export interface AppActions {
  createVehicle(input: VehicleInput): Promise<Vehicle>;
  updateVehicle(patch: Partial<VehicleInput>): Promise<void>;
  setActiveVehicle(id: string): Promise<void>;
  addOdometerEntry(kind: OdometerEntryKind, valueKm: number, note?: string): Promise<void>;
  deleteOdometerEntry(id: string): Promise<void>;
  startTrip(): Promise<void>;
  saveTrip(finished: FinishedTrip): Promise<Trip>;
  discardTrip(): Promise<void>;
  updateTrip(id: string, patch: Partial<Pick<Trip, 'notes' | 'is_valid' | 'invalid_reason' | 'start_place_id' | 'end_place_id'>>): Promise<void>;
  saveMaintenanceItem(item: MaintenanceItemInput): Promise<void>;
  deleteMaintenanceItem(id: string): Promise<void>;
  addMaintenanceEvent(ev: Omit<MaintenanceEvent, 'id' | 'vehicle_id' | 'created_at'>): Promise<void>;
  deleteMaintenanceEvent(id: string): Promise<void>;
  addFuelEntry(entry: Omit<FuelEntry, 'id' | 'vehicle_id' | 'created_at'>): Promise<void>;
  deleteFuelEntry(id: string): Promise<void>;
  addPlace(place: Omit<SavedPlace, 'id' | 'user_id' | 'is_demo' | 'created_at'>): Promise<void>;
  deletePlace(id: string): Promise<void>;
  loadDemo(): Promise<void>;
  removeDemo(): Promise<void>;
  signOut(): Promise<void>;
}

export interface AppDataValue {
  configured: boolean;
  authReady: boolean;
  session: Session | null;
  online: boolean;
  sync: SyncState;
  queue: SyncQueue | null;
  repo: SupabaseRepository | null;
  loading: boolean;
  loadError: string | null;
  refresh(): Promise<void>;
  vehicles: Vehicle[];
  activeVehicle: Vehicle | null;
  bundle: VehicleBundle | null;
  overview: VehicleOverview | null;
  now: Date;
  recorder: RecorderState;
  tripRecorder: TripRecorder;
  locationProvider: LocationProvider;
  actions: AppActions;
}

export const AppDataContext = createContext<AppDataValue | null>(null);

export function useAppData(): AppDataValue {
  const v = useContext(AppDataContext);
  if (!v) throw new Error('useAppData must be used inside <AppDataProvider>');
  return v;
}
