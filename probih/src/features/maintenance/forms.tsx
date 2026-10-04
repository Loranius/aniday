import { useState, type FormEvent } from 'react';
import type { MaintenanceItemInput } from '@/app/appDataContext';
import { toISODate } from '@/domain/dates';
import { CATEGORY_LABELS } from '@/domain/maintenance';
import type { MaintenanceCategory, MaintenanceEvent, MaintenanceItem } from '@/domain/types';
import { parseNumber, validateOdometer } from '@/domain/validation';
import { newId } from '@/data/ids';
import { Banner, Button, Field, Input, Select, Textarea, Toggle } from '@/ui/primitives';

type EventInput = Omit<MaintenanceEvent, 'id' | 'vehicle_id' | 'created_at'>;

export function MaintenanceItemForm({
  item,
  onSubmit,
}: {
  item?: MaintenanceItem;
  onSubmit: (item: MaintenanceItemInput, initialService: { date: string; odometer: number } | null) => Promise<void>;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [icon, setIcon] = useState(item?.icon ?? '🔧');
  const [category, setCategory] = useState<MaintenanceCategory>(item?.category ?? 'other');
  const [km, setKm] = useState(item?.interval_km ? String(item.interval_km) : '');
  const [months, setMonths] = useState(item?.interval_days ? String(Math.round((item.interval_days / 30.4375) * 10) / 10) : '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [enabled, setEnabled] = useState(item?.enabled ?? true);
  const [lastDate, setLastDate] = useState('');
  const [lastOdo, setLastOdo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const intervalKm = km ? Math.round(parseNumber(km)) : null;
    const intervalDays = months ? Math.round(parseNumber(months) * 30.4375) : null;
    if (intervalKm == null && intervalDays == null) return setError('Вкажіть інтервал у км або місяцях (або обидва)');
    if ((intervalKm != null && !(intervalKm > 0)) || (intervalDays != null && !(intervalDays > 0))) return setError('Інтервал має бути більше нуля');
    let initial: { date: string; odometer: number } | null = null;
    if (!item && (lastDate || lastOdo)) {
      const o = parseNumber(lastOdo);
      if (!lastDate || validateOdometer(o)) return setError('Для останньої заміни вкажіть і дату, і пробіг');
      initial = { date: lastDate, odometer: o };
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(
        { id: item?.id ?? newId(), name: name.trim(), icon: icon || '🔧', category, interval_km: intervalKm, interval_days: intervalDays, notes: notes.trim() || null, enabled },
        initial,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-[5rem_1fr] gap-3">
        <Field label="Іконка">
          <Input maxLength={4} value={icon} onChange={(e) => setIcon(e.target.value)} className="text-center text-xl" />
        </Field>
        <Field label="Назва">
          <Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Моторне масло" />
        </Field>
      </div>
      <Field label="Категорія">
        <Select value={category} onChange={(e) => setCategory(e.target.value as MaintenanceCategory)}>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Кожні, км">
          <Input inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} placeholder="10 000" />
        </Field>
        <Field label="або кожні, міс.">
          <Input inputMode="decimal" value={months} onChange={(e) => setMonths(e.target.value)} placeholder="12" />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-muted">Що настане раніше. Залиште одне поле порожнім, якщо інтервал лише за пробігом або лише за часом.</p>
      {!item && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Остання заміна — дата">
            <Input type="date" max={toISODate(new Date())} value={lastDate} onChange={(e) => setLastDate(e.target.value)} />
          </Field>
          <Field label="— пробіг, км">
            <Input inputMode="decimal" value={lastOdo} onChange={(e) => setLastOdo(e.target.value)} />
          </Field>
        </div>
      )}
      <Field label="Нотатки">
        <Textarea maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Напр.: 5W-30, 4.3 л" />
      </Field>
      <Toggle checked={enabled} onChange={setEnabled} label="Відстежувати" />
      {error && <Banner tone="error">{error}</Banner>}
      <Button type="submit" className="w-full" disabled={busy}>
        Зберегти
      </Button>
    </form>
  );
}

export function MaintenanceEventForm({
  items,
  defaultItemId,
  currentOdometer,
  onSubmit,
}: {
  items: MaintenanceItem[];
  defaultItemId?: string;
  currentOdometer: number;
  onSubmit: (ev: EventInput) => Promise<void>;
}) {
  const [itemId, setItemId] = useState(defaultItemId ?? items[0]?.id ?? '');
  const [date, setDate] = useState(toISODate(new Date()));
  const [odometer, setOdometer] = useState(String(Math.round(currentOdometer)));
  const [cost, setCost] = useState('');
  const [provider, setProvider] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const odo = parseNumber(odometer);
    const odoErr = validateOdometer(odo);
    if (odoErr) return setError(odoErr);
    const c = cost ? parseNumber(cost) : null;
    if (c != null && !(c >= 0)) return setError('Невірна вартість');
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ maintenance_item_id: itemId, date, odometer: Math.round(odo * 10) / 10, cost: c, provider: provider.trim() || null, notes: notes.trim() || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Що замінено">
        <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.icon} {i.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Дата">
          <Input type="date" required max={toISODate(new Date())} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Пробіг, км">
          <Input inputMode="decimal" required value={odometer} onChange={(e) => setOdometer(e.target.value)} />
        </Field>
        <Field label="Вартість, грн">
          <Input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="1 850" />
        </Field>
        <Field label="СТО / де">
          <Input maxLength={120} value={provider} onChange={(e) => setProvider(e.target.value)} />
        </Field>
      </div>
      <Field label="Нотатки">
        <Textarea maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {error && <Banner tone="error">{error}</Banner>}
      <Button type="submit" className="w-full" disabled={busy || !itemId}>
        Записати заміну
      </Button>
    </form>
  );
}
