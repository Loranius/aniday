import { useState, type FormEvent } from 'react';
import type { VehicleInput } from '@/app/appDataContext';
import type { FuelType, Transmission } from '@/domain/types';
import { normalizePlate, normalizeVin, parseNumber, validateOdometer, validateVin, vinHint } from '@/domain/validation';
import { Banner, Button, Field, Input, Select } from '@/ui/primitives';
import { FUEL_LABELS, TRANSMISSION_LABELS } from './labels';

export function VehicleForm({
  initial,
  submitLabel,
  onSubmit,
  showOdometer = true,
}: {
  initial?: Partial<VehicleInput>;
  submitLabel: string;
  onSubmit: (v: VehicleInput) => Promise<void>;
  showOdometer?: boolean;
}) {
  const [make, setMake] = useState(initial?.make ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [year, setYear] = useState(initial?.year ? String(initial.year) : '');
  const [engine, setEngine] = useState(initial?.engine ?? '');
  const [transmission, setTransmission] = useState<Transmission | ''>(initial?.transmission ?? '');
  const [fuel, setFuel] = useState<FuelType>(initial?.fuel_type ?? 'petrol');
  const [vin, setVin] = useState(initial?.vin ?? '');
  const [plate, setPlate] = useState(initial?.license_plate ?? '');
  const [odometer, setOdometer] = useState(initial?.initial_odometer != null ? String(initial.initial_odometer) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const vinNorm = normalizeVin(vin);
  const vinErr = validateVin(vinNorm);
  const odo = parseNumber(odometer);
  const odoErr = showOdometer && odometer !== '' ? validateOdometer(odo) : null;
  const yearNum = year ? Number(year) : null;
  const yearErr = yearNum != null && (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > 2100) ? 'Невірний рік' : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (vinErr || odoErr || yearErr) return;
    if (showOdometer && !Number.isFinite(odo)) return setError('Вкажіть поточний пробіг');
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        make: make.trim(),
        model: model.trim(),
        year: yearNum,
        engine: engine.trim() || null,
        transmission: transmission || null,
        fuel_type: fuel,
        vin: vinNorm || null,
        license_plate: normalizePlate(plate) || null,
        initial_odometer: showOdometer ? Math.round(odo * 10) / 10 : (initial?.initial_odometer ?? 0),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Марка">
          <Input required maxLength={60} value={make} onChange={(e) => setMake(e.target.value)} placeholder="Nissan" />
        </Field>
        <Field label="Модель">
          <Input required maxLength={60} value={model} onChange={(e) => setModel(e.target.value)} placeholder="Tiida" />
        </Field>
        <Field label="Рік" error={yearErr}>
          <Input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))} placeholder="2008" />
        </Field>
        <Field label="Двигун">
          <Input maxLength={60} value={engine} onChange={(e) => setEngine(e.target.value)} placeholder="1.6 бензин" />
        </Field>
        <Field label="КПП">
          <Select value={transmission} onChange={(e) => setTransmission(e.target.value as Transmission | '')}>
            <option value="">—</option>
            {Object.entries(TRANSMISSION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Паливо">
          <Select value={fuel} onChange={(e) => setFuel(e.target.value as FuelType)}>
            {Object.entries(FUEL_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="VIN" error={vinErr} hint={vinHint(vinNorm) ?? 'VIN ідентифікує авто, але не дає його GPS-позиції.'}>
        <Input autoCapitalize="characters" value={vin} onChange={(e) => setVin(e.target.value)} placeholder="JN1…" />
      </Field>
      <Field label="Держномер">
        <Input autoCapitalize="characters" maxLength={16} value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="AA 1234 BB" />
      </Field>
      {showOdometer && (
        <Field label="Поточний пробіг, км" error={odoErr} hint="З цього значення почнеться облік. Далі пробіг рахується автоматично з поїздок.">
          <Input inputMode="decimal" required value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder="184 000" />
        </Field>
      )}
      {error && <Banner tone="error">{error}</Banner>}
      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy ? 'Зберігаю…' : submitLabel}
      </Button>
    </form>
  );
}
