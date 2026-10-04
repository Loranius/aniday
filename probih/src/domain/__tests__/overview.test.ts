import { describe, expect, it } from 'vitest';
import { generateDemoData } from '../demo';
import { buildVehicleOverview } from '../overview';

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

describe('demo data + overview', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  const d = generateDemoData('user', now, id);
  const o = buildVehicleOverview(
    { vehicle: d.vehicle, trips: d.trips, odometerEntries: [], maintenanceItems: d.maintenanceItems, maintenanceEvents: d.maintenanceEvents, fuelEntries: d.fuelEntries, places: d.places },
    now,
  );

  it('is flagged as demo everywhere it matters', () => {
    expect(d.vehicle.is_demo).toBe(true);
    expect(d.places.every((p) => p.is_demo)).toBe(true);
    expect(d.trips.every((t) => t.vehicle_id === d.vehicle.id)).toBe(true);
  });

  it('produces a realistic, non-empty dashboard', () => {
    expect(o.odometer.total).toBeGreaterThan(184_500);
    expect(o.avgMonthlyKm).toBeGreaterThan(300);
    expect(o.fuel.litersPer100Km).toBeGreaterThan(7);
    expect(o.fuel.litersPer100Km).toBeLessThan(9);
    const statuses = new Set(o.maintenance.map((m) => m.next.status));
    expect(statuses.has('ok')).toBe(true);
    expect(statuses.has('soon')).toBe(true);
    expect(statuses.has('overdue')).toBe(true);
    expect(o.maintenance[0]!.next.status).toBe('overdue'); // most urgent first
  });

  it('every trip has a valid time range and non-negative distance (DB constraints)', () => {
    for (const t of d.trips) {
      expect(Date.parse(t.ended_at)).toBeGreaterThanOrEqual(Date.parse(t.started_at));
      expect(t.distance_km).toBeGreaterThan(0);
    }
    expect(new Set(d.trips.map((t) => t.started_at)).size).toBe(d.trips.length); // unique (vehicle_id, started_at)
  });
});
