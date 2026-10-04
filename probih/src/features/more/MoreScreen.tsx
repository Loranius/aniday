import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Car, ChevronRight, Cloud, Fuel, Gauge, LogOut, MapPin, Moon } from 'lucide-react';
import { useAppData } from '@/app/appDataContext';
import { getTheme, setTheme, type ThemeMode } from '@/app/theme';
import { Button, Card, PageHeader, SectionTitle, Select } from '@/ui/primitives';

function Row({ to, icon, label, value }: { to: string; icon: ReactNode; label: string; value?: ReactNode }) {
  return (
    <Link to={to} className="flex min-h-14 items-center gap-3 py-2">
      <span className="text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {value && <span className="text-sm text-muted">{value}</span>}
      <ChevronRight size={18} className="text-muted" />
    </Link>
  );
}

export function MoreScreen() {
  const { session, vehicles, activeVehicle, actions, sync } = useAppData();
  const [theme, setThemeState] = useState<ThemeMode>(getTheme());
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const hasDemo = vehicles.some((v) => v.is_demo);

  return (
    <div>
      <PageHeader title="Ще" subtitle={session?.user.email} />
      <Card className="divide-y divide-line py-0">
        <Row to="/more/fuel" icon={<Fuel size={20} />} label="Паливо" />
        <Row to="/more/places" icon={<MapPin size={20} />} label="Збережені місця" />
        <Row to="/more/odometer" icon={<Gauge size={20} />} label="Пробіг і коригування" />
        <Row to="/more/vehicle" icon={<Car size={20} />} label="Автомобіль" value={activeVehicle ? `${activeVehicle.make} ${activeVehicle.model}` : undefined} />
        <Row to="/more/sync" icon={<Cloud size={20} />} label="Синхронізація" value={sync.pending.length ? `${sync.pending.length} в черзі` : 'OK'} />
      </Card>

      {vehicles.length > 1 && (
        <>
          <SectionTitle>Активний автомобіль</SectionTitle>
          <Card>
            <Select value={activeVehicle?.id ?? ''} onChange={(e) => void actions.setActiveVehicle(e.target.value)}>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.make} {v.model}{v.is_demo ? ' (демо)' : ''}
                </option>
              ))}
            </Select>
          </Card>
        </>
      )}

      <SectionTitle>Вигляд</SectionTitle>
      <Card>
        <label className="flex items-center gap-3">
          <Moon size={20} className="text-muted" />
          <span className="flex-1">Тема</span>
          <Select
            className="w-40"
            value={theme}
            onChange={(e) => {
              const m = e.target.value as ThemeMode;
              setTheme(m);
              setThemeState(m);
            }}
          >
            <option value="dark">Темна</option>
            <option value="light">Світла</option>
            <option value="system">Як у системі</option>
          </Select>
        </label>
      </Card>

      <SectionTitle>Демо-дані</SectionTitle>
      <Card className="space-y-3">
        <p className="text-sm text-muted">
          Демо-авто з поїздками, заправками й обслуговуванням. Зберігається окремо від ваших даних (позначка «демо») і видаляється
          повністю.
        </p>
        <Button
          variant={hasDemo ? 'danger' : 'secondary'}
          className="w-full"
          disabled={busy}
          onClick={async () => {
            if (hasDemo && !confirm('Видалити демо-авто і всі демо-дані?')) return;
            setBusy(true);
            try {
              if (hasDemo) await actions.removeDemo();
              else {
                await actions.loadDemo();
                navigate('/car');
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          {hasDemo ? 'Видалити демо-дані' : 'Завантажити демо-авто'}
        </Button>
      </Card>

      <Button variant="secondary" className="mt-6 w-full" onClick={() => confirm('Вийти з акаунта?') && void actions.signOut()}>
        <LogOut size={18} /> Вийти
      </Button>
      <p className="mt-6 text-center text-xs text-muted">Пробіг 0.1 · дані на мапі © OpenStreetMap</p>
    </div>
  );
}
