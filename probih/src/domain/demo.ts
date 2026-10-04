/**
 * Demo data (clearly flagged with is_demo = true and removable in one action).
 * Never mixed into a real vehicle: it always creates its own demo vehicle.
 */
import { addDays, toISODate } from './dates';
import { haversineMeters, type LatLng } from './geo';
import { DEFAULT_MAINTENANCE_TEMPLATES } from './maintenance';
import type { FuelEntry, MaintenanceEvent, MaintenanceItem, SavedPlace, Trip, Vehicle } from './types';

export interface DemoData {
  vehicle: Vehicle;
  places: SavedPlace[];
  trips: Trip[];
  maintenanceItems: MaintenanceItem[];
  maintenanceEvents: MaintenanceEvent[];
  fuelEntries: FuelEntry[];
}

/** Deterministic PRNG so the demo looks the same on every run. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLACES = [
  { key: 'home', name: 'Дім', icon: '🏠', lat: 50.501, lng: 30.498 },
  { key: 'work', name: 'Робота', icon: '💼', lat: 50.4265, lng: 30.5383 },
  { key: 'gym', name: 'Зал', icon: '🏋️', lat: 50.459, lng: 30.404 },
  { key: 'shop', name: 'Магазин', icon: '🛒', lat: 50.4855, lng: 30.505 },
] as const;
type PlaceKey = (typeof PLACES)[number]['key'];

/** Event: [template name, days ago, odometer, cost]. Chosen to show every status. */
const EVENTS: [string, number, number, number | null][] = [
  ['Моторне масло', 200, 178_500, 1850],
  ['Масляний фільтр', 200, 178_500, 320],
  ['Повітряний фільтр', 300, 169_200, 450],
  ['Салонний фільтр', 330, 169_500, 380],
  ['Паливний фільтр', 900, 150_000, 900],
  ['Антифриз', 1280, 150_000, 1600],
  ['Гальмівна рідина', 670, 163_000, 700],
  ['Свічки запалювання', 600, 160_000, 1200],
  ['Гальмівні колодки', 560, 162_000, 1400],
  ['Гальмівні диски', 560, 162_000, 3200],
  ['Акумулятор', 1120, 152_000, 3900],
  ['Шини', 1460, 150_000, 12_000],
];

function wigglyPath(a: LatLng, b: LatLng, rnd: () => number, steps = 14): LatLng[] {
  const pts: LatLng[] = [a];
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const off = (rnd() - 0.5) * 0.006;
    pts.push({ lat: a.lat + dy * t + dx * off, lng: a.lng + dx * t - dy * off });
  }
  pts.push(b);
  return pts;
}

function pathKm(pts: LatLng[]): number {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += haversineMeters(pts[i - 1]!, pts[i]!);
  return Math.round(m * 1.12) / 1000; // roads are longer than the sampled polyline
}

export function generateDemoData(userId: string, now: Date, newId: () => string): DemoData {
  const rnd = mulberry32(2008);
  const nowIso = now.toISOString();
  const vehicleId = newId();
  const initialOdometer = 184_000;

  const vehicle: Vehicle = {
    id: vehicleId,
    user_id: userId,
    vin: null,
    license_plate: 'DEMO 2008',
    make: 'Nissan',
    model: 'Tiida',
    year: 2008,
    engine: '1.6 бензин',
    transmission: 'manual',
    fuel_type: 'petrol',
    initial_odometer: initialOdometer,
    current_odometer: initialOdometer,
    is_demo: true,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const places: SavedPlace[] = PLACES.map((p) => ({
    id: newId(),
    user_id: userId,
    name: p.name,
    icon: p.icon,
    latitude: p.lat,
    longitude: p.lng,
    address: null,
    radius_m: 200,
    is_demo: true,
    created_at: nowIso,
  }));
  const placeId = (k: PlaceKey) => places[PLACES.findIndex((p) => p.key === k)]!.id;
  const placeLL = (k: PlaceKey) => {
    const p = PLACES.find((x) => x.key === k)!;
    return { lat: p.lat, lng: p.lng };
  };

  const trips: Trip[] = [];
  const addTrip = (day: Date, hour: number, from: PlaceKey, to: PlaceKey) => {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, Math.floor(rnd() * 50));
    if (start.getTime() > now.getTime()) return;
    const path = wigglyPath(placeLL(from), placeLL(to), rnd);
    const km = pathKm(path);
    const avg = 26 + rnd() * 14; // km/h in city traffic
    const duration = Math.round((km / avg) * 3600);
    const end = new Date(start.getTime() + duration * 1000);
    trips.push({
      id: newId(),
      vehicle_id: vehicleId,
      started_at: start.toISOString(),
      ended_at: end.toISOString(),
      start_lat: path[0]!.lat,
      start_lng: path[0]!.lng,
      end_lat: path[path.length - 1]!.lat,
      end_lng: path[path.length - 1]!.lng,
      distance_km: km,
      duration_seconds: duration,
      average_speed: Math.round(avg * 10) / 10,
      max_speed: Math.round(55 + rnd() * 35),
      route_geometry: { type: 'LineString', coordinates: path.map((p) => [p.lng, p.lat]) },
      start_place_id: placeId(from),
      end_place_id: placeId(to),
      notes: null,
      is_valid: true,
      invalid_reason: null,
      source: 'phone',
      created_at: end.toISOString(),
    });
  };

  for (let d = 60; d >= 0; d--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
    const dow = day.getDay();
    if (dow >= 1 && dow <= 5) {
      addTrip(day, 8, 'home', 'work');
      if (rnd() < 0.3) {
        addTrip(day, 18, 'work', 'shop');
        addTrip(day, 19, 'shop', 'home');
      } else addTrip(day, 18, 'work', 'home');
      if (dow === 2 || dow === 4) {
        addTrip(day, 20, 'home', 'gym');
        addTrip(day, 21, 'gym', 'home');
      }
    } else if (rnd() < 0.7) {
      addTrip(day, 11, 'home', 'shop');
      addTrip(day, 13, 'shop', 'home');
    }
  }
  trips.sort((a, b) => a.started_at.localeCompare(b.started_at));

  const today = toISODate(now);
  const maintenanceItems: MaintenanceItem[] = DEFAULT_MAINTENANCE_TEMPLATES.map((t) => ({
    id: newId(),
    vehicle_id: vehicleId,
    name: t.name,
    icon: t.icon,
    category: t.category,
    interval_km: t.interval_km,
    interval_days: t.interval_days,
    last_service_odometer: null,
    last_service_date: null,
    notes: null,
    enabled: true,
    created_at: nowIso,
    updated_at: nowIso,
  }));
  const maintenanceEvents: MaintenanceEvent[] = EVENTS.flatMap(([name, daysAgo, odometer, cost]) => {
    const item = maintenanceItems.find((i) => i.name === name);
    if (!item) return [];
    return [
      {
        id: newId(),
        vehicle_id: vehicleId,
        maintenance_item_id: item.id,
        date: addDays(today, -daysAgo),
        odometer,
        cost,
        provider: 'СТО (демо)',
        notes: null,
        created_at: nowIso,
      },
    ];
  });

  // Fuel: a full tank roughly every 380–450 km, consumption ≈ 8 L/100 km.
  const fuelEntries: FuelEntry[] = [];
  let odo = initialOdometer;
  let sinceFill = 0;
  const pushFill = (date: string, odometer: number, liters: number) => {
    const price = Math.round((57.5 + rnd() * 2) * 100) / 100;
    fuelEntries.push({
      id: newId(),
      vehicle_id: vehicleId,
      date,
      odometer: Math.round(odometer * 10) / 10,
      liters: Math.round(liters * 100) / 100,
      price_per_liter: price,
      total_cost: Math.round(price * liters * 100) / 100,
      fuel_type: 'petrol',
      station: rnd() < 0.5 ? 'WOG' : 'ОККО',
      full_tank: true,
      notes: null,
      created_at: nowIso,
    });
  };
  if (trips[0]) pushFill(trips[0].started_at.slice(0, 10), odo, 38);
  for (const t of trips) {
    odo += t.distance_km;
    sinceFill += t.distance_km;
    if (sinceFill >= 380 + rnd() * 70) {
      pushFill(t.ended_at.slice(0, 10), odo, (sinceFill * (7.6 + rnd() * 1.0)) / 100);
      sinceFill = 0;
    }
  }

  return { vehicle, places, trips, maintenanceItems, maintenanceEvents, fuelEntries };
}
