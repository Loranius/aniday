import { useAppData } from '@/app/appDataContext';
import type { SyncOp } from '@/data/syncQueue';
import { formatDate, formatTime } from '@/ui/format';
import { Banner, Button, Card, PageHeader, SectionTitle } from '@/ui/primitives';
import { BackLink } from '@/ui/BackLink';

const TABLE_LABELS: Record<string, string> = {
  vehicles: 'Автомобіль',
  odometer_entries: 'Пробіг',
  trips: 'Поїздка',
  saved_places: 'Місце',
  maintenance_items: 'Позиція ТО',
  maintenance_events: 'Заміна',
  fuel_entries: 'Заправка',
};

function describe(op: SyncOp): string {
  if (op.kind === 'trip') return `Поїздка ${op.trip.distance_km} км (${op.points.length} точок)`;
  const what = TABLE_LABELS[op.table] ?? op.table;
  if (op.kind === 'insert') return `${what}: додати ${op.rows.length > 1 ? `(${op.rows.length})` : ''}`;
  if (op.kind === 'update') return `${what}: змінити`;
  return `${what}: видалити`;
}

export function SyncScreen() {
  const { sync, online, queue, refresh, loadError } = useAppData();
  return (
    <div>
      <PageHeader back={<BackLink to="/more" />} title="Синхронізація" />
      <div className="space-y-2">
        <Banner tone={online ? 'info' : 'warn'}>{online ? 'Є підключення до інтернету' : 'Немає інтернету — зміни зберігаються на телефоні'}</Banner>
        {sync.lastError && <Banner tone="warn">Остання спроба: {sync.lastError}</Banner>}
        {loadError && <Banner tone="warn">Завантаження: {loadError}</Banner>}
      </div>
      <Card className="mt-4 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">У черзі</span>
          <span>{sync.pending.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Остання синхронізація</span>
          <span>{sync.lastSyncedAt ? `${formatDate(sync.lastSyncedAt)} ${formatTime(sync.lastSyncedAt)}` : '—'}</span>
        </div>
      </Card>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" disabled={sync.syncing} onClick={() => void queue?.flush()}>
          {sync.syncing ? 'Синхронізую…' : 'Надіслати зараз'}
        </Button>
        <Button variant="secondary" onClick={() => void refresh()}>
          Оновити дані
        </Button>
      </div>

      {sync.pending.length > 0 && (
        <>
          <SectionTitle>Очікують відправки</SectionTitle>
          <Card className="divide-y divide-line py-1 text-sm">
            {sync.pending.map((op) => (
              <div key={op.id} className="flex justify-between gap-3 py-2.5">
                <span>{describe(op)}</span>
                <span className="shrink-0 text-muted">{formatTime(op.createdAt)}</span>
              </div>
            ))}
          </Card>
        </>
      )}

      {sync.failed.length > 0 && (
        <>
          <SectionTitle>Не прийнято сервером</SectionTitle>
          <Card className="divide-y divide-line py-1 text-sm">
            {sync.failed.map((f) => (
              <div key={f.op.id} className="py-2.5">
                <div>{describe(f.op)}</div>
                <div className="text-xs text-due">{f.error}</div>
              </div>
            ))}
          </Card>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => void queue?.retryFailed()}>
              Повторити
            </Button>
            <Button variant="danger" onClick={() => confirm('Відкинути ці зміни назавжди?') && void queue?.discardFailed()}>
              Відкинути
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
