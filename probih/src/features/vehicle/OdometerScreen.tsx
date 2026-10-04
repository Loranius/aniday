import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { useAppData } from '@/app/appDataContext';
import type { OdometerEntryKind } from '@/domain/types';
import { parseNumber, validateOdometer } from '@/domain/validation';
import { formatDate, formatInt, formatKm } from '@/ui/format';
import { Banner, Button, Card, Field, Input, PageHeader, SectionTitle, Select } from '@/ui/primitives';
import { BackLink } from '@/ui/BackLink';

export function OdometerScreen() {
  const { bundle, overview, actions } = useAppData();
  const [kind, setKind] = useState<OdometerEntryKind>('reading');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [initial, setInitial] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!bundle || !overview) return null;
  const o = overview.odometer;

  async function add(e: FormEvent) {
    e.preventDefault();
    const n = parseNumber(value);
    const err = validateOdometer(n) ?? (kind === 'manual_distance' && n <= 0 ? 'Вкажіть кілометри' : null);
    if (err) return setError(err);
    if (kind === 'reading' && n < o.total - 0.5 && !confirm(`Нове значення менше за поточне (${formatInt(o.total)} км). Скоригувати вниз?`)) return;
    setError(null);
    await actions.addOdometerEntry(kind, Math.round(n * 10) / 10, note.trim());
    setValue('');
    setNote('');
  }

  const entries = [...bundle.odometerEntries].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));

  return (
    <div>
      <PageHeader back={<BackLink to="/more" />} title="Пробіг" />
      <Card className="mt-2">
        <div className="text-sm text-muted">Поточний пробіг</div>
        <div className="tabular text-3xl font-semibold">{formatKm(o.total)}</div>
        <div className="tabular mt-3 space-y-1 border-t border-line pt-3 text-sm text-muted">
          <div className="flex justify-between">
            <span>{o.baselineAt ? `Показник від ${formatDate(o.baselineAt)}` : 'Початковий пробіг'}</span>
            <span>{formatKm(o.baseline)}</span>
          </div>
          <div className="flex justify-between">
            <span>+ поїздки (GPS)</span>
            <span>{formatKm(o.tripsKm, 1)}</span>
          </div>
          <div className="flex justify-between">
            <span>+ додано вручну</span>
            <span>{formatKm(o.manualKm, 1)}</span>
          </div>
        </div>
      </Card>

      <SectionTitle>Коригування</SectionTitle>
      <Card>
        <form onSubmit={add} className="space-y-4">
          <Field label="Тип">
            <Select value={kind} onChange={(e) => setKind(e.target.value as OdometerEntryKind)}>
              <option value="reading">Показник одометра зараз (коригування)</option>
              <option value="manual_distance">Додати кілометри без GPS</option>
            </Select>
          </Field>
          <Field label={kind === 'reading' ? 'Що показує одометр, км' : 'Скільки км додати'} error={error}>
            <Input inputMode="decimal" required value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Field label="Коментар">
            <Input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Напр.: поїздка без телефону" />
          </Field>
          <Button type="submit" className="w-full">
            Зберегти
          </Button>
        </form>
      </Card>

      {entries.length > 0 && (
        <>
          <SectionTitle>Журнал змін</SectionTitle>
          <Card className="divide-y divide-line py-1">
            {entries.map((e) => (
              <div key={e.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{e.kind === 'reading' ? `Показник: ${formatKm(e.value_km)}` : `+ ${formatKm(e.value_km, 1)} вручну`}</div>
                  <div className="text-sm text-muted">
                    {formatDate(e.recorded_at)}
                    {e.note && ` · ${e.note}`}
                  </div>
                </div>
                <button aria-label="Видалити" className="grid h-11 w-11 place-items-center text-muted" onClick={() => confirm('Видалити запис?') && void actions.deleteOdometerEntry(e.id)}>
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </Card>
        </>
      )}

      <SectionTitle>Початковий пробіг</SectionTitle>
      <Card>
        <form
          className="flex items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const n = parseNumber(initial);
            if (validateOdometer(n)) return;
            await actions.updateVehicle({ initial_odometer: Math.round(n * 10) / 10 });
            setInitial('');
          }}
        >
          <div className="flex-1">
            <Field label={`Зараз: ${formatKm(bundle.vehicle.initial_odometer)}`}>
              <Input inputMode="decimal" value={initial} onChange={(e) => setInitial(e.target.value)} placeholder="Нове значення" />
            </Field>
          </div>
          <Button type="submit" variant="secondary" disabled={!initial}>
            Змінити
          </Button>
        </form>
        {o.baselineAt && <p className="mt-2 text-xs text-muted">Зараз діє показник з журналу — початковий пробіг не впливає на підсумок.</p>}
      </Card>
      <div className="mt-4">
        <Banner>Пробіг рахується автоматично і не редагується напряму. Кожна зміна фіксується в журналі.</Banner>
      </div>
    </div>
  );
}
