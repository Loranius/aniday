import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { useAppData } from '@/app/appDataContext';
import { toISODate } from '@/domain/dates';
import { entryCost } from '@/domain/fuel';
import type { FuelType } from '@/domain/types';
import { parseNumber, validateOdometer } from '@/domain/validation';
import { formatDate, formatKm, formatMoney, formatMoney2, formatNumber1 } from '@/ui/format';
import { Banner, Button, Card, EmptyState, Field, Input, PageHeader, SectionTitle, Select, Sheet, Stat, Toggle } from '@/ui/primitives';
import { BackLink } from '@/ui/BackLink';
import { FUEL_LABELS } from '@/features/vehicle/labels';

export function FuelScreen() {
  const { bundle, overview, actions } = useAppData();
  const [adding, setAdding] = useState(false);
  if (!bundle || !overview) return null;
  const f = overview.fuel;

  return (
    <div>
      <PageHeader back={<BackLink to="/more" />} title="Паливо" action={<Button onClick={() => setAdding(true)}>+ Заправка</Button>} />
      <Card className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Середня витрата" value={f.litersPer100Km != null ? `${formatNumber1(f.litersPer100Km)} л/100 км` : '—'} />
        <Stat label="Вартість км" value={f.costPerKm != null ? formatMoney2(f.costPerKm) : '—'} sub={f.costPer100Km != null ? `${formatMoney(f.costPer100Km)} / 100 км` : undefined} />
        <Stat label="Цей місяць" value={formatMoney(f.monthToDate)} />
        <Stat label="Середньо за місяць" value={f.monthlyAverage != null ? formatMoney(f.monthlyAverage) : '—'} />
        <Stat label="За 12 місяців" value={formatMoney(f.last365)} />
      </Card>
      {f.litersPer100Km == null && (
        <p className="mt-2 px-1 text-xs text-muted">Витрата рахується між двома повними баками — потрібно щонайменше дві заправки «до повного».</p>
      )}

      <SectionTitle>Заправки</SectionTitle>
      {bundle.fuelEntries.length === 0 ? (
        <EmptyState icon="⛽" title="Ще немає заправок" text="Записуйте заправки — і застосунок порахує витрату та вартість кілометра." />
      ) : (
        <Card className="divide-y divide-line py-1">
          {bundle.fuelEntries.map((e) => {
            const cost = entryCost(e);
            return (
              <div key={e.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{formatDate(e.date)}</span>
                    <span className="tabular font-semibold">{formatNumber1(e.liters)} л</span>
                  </div>
                  <div className="tabular flex justify-between gap-2 text-sm text-muted">
                    <span className="truncate">
                      {formatKm(e.odometer)}
                      {e.station && ` · ${e.station}`}
                      {!e.full_tank && ' · не повний'}
                    </span>
                    <span>{cost != null ? formatMoney(cost) : ''}</span>
                  </div>
                </div>
                <button aria-label="Видалити" className="grid h-11 w-11 place-items-center text-muted" onClick={() => confirm('Видалити заправку?') && void actions.deleteFuelEntry(e.id)}>
                  <Trash2 size={18} />
                </button>
              </div>
            );
          })}
        </Card>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title="Нова заправка">
        <FuelForm
          currentOdometer={overview.odometer.total}
          fuelType={bundle.vehicle.fuel_type}
          lastPrice={bundle.fuelEntries[0]?.price_per_liter ?? null}
          onSubmit={async (e) => {
            await actions.addFuelEntry(e);
            setAdding(false);
          }}
        />
      </Sheet>
    </div>
  );
}

function FuelForm({
  currentOdometer,
  fuelType,
  lastPrice,
  onSubmit,
}: {
  currentOdometer: number;
  fuelType: FuelType;
  lastPrice: number | null;
  onSubmit: (e: {
    date: string;
    odometer: number;
    liters: number;
    price_per_liter: number | null;
    total_cost: number | null;
    fuel_type: FuelType;
    station: string | null;
    full_tank: boolean;
    notes: string | null;
  }) => Promise<void>;
}) {
  const [date, setDate] = useState(toISODate(new Date()));
  const [odometer, setOdometer] = useState(String(Math.round(currentOdometer)));
  const [liters, setLiters] = useState('');
  const [price, setPrice] = useState(lastPrice != null ? String(lastPrice) : '');
  const [total, setTotal] = useState('');
  const [type, setType] = useState<FuelType>(fuelType);
  const [station, setStation] = useState('');
  const [full, setFull] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const l = parseNumber(liters);
  const p = parseNumber(price);
  const computedTotal = Number.isFinite(l) && Number.isFinite(p) ? Math.round(l * p * 100) / 100 : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const odo = parseNumber(odometer);
    const err = validateOdometer(odo) ?? (!(l > 0) || l >= 1000 ? 'Вкажіть кількість літрів' : null);
    if (err) return setError(err);
    const t = total ? parseNumber(total) : computedTotal;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        date,
        odometer: Math.round(odo * 10) / 10,
        liters: Math.round(l * 100) / 100,
        price_per_liter: Number.isFinite(p) ? p : null,
        total_cost: t != null && Number.isFinite(t) ? t : null,
        fuel_type: type,
        station: station.trim() || null,
        full_tank: full,
        notes: null,
      });
    } catch (er) {
      setError(er instanceof Error ? er.message : String(er));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Дата">
          <Input type="date" required value={date} max={toISODate(new Date())} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Пробіг, км">
          <Input inputMode="decimal" required value={odometer} onChange={(e) => setOdometer(e.target.value)} />
        </Field>
        <Field label="Літри">
          <Input inputMode="decimal" required value={liters} onChange={(e) => setLiters(e.target.value)} placeholder="40" />
        </Field>
        <Field label="Ціна за л, грн">
          <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="57.90" />
        </Field>
        <Field label="Сума, грн" hint={computedTotal != null && !total ? `≈ ${formatMoney2(computedTotal)}` : undefined}>
          <Input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
        </Field>
        <Field label="Паливо">
          <Select value={type} onChange={(e) => setType(e.target.value as FuelType)}>
            {Object.entries(FUEL_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="АЗС">
        <Input maxLength={120} value={station} onChange={(e) => setStation(e.target.value)} placeholder="WOG, ОККО…" />
      </Field>
      <Toggle checked={full} onChange={setFull} label="Заправка до повного баку" />
      {error && <Banner tone="error">{error}</Banner>}
      <Button type="submit" className="w-full" disabled={busy}>
        Зберегти
      </Button>
    </form>
  );
}
