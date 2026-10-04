import type { MaintenanceOverviewRow } from '@/domain/overview';
import { formatDate, formatInt, formatKm } from '@/ui/format';

/** "6 357 / 10 000 км · Залишилось 3 643 км" or the time-based equivalent. */
export function describeRemaining(row: MaintenanceOverviewRow): { usage: string | null; remaining: string } {
  const { next, item } = row;
  if (next.status === 'unknown') return { usage: null, remaining: 'Додайте дату або пробіг останньої заміни' };
  const usage =
    next.kmSinceService != null && item.interval_km
      ? `${formatInt(next.kmSinceService)} / ${formatInt(item.interval_km)} км`
      : null;
  if (next.limitingFactor === 'km' && next.kmRemaining != null) {
    return {
      usage,
      remaining: next.kmRemaining >= 0 ? `Залишилось ${formatKm(next.kmRemaining)}` : `Перепробіг ${formatKm(-next.kmRemaining)}`,
    };
  }
  if (next.daysRemaining != null && next.dueDate) {
    return {
      usage,
      remaining: next.daysRemaining >= 0 ? `Заміна до ${formatDate(next.dueDate)}` : `Прострочено з ${formatDate(next.dueDate)}`,
    };
  }
  return { usage, remaining: '' };
}
