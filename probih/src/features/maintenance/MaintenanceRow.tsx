import type { MaintenanceOverviewRow } from '@/domain/overview';
import { formatForecast } from '@/ui/format';
import { describeRemaining } from './describe';
import { ProgressBar, StatusBadge } from '@/ui/status';

export function MaintenanceRow({ row, compact = false }: { row: MaintenanceOverviewRow; compact?: boolean }) {
  const { item, next, estimate } = row;
  const { usage, remaining } = describeRemaining(row);
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-xl" aria-hidden>
            {item.icon}
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium">{item.name}</div>
            {usage && <div className="tabular text-sm text-muted">{usage}</div>}
          </div>
        </div>
        <StatusBadge status={next.status} />
      </div>
      {next.progress != null && (
        <div className="mt-2.5">
          <ProgressBar value={next.progress} status={next.status} />
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-sm">
        <span className="tabular">{remaining}</span>
        {!compact && estimate?.basis === 'mileage' && next.status !== 'overdue' && (
          <span className="text-muted" title="Прогноз за середнім пробігом, не гарантована дата">
            {formatForecast(estimate.monthsRemaining)}
          </span>
        )}
      </div>
    </div>
  );
}
