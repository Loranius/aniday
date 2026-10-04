import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { useAppData } from '@/app/appDataContext';
import { CATEGORY_LABELS } from '@/domain/maintenance';
import { formatDate, formatForecast, formatInt, formatKm, formatMoney } from '@/ui/format';
import { Button, Card, EmptyState, PageHeader, SectionTitle, Sheet, Stat } from '@/ui/primitives';
import { ProgressBar, StatusBadge } from '@/ui/status';
import { BackLink } from '@/ui/BackLink';
import { describeRemaining } from './describe';
import { MaintenanceEventForm, MaintenanceItemForm } from './forms';

export function MaintenanceItemScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { bundle, overview, actions } = useAppData();
  const [logging, setLogging] = useState(false);
  const [editing, setEditing] = useState(false);
  if (!bundle || !overview) return null;
  const item = bundle.maintenanceItems.find((i) => i.id === id);
  if (!item) return <EmptyState icon="🤷" title="Позицію не знайдено" action={<BackLink to="/maintenance" />} />;
  const row = overview.maintenance.find((r) => r.item.id === item.id);
  const events = bundle.maintenanceEvents.filter((e) => e.maintenance_item_id === item.id);
  const totalCost = events.reduce((s, e) => s + (e.cost ?? 0), 0);

  return (
    <div>
      <PageHeader
        back={<BackLink to="/maintenance" label="Обслуговування" />}
        title={`${item.icon} ${item.name}`}
        subtitle={CATEGORY_LABELS[item.category]}
        action={row && <StatusBadge status={row.next.status} />}
      />

      {row && row.next.status !== 'unknown' && (
        <Card className="mt-2 space-y-3">
          <ProgressBar value={row.next.progress} status={row.next.status} />
          <div className="tabular text-lg font-semibold">{describeRemaining(row).remaining}</div>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Остання заміна" value={row.lastServiceDate ? formatDate(row.lastServiceDate) : '—'} sub={row.lastServiceOdometer != null ? formatKm(row.lastServiceOdometer) : undefined} />
            <Stat
              label="Наступна"
              value={row.next.dueOdometer != null ? formatKm(row.next.dueOdometer) : row.next.dueDate ? formatDate(row.next.dueDate) : '—'}
              sub={row.next.dueOdometer != null && row.next.dueDate ? `або до ${formatDate(row.next.dueDate)}` : undefined}
            />
          </div>
          {row.estimate && (
            <div className="rounded-xl bg-surface-2 p-3 text-sm">
              <div className="font-medium">
                {row.estimate.basis === 'mileage' ? formatForecast(row.estimate.monthsRemaining) : `До ${formatDate(row.estimate.date)}`}
              </div>
              <div className="text-muted">
                {row.estimate.basis === 'mileage'
                  ? `≈ ${formatDate(row.estimate.date)} при ${formatInt(overview.avgMonthlyKm ?? 0)} км/міс. Це прогноз, не гарантована дата.`
                  : 'Обмеження за часом настане раніше, ніж за пробігом.'}
              </div>
            </div>
          )}
        </Card>
      )}

      <Card className="mt-4 grid grid-cols-2 gap-4">
        <Stat label="Інтервал (км)" value={item.interval_km ? formatKm(item.interval_km) : '—'} />
        <Stat label="Інтервал (час)" value={item.interval_days ? `${Math.round(item.interval_days / 30.4375)} міс.` : '—'} />
      </Card>
      {item.notes && <p className="mt-3 px-1 text-sm text-muted">{item.notes}</p>}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button onClick={() => setLogging(true)}>Записати заміну</Button>
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Змінити інтервал
        </Button>
      </div>

      <SectionTitle>Історія{totalCost > 0 && ` · ${formatMoney(totalCost)}`}</SectionTitle>
      {events.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Немає записів. Додайте останню заміну, щоб рахувати залишок.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-line py-1">
          {events.map((e) => (
            <div key={e.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{formatDate(e.date)}</div>
                <div className="tabular text-sm text-muted">
                  {formatKm(e.odometer)}
                  {e.cost != null && ` · ${formatMoney(e.cost)}`}
                  {e.provider && ` · ${e.provider}`}
                </div>
                {e.notes && <div className="text-sm text-muted">{e.notes}</div>}
              </div>
              <button
                aria-label="Видалити запис"
                className="grid h-11 w-11 place-items-center text-muted"
                onClick={() => confirm('Видалити цей запис?') && void actions.deleteMaintenanceEvent(e.id)}
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </Card>
      )}

      <Button
        variant="danger"
        className="mt-8 w-full"
        onClick={async () => {
          if (!confirm(`Видалити «${item.name}» разом з історією?`)) return;
          await actions.deleteMaintenanceItem(item.id);
          navigate('/maintenance');
        }}
      >
        Видалити позицію
      </Button>

      <Sheet open={logging} onClose={() => setLogging(false)} title="Записати заміну">
        <MaintenanceEventForm
          items={[item]}
          defaultItemId={item.id}
          currentOdometer={overview.odometer.total}
          onSubmit={async (ev) => {
            await actions.addMaintenanceEvent(ev);
            setLogging(false);
          }}
        />
      </Sheet>
      <Sheet open={editing} onClose={() => setEditing(false)} title="Налаштування позиції">
        <MaintenanceItemForm
          item={item}
          onSubmit={async (it) => {
            await actions.saveMaintenanceItem(it);
            setEditing(false);
          }}
        />
      </Sheet>
    </div>
  );
}
