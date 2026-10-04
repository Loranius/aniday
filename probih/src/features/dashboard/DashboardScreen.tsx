import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, CloudOff, Fuel, Play } from 'lucide-react';
import { useAppData } from '@/app/appDataContext';
import { MaintenanceRow } from '@/features/maintenance/MaintenanceRow';
import { formatInt, formatKm, formatMoney, formatMoney2, formatNumber1, pluralTrips } from '@/ui/format';
import { Banner, Button, Card, SectionTitle, Stat } from '@/ui/primitives';

export function DashboardScreen() {
  const { activeVehicle: v, overview, sync, online, recorder, actions } = useAppData();
  const navigate = useNavigate();
  if (!v || !overview) return null;

  const upcoming = overview.maintenance.filter((r) => r.next.status !== 'unknown').slice(0, 3);
  const unknownCount = overview.maintenance.filter((r) => r.next.status === 'unknown').length;
  const recording = recorder.status === 'recording' || recorder.status === 'starting';

  return (
    <div className="pt-2">
      <header className="safe-top pb-1 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">
              {v.make} {v.model}
            </h1>
            <div className="truncate text-sm text-muted">
              {[v.year, v.engine, v.license_plate].filter(Boolean).join(' · ')}
            </div>
          </div>
          {v.is_demo && <span className="rounded-full bg-soon/15 px-2.5 py-1 text-xs font-medium text-soon">ДЕМО</span>}
        </div>
      </header>

      {(!online || sync.pending.length > 0 || sync.failed.length > 0) && (
        <div className="mt-3">
          <Banner
            tone={sync.failed.length ? 'error' : 'warn'}
            action={
              <Link to="/more/sync" className="shrink-0 text-accent">
                Деталі
              </Link>
            }
          >
            <span className="flex items-center gap-2">
              <CloudOff size={16} />
              {sync.failed.length
                ? `${sync.failed.length} змін не прийнято сервером`
                : sync.pending.length
                  ? `${sync.pending.length} змін очікують синхронізації`
                  : 'Офлайн — нові дані збережуться на телефоні'}
            </span>
          </Banner>
        </div>
      )}

      <Card className="mt-4">
        <div className="text-sm text-muted">Пробіг</div>
        <div className="tabular mt-0.5 text-4xl font-semibold tracking-tight">{formatKm(overview.odometer.total)}</div>
        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3">
          <Stat label="Сьогодні" value={formatKm(overview.today.km, 1)} sub={pluralTrips(overview.today.count)} />
          <Stat label="За місяць ≈" value={overview.avgMonthlyKm != null ? formatKm(overview.avgMonthlyKm) : '—'} sub="середнє" />
          <Stat
            label="Витрата"
            value={overview.fuel.litersPer100Km != null ? `${formatNumber1(overview.fuel.litersPer100Km)} л` : '—'}
            sub="на 100 км"
          />
        </div>
        {!recording && (
          <Button
            className="mt-4 w-full"
            onClick={async () => {
              navigate('/map');
              await actions.startTrip();
            }}
          >
            <Play size={18} /> Почати поїздку
          </Button>
        )}
      </Card>

      <SectionTitle
        action={
          <Link to="/maintenance" className="flex items-center text-sm text-accent">
            Усе <ChevronRight size={16} />
          </Link>
        }
      >
        Найближче обслуговування
      </SectionTitle>
      <Card className="py-1">
        {upcoming.length === 0 ? (
          <div className="py-4 text-sm text-muted">
            Вкажіть, коли востаннє міняли масло та інші розхідники — і тут з’явиться, що і коли замінити.
            <Link to="/maintenance" className="mt-2 block text-accent">
              Заповнити історію обслуговування →
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {upcoming.map((r) => (
              <Link key={r.item.id} to={`/maintenance/${r.item.id}`} className="block">
                <MaintenanceRow row={r} />
              </Link>
            ))}
          </div>
        )}
        {upcoming.length > 0 && unknownCount > 0 && (
          <Link to="/maintenance" className="block border-t border-line py-3 text-sm text-muted">
            Ще {unknownCount} позицій без історії →
          </Link>
        )}
      </Card>

      <SectionTitle
        action={
          <Link to="/more/fuel" className="flex items-center text-sm text-accent">
            Заправки <ChevronRight size={16} />
          </Link>
        }
      >
        Паливо
      </SectionTitle>
      <Card onClick={() => navigate('/more/fuel')}>
        <div className="flex items-center gap-3">
          <Fuel className="shrink-0 text-muted" size={22} />
          <div className="grid flex-1 grid-cols-3 gap-3">
            <Stat label="Вартість км" value={overview.fuel.costPerKm != null ? formatMoney2(overview.fuel.costPerKm) : '—'} />
            <Stat label="Цей місяць" value={formatMoney(overview.fuel.monthToDate)} />
            <Stat label="Середньо/міс" value={overview.fuel.monthlyAverage != null ? formatMoney(overview.fuel.monthlyAverage) : '—'} />
          </div>
        </div>
      </Card>
      <p className="mt-6 text-center text-xs text-muted">
        Облік з {formatInt(v.initial_odometer)} км · прогнози орієнтовні
      </p>
    </div>
  );
}
