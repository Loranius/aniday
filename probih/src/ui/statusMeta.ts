import type { MaintenanceStatus } from '@/domain/types';

export const STATUS_META: Record<MaintenanceStatus, { label: string; dot: string; text: string; bar: string }> = {
  ok: { label: 'OK', dot: '🟢', text: 'text-ok', bar: 'bg-ok' },
  soon: { label: 'Скоро', dot: '🟡', text: 'text-soon', bar: 'bg-soon' },
  due: { label: 'Час замінити', dot: '🔴', text: 'text-due', bar: 'bg-due' },
  overdue: { label: 'Прострочено', dot: '⚫', text: 'text-overdue', bar: 'bg-due' },
  unknown: { label: 'Немає даних', dot: '⚪', text: 'text-muted', bar: 'bg-line' },
};
