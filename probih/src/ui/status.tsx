import type { MaintenanceStatus } from '@/domain/types';
import { STATUS_META } from './statusMeta';
import { cn } from './cn';

export function StatusBadge({ status, className }: { status: MaintenanceStatus; className?: string }) {
  const m = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        status === 'overdue' ? 'bg-due text-white dark:bg-due/25 dark:text-overdue' : 'bg-surface-2',
        status !== 'overdue' && m.text,
        className,
      )}
    >
      <span aria-hidden>{m.dot}</span>
      {m.label}
    </span>
  );
}

export function ProgressBar({ value, status }: { value: number | null; status: MaintenanceStatus }) {
  const pct = value == null ? 0 : Math.min(100, Math.max(0, value * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full', STATUS_META[status].bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}
