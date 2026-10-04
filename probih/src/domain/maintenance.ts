import { daysBetween, addDays } from './dates';
import type {
  ISODate,
  MaintenanceCategory,
  MaintenanceEvent,
  MaintenanceItem,
  MaintenanceStatus,
} from './types';

/** Thresholds on the consumed share of an interval (km or time, whichever is larger). */
export const STATUS_THRESHOLDS = {
  /** From this share the item is "soon" (e.g. 8 500 / 10 000 km). */
  soon: 0.85,
  /** From this share the item is "due" — replace now (e.g. 9 700 / 10 000 km). */
  due: 0.97,
  /** Above 100 % it is overdue. */
  overdue: 1,
} as const;

export function calculateMaintenanceStatus(progress: number | null): MaintenanceStatus {
  if (progress == null || !Number.isFinite(progress)) return 'unknown';
  if (progress > STATUS_THRESHOLDS.overdue) return 'overdue';
  if (progress >= STATUS_THRESHOLDS.due) return 'due';
  if (progress >= STATUS_THRESHOLDS.soon) return 'soon';
  return 'ok';
}

export interface LastService {
  odometer: number | null;
  date: ISODate | null;
}

/**
 * Latest service for an item: the most recent event by date (ties: higher odometer).
 * A service performed earlier than planned simply becomes the new baseline.
 */
export function deriveLastService(
  itemId: string,
  events: readonly Pick<MaintenanceEvent, 'maintenance_item_id' | 'date' | 'odometer'>[],
): LastService {
  let best: { date: ISODate; odometer: number } | null = null;
  for (const e of events) {
    if (e.maintenance_item_id !== itemId) continue;
    if (!best || e.date > best.date || (e.date === best.date && e.odometer > best.odometer)) {
      best = { date: e.date, odometer: e.odometer };
    }
  }
  return { odometer: best?.odometer ?? null, date: best?.date ?? null };
}

export interface NextServiceInfo {
  status: MaintenanceStatus;
  /** Max of km and time share consumed (1 = 100 %). */
  progress: number | null;
  limitingFactor: 'km' | 'time' | null;
  kmSinceService: number | null;
  /** Negative when overdue. */
  kmRemaining: number | null;
  dueOdometer: number | null;
  daysSinceService: number | null;
  /** Negative when overdue. */
  daysRemaining: number | null;
  dueDate: ISODate | null;
}

type ItemIntervals = Pick<MaintenanceItem, 'interval_km' | 'interval_days'>;

/** Next service by mileage OR time — whichever comes first. */
export function calculateNextService(
  item: ItemIntervals,
  last: LastService,
  currentOdometer: number,
  today: ISODate,
): NextServiceInfo {
  const intervalKm = item.interval_km && item.interval_km > 0 ? item.interval_km : null;
  const intervalDays = item.interval_days && item.interval_days > 0 ? item.interval_days : null;

  let kmSince: number | null = null;
  let kmRemaining: number | null = null;
  let dueOdometer: number | null = null;
  let kmShare: number | null = null;
  if (intervalKm != null && last.odometer != null) {
    // A service logged with a higher odometer than the current one (typo or unsynced trips)
    // must not produce negative usage.
    kmSince = Math.max(0, Math.round(currentOdometer - last.odometer));
    dueOdometer = last.odometer + intervalKm;
    kmRemaining = Math.round(dueOdometer - Math.max(currentOdometer, last.odometer));
    kmShare = kmSince / intervalKm;
  }

  let daysSince: number | null = null;
  let daysRemaining: number | null = null;
  let dueDate: ISODate | null = null;
  let timeShare: number | null = null;
  if (intervalDays != null && last.date != null) {
    daysSince = Math.max(0, daysBetween(last.date, today));
    dueDate = addDays(last.date, intervalDays);
    daysRemaining = daysBetween(today, dueDate);
    timeShare = daysSince / intervalDays;
  }

  let progress: number | null = null;
  let limitingFactor: NextServiceInfo['limitingFactor'] = null;
  if (kmShare != null) {
    progress = kmShare;
    limitingFactor = 'km';
  }
  if (timeShare != null && (progress == null || timeShare > progress)) {
    progress = timeShare;
    limitingFactor = 'time';
  }

  return {
    status: calculateMaintenanceStatus(progress),
    progress,
    limitingFactor,
    kmSinceService: kmSince,
    kmRemaining,
    dueOdometer,
    daysSinceService: daysSince,
    daysRemaining,
    dueDate,
  };
}

const STATUS_RANK: Record<MaintenanceStatus, number> = { overdue: 0, due: 1, soon: 2, ok: 3, unknown: 4 };

/** Most urgent first; within the same status, larger consumed share first. */
export function compareByUrgency(a: NextServiceInfo, b: NextServiceInfo): number {
  const r = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (r !== 0) return r;
  return (b.progress ?? -1) - (a.progress ?? -1);
}

export interface MaintenanceTemplate {
  name: string;
  icon: string;
  category: MaintenanceCategory;
  interval_km: number | null;
  interval_days: number | null;
}

/**
 * Generic starting intervals. They are copied into the user's own items and can be edited —
 * nothing here is tied to a specific car model.
 */
export const DEFAULT_MAINTENANCE_TEMPLATES: readonly MaintenanceTemplate[] = [
  { name: 'Моторне масло', icon: '🛢️', category: 'engine', interval_km: 10_000, interval_days: 365 },
  { name: 'Масляний фільтр', icon: '🧴', category: 'filters', interval_km: 10_000, interval_days: 365 },
  { name: 'Повітряний фільтр', icon: '🌬️', category: 'filters', interval_km: 20_000, interval_days: 730 },
  { name: 'Салонний фільтр', icon: '🍃', category: 'filters', interval_km: 15_000, interval_days: 365 },
  { name: 'Паливний фільтр', icon: '⛽', category: 'filters', interval_km: 40_000, interval_days: null },
  { name: 'Антифриз', icon: '❄️', category: 'fluids', interval_km: 60_000, interval_days: 1460 },
  { name: 'Гальмівна рідина', icon: '🛑', category: 'fluids', interval_km: null, interval_days: 730 },
  { name: 'Свічки запалювання', icon: '⚡', category: 'ignition', interval_km: 30_000, interval_days: null },
  { name: 'Гальмівні колодки', icon: '🧱', category: 'brakes', interval_km: 30_000, interval_days: null },
  { name: 'Гальмівні диски', icon: '💿', category: 'brakes', interval_km: 60_000, interval_days: null },
  { name: 'Акумулятор', icon: '🔋', category: 'electrical', interval_km: null, interval_days: 1825 },
  { name: 'Шини', icon: '🛞', category: 'tires', interval_km: 50_000, interval_days: 2190 },
];

export const CATEGORY_LABELS: Record<MaintenanceCategory, string> = {
  engine: 'Двигун',
  filters: 'Фільтри',
  fluids: 'Рідини',
  brakes: 'Гальма',
  ignition: 'Запалювання',
  electrical: 'Електрика',
  tires: 'Шини',
  other: 'Інше',
};
