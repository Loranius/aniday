import { toISODate } from './dates';
import { calculateFuelConsumption, calculateCostPerKm, calculateFuelCostSummary } from './fuel';
import { calculateNextService, compareByUrgency, deriveLastService, type NextServiceInfo } from './maintenance';
import { calculateOdometerBreakdown, summarizeTripsForDay, type OdometerBreakdown } from './odometer';
import { calculateAverageMonthlyMileage, estimateServiceDate, type ServiceDateEstimate } from './prediction';
import type {
  FuelEntry,
  MaintenanceEvent,
  MaintenanceItem,
  OdometerEntry,
  SavedPlace,
  Trip,
  Vehicle,
} from './types';

/** Everything that belongs to one vehicle, as loaded from the backend (+ unsynced local changes). */
export interface VehicleBundle {
  vehicle: Vehicle;
  trips: Trip[];
  odometerEntries: OdometerEntry[];
  maintenanceItems: MaintenanceItem[];
  maintenanceEvents: MaintenanceEvent[];
  fuelEntries: FuelEntry[];
  places: SavedPlace[];
}

export interface MaintenanceOverviewRow {
  item: MaintenanceItem;
  next: NextServiceInfo;
  lastServiceOdometer: number | null;
  lastServiceDate: string | null;
  /** Forecast only — never a guaranteed date. */
  estimate: ServiceDateEstimate | null;
}

export interface VehicleOverview {
  odometer: OdometerBreakdown;
  today: { km: number; count: number };
  avgMonthlyKm: number | null;
  maintenance: MaintenanceOverviewRow[];
  fuel: {
    litersPer100Km: number | null;
    costPerKm: number | null;
    costPer100Km: number | null;
    monthToDate: number;
    monthlyAverage: number | null;
    last365: number;
  };
}

/** Single place where the dashboard numbers are derived. Pure. */
export function buildVehicleOverview(b: VehicleBundle, now: Date): VehicleOverview {
  const odometer = calculateOdometerBreakdown({
    initialOdometer: b.vehicle.initial_odometer,
    trips: b.trips,
    entries: b.odometerEntries,
  });
  const today = toISODate(now);
  const avgMonthlyKm = calculateAverageMonthlyMileage(b.trips, b.odometerEntries, now);

  const maintenance = b.maintenanceItems
    .filter((i) => i.enabled)
    .map((item) => {
      const last = deriveLastService(item.id, b.maintenanceEvents);
      const next = calculateNextService(item, last, odometer.total, today);
      const estimate =
        next.status === 'unknown'
          ? null
          : estimateServiceDate({ kmRemaining: next.kmRemaining, avgMonthlyKm, dueDate: next.dueDate, today: now });
      return { item, next, lastServiceOdometer: last.odometer, lastServiceDate: last.date, estimate };
    })
    .sort((a, b2) => compareByUrgency(a.next, b2.next));

  const consumption = calculateFuelConsumption(b.fuelEntries);
  const cost = calculateCostPerKm(b.fuelEntries);
  const costSummary = calculateFuelCostSummary(b.fuelEntries, today);

  return {
    odometer,
    today: summarizeTripsForDay(b.trips, now),
    avgMonthlyKm,
    maintenance,
    fuel: {
      litersPer100Km: consumption.litersPer100Km,
      costPerKm: cost?.perKm ?? null,
      costPer100Km: cost?.per100Km ?? null,
      ...costSummary,
    },
  };
}
