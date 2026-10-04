import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAppData } from '@/app/appDataContext';
import { Button, Card, PageHeader, SectionTitle, Sheet } from '@/ui/primitives';
import { MaintenanceRow } from './MaintenanceRow';
import { MaintenanceEventForm, MaintenanceItemForm } from './forms';

export function MaintenanceScreen() {
  const { bundle, overview, actions } = useAppData();
  const [adding, setAdding] = useState(false);
  const [logging, setLogging] = useState(false);
  if (!bundle || !overview) return null;

  const known = overview.maintenance.filter((r) => r.next.status !== 'unknown');
  const unknown = overview.maintenance.filter((r) => r.next.status === 'unknown');
  const disabled = bundle.maintenanceItems.filter((i) => !i.enabled);
  const enabledItems = bundle.maintenanceItems.filter((i) => i.enabled);

  return (
    <div>
      <PageHeader
        title="Обслуговування"
        subtitle="Прогнози орієнтовні — за вашим середнім пробігом"
        action={
          <Button variant="secondary" onClick={() => setAdding(true)} aria-label="Додати позицію">
            <Plus size={18} />
          </Button>
        }
      />
      <Button className="mt-2 w-full" onClick={() => setLogging(true)} disabled={enabledItems.length === 0}>
        Записати заміну
      </Button>

      {known.length > 0 && (
        <Card className="mt-4 divide-y divide-line py-1">
          {known.map((r) => (
            <Link key={r.item.id} to={`/maintenance/${r.item.id}`} className="block">
              <MaintenanceRow row={r} />
            </Link>
          ))}
        </Card>
      )}

      {unknown.length > 0 && (
        <>
          <SectionTitle>Без історії</SectionTitle>
          <p className="mb-2 px-1 text-sm text-muted">Вкажіть, коли їх міняли востаннє — тоді з’явиться статус і прогноз.</p>
          <Card className="divide-y divide-line py-1">
            {unknown.map((r) => (
              <Link key={r.item.id} to={`/maintenance/${r.item.id}`} className="flex min-h-14 items-center gap-3 py-2">
                <span className="text-xl">{r.item.icon}</span>
                <span className="flex-1">{r.item.name}</span>
                <span className="text-sm text-muted">
                  {[r.item.interval_km && `${(r.item.interval_km / 1000).toLocaleString('uk-UA')} тис. км`, r.item.interval_days && `${Math.round(r.item.interval_days / 30.4375)} міс.`]
                    .filter(Boolean)
                    .join(' / ')}
                </span>
              </Link>
            ))}
          </Card>
        </>
      )}

      {disabled.length > 0 && (
        <>
          <SectionTitle>Вимкнені</SectionTitle>
          <Card className="divide-y divide-line py-1 opacity-70">
            {disabled.map((i) => (
              <Link key={i.id} to={`/maintenance/${i.id}`} className="flex min-h-12 items-center gap-3 py-2">
                <span className="text-xl">{i.icon}</span>
                <span>{i.name}</span>
              </Link>
            ))}
          </Card>
        </>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title="Нова позиція">
        <MaintenanceItemForm
          onSubmit={async (item, initial) => {
            await actions.saveMaintenanceItem(item);
            if (initial) await actions.addMaintenanceEvent({ maintenance_item_id: item.id, date: initial.date, odometer: initial.odometer, cost: null, provider: null, notes: 'Початкові дані' });
            setAdding(false);
          }}
        />
      </Sheet>
      <Sheet open={logging} onClose={() => setLogging(false)} title="Записати заміну">
        <MaintenanceEventForm
          items={enabledItems}
          currentOdometer={overview.odometer.total}
          onSubmit={async (ev) => {
            await actions.addMaintenanceEvent(ev);
            setLogging(false);
          }}
        />
      </Sheet>
    </div>
  );
}
